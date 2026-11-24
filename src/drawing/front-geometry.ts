import type { FrontVectorAsset, ProjectAnnotation, ProjectConfiguredItem, ProjectPhysicalNode, ProjectPlacementRect } from "../shared/project.js";

type View = ProjectConfiguredItem["views"][number];
export type FrontViewBox = [number, number, number, number];
export interface Point { x: number; y: number; }
export interface Bounds { left: number; top: number; right: number; bottom: number; }

export function flatten(nodes: readonly ProjectPhysicalNode[]): ProjectPhysicalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

export function frontViewBoxNumbers(left:number,top:number,right:number,bottom:number,margin:number,
  zoom:number):FrontViewBox {
  const width=(right-left+2*margin)/zoom;
  const height=(bottom-top+2*margin)/zoom;
  return [(left+right-width)/2,(top+bottom-height)/2,width,height];
}

/** CSS pixels per drawing millimetre for an svg box showing `viewBox` with meet scaling; null before layout. */
export function drawingScale(box:{width:number;height:number},viewBox:readonly [number,number,number,number]):number|null {
  if(!(box.width>0)||!(box.height>0)||!(viewBox[2]>0)||!(viewBox[3]>0))return null;
  return Math.min(box.width/viewBox[2],box.height/viewBox[3]);
}

/** Smallest on-screen text height, in CSS pixels, that is still readable. */
export const MIN_LABEL_PX=7;
/** Average character advance of the UI face, as a fraction of the font size. */
const LABEL_ADVANCE=.62;

/**
 * The drawing-unit font size of an object's code label, or null when the label would not be
 * readable (docs/R17_VISUAL_DESIGN.md §5): wider than the object, or smaller on screen than
 * MIN_LABEL_PX at the current scale. With no scale yet every label that fits is kept.
 */
export function frontLabelSize(text:string,widthMm:number,heightMm:number,scale:number|null):number|null {
  const fontSize=Math.max(3,Math.min(10,widthMm/12,heightMm/3));
  if(text.length*fontSize*LABEL_ADVANCE>widthMm-4)return null;
  if(scale!==null&&fontSize*scale<MIN_LABEL_PX)return null;
  return fontSize;
}

/** What the Fronte Quadro draws for a root, and the exact viewBox it uses (needed for hit-testing). */
export function frontGeometry(root:ProjectPhysicalNode,items:readonly ProjectConfiguredItem[],zoom=1) {
  const byItem = new Map(items.map(item => [item.uuid, item]));
  const drawable = flatten([root]).map(node => {
    const item = node.itemUuid ? byItem.get(node.itemUuid) : undefined;
    const view = item?.views.find(shape => shape.viewCode === node.viewCode);
    return { node, item, view };
  }).filter(entry => entry.item && entry.view && entry.node.xMm !== null && entry.node.yMm !== null &&
    entry.view.widthMm > 0 && entry.view.heightMm > 0);
  if (drawable.length === 0) return null;
  const left = Math.min(...drawable.map(entry => entry.node.xMm!));
  const top = Math.min(...drawable.map(entry => entry.node.yMm!));
  const right = Math.max(...drawable.map(entry => entry.node.xMm! + entry.view!.widthMm));
  const bottom = Math.max(...drawable.map(entry => entry.node.yMm! + entry.view!.heightMm));
  const margin = Math.max(5, (right - left) * 0.02);
  const parentRects = new Map<string,ProjectPlacementRect>(drawable.map(({node,view})=>
    [node.uuid,{xMm:node.xMm!,yMm:node.yMm!,widthMm:view!.widthMm,heightMm:view!.heightMm}]));
  return { drawable, parentRects, viewBox: frontViewBoxNumbers(left,top,right,bottom,margin,zoom) };
}

/*
 * Combined Fronte Quadro. Every placed Carpenteria is a sector of one drawing. Persisted node
 * coordinates are never rewritten: a sector may carry a renderer-only display offset, and every
 * conversion between the two coordinate systems goes through it (display = persisted + offset).
 */

/** Visual gap between neighbouring sectors, in millimetres. */
export const SECTOR_GAP_MM = 50;
/** Tolerance for "already separated" so float noise never displaces a correctly placed root. */
const SEPARATION_EPSILON_MM = 1e-6;
/** On-screen height of a sector caption, in CSS pixels. */
export const CAPTION_PX = 12;
/** Space reserved above the sectors for their captions, as a multiple of the caption height. */
const CAPTION_BAND = 1.8;

export interface FrontDrawable { node: ProjectPhysicalNode; item: ProjectConfiguredItem; view: View; }

