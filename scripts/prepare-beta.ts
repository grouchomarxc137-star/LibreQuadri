import path from "node:path";
import { BETA1_SEED_DIRECTORY } from "../src/main/alpha/identity.js";
import { BETA1_PROFILE, createAlphaSnapshot } from "../src/main/alpha/seed.js";

try {
  const [dataRoot, ...extra] = process.argv.slice(2);
  if (!dataRoot || extra.length) throw new Error("Usage: npm run prepare:beta1 -- <validated-data-root>");
  const root = path.resolve(import.meta.dirname, "../..");
  const seed = path.join(root, "build", "beta-1.0", BETA1_SEED_DIRECTORY);
  const manifest = await createAlphaSnapshot(path.resolve(dataRoot), seed, path.join(root, "db/migrations/lq"), BETA1_PROFILE);
  console.log(JSON.stringify({ seed, version: manifest.version, counts: manifest.counts, assets: manifest.assets.length }, null, 2));
} catch (error) {
  console.error("Beta preparation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
