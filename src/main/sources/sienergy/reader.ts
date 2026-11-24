import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

export interface SienergyGraphic {
  representation: number;
  reference: string | null;
  drawing: string | null;
  widthMm: number | null;
  dimensionsMm: number[];
  sourceLine: number;
  sizeCode?:number;layer?:string;payload?:number[];
}
export interface SienergyRecord {
  id: string; kind: number; parentId: string | null; sourceLine: number;
  localCode: string; manufacturerCode: string | null; identifier: string; title: string;
  graphics: SienergyGraphic[]; references: string[];
  articleFlags?:number;description?:string;component?:{targetId:string;quantity:number}|null;
}
export interface SienergySource {
  header: string; sha256: string; lineCount: number;
  records: Map<string, SienergyRecord>;
  diagnostics: { code: string; line: number }[];
}

/** The source uses backslash escapes inside apostrophe-delimited strings. */
export function sienergyTokens(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i]!)) { i++; continue; }
    if (line[i] === "'") {
      i++; let value = "", closed = false;
      while (i < line.length) {
        const c = line[i++]!;
        if (c === "'") { closed = true; break; }
        if (c === "\\" && i < line.length) value += line[i++]!;
        else value += c;
      }
      if (!closed) throw new Error("Unterminated Sienergy string");
      out.push(value);
    } else {
      const start = i;
      while (i < line.length && !/\s/.test(line[i]!)) i++;
      out.push(line.slice(start, i));
    }
  }
  return out;
}

const headerPattern = /^(\d+) (3|5|7|9) ([0-9a-f]+) [0-9a-f]+ [0-9a-f]{8} /;
const quoted = (line: string) => [...line.matchAll(/'((?:\\.|[^'\\])*)'/g)]
  .map(m => m[1]!.replace(/\\(.)/g, "$1"));
const referenceIds = (line: string) => [...line.matchAll(/0:([0-9a-f]+)\[\d+\]\([^)]*\)/g)].map(m => m[1]!);
const positive = (value: string | undefined): number | null => {
  const n = Number(value); return value !== undefined && Number.isFinite(n) && n > 0 ? n : null;
};

/** Stream bytes, retaining only source facts needed by engineering normalization. */
export async function readSienergySource(filename: string): Promise<SienergySource> {
  const records = new Map<string, SienergyRecord>();
  const diagnostics: SienergySource["diagnostics"] = [];
  const stack: { depth: number; id: string; prefix: string }[] = [];
  const hash = createHash("sha256"), decoder = new TextDecoder("windows-1252");
  let pending = "", header = "", lineCount = 0, catalogue = true;
  let current: { depth: number; kind: number; id: string; line: number; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const { depth, kind, id, line, body } = current;
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    const parent = stack.at(-1), strings = quoted(body[kind === 3 ? 0 : 1] ?? "");
    const local = kind === 7 ? strings[0] ?? "" : "";
    const inherited = parent?.prefix ?? "";
    const ownPrefix = kind === 5 ? strings[0] || inherited : inherited;
    // Group prefixes can also be commercial classifications (e.g. IT2). Only
    // reconstruct a short code when the stored full identifier corroborates it.
    const manufacturerCode = local ? (inherited && strings[1] === inherited + local
      ? inherited + local : local) : null;
    const graphics: SienergyGraphic[] = [];
    for (let k = 0; k < body.length; k++) {
      const text = body[k]!;
      if (!/^0 \d+ 3 \d+ /.test(text)) continue;
      const tokens = sienergyTokens(text), refs = referenceIds(text);
      const names = quoted(text);
      let widthMm: number | null = null;
      // This exact record shape stores nominal mounting span, not body dimensions.
      if (tokens[1] === "168" && tokens[3] === "1" && refs.length === 0) {
        const span = /^(\d+) (\d+\.\d+)\s*$/.exec(body[k + 4] ?? "");
        if (span) widthMm = positive(span[2]);
      }
      const lastString = text.lastIndexOf("'");
      const dimensions = refs.length === 0 && ["390","164","184","208"].includes(tokens[1]!)
        ? text.slice(lastString + 1).trim().split(/\s+/).slice(0, 3).map(Number) : [];
      const payload=refs.length?[]:(body[k+4]??"").trim().split(/\s+/).map(Number);
      graphics.push({ representation: Number(tokens[3]), reference: refs[0] ?? null,
        drawing: refs.length ? null : names[0] || null, widthMm,
        dimensionsMm: dimensions.every(n => Number.isFinite(n) && n >= 0) ? dimensions : [],
        sourceLine: line + k + 1,sizeCode:Number(tokens[1]),layer:names.at(-1)??"",
        payload:payload.every(Number.isFinite)?payload:[] });
    }
    if (records.has(id)) throw new Error(`Duplicate material object ${id} at line ${line}`);
    const componentLine=kind===9?/^0:([a-f0-9]+)\[\d+\]\([^)]*\)\s+'(?:\\.|[^'\\])*'\s+0\s+(\d+(?:\.\d+)?)\s+(?:19|51)\s*;/.exec(body[0]??""):null;
    records.set(id, { id, kind, parentId: parent?.id ?? null, sourceLine: line,
      localCode: local, manufacturerCode, identifier: kind === 7 ? strings[1] ?? "" : "",
      title: kind === 3 ? strings[1] ?? "" : kind === 5 ? strings[1] ?? "" : strings[3] ?? "",
      articleFlags:kind===7?Number(/^\d+/.exec(body[1]??"")?.[0]??0):0,description:kind===7?strings[2]??"":"",
      component:componentLine?{targetId:componentLine[1]!,quantity:Number(componentLine[2])}:null,
      graphics, references: [...new Set(body.flatMap(referenceIds))] });
    if (kind !== 9) stack.push({ depth, id, prefix: ownPrefix });
    current = null;
  };
  const acceptLine = (text: string) => {
    lineCount++;
    if (lineCount === 1) {
      header = text;
      if (!/^EXEL S\.R\.L\. integra5 .* 1 \d+/.test(header)) throw new Error("Unsupported Sienergy master format");
    }
    if (!catalogue) return;
    // A separate selector namespace follows the material graph; its IDs may overlap.
    if (/^0 10 [0-9a-f]+ 0\s*;/.test(text)) { flush(); catalogue = false; return; }
    const h = headerPattern.exec(text);
    if (h) {
      flush(); current = {depth:Number(h[1]),kind:Number(h[2]),id:h[3]!,line:lineCount,body:[]};
    } else if (current) {
      if (current.body.length >= 10000) throw new Error(`Oversized source record at ${current.line}`);
      current.body.push(text);
    }
  };
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk); pending += decoder.decode(chunk, {stream:true});
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      acceptLine(pending.slice(0, end).replace(/\r$/, "")); pending = pending.slice(end + 1);
    }
    if (pending.length > 2_000_000) throw new Error("Oversized Sienergy source line");
  }
  pending += decoder.decode(); if (pending) acceptLine(pending); flush();
  if (!records.size) throw new Error("Empty Sienergy material graph");
  return {header,sha256:hash.digest("hex"),lineCount,records,diagnostics};
}
