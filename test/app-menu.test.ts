import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuActions,
  type ApplicationMenuState,
} from "../src/main/app/app-menu.js";

function actions(): ApplicationMenuActions {
  return {
    newProject: vi.fn(), openProject: vi.fn(), openRecent: vi.fn(), clearRecent: vi.fn(),
    closeProject: vi.fn(), saveProject: vi.fn(), saveProjectAs: vi.fn(), command: vi.fn(),
    zoom: vi.fn(), setTheme: vi.fn(),
  };
}

function state(overrides: Partial<ApplicationMenuState> = {}): ApplicationMenuState {
  return {
    platform: "darwin", applicationName: "LibreQuadri", projectOpen: false, canSave: false,
    recent: [], theme: "system", development: false, ...overrides,
  };
}

function items(template: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...items(Array.isArray(item.submenu) ? item.submenu : [])]);
}

function find(template: readonly MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions {
  const item = items(template).find((candidate) => candidate.id === id);
  if (!item) throw new Error(`menu item ${id} not found`);
  return item;
}

function click(item: MenuItemConstructorOptions): void {
  (item.click as () => void)();
}

describe("native application menu", () => {
  it("uses the macOS application menu, Window menu and standard Quit", () => {
    const template = buildApplicationMenuTemplate(state(), actions());
    expect(template.map((item) => item.label)).toEqual(
      ["LibreQuadri", "File", "Modifica", "Progetto", "Listino", "Vista", "Finestra"]);
    const application = template[0]!.submenu as MenuItemConstructorOptions[];
    expect(application.map((item) => item.role).filter(Boolean)).toEqual(
      ["about", "services", "hide", "hideOthers", "unhide", "quit"]);
    expect(find(template, "window").role).toBe("window");
    expect(items(template).some((item) => item.id === "file.quit")).toBe(false);
  });

  it("puts Esci in File and Informazioni in Aiuto on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const template = buildApplicationMenuTemplate(state({ platform }), actions());
      expect(template.map((item) => item.label)).toEqual(["File", "Modifica", "Progetto", "Listino", "Vista", "Aiuto"]);
      expect(find(template, "file.quit")).toMatchObject({ label: "Esci", role: "quit", accelerator: "Ctrl+Q" });
      expect((find(template, "help").submenu as MenuItemConstructorOptions[])[0]!.role).toBe("about");
    }
  });

  it("keeps the standard clipboard roles so text fields keep Cmd/Ctrl+C and Cmd/Ctrl+V", () => {
    const edit = find(buildApplicationMenuTemplate(state(), actions()), "edit").submenu as MenuItemConstructorOptions[];
    expect(edit.map((item) => item.role).filter(Boolean)).toEqual(["cut", "copy", "paste", "selectAll"]);
    expect(edit.map((item) => item.label).filter(Boolean)).toEqual(
      ["Annulla", "Ripeti", "Taglia", "Copia", "Incolla", "Seleziona tutto"]);
  });

  it("routes Annulla / Ripeti to the renderer, named after the document action and always enabled", () => {
    const menuActions = actions();
    const closed = buildApplicationMenuTemplate(state({ undoLabel: "Sposta" }), menuActions);
    expect(find(closed, "edit.undo")).toMatchObject({ label: "Annulla", accelerator: "CmdOrCtrl+Z", registerAccelerator: true });
    expect(find(closed, "edit.undo").enabled).toBeUndefined();
    const open = buildApplicationMenuTemplate(state({ projectOpen: true, undoLabel: "Inserisci falsi poli DIN", redoLabel: "Sposta" }), menuActions);
    expect(find(open, "edit.undo").label).toBe("Annulla Inserisci falsi poli DIN");
    expect(find(open, "edit.redo")).toMatchObject({ label: "Ripeti Sposta", accelerator: "Shift+CmdOrCtrl+Z", registerAccelerator: true });
    click(find(open, "edit.undo"));
    click(find(open, "edit.redo"));
    expect(menuActions.command).toHaveBeenNthCalledWith(1, "edit:undo");
    expect(menuActions.command).toHaveBeenNthCalledWith(2, "edit:redo");
    // Windows/Linux: the renderer owns Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; the menu only displays the shortcuts.
    for (const platform of ["win32", "linux"] as const) {
      const template = buildApplicationMenuTemplate(state({ platform, projectOpen: true }), actions());
      expect(find(template, "edit.undo")).toMatchObject({ label: "Annulla", accelerator: "CmdOrCtrl+Z", registerAccelerator: false });
      expect(find(template, "edit.redo")).toMatchObject({ label: "Ripeti", accelerator: "Ctrl+Y", registerAccelerator: false });
    }
  });

  it("uses platform-neutral accelerators for lifecycle, workspaces and zoom", () => {
    const template = buildApplicationMenuTemplate(state({ projectOpen: true, canSave: true }), actions());
    expect(Object.fromEntries(["file.new", "file.open", "file.close", "file.save", "file.saveAs",
      "project.devices", "project.enclosures", "project.panels", "project.distinta", "project.properties",
      "view.zoomIn", "view.zoomInPlus", "view.zoomOut", "view.zoomReset"].map((id) => [id, find(template, id).accelerator])))
      .toEqual({
        "file.new": "CmdOrCtrl+N", "file.open": "CmdOrCtrl+O", "file.close": "CmdOrCtrl+W",
        "file.save": "CmdOrCtrl+S", "file.saveAs": "Shift+CmdOrCtrl+S",
        // Design modes retain digit shortcuts; Distinta is an action without the old workspace shortcut.
        "project.devices": "CmdOrCtrl+1", "project.enclosures": "CmdOrCtrl+2", "project.panels": "CmdOrCtrl+3",
        "project.distinta": undefined,
        "project.properties": "CmdOrCtrl+I",
        "view.zoomIn": "CmdOrCtrl+=", "view.zoomInPlus": "CmdOrCtrl+Plus", "view.zoomOut": "CmdOrCtrl+-",
        "view.zoomReset": "CmdOrCtrl+0",
      });
    expect(find(template, "view.zoomInPlus")).toMatchObject({ visible: false, acceleratorWorksWhenHidden: true });
  });

  it("lists design modes in order and Distinta without the old workspace shortcut", () => {
    const project = find(buildApplicationMenuTemplate(state({ projectOpen: true }), actions()), "project")
      .submenu as MenuItemConstructorOptions[];
    expect(project.filter((item) => item.id?.startsWith("project.") && item.id !== "project.properties" && item.id !== "project.engineering")
      .map((item) => [item.label, item.accelerator])).toEqual([
      ["Apparecchi", "CmdOrCtrl+1"], ["Carpenterie", "CmdOrCtrl+2"], ["Pannelli", "CmdOrCtrl+3"], ["Distinta…", undefined],
    ]);
  });

  it("disables project actions without a project and enables them with one", () => {
    const projectIds = ["file.close", "file.save", "file.saveAs", "project.devices", "project.enclosures",
      "project.panels", "project.distinta", "project.properties", "project.engineering"];
    const closed = buildApplicationMenuTemplate(state(), actions());
    for (const id of projectIds) expect(find(closed, id).enabled, id).toBe(false);
    for (const id of ["file.new", "file.open", "listino.update", "listino.unclassified"]) {
      expect(find(closed, id).enabled, id).not.toBe(false);
    }
    const saved = buildApplicationMenuTemplate(state({ projectOpen: true, canSave: false }), actions());
    expect(find(saved, "file.save").enabled).toBe(false);
    expect(find(saved, "file.saveAs").enabled).toBe(true);
    const modified = buildApplicationMenuTemplate(state({ projectOpen: true, canSave: true }), actions());
    for (const id of projectIds) expect(find(modified, id).enabled, id).toBe(true);
  });

  it("routes lifecycle items to the main-process lifecycle and UI items to renderer commands", () => {
    const handlers = actions();
    const template = buildApplicationMenuTemplate(state({ projectOpen: true, canSave: true }), handlers);
    click(find(template, "file.new"));
    click(find(template, "file.open"));
    click(find(template, "file.close"));
    click(find(template, "file.save"));
    click(find(template, "file.saveAs"));
    expect(handlers.newProject).toHaveBeenCalledOnce();
    expect(handlers.openProject).toHaveBeenCalledOnce();
    expect(handlers.closeProject).toHaveBeenCalledOnce();
    expect(handlers.saveProject).toHaveBeenCalledOnce();
    expect(handlers.saveProjectAs).toHaveBeenCalledOnce();
    for (const [id, command] of [["project.devices", "design:devices"], ["project.enclosures", "design:enclosures"],
      ["project.panels", "design:panels"], ["project.distinta", "document:distinta"],
      ["project.properties", "project:properties"],
      ["listino.update", "listino:update"], ["listino.unclassified", "listino:unclassified"]] as const) {
      click(find(template, id));
      expect(handlers.command).toHaveBeenLastCalledWith(command);
    }
    click(find(template, "view.zoomIn"));
    click(find(template, "view.zoomOut"));
    click(find(template, "view.zoomReset"));
    expect(vi.mocked(handlers.zoom).mock.calls).toEqual([["in"], ["out"], ["reset"]]);
  });

  it("lists recent projects, flags missing files and offers Cancella elenco", () => {
    const handlers = actions();
    const template = buildApplicationMenuTemplate(state({ recent: [
      { label: "Quadro QG1 (QG1.lqp)", path: "/projects/QG1.lqp", available: true },
      { label: "Linea 3 (Linea3.lqp)", path: "/gone/Linea3.lqp", available: false },
    ] }), handlers);
    const recent = find(template, "file.recent").submenu as MenuItemConstructorOptions[];
    expect(recent[0]).toMatchObject({ label: "Quadro QG1 (QG1.lqp)", enabled: true });
    expect(recent[1]).toMatchObject({ label: "Linea 3 (Linea3.lqp) (file non trovato)", enabled: false });
    click(recent[0]!);
    expect(handlers.openRecent).toHaveBeenCalledWith("/projects/QG1.lqp");
    click(find(template, "file.recent.clear"));
    expect(handlers.clearRecent).toHaveBeenCalledOnce();
    const empty = buildApplicationMenuTemplate(state(), handlers);
    expect(find(empty, "file.recent").enabled).toBe(false);
  });

  it("shows the theme as radio items bound to the saved preference", () => {
    const handlers = actions();
    const template = buildApplicationMenuTemplate(state({ theme: "dark" }), handlers);
    const theme = find(template, "view.theme").submenu as MenuItemConstructorOptions[];
    expect(theme.map((item) => [item.label, item.type, item.checked])).toEqual([
      ["Chiaro", "radio", false], ["Scuro", "radio", true], ["Come il sistema", "radio", false]]);
    click(theme[0]!);
    expect(handlers.setTheme).toHaveBeenCalledWith("light");
  });

  it("adds developer tools only to development builds", () => {
    const roles = (development: boolean) => items(buildApplicationMenuTemplate(state({ development }), actions()))
      .map((item) => item.role);
    expect(roles(true)).toContain("toggleDevTools");
    expect(roles(false)).not.toContain("toggleDevTools");
    expect(roles(false)).not.toContain("reload");
  });
});
