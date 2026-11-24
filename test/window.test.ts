import { describe, expect, it, vi } from "vitest";

import { createMainWindow } from "../src/main/window.js";

const mock = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  ready: null as (() => void) | null,
  maximize: vi.fn(),
  show: vi.fn(),
  loadFile: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor(options: Record<string, unknown>) {
      mock.options = options;
    }

    once(event: string, callback: () => void) {
      if (event === "ready-to-show") mock.ready = callback;
    }

    maximize = mock.maximize;
    show = mock.show;
    loadFile = mock.loadFile;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
  },
}));

describe("main window launch", () => {
  it("maximizes before showing the ready window while keeping normal controls", () => {
    const location = {
      indexPath: "/app/index.html",
      indexUrl: "file:///app/index.html",
      preloadPath: "/app/preload.cjs",
    };
    createMainWindow(location);

    expect(mock.options).toMatchObject({
      show: false,
      webPreferences: {
        preload: location.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    expect(mock.options).not.toHaveProperty("fullscreen");
    expect(mock.options).not.toHaveProperty("kiosk");
    expect(mock.maximize).not.toHaveBeenCalled();
    expect(mock.show).not.toHaveBeenCalled();

    expect(mock.ready).toBeTypeOf("function");
    mock.ready!();
    expect(mock.maximize).toHaveBeenCalledOnce();
    expect(mock.show).toHaveBeenCalledOnce();
    expect(mock.maximize.mock.invocationCallOrder[0]).toBeLessThan(mock.show.mock.invocationCallOrder[0]!);
  });
});
