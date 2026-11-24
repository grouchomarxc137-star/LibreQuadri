import { BrowserWindow } from "electron";

import type { RendererLocation } from "./renderer-location.js";

/**
 * The renderer is isolated from Node and SQLite: it only sees the narrow API
 * that the sandboxed preload script exposes through contextBridge.
 */
export function createMainWindow(location: RendererLocation): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: "LibreQuadri",
    webPreferences: {
      preload: location.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });

  // The app is a single local page: no popups, and no navigation away from it.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url.split(/[?#]/)[0] !== location.indexUrl) {
      event.preventDefault();
    }
  });

  void window.loadFile(location.indexPath);
  return window;
}
