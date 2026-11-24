import type { FrontVectorAsset, ProjectAnnotation, ProjectConfiguredItem } from "../shared/project.js";
import { ANNOTATION_LINE_HEIGHT, ANNOTATION_PADDING_MM } from "../shared/project.js";
import { FRONT_PANEL_ROLES } from "../shared/front-presentation.js";
import { captionText, combinedWidthLabel, depthDimensionGeometry, dimensionMillimetres, dimensionFontMm, frontLabelSize, frontOptionLabelRects,
  type CombinedFrontWidth, type FrontDrawable, type FrontSector, type SectorDimensions } from "./front-geometry.js";

export type FrontAssets = Readonly<Record<string, FrontVectorAsset>>;
type View = ProjectConfiguredItem["views"][number];
export function previewView(item: ProjectConfiguredItem): View | undefined {
  return item.views.find(view => view.viewCode === "front") ?? item.views[0];
}

/** Inert drawing vocabulary, shared by React on screen and escaped markup in main. No editor props. */
export interface FrontPrimitive {
  tag: "svg" | "g" | "rect" | "path" | "text" | "title" | "foreignObject" | "div";
  attributes: Partial<Record<"className" | "xmlns" | "x" | "y" | "width" | "height" | "viewBox" |
    "preserveAspectRatio" | "d" | "fill" | "stroke" | "strokeWidth" | "fontSize" | "textAnchor" |
    "transform" | "aria-hidden" | "data-dimension", string | number | boolean>> & { style?: FrontTextStyle };
  children: (FrontPrimitive | string)[];
}
export const frontElement = (tag: FrontPrimitive["tag"], attributes: FrontPrimitive["attributes"],
  children: FrontPrimitive["children"] = []): FrontPrimitive => ({ tag, attributes, children });

/** The profile, never the asset's extent, supplies physical size. */
export function frontShapePrimitive({ x, y, width, height, assetKey, assets, className }: {
  x: number; y: number; width: number; height: number; assetKey: string | null | undefined;
  assets: FrontAssets; className?: string;
}): FrontPrimitive {
  const asset = assetKey ? assets[assetKey] : undefined;
  return asset ? frontElement("svg", { className: className ?? "front-vector", x, y, width, height,
    viewBox: asset.viewBox.join(" "), preserveAspectRatio: "none" }, [
    frontElement("path", { d: asset.strokes, fill: "none", stroke: "currentColor", strokeWidth: asset.strokeWidth }),
    frontElement("path", { d: asset.fills, fill: "currentColor" }),
  ]) : frontElement("rect", { ...(className === undefined ? {} : { className }), x, y, width, height });
}

/**
 * The primary label drawn directly on an object in the Fronte Quadro: a device shows its primary
 * article code, falling back to its model name; an enclosure shows its model name. A support
 * (Pannello) carries no text on the drawing: it is identified in Albero fisico and the detail
 * panels. The model code is an internal identity and is never drawn. Null when there is no label.
 */
export function frontLabel(item: ProjectConfiguredItem): string | null {
  const text = (value: string | null | undefined) => value?.trim() ? value.trim() : null;
  if (item.modelKind === "support") return null;
  if (item.modelKind === "device") {
    const article = item.bom.find(row => row.role === "primary") ?? item.bom[0];
    return text(article?.manufacturerCode) ?? text(item.modelName);
  }
  return text(item.modelName);
}

/** Layer order is shared by screen and PDF; geometry always comes from combinedFrontGeometry. */
export function orderedFront(sector: FrontSector): FrontDrawable[] {
  return [...sector.drawable].sort((a, b) =>
    ({ enclosure: 0, support: 1, device: 2, group: 3 })[a.node.nodeKind] -
    ({ enclosure: 0, support: 1, device: 2, group: 3 })[b.node.nodeKind]);
}

export function frontOpening(entry: FrontDrawable, assets: FrontAssets): boolean {
  if (entry.node.nodeKind !== "support") return false;
  if (entry.view.symbolKind === FRONT_PANEL_ROLES.guide) return true;
  if (entry.view.symbolKind === FRONT_PANEL_ROLES.physical) return false;
  // Historical snapshots did not distinguish placeholders from unavailable artwork.
  return !(entry.view.assetKey && assets[entry.view.assetKey]);
}