export function frontOptionLabelRects(entry: FrontDrawable, assets: Readonly<Record<string, FrontVectorAsset>>) {
  if (entry.node.nodeKind !== "enclosure" || entry.view.viewCode !== "front") return [];
  return (entry.item.frontOptionLabels ?? []).filter(label => Object.hasOwn(assets, label.assetKey)).map(label => ({
    assetKey: label.assetKey, x: entry.node.xMm! + label.xMm, y: entry.node.yMm! + label.yMm,
    width: label.widthMm, height: label.heightMm,
  }));
}

export interface FrontSector {
  root: ProjectPhysicalNode;
  /** Model name of the Carpenteria; the only caption. */
  label: string;
  drawable: FrontDrawable[];
  /** Container rectangles in persisted coordinates, as the backend's targets refer to them. */
  parentRects: Map<string, ProjectPlacementRect>;
  /** Drawn extent in persisted coordinates. */
  bounds: Bounds;
  /** Renderer-only offset added to persisted coordinates to get display coordinates. */
  offset: Point;
  /** Drawn extent in display coordinates. */
  displayBounds: Bounds;
}

export interface CombinedFrontGeometry {
  /** Left to right in display order: persisted root X, then Y, then UUID. */
  sectors: FrontSector[];
  /** Roots with nothing drawable; they are left out without affecting the others. */
  skipped: ProjectPhysicalNode[];
  /** Extent of all sectors in display coordinates. */
  bounds: Bounds | null;
  viewBox: FrontViewBox;
  /** Extent of everything drawn, display coordinates: the sectors plus, when shown, dimensions and annotations. */
  contentBounds: Bounds | null;
  /** Per-sector dimension placement shared by the canvas and PDF. */
  dimensionsByRoot: ReadonlyMap<string, SectorDimensions>;
  canCombineWidths: boolean;
  combinedWidth: CombinedFrontWidth | null;
  /** Left edges the viewBox may take by horizontal navigation; a single value when everything fits. */
  scrollRange: ScrollRange;
  /** Top edges the viewBox may take by vertical navigation; a single value when everything fits. */
  scrollRangeY: ScrollRange;
  /** Caption font size in drawing millimetres; null when there is a single sector. */
  captionMm: number | null;
}

function drawableOf(root: ProjectPhysicalNode, byItem: ReadonlyMap<string, ProjectConfiguredItem>): FrontDrawable[] {
  const found: FrontDrawable[] = [];
  for (const node of flatten([root])) {
    const item = node.itemUuid ? byItem.get(node.itemUuid) : undefined;
    const view = item?.views.find(shape => shape.viewCode === node.viewCode);
    if (item && view && node.xMm !== null && node.yMm !== null && view.widthMm > 0 && view.heightMm > 0)
      found.push({ node, item, view });
  }
  return found;
}

function boundsOf(drawable: readonly FrontDrawable[]): Bounds {
  return { left: Math.min(...drawable.map(entry => entry.node.xMm!)),
    top: Math.min(...drawable.map(entry => entry.node.yMm!)),
    right: Math.max(...drawable.map(entry => entry.node.xMm! + entry.view.widthMm)),
    bottom: Math.max(...drawable.map(entry => entry.node.yMm! + entry.view.heightMm)) };
}

function shifted(bounds: Bounds, offset: Point): Bounds {
  return { left: bounds.left + offset.x, top: bounds.top + offset.y,
    right: bounds.right + offset.x, bottom: bounds.bottom + offset.y };
}

/**
 * Deterministic left-to-right strip, bottom aligned. The first sector keeps its persisted X and
 * every following one is shown exactly SECTOR_GAP_MM after the sectors before it. Roots the
 * backend creates side by side are already one gap apart and keep zero X offset; an older
 * overlapping root is moved right and the hole left by a removed Carpenteria is closed, both on
 * screen only. Every sector then gets the Y offset that puts its floor (`floor`, the bottom edge
 * of the Carpenteria; the drawn extent's bottom when not given) on the lowest floor of all, so
 * Carpenterie of different heights stand on one line and equal ones need no Y offset.
 */
export function layoutSectors<T extends { root: ProjectPhysicalNode; bounds: Bounds; floor?: number }>(sectors: readonly T[]):
  (T & { offset: Point })[] {
  const order = [...sectors].sort((a, b) =>
    (a.root.xMm ?? a.bounds.left) - (b.root.xMm ?? b.bounds.left) ||
    (a.root.yMm ?? a.bounds.top) - (b.root.yMm ?? b.bounds.top) ||
    (a.root.uuid < b.root.uuid ? -1 : a.root.uuid > b.root.uuid ? 1 : 0));
  let cursor = -Infinity;
  const floorOf = (sector: T) => sector.floor ?? sector.bounds.bottom;
  const floor = Math.max(...order.map(floorOf));
  return order.map(sector => {
    let x = 0;
    if (cursor !== -Infinity && Math.abs(sector.bounds.left - (cursor + SECTOR_GAP_MM)) > SEPARATION_EPSILON_MM)
      x = cursor + SECTOR_GAP_MM - sector.bounds.left;
    cursor = Math.max(cursor, sector.bounds.right + x);
    const y = floor - floorOf(sector);
    return { ...sector, offset: { x, y: y === 0 ? 0 : y } };
  });
}

