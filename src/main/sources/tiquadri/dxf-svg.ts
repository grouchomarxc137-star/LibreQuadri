/** Convert the limited DXF R12 BLOCK vocabulary used by drawing imports into inert SVG. */
export interface DrawingSvg {
  readonly svg: string;
  readonly entities: number;
  readonly unsupported: readonly string[];
}

type Pair = { code: number; value: string };
type Point = { x: number; y: number };
const fmt = (n: number): string => Number(n.toFixed(5)).toString();

function pairs(source: string): Pair[] {
  const lines = source.replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2) throw new Error("Incomplete DXF group pair");
  const result: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isSafeInteger(code)) throw new Error("Invalid DXF group code");
    result.push({ code, value: lines[i + 1]!.trim() });
  }
  return result;
}

function field(groups: readonly Pair[], code: number): number | undefined {
  const raw = groups.find(group => group.code === code)?.value;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error("Invalid DXF coordinate");
  return value;
}

function point(groups: readonly Pair[], xCode: number, yCode: number): Point | null {
  const x = field(groups, xCode), y = field(groups, yCode);
  return x === undefined || y === undefined ? null : { x, y: -y };
}

export function convertDxfBlock(source: string): DrawingSvg {
  if (source.length > 5_000_000) throw new Error("DXF block is too large");
  const input = pairs(source);
  const strokes: string[] = [], fills: string[] = [], bounds: Point[] = [];
  const unsupported = new Set<string>();
  let entities = 0, inBlock = false, ended = false;
  let vertices: Point[] | null = null, polyClosed = false, polyUnsupported = false;
  const add = (collection: string[], d: string, points: readonly Point[]) => {
    collection.push(d); bounds.push(...points); entities++;
  };
  const xy = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`;
  const flushPoly = () => {
    if (vertices?.length && vertices.length > 1 && !polyUnsupported) {
      add(strokes, `M ${vertices.map(xy).join(" L ")}${polyClosed ? " Z" : ""}`, vertices);
    }
    vertices = null;
    polyUnsupported = false;
  };
  for (let i = 0; i < input.length;) {
    if (input[i]!.code !== 0) throw new Error("DXF entity marker expected");
    const kind = input[i++]!.value.toUpperCase();
    const groups: Pair[] = [];
    while (i < input.length && input[i]!.code !== 0) groups.push(input[i++]!);
    if (kind === "BLOCK") { if (inBlock) throw new Error("Nested DXF block"); inBlock = true; continue; }
    if (kind === "ENDBLK") { flushPoly(); ended = true; break; }
    if (!inBlock) throw new Error("DXF block header missing");
    if (kind === "POLYLINE") { flushPoly(); vertices = []; polyClosed = ((field(groups, 70) ?? 0) & 1) !== 0;
      if (((field(groups, 70) ?? 0) & ~1) !== 0) {unsupported.add("POLYLINE_FLAGS");polyUnsupported=true;}
      continue; }
    if (kind === "VERTEX") {
      const p = point(groups, 10, 20);
      if (vertices && p) vertices.push(p);
      if ((field(groups,42)??0)!==0) {unsupported.add("POLYLINE_BULGE");polyUnsupported=true;}
      continue;
    }
    if (kind === "SEQEND") { flushPoly(); continue; }
    if (kind === "LINE") {
      const a = point(groups, 10, 20), b = point(groups, 11, 21);
      if (a && b) add(strokes, `M ${xy(a)} L ${xy(b)}`, [a, b]);
    } else if (kind === "SOLID") {
      const a = point(groups, 10, 20), b = point(groups, 11, 21);
      const c = point(groups, 12, 22), d = point(groups, 13, 23);
      if (a && b && c) {
        const corners = d && (d.x !== c.x || d.y !== c.y) ? [a,b,d,c] : [a,b,c];
        add(fills, `M ${corners.map(xy).join(" L ")} Z`, corners);
      }
    } else if (kind === "CIRCLE" || kind === "ARC") {
      const center = point(groups, 10, 20), radius = field(groups, 40);
      if (!center || radius === undefined || radius <= 0) continue;
      const circleBounds = [
        {x:center.x-radius,y:center.y-radius},{x:center.x+radius,y:center.y+radius},
      ];
      if (kind === "CIRCLE") {
        const start = {x:center.x+radius,y:center.y};
        add(strokes, `M ${xy(start)} A ${fmt(radius)} ${fmt(radius)} 0 1 0 ${fmt(center.x-radius)} ${fmt(center.y)} A ${fmt(radius)} ${fmt(radius)} 0 1 0 ${xy(start)}`, circleBounds);
      } else {
        const startAngle = field(groups, 50), endAngle = field(groups, 51);
        if (startAngle === undefined || endAngle === undefined) continue;
        const span = ((endAngle - startAngle) % 360 + 360) % 360;
        const at = (degrees: number): Point => ({x:center.x+radius*Math.cos(degrees*Math.PI/180),
          y:center.y-radius*Math.sin(degrees*Math.PI/180)});
        const start = at(startAngle), end = at(endAngle);
        const arcBounds = [start,end];
        for (const angle of [0,90,180,270]) {
          if (((angle-startAngle)%360+360)%360 <= span) arcBounds.push(at(angle));
        }
        if (span > 0) add(strokes, `M ${xy(start)} A ${fmt(radius)} ${fmt(radius)} 0 ${span>180?1:0} 0 ${xy(end)}`, arcBounds);
      }
    } else if (kind === "POINT") {
      const p = point(groups, 10, 20);
      if (p) add(fills, `M ${fmt(p.x-0.1)} ${fmt(p.y-0.1)} h 0.2 v 0.2 h -0.2 Z`, [p]);
    } else unsupported.add(kind);
  }
  if (!ended || !inBlock || !entities || !bounds.length) throw new Error("DXF block has no supported geometry");
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (const p of bounds) {
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  if (maxX-minX<=0 || maxY-minY<=0) throw new Error("DXF block has degenerate extents");
  const width = maxX-minX, height = maxY-minY;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}"><path fill="none" stroke="currentColor" stroke-width="0.08" d="${strokes.join(" ")}"/><path fill="currentColor" d="${fills.join(" ")}"/></svg>`;
  return {svg,entities,unsupported:[...unsupported].sort()};
}