/** Presentation only: geometry, descendants and physical placement always retain the support. */
export function frontPrintable(entry: FrontDrawable): boolean {
  return entry.node.nodeKind !== "support" || entry.view.symbolKind !== FRONT_PANEL_ROLES.guide;
}

/** One engineering object, without any editor affordances. */
export function frontObjectPrimitives(entry: FrontDrawable, assets: FrontAssets, labels: boolean,
  scale: number | null): FrontPrimitive[] {
  const { node, item, view } = entry;
  const guide = node.nodeKind === "support" && view.symbolKind === FRONT_PANEL_ROLES.guide;
  const asset = !guide && view.assetKey ? assets[view.assetKey] : undefined;
  const label = !asset && labels ? frontLabel(item) : null;
  const labelSize = label !== null ? frontLabelSize(label, view.widthMm, view.heightMm, scale) : null;
  const shape = frontShapePrimitive({ x: node.xMm!, y: node.yMm!, width: view.widthMm, height: view.heightMm,
    assetKey: guide ? null : view.assetKey, assets });
  return labelSize === null ? [shape] : [shape, frontElement("text", {
    x: node.xMm! + 2, y: node.yMm! + Math.min(12, view.heightMm / 2), fontSize: labelSize,
  }, [label!])];
}

export function frontCaptionPrimitives(sector: FrontSector, captionMm: number | null): FrontPrimitive[] {
  return captionMm === null ? [] : [frontElement("title", {}, [sector.label]),
    frontElement("text", { className: "front-caption", x: sector.bounds.left,
      y: sector.bounds.top - captionMm * .35, fontSize: captionMm },
    [captionText(sector.label, sector.bounds.right - sector.bounds.left, captionMm)])];
}

export function frontOptionLabelPrimitives(sector: FrontSector, assets: FrontAssets): FrontPrimitive[] {
  const enclosure = sector.drawable.find(entry => entry.node === sector.root);
  return enclosure ? frontOptionLabelRects(enclosure, assets).map(rect =>
    frontShapePrimitive({ ...rect, assets, className: "front-vector front-option-label" })) : [];
}

/** Saved text and editor text use the same box, wrapping, padding and clipping. */
export interface FrontTextStyle {
  boxSizing: "border-box"; width: string; height: string; padding: number; fontSize: number; lineHeight: number;
}
export const frontNoteTextStyle = (fontSizeMm: number): FrontTextStyle => ({
  boxSizing: "border-box", width: "100%", height: "100%", padding: ANNOTATION_PADDING_MM,
  fontSize: fontSizeMm, lineHeight: ANNOTATION_LINE_HEIGHT,
});

export function frontNotePrimitives(note: Pick<ProjectAnnotation, "xMm" | "yMm" | "widthMm" | "heightMm" | "fontSizeMm" | "text">):
  [FrontPrimitive, FrontPrimitive] {
  const rect = { x: note.xMm, y: note.yMm, width: note.widthMm, height: note.heightMm };
  return [frontElement("rect", { className: "front-note-box", ...rect }),
    frontElement("foreignObject", { className: "front-note-frame", ...rect }, [
      frontElement("div", { className: "front-note-text", style: frontNoteTextStyle(note.fontSizeMm) }, [note.text]),
    ])];
}

/** Gap between the Carpenteria's edge and the start of an extension line, and how far it runs past the dimension line. */
const EXTENSION_GAP_MM = 2;
const EXTENSION_OVERSHOOT_MM = 2;

function arrowhead(offset: number, tip: [number, number], along: [number, number], sizeFactor = 1) {
  const arrow = Math.min(4, offset * 0.3) * sizeFactor;
  const [tx, ty] = tip, [ax, ay] = along;
  const px = -ay, py = ax;
  return `M ${tx} ${ty} L ${tx + ax * arrow + px * arrow / 3} ${ty + ay * arrow + py * arrow / 3} ` +
    `L ${tx + ax * arrow - px * arrow / 3} ${ty + ay * arrow - py * arrow / 3} Z`;
}

