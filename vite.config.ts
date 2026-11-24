import { defineConfig } from "vite";

// The renderer is built to static files and loaded by Electron over file://,
// so every asset URL must be relative (base "./").
export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    sourcemap: true,
  },
});
