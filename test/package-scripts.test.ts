/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Live acceptance once ran a merged milestone against a `dist/` built before the merge: `npm start`
 * was just `electron .`, which loads whatever was built last, so neither new feature was in the app.
 * Unit tests cannot see that, so the launch path itself is pinned here.
 */
describe("launching the application", () => {
  const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;

  it("always rebuilds the main process and the renderer before npm start, so a stale dist can never be run", () => {
    expect(scripts["start"]).toBe("electron .");
    expect(scripts["prestart"]).toBe("npm run build && node dist/scripts/sync-engineering.js --check --advisory");
    expect(scripts["build"]).toContain("build:main");
    expect(scripts["build"]).toContain("build:renderer");
    expect(scripts["build:main"]).toContain("tsc");
    expect(scripts["build:renderer"]).toContain("vite build");
  });
});