function widthPrimitives(left: number, right: number, bottom: number, lineY: number, offset: number, font: number,
  label: string, kind: "width" | "combined-width") {
  return [
    frontElement("path", { className: "front-dimension-line", d: `M ${left} ${bottom + EXTENSION_GAP_MM} L ${left} ${lineY + EXTENSION_OVERSHOOT_MM}
      M ${right} ${bottom + EXTENSION_GAP_MM} L ${right} ${lineY + EXTENSION_OVERSHOOT_MM} M ${left} ${lineY} L ${right} ${lineY}` }),
    frontElement("path", { className: "front-dimension-arrow", d: `${arrowhead(offset, [left, lineY], [1, 0])} ${arrowhead(offset, [right, lineY], [-1, 0])}` }),
    frontElement("text", { className: "front-dimension-text", "data-dimension": kind, x: left + (right - left) / 2,
      y: lineY + font * 0.35, fontSize: font, textAnchor: "middle", strokeWidth: font * 0.35 }, [label]),
  ];
}

export function frontCombinedWidthPrimitives(width: CombinedFrontWidth, scale: number | null) {
  return frontElement("g", { className: "front-dimensions", "aria-hidden": true },
    widthPrimitives(width.left, width.right, width.bottom, width.lineY, width.offsetMm,
      dimensionFontMm(width, scale), combinedWidthLabel(width.widthMm), "combined-width"));
}

/**
 * Overall width and height of one Carpenteria: extension lines, a dimension line with arrowheads and
 * the value in millimetres. Drawn inside the Carpenteria's own sector group, so the sector's display
 * offset applies to it exactly as to the drawing it measures. Presentation only: it takes no pointer
 * events and nothing here is read by placement or hit-testing.
 */
export function frontDimensionPrimitives(dimensions: SectorDimensions, scale: number | null, showWidth = true) {
  const { rect, offsetMm: offset } = dimensions;
  const font = dimensionFontMm(dimensions, scale);
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  const lineY = bottom + offset, lineX = rect.x - offset;
  const halo = { strokeWidth: font * 0.35 };
  const depth = depthDimensionGeometry(dimensions, scale);
  return frontElement("g", { className: "front-dimensions", "aria-hidden": true }, [
    ...(showWidth ? widthPrimitives(rect.x, right, bottom, lineY, offset, font,
      dimensionMillimetres.format(dimensions.widthMm) + " mm", "width") : []),
    frontElement("path", { className: "front-dimension-line", d: `M ${rect.x - EXTENSION_GAP_MM} ${rect.y} L ${lineX - EXTENSION_OVERSHOOT_MM} ${rect.y}
      M ${rect.x - EXTENSION_GAP_MM} ${bottom} L ${lineX - EXTENSION_OVERSHOOT_MM} ${bottom} M ${lineX} ${rect.y} L ${lineX} ${bottom}` }),
    frontElement("path", { className: "front-dimension-arrow", d: `${arrowhead(offset, [lineX, rect.y], [0, 1])} ${arrowhead(offset, [lineX, bottom], [0, -1])}` }),
    frontElement("text", { className: "front-dimension-text", "data-dimension": "height", x: lineX,
      y: rect.y + rect.height / 2 + font * 0.35, fontSize: font, textAnchor: "middle",
      transform: `rotate(-90 ${lineX} ${rect.y + rect.height / 2})`, ...halo }, [dimensionMillimetres.format(dimensions.heightMm) + " mm"]),
    ...(depth ? [
      frontElement("path", { className: "front-dimension-line",
        d: `M ${depth.start.x} ${depth.start.y} L ${depth.end.x} ${depth.end.y}` }),
      frontElement("path", { className: "front-dimension-arrow",
        d: `${arrowhead(offset, [depth.start.x, depth.start.y], [1 / Math.SQRT2, -1 / Math.SQRT2], depth.arrowScale)} ${arrowhead(offset, [depth.end.x, depth.end.y], [-1 / Math.SQRT2, 1 / Math.SQRT2], depth.arrowScale)}` }),
      frontElement("text", { className: "front-dimension-text", "data-dimension": "depth",
        x: depth.label.x, y: depth.label.y, fontSize: font, textAnchor: "middle",
        transform: `rotate(-45 ${depth.label.x} ${depth.label.y})`, strokeWidth: depth.font * 0.35 }, [depth.text]),
    ] : []),
  ]);
}