export interface ScrollRange { min: number; max: number; }

/**
 * The viewBox for a drawing extent. It is extended to the drawing box's own aspect ratio when
 * that is known, so everything visible in the box is inside the viewBox and hit-testable; zoom
 * above 1 centres on `focus`, kept inside the fitted extent, and at 1 or less on the extent.
 * `scrollX` (the viewBox's left edge) overrides the horizontal centring; it is display-only and
 * clamped to `range`, the span of left edges that keep the window inside the fitted extent
 * (min === max when the whole drawing fits).
 */
export function combinedViewport(bounds: Bounds, zoom: number, focus: Point | null, aspect: number | null,
  topExtra = 0, scrollX: number | null = null, scrollY: number | null = null):
  { viewBox: FrontViewBox; range: ScrollRange; rangeY: ScrollRange } {
  const margin = Math.max(5, (bounds.right - bounds.left) * 0.02);
  const left = bounds.left - margin, right = bounds.right + margin;
  const top = bounds.top - margin - topExtra, bottom = bounds.bottom + margin;
  let fullWidth = right - left, fullHeight = bottom - top;
  if (aspect !== null && aspect > 0) {
    if (fullWidth / fullHeight < aspect) fullWidth = fullHeight * aspect;
    else fullHeight = fullWidth / aspect;
  }
  const width = fullWidth / zoom, height = fullHeight / zoom;
  const centre = (mid: number, full: number, size: number, wanted: number | undefined) => {
    if (wanted === undefined || size >= full) return mid;
    const room = (full - size) / 2;
    return Math.max(mid - room, Math.min(mid + room, wanted));
  };
  const rangeOf = (mid: number, full: number, size: number): ScrollRange => size >= full
    ? { min: mid - size / 2, max: mid - size / 2 } : { min: mid - full / 2, max: mid + full / 2 - size };
  const midX = (left + right) / 2, midY = (top + bottom) / 2;
  const range = rangeOf(midX, fullWidth, width), rangeY = rangeOf(midY, fullHeight, height);
  const x = scrollX !== null && range.max > range.min ? Math.max(range.min, Math.min(range.max, scrollX))
    : centre(midX, fullWidth, width, focus?.x) - width / 2;
  const y = scrollY !== null && rangeY.max > rangeY.min ? Math.max(rangeY.min, Math.min(rangeY.max, scrollY))
    : centre(midY, fullHeight, height, focus?.y) - height / 2;
  return { viewBox: [x, y, width, height], range, rangeY };
}

export function combinedViewBox(bounds: Bounds, zoom: number, focus: Point | null, aspect: number | null,
  topExtra = 0): FrontViewBox {
  return combinedViewport(bounds, zoom, focus, aspect, topExtra).viewBox;
}

/** On-screen text height of an overall dimension, in CSS pixels. */
export const DIMENSION_TEXT_PX = 11;

/** The overall dimension graphics of one Carpenteria, in the sector's persisted coordinates. */
export interface SectorDimensions {
  /** The Carpenteria's own front rectangle (its snapshotted view), or the sector extent when it has none. */
  rect: Rect;
  widthMm: number;
  heightMm: number;
  /** Authoritative snapshotted outer enclosure depth; never the usable or device depth. */
  depthMm: number | null;
  /** Distance of the dimension lines from the Carpenteria's edge. */
  offsetMm: number;
  /** Largest text height the dimension may use, so its text stays inside the reserved band. */
  maxFontMm: number;
  /** A fitted depth callout above the sector, in persisted coordinates. */
  depthPlacement?: { right: number; bottom: number; width: number };
}

export interface CombinedFrontWidth {
  left: number;
  right: number;
  bottom: number;
  lineY: number;
  widthMm: number;
  offsetMm: number;
  maxFontMm: number;
}

/**
 * Overall width and height of a Carpenteria from its snapshotted front view. Pure presentation:
 * nothing here feeds placement, hit-testing or any persisted value.
 */
