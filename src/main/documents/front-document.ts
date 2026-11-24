import type { FrontPdfOptions, ProjectDocumentView } from "../../shared/project.js";
import { frontCaptionPrimitives, frontCombinedWidthPrimitives, frontDimensionPrimitives, frontElement, frontNotePrimitives, frontObjectPrimitives,
  frontOpening, frontOptionLabelPrimitives, frontPrintable, orderedFront, type FrontAssets } from "../../drawing/front-primitives.js";
import { frontPrimitiveMarkup } from "./front-markup.js";
import { combinedFrontGeometry, type FrontViewBox } from "../../drawing/front-geometry.js";
import { escapeHtml } from "./document-html.js";

const MARGIN_MM = 10;
const HEADING_MM = 20;
const NOTICE_MM = 6;

/** A4, choosing the orientation that gives the complete drawing the largest uniform scale. */
export function frontPageLayout(viewBox: FrontViewBox) {
  const candidate = (width: number, height: number) => {
    const drawingWidthMm = width - MARGIN_MM * 2;
    const drawingHeightMm = height - MARGIN_MM * 2 - HEADING_MM - NOTICE_MM;
    return { drawingWidthMm, drawingHeightMm,
      scale: Math.min(drawingWidthMm / viewBox[2], drawingHeightMm / viewBox[3]) };
  };
  const portrait = candidate(210, 297), landscape = candidate(297, 210);
  return landscape.scale > portrait.scale
    ? { ...landscape, landscape: true } : { ...portrait, landscape: false };
}

/** Main-owned snapshot + local vectors only; there is no renderer-supplied HTML or editor state. */
export function buildFrontDocument(project: ProjectDocumentView, assets: FrontAssets, options: FrontPdfOptions) {
  const items = project.configuredItems.filter(item => item.physStatus === "resolved" &&
    (item.modelKind === "enclosure" || item.modelKind === "support" || item.modelKind === "device"));
  const roots = project.physicalNodes.filter(node => node.nodeKind === "enclosure");
  const annotations = project.annotations ?? [];
  const geometry = combinedFrontGeometry(roots, items, { ...options, annotations, assets });
  if (geometry.sectors.length === 0) throw new Error("Fronte Quadro non disponibile: nessuna geometria da esportare.");
  const layout = frontPageLayout(geometry.viewBox);
  const drawing = frontPrimitiveMarkup(frontElement("svg", { className: "front-drawing", xmlns: "http://www.w3.org/2000/svg",
    viewBox: geometry.viewBox.join(" "), preserveAspectRatio: "xMidYMid meet" }, [
    ...geometry.sectors.map(sector => frontElement("g", { className: "front-sector",
      ...(sector.offset.x || sector.offset.y ? { transform: `translate(${sector.offset.x} ${sector.offset.y})` } : {}) }, [
      ...frontCaptionPrimitives(sector, geometry.captionMm),
      ...orderedFront(sector).filter(frontPrintable).map(entry => frontElement("g", {
        className: `front-${entry.node.nodeKind}${frontOpening(entry, assets) ? " front-opening" : ""}`,
      }, frontObjectPrimitives(entry, assets, options.labels, null))),
      ...frontOptionLabelPrimitives(sector, assets),
      ...(options.dimensions ? [frontDimensionPrimitives(geometry.dimensionsByRoot.get(sector.root.uuid)!, null, !geometry.combinedWidth)] : []),
    ])),
    ...(geometry.combinedWidth ? [frontCombinedWidthPrimitives(geometry.combinedWidth, null)] : []),
    frontElement("g", { className: "front-annotations" }, annotations.map(note =>
      frontElement("g", { className: "front-note" }, frontNotePrimitives(note)))),
  ]));
  const meta = project.metadata;
  const details = [meta.companyName, meta.normCode, meta.date].filter(Boolean).join(" · ");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>LibreQuadri · Fronte Quadro - ${escapeHtml(meta.title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>
@page { size: A4 ${layout.landscape ? "landscape" : "portrait"}; margin: ${MARGIN_MM}mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: #2B3139; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; }
body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
header { height: ${HEADING_MM}mm; display: flex; gap: 5mm; align-items: flex-start; border-bottom: .25mm solid #C8CDD4; padding-bottom: 2mm; }
header .brand { font-size: 12px; font-weight: 700; padding-top: 1mm; }
header div { min-width: 0; flex: 1; }
h1 { font-size: 14px; margin: 0 0 1mm; }
header p { font-size: 10px; margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.front-drawing { display: block; width: ${layout.drawingWidthMm}mm; height: ${layout.drawingHeightMm}mm; }
.front-drawing rect { stroke-width: 1; vector-effect: non-scaling-stroke; }
.front-vector { color: #2B3139; }
.front-enclosure rect { fill: #FBFBFC; stroke: #2B3139; }
.front-support rect { fill: #F3F5F7; stroke: #2B3139; }
.front-support.front-opening rect { fill: none; stroke: #2B3139; stroke-dasharray: 4 2; }
.front-device rect { fill: #FFFFFF; stroke: #2B3139; }
.front-drawing text { fill: #2B3139; }
.front-caption { fill: #4A515A; font-weight: 500; }
.front-dimension-line { fill: none; stroke: #4A515A; stroke-width: 1; vector-effect: non-scaling-stroke; }
.front-dimension-arrow { fill: #4A515A; stroke: none; }
.front-dimension-text { stroke: white; stroke-linejoin: round; paint-order: stroke; font-variant-numeric: tabular-nums; }
.front-note-box { fill: none; stroke: none; }
.front-note-frame { overflow: hidden; }
.front-note-text { color: #2B3139; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; }
.notice { height: ${NOTICE_MM}mm; margin: 0; font-size: 9px; }
</style></head><body>
<header><span class="brand">LibreQuadri</span><div><h1>Fronte Quadro</h1>
<p>${escapeHtml(meta.title)}</p><p>${escapeHtml(details)}</p></div></header>
${drawing}<p class="notice">${geometry.skipped.length ? `${geometry.skipped.length} carpenterie non mostrate: geometria o posizione mancante.` : ""}</p>
</body></html>`;
  return { html, layout, viewBox: geometry.viewBox };
}
