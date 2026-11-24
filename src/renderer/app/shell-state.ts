import type { AppCommand } from "../../shared/app.js";

export type DesignSection = "device" | "enclosure" | "support";
export type PlacementMode = "free" | "auto";
export type ShellDialog = "new-project" | "properties" | "listino" | "unclassified" | "engineering" | "brands" | "distinta";
export type CatalogueView = "manufacturer" | "search" | "configuration";

export interface ShellState {
  readonly designSection: DesignSection;
  readonly placementMode: PlacementMode;
  readonly dialog: ShellDialog | null;
  readonly catalogueView: CatalogueView;
  readonly activeLineUuid: string | null;
}
export const initialShellState: ShellState = {
  designSection: "device", placementMode: "auto", dialog: null, catalogueView: "manufacturer", activeLineUuid: null,
};
export type ShellAction =
  | { readonly type: "command"; readonly command: AppCommand; readonly projectOpen: boolean }
  | { readonly type: "design-section"; readonly section: DesignSection }
  | { readonly type: "placement-mode"; readonly mode: PlacementMode }
  | { readonly type: "open-dialog"; readonly dialog: ShellDialog }
  | { readonly type: "close-dialog" }
  | { readonly type: "catalogue-view"; readonly view: CatalogueView }
  | { readonly type: "configure" }
  | { readonly type: "open-line"; readonly lineUuid: string }
  | { readonly type: "active-line"; readonly lineUuid: string | null }
  | { readonly type: "project-opened" }
  | { readonly type: "project-closed"; readonly openNewProject?: boolean };

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "command":
      if (!action.projectOpen && (action.command.startsWith("design:") || action.command === "document:distinta" ||
        action.command === "project:engineering" || action.command === "project:properties")) return state;
      switch (action.command) {
        case "design:devices": return { ...state, designSection: "device" };
        case "design:enclosures": return { ...state, designSection: "enclosure" };
        case "design:panels": return { ...state, designSection: "support" };
        case "document:distinta": return { ...state, dialog: "distinta" };
        case "project:engineering": return { ...state, dialog: "engineering" };
        case "project:properties": return { ...state, dialog: "properties" };
        case "project:new": return { ...state, dialog: "new-project" };
        case "listino:update": return { ...state, dialog: "listino" };
        case "listino:brands": return { ...state, dialog: "brands" };
        case "listino:unclassified": return { ...state, dialog: "unclassified" };
      }
      return state;
    case "design-section": return { ...state, designSection: action.section };
    case "placement-mode": return { ...state, placementMode: action.mode };
    case "open-dialog": return { ...state, dialog: action.dialog };
    case "close-dialog": return { ...state, dialog: null };
    case "catalogue-view": return { ...state, catalogueView: action.view };
    case "configure": return { ...state, designSection: "device", catalogueView: "configuration" };
    case "open-line": return { ...state, dialog: null, designSection: "device", catalogueView: "manufacturer", activeLineUuid: action.lineUuid };
    case "active-line": return state.activeLineUuid === action.lineUuid ? state : { ...state, activeLineUuid: action.lineUuid };
    case "project-closed":
      if (action.openNewProject) return { ...initialShellState, dialog: "new-project" };
      // A plain close and a project switch both reset the workspace.
      // fall through
    case "project-opened":
      return { ...initialShellState,
      dialog: state.dialog === "listino" || state.dialog === "unclassified" || state.dialog === "brands" ? state.dialog : null };
  }
}