export function sectorDimensions(sector: Pick<FrontSector, "root" | "drawable" | "bounds">): SectorDimensions {
  const own = sector.drawable.find(entry => entry.node === sector.root);
  const rect: Rect = own
    ? { x: own.node.xMm!, y: own.node.yMm!, width: own.view.widthMm, height: own.view.heightMm }
    : { x: sector.bounds.left, y: sector.bounds.top, width: sector.bounds.right - sector.bounds.left,
      height: sector.bounds.bottom - sector.bounds.top };
  const offsetMm = Math.max(12, Math.min(20, Math.max(rect.width, rect.height) * 0.035));
  const outerDepth = own?.item.modelKind === "enclosure" ? own.item.outerDepthMm : null;
  const depthMm = typeof outerDepth === "number" && Number.isFinite(outerDepth) && outerDepth > 0 ? outerDepth : null;
  return { rect, widthMm: rect.width, heightMm: rect.height, depthMm, offsetMm, maxFontMm: offsetMm * 0.9 };
}

/** Text height of a dimension at the given drawing scale (null before layout): constant on screen, capped. */
export function dimensionFontMm(dimensions: Pick<SectorDimensions, "maxFontMm">, scale: number | null): number {
  return scale !== null && scale > 0 ? Math.min(DIMENSION_TEXT_PX / scale, dimensions.maxFontMm) : dimensions.maxFontMm;
}

/** Shared measurement formatting for the screen, SVG serializer and label bounds. */
export const dimensionMillimetres = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const combinedMillimetres = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: true });
export const combinedWidthLabel = (widthMm: number): string => `Totale carpenterie · ${combinedMillimetres.format(widthMm)} mm`;

interface DepthDimensionGeometry {
  start: Point;
  end: Point;
  label: Point;
  text: string;
  font: number;
  bounds: Bounds;
  arrowScale: number;
}

/** Schematic 45° depth dimension outside the upper-right corner: its graphic length never claims a third-axis projection. */
export function depthDimensionGeometry(dimensions: SectorDimensions, scale: number | null): DepthDimensionGeometry | null {
  if (dimensions.depthMm === null) return null;
  const font = dimensionFontMm(dimensions, scale);
  const text = dimensionMillimetres.format(dimensions.depthMm) + " mm";
  // Size for text, independently of depth. Use the maximum font so the placement stays fixed on zoom.
  const length = Math.max(dimensions.offsetMm * 3, text.length * dimensions.maxFontMm * .75 + 12);
  const leg = length / Math.SQRT2;
  const start = { x: dimensions.rect.x + dimensions.rect.width + dimensions.offsetMm * 2,
    y: dimensions.rect.y - dimensions.offsetMm };
  const end = { x: start.x + leg, y: start.y - leg };
  const label = { x: start.x + leg / 2 - font * .65, y: start.y - leg / 2 - font * .65 };
  // Conservative rotated text box, including glyph ascent/descent and the existing white halo.
  const halfWidth = text.length * font * .75 / 2, halfHeight = font * .8;
  const corners = [-1, 1].flatMap(x => [-1, 1].map(y => ({
    x: label.x + (x * halfWidth + y * halfHeight) / Math.SQRT2,
    y: label.y + (-x * halfWidth + y * halfHeight) / Math.SQRT2,
  })));
  const points = [start, end, ...corners];
  const bounds = { left: Math.min(...points.map(point => point.x)) - 2,
    top: Math.min(...points.map(point => point.y)) - 2,
    right: Math.max(...points.map(point => point.x)) + 2,
    bottom: Math.max(...points.map(point => point.y)) + 2 };
  const placement = dimensions.depthPlacement;
  if (!placement) return { start, end, label, text, font, bounds, arrowScale: 1 };

  // Anchor and fit against the maximum-size footprint so zoom cannot shift the line.
  const maximum = scale === null ? bounds : depthDimensionGeometry({ ...dimensions, depthPlacement: undefined }, null)!.bounds;
  const factor = Math.min(1, placement.width / (maximum.right - maximum.left));
  const place = (point: Point): Point => ({
    x: placement.right + (point.x - maximum.right) * factor,
    y: placement.bottom + (point.y - maximum.bottom) * factor,
  });
  const topLeft = place({ x: bounds.left, y: bounds.top });
  const bottomRight = place({ x: bounds.right, y: bounds.bottom });
  return { start: place(start), end: place(end), label: place(label), text, font: font * factor, arrowScale: factor,
    bounds: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y } };
}

/** All dimensions in persisted coordinates; display offsets are applied only by the sector. */
function dimensionBounds(dimensions: SectorDimensions, scale: number | null): Bounds {
  const band = dimensions.offsetMm + dimensionFontMm(dimensions, scale) / 2 + 2;
  const rect = dimensions.rect;
  const front = { left: rect.x - band, top: rect.y,
    right: rect.x + rect.width, bottom: rect.y + rect.height + band };
  // Reserve the maximum label size, covering both the PDF and any fitted/zoomed screen scale.
  const depth = depthDimensionGeometry(dimensions, null);
  return depth ? union(front, depth.bounds) : front;
}

