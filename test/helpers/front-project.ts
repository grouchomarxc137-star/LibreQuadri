import type { ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode } from "../../src/shared/project.js";
const item = (uuid: string, kind: "enclosure" | "support" | "device", width: number, height: number) => ({
  uuid, modelKind: kind, modelName: uuid, physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: "C16" }],
  views: [{ viewCode: "front", widthMm: width, heightMm: height, assetKey: kind === "device" ? "vector" : null }],
}) as unknown as ProjectConfiguredItem;
const node = (uuid: string, kind: "enclosure" | "support" | "device", x: number, y: number,
  children: ProjectPhysicalNode[] = []) => ({ uuid, itemUuid: uuid, nodeKind: kind, xMm: x, yMm: y,
  children, viewCode: "front" }) as ProjectPhysicalNode;
export const frontAssets = { vector: { viewBox: [0, 0, 54, 45] as [number, number, number, number],
  strokeWidth: .08, strokes: "M 0 0 L 54 45", fills: "M 0 0 L 2 2 Z" } };
export const frontProject = {
  metadata: { title: "Q1 <script>alert(1)</script>", companyName: "Cliente & C.", normCode: "CEI", date: "2026-10-07" },
  configuredItems: [item("case", "enclosure", 600, 1200), item("panel", "support", 500, 200),
    item("device", "device", 54, 45), item("case2", "enclosure", 300, 600)],
  physicalNodes: [node("case", "enclosure", 40, 70, [node("panel", "support", 90, 170,
    [node("device", "device", 136.5, 123)])]), node("case2", "enclosure", 40, 70)],
  annotations: [{ uuid: "note", text: "Linea 1\nLinea 2 <img src=x onerror=alert(1)>", fontSizeMm: 18,
    xMm: -180, yMm: -120, widthMm: 160, heightMm: 90 }],
} as unknown as ProjectDocumentView;
