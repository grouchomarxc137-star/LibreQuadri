import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateProjectManifest } from "../scripts/project-manifest.js";

describe("project schema manifest", () => {
  it("matches every committed project migration prefix deterministically", () => {
    const migrations = path.resolve("db/migrations/project");
    expect(readFileSync(path.join(migrations, "manifest.json"), "utf8"))
      .toBe(generateProjectManifest(migrations));
  });
});