/** Drawn extent of an annotation box (its position is the top-left corner). */
function annotationBounds(note: Pick<ProjectAnnotation, "xMm" | "yMm" | "widthMm" | "heightMm">): Bounds {
  return { left: note.xMm, top: note.yMm, right: note.xMm + note.widthMm, bottom: note.yMm + note.heightMm };
}

function union(a: Bounds, b: Bounds): Bounds {
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/**
 * Every root with drawable geometry as a sector of one drawing, with its display offset, the
 * combined viewBox and the maps needed to hit-test in persisted coordinates. `focusUuid` only
 * decides where zoom centres; it never changes which sectors exist. `dimensions` and `annotations`
 * change the area the viewBox may show so they stay reachable; they never move a sector.
 */
export function combinedFrontGeometry(roots: readonly ProjectPhysicalNode[], items: readonly ProjectConfiguredItem[],
  options: { zoom?: number; focusUuid?: string; viewportPx?: { width: number; height: number } | null;
    /** Display-only horizontal position (viewBox left edge); null centres on the focus. */ scrollX?: number | null;
    /** Display-only vertical position (viewBox top edge); null centres on the focus. */ scrollY?: number | null;
    /** Reserve room for each Carpenteria's overall dimensions. */ dimensions?: boolean;
    combinedWidths?: boolean;
    assets?: Readonly<Record<string, FrontVectorAsset>>;
    /** Text boxes, in drawing coordinates. */ annotations?: readonly Pick<ProjectAnnotation, "xMm" | "yMm" | "widthMm" | "heightMm">[] } = {}):
  CombinedFrontGeometry {
  const { zoom = 1, focusUuid, viewportPx = null, scrollX = null, scrollY = null, dimensions = false, annotations = [], assets = {} } = options;
  const byItem = new Map(items.map(item => [item.uuid, item]));
  const skipped: ProjectPhysicalNode[] = [];
  const natural = roots.flatMap(root => {
    const drawable = drawableOf(root, byItem);
    if (drawable.length === 0) { skipped.push(root); return []; }
    const own = drawable.find(entry => entry.node === root);
    let bounds = boundsOf(drawable);
    if (own) for (const { x, y, width, height } of frontOptionLabelRects(own, assets)) {
      bounds = union(bounds, { left: x, top: y, right: x + width, bottom: y + height });
    }
    return [{ root, drawable, bounds, floor: own ? own.node.yMm! + own.view.heightMm : bounds.bottom }];
  });
  const sectors: FrontSector[] = layoutSectors(natural).map(sector => ({
    ...sector,
    label: (sector.root.itemUuid ? byItem.get(sector.root.itemUuid)?.modelName : undefined) ?? "Carpenteria",
    parentRects: new Map(sector.drawable.map(({ node, view }) =>
      [node.uuid, { xMm: node.xMm!, yMm: node.yMm!, widthMm: view.widthMm, heightMm: view.heightMm }])),
    displayBounds: shifted(sector.bounds, sector.offset),
  }));
  const dimensionsByRoot = new Map<string, SectorDimensions>();
  const canCombineWidths = sectors.length > 1 && sectors.every(sector => sector.parentRects.has(sector.root.uuid));
  const aspect = viewportPx && viewportPx.width > 0 && viewportPx.height > 0 ? viewportPx.width / viewportPx.height : null;
  if (sectors.length === 0) {
    const contentBounds = annotations.reduce<Bounds | null>((bounds, note) => {
      const box = annotationBounds(note);
      return bounds ? union(bounds, box) : box;
    }, null);
    const viewport = contentBounds ? combinedViewport(contentBounds, zoom, null, aspect, 0, scrollX, scrollY) : null;
    const none = { min: 0, max: 0 };
    return { sectors, skipped, bounds: null, contentBounds, dimensionsByRoot, canCombineWidths, combinedWidth: null,
      viewBox: viewport?.viewBox ?? [0, 0, 1, 1], scrollRange: viewport?.range ?? none,
      scrollRangeY: viewport?.rangeY ?? none, captionMm: null };
  }
  const bounds: Bounds = { left: Math.min(...sectors.map(sector => sector.displayBounds.left)),
    top: Math.min(...sectors.map(sector => sector.displayBounds.top)),
    right: Math.max(...sectors.map(sector => sector.displayBounds.right)),
    bottom: Math.max(...sectors.map(sector => sector.displayBounds.bottom)) };
  // Dimensions and notes are sized from the fitted scale of the sectors alone: their text keeps its on-screen size,
  // so zooming only ever shrinks them in drawing units and this extent always covers them.
  const sectorScale = viewportPx ? drawingScale(viewportPx, combinedViewBox(bounds, 1, null, aspect)) : null;
  let baseBounds = bounds;
  let captionFitBounds = bounds;
  if (dimensions) for (const sector of sectors) {
    const dims = sectorDimensions(sector);
    dimensionsByRoot.set(sector.root.uuid, dims);
    // Keep the historical front reserve for sectors with descendants outside their own frame.
    const band = dims.offsetMm + dims.maxFontMm / 2 + 2;
    baseBounds = union(baseBounds, { left: sector.displayBounds.left - band, top: sector.displayBounds.top,
      right: sector.displayBounds.right, bottom: sector.displayBounds.bottom + band });
    captionFitBounds = union(captionFitBounds, shifted(dimensionBounds(dims, sectorScale), sector.offset));
  }
  let combinedWidth: CombinedFrontWidth | null = null;
  if (dimensions && options.combinedWidths && canCombineWidths) {
    const fronts = sectors.map(sector => ({ dims: dimensionsByRoot.get(sector.root.uuid)!, offset: sector.offset }));
    const left = Math.min(...fronts.map(({dims, offset}) => dims.rect.x + offset.x));
    const right = Math.max(...fronts.map(({dims, offset}) => dims.rect.x + dims.rect.width + offset.x));
    const bottom = Math.max(...fronts.map(({dims, offset}) => dims.rect.y + dims.rect.height + offset.y));
    const offsetMm = Math.max(...fronts.map(({dims}) => dims.offsetMm));
    const widthMm = fronts.reduce((sum, {dims}) => sum + dims.widthMm, 0);
    const lineY = bounds.bottom + offsetMm;
    const maxFontMm = Math.min(offsetMm * .9, (right - left) / (combinedWidthLabel(widthMm).length * .75));
    combinedWidth = { left, right, bottom, lineY, widthMm, offsetMm, maxFontMm };
    baseBounds = union(baseBounds, { left, right, top: bottom, bottom: lineY + maxFontMm / 2 + 2 });
  }
  for (const note of annotations) baseBounds = union(baseBounds, annotationBounds(note));
  captionFitBounds = union(captionFitBounds, baseBounds);
  let captionMm: number | null = null;
  let topExtra = 0;
  if (sectors.length > 1) {
    // Captions stay CAPTION_PX tall on screen: size them from the fitted scale, then reserve their band.
    const fitScale = viewportPx ? drawingScale(viewportPx, combinedViewBox(captionFitBounds, 1, null, aspect)) : null;
    const fitted = fitScale ? CAPTION_PX / fitScale : 10;
    topExtra = fitted * CAPTION_BAND;
    captionMm = fitScale ? CAPTION_PX / (fitScale * zoom) : 10;
  }
  let contentBounds = baseBounds;
  if (dimensions) {
    const occupied: Bounds[] = [];
    for (const sector of [...sectors].reverse()) {
      const dims = dimensionsByRoot.get(sector.root.uuid)!;
      const depth = depthDimensionGeometry(dims, null);
      const captionClearance = Math.max(topExtra, (captionMm ?? 0) * CAPTION_BAND);
      if (depth && occupied.some(other => overlaps(shifted(depth.bounds, sector.offset), other))) {
        dims.depthPlacement = { right: sector.bounds.right, bottom: sector.bounds.top - captionClearance - 2,
          width: sector.bounds.right - sector.bounds.left };
      }
      const placedDepth = depthDimensionGeometry(dims, null);
      if (placedDepth) occupied.push(shifted(placedDepth.bounds, sector.offset));
      const display = sector.displayBounds;
      occupied.push({ ...display, left: display.left - dims.offsetMm - dims.maxFontMm / 2 - 2,
        top: display.top - captionClearance });
      contentBounds = union(contentBounds, shifted(dimensionBounds(dims, sectorScale), sector.offset));
    }
  }
  const focus = sectors.find(sector => sector.root.uuid === focusUuid);
  const focusCentre = focus ? { x: (focus.displayBounds.left + focus.displayBounds.right) / 2,
    y: (focus.displayBounds.top + focus.displayBounds.bottom) / 2 } : null;
  const viewport = combinedViewport(contentBounds, zoom, focusCentre, aspect, topExtra, scrollX, scrollY);
  return { sectors, skipped, bounds, contentBounds, dimensionsByRoot, canCombineWidths, combinedWidth, captionMm, viewBox: viewport.viewBox,
    scrollRange: viewport.range, scrollRangeY: viewport.rangeY };
}

function inside(bounds: Bounds, point: Point): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

/** The sector whose drawing is under a display-space point; null in a gap or outside every sector. */
export function sectorAt(geometry: Pick<CombinedFrontGeometry, "sectors">, point: Point): FrontSector | null {
  return geometry.sectors.find(sector => inside(sector.displayBounds, point)) ?? null;
}

/** A display-space point in the sector's persisted (root) coordinates. */
export function toPersistedPoint(sector: Pick<FrontSector, "offset">, point: Point): Point {
  return { x: point.x - sector.offset.x, y: point.y - sector.offset.y };
}

/** A persisted-coordinate point in display coordinates. */
export function toDisplayPoint(sector: Pick<FrontSector, "offset">, point: Point): Point {
  return { x: point.x + sector.offset.x, y: point.y + sector.offset.y };
}

/** The sector that holds a container, by its parent uuid. */
export function sectorOfContainer(geometry: Pick<CombinedFrontGeometry, "sectors">, parentUuid: string): FrontSector | undefined {
  return geometry.sectors.find(sector => sector.parentRects.has(parentUuid));
}

/** Drag ghost bounds: true on-screen size at the drawing's scale, kept between a legible minimum and a modest maximum. */
export const GHOST_MIN_PX = 20;
export const GHOST_MAX_PX = 96;
export function ghostSize(view: Pick<View, "widthMm" | "heightMm">, scale: number | null): { width: number; height: number } {
  const factor = scale !== null && scale > 0 ? scale : 1;
  const width = view.widthMm * factor, height = view.heightMm * factor;
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 0, height: 0 };
  const fit = longest > GHOST_MAX_PX ? GHOST_MAX_PX / longest : longest < GHOST_MIN_PX ? GHOST_MIN_PX / longest : 1;
  return { width: width * fit, height: height * fit };
}

