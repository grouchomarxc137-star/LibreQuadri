import { readFileSync } from "node:fs";
import path from "node:path";
import { FRONT_PANEL_ROLES } from "../../../shared/front-presentation.js";

export interface PanelPresentationApproval {
  panelFamily: number; packId: number; reviewedName: string;
  widthMm: number; heightMm: number; evidence: string;
}

export function loadPanelPresentationApprovals(seedFolder = path.resolve("db/seed")): PanelPresentationApproval[] {
  const parsed: unknown = JSON.parse(readFileSync(path.join(seedFolder, "tiquadri-front-presentation.json"), "utf8"));
  if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row !== "object" ||
    !Number.isSafeInteger(row.panelFamily) || row.panelFamily <= 0 ||
    !Number.isSafeInteger(row.packId) || row.packId <= 0 ||
    typeof row.reviewedName !== "string" || !row.reviewedName.trim() ||
    !Number.isFinite(row.widthMm) || row.widthMm <= 0 ||
    !Number.isFinite(row.heightMm) || row.heightMm <= 0 ||
    typeof row.evidence !== "string" || !row.evidence.trim()) ||
    new Set(parsed.map(row => row.panelFamily)).size !== parsed.length ||
    new Set(parsed.map(row => row.packId)).size !== parsed.length)
    throw new Error("Invalid reviewed TiQuadri front presentation seed");
  return parsed as PanelPresentationApproval[];
}

/** Source placeholders are intentional absence, never inferred from a failed asset load. */
export function classifyPanelPresentation(panel: Record<string, unknown>, pack: Record<string, unknown> | undefined,
  approval: PanelPresentationApproval | undefined): { symbol: string; conflict: boolean } {
  const legacy = panel["Pannello_DIN"] === true ? "din_panel" : "panel";
  const ordinary = panel["File_Blocco"] !== "senza";
  if (!approval) return { symbol: ordinary ? FRONT_PANEL_ROLES.physical : legacy, conflict: false };
  const verified = pack?.["ID_Pack"] === approval.packId && pack["Descri_Pack"] === approval.reviewedName &&
    pack["Famiglia_Pannelli"] === approval.panelFamily && panel["Famiglia_pannelli"] === approval.panelFamily &&
    panel["Pannello_centralino"] === true && panel["Pannello_DIN"] === true &&
    panel["File_Blocco"] === "senza" && panel["Larghezza"] === approval.widthMm &&
    panel["Altezza"] === approval.heightMm;
  return { symbol: verified ? FRONT_PANEL_ROLES.guide : ordinary ? FRONT_PANEL_ROLES.physical : legacy,
    conflict: !verified };
}