/** A caption shortened to what fits `widthMm` at `fontMm`, with an ellipsis when cut. */
export function captionText(label: string, widthMm: number, fontMm: number): string {
  const fits = Math.max(1, Math.floor((widthMm - 2) / (fontMm * LABEL_ADVANCE)));
  return label.length <= fits ? label : `${label.slice(0, Math.max(1, fits - 1))}…`;
}

/** Where the horizontal window sits, 0…1 across its range, and how much of the drawing it shows; null when everything fits. */
export function scrollThumb(geometry: Pick<CombinedFrontGeometry, "viewBox" | "scrollRange">):
  { start: number; size: number } | null {
  const { min, max } = geometry.scrollRange;
  if (!(max > min)) return null;
  const width = geometry.viewBox[2], total = max - min + width;
  return { start: (geometry.viewBox[0] - min) / total, size: width / total };
}

/** A scroll position (viewBox left edge) moved by `delta` millimetres and kept inside the range. */
export function scrolledX(geometry: Pick<CombinedFrontGeometry, "viewBox" | "scrollRange">, delta: number): number {
  const { min, max } = geometry.scrollRange;
  return Math.max(min, Math.min(max, geometry.viewBox[0] + delta));
}

type Nav = Pick<CombinedFrontGeometry, "viewBox" | "scrollRange">;
type Nav2 = Nav & Pick<CombinedFrontGeometry, "scrollRangeY">;

/** Where the vertical window sits, 0…1 across its range, and how much of the drawing it shows; null when everything fits. */
export function scrollThumbY(geometry: Pick<CombinedFrontGeometry, "viewBox" | "scrollRangeY">):
  { start: number; size: number } | null {
  const { min, max } = geometry.scrollRangeY;
  if (!(max > min)) return null;
  const height = geometry.viewBox[3], total = max - min + height;
  return { start: (geometry.viewBox[1] - min) / total, size: height / total };
}

/** A vertical scroll position (viewBox top edge) moved by `delta` millimetres and kept inside the range. */
export function scrolledY(geometry: Pick<CombinedFrontGeometry, "viewBox" | "scrollRangeY">, delta: number): number {
  const { min, max } = geometry.scrollRangeY;
  return Math.max(min, Math.min(max, geometry.viewBox[1] + delta));
}

/** New display-only position on each axis; null for an axis that does not move (it fits, or the input has no part in it). */
export interface PanTarget { x: number | null; y: number | null; }

/** Pixels one wheel "line" or "page" stands for when the device reports those units. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

/**
 * Pan for a wheel or trackpad gesture over the drawing. Each axis follows its own delta, so a two-axis
 * gesture (Magic Mouse, trackpad) moves both and a plain wheel moves vertically; Shift turns a pure
 * vertical wheel into a horizontal pan, as everywhere else. Only an axis that overflows moves; null when
 * neither does (the event is left alone), and Ctrl + wheel (pinch) is never taken.
 */
export function wheelPanTarget(geometry: Nav2, scale: number | null,
  event: { shiftKey: boolean; ctrlKey?: boolean; deltaX: number; deltaY: number; deltaMode?: number }): PanTarget | null {
  if (!scale || !(scale > 0) || event.ctrlKey) return null;
  const overflowX = scrollThumb(geometry) !== null, overflowY = scrollThumbY(geometry) !== null;
  if (!overflowX && !overflowY) return null;
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  let dx = event.deltaX * unit, dy = event.deltaY * unit;
  if (event.shiftKey && dx === 0) { dx = dy; dy = 0; }
  const x = overflowX && dx !== 0 ? scrolledX(geometry, dx / scale) : null;
  const y = overflowY && dy !== 0 ? scrolledY(geometry, dy / scale) : null;
  return x === null && y === null ? null : { x, y };
}

/** Share of the visible window one Ctrl/Cmd + arrow press moves. */
export const PAN_STEP_FRACTION = 0.25;

/**
 * Pan for Ctrl (or Cmd) + arrow while the drawing area itself is focused; null for any other key or
 * modifier mix, when the drawing is not focused, or when that axis does not overflow.
 */
export function keyPanTarget(geometry: Nav2, event: { key: string; altKey?: boolean; ctrlKey?: boolean;
  metaKey?: boolean; shiftKey?: boolean }, drawingFocused: boolean): PanTarget | null {
  if (!drawingFocused || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
  const step = (sign: number, size: number) => sign * size * PAN_STEP_FRACTION;
  switch (event.key) {
    case "ArrowLeft": case "ArrowRight": {
      if (!scrollThumb(geometry)) return null;
      return { x: scrolledX(geometry, step(event.key === "ArrowRight" ? 1 : -1, geometry.viewBox[2])), y: null };
    }
    case "ArrowUp": case "ArrowDown": {
      if (!scrollThumbY(geometry)) return null;
      return { x: null, y: scrolledY(geometry, step(event.key === "ArrowDown" ? 1 : -1, geometry.viewBox[3])) };
    }
    default: return null;
  }
}

/** Share of the visible width one arrow press moves. */
export const ARROW_SCROLL_FRACTION = 0.15;

/** New horizontal position for a Left/Right key; null unless the drawing area itself is focused and overflowing. */
export function keyScrollTarget(geometry: Nav, event: { key: string; altKey?: boolean; ctrlKey?: boolean;
  metaKey?: boolean; shiftKey?: boolean }, drawingFocused: boolean): number | null {
  if (!drawingFocused || !scrollThumb(geometry) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
  return scrolledX(geometry, (event.key === "ArrowRight" ? 1 : -1) * geometry.viewBox[2] * ARROW_SCROLL_FRACTION);
}

/** Selection outline distance outside the object, handle size (drawing mm) and tag text height (CSS px), per §3.5. */
export const SELECTION_GAP_MM = 1.5;
export const SELECTION_HANDLE_MM = 4.4;
export const SELECTION_TAG_PX = 10;
const TAG_PADDING_PX = 5;
const TAG_HEIGHT_PX = 16;

export interface Rect { x: number; y: number; width: number; height: number; }
export interface SelectionFrame {
  outline: Rect;
  /** Corner handles: top-left, top-right, bottom-right, bottom-left. */
  handles: Rect[];
  /** Article-code tag above the outline at constant on-screen size; null before layout gives a scale. */
  tag: (Rect & { fontSize: number; textX: number; textY: number }) | null;
}

/**
 * The orange selection of an object drawn at `rect` (the same coordinates the object uses, inside
 * its sector, so the sector's display offset applies to both). The tag keeps SELECTION_TAG_PX
 * text at every zoom: its drawing size is the pixel size divided by the current scale.
 */
export function selectionFrame(rect: Rect, label: string, scale: number | null): SelectionFrame {
  const outline = { x: rect.x - SELECTION_GAP_MM, y: rect.y - SELECTION_GAP_MM,
    width: rect.width + 2 * SELECTION_GAP_MM, height: rect.height + 2 * SELECTION_GAP_MM };
  const half = SELECTION_HANDLE_MM / 2;
  const handles = [[outline.x, outline.y], [outline.x + outline.width, outline.y],
    [outline.x + outline.width, outline.y + outline.height], [outline.x, outline.y + outline.height]]
    .map(([x, y]) => ({ x: x! - half, y: y! - half, width: SELECTION_HANDLE_MM, height: SELECTION_HANDLE_MM }));
  if (scale === null || !(scale > 0)) return { outline, handles, tag: null };
  const fontSize = SELECTION_TAG_PX / scale;
  const padding = TAG_PADDING_PX / scale;
  const height = TAG_HEIGHT_PX / scale;
  const width = label.length * fontSize * LABEL_ADVANCE + 2 * padding;
  const y = outline.y - height - half;
  return { outline, handles,
    tag: { x: outline.x, y, width, height, fontSize, textX: outline.x + padding, textY: y + height / 2 + fontSize * .36 } };
}
