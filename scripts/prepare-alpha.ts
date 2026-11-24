import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapDevelopmentCatalogue } from "../src/main/development/catalogue-bootstrap.js";
import { ALPHA1_PROFILE, ALPHA11_PROFILE, createAlphaSnapshot } from "../src/main/alpha/seed.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const args = process.argv.slice(2);
const alpha1 = args[0] === "--alpha1";
const alpha11 = args[0] === "--alpha11";
const [sourceRoot, ...extra] = alpha1 || alpha11 ? args.slice(1) : args;
try {
  if (!sourceRoot || extra.length) throw new Error("Usage: npm run prepare:alpha -- <private-source-root> (same layout as bootstrap:dev)");
  const directory = path.join(root,"build",alpha11 ? "alpha-1.1" : alpha1 ? "alpha-1" : "alpha");
  const seed = path.join(directory,"alpha-seed");
  if (existsSync(seed)) throw new Error(`Alpha seed already exists: ${seed}. Archive/remove it deliberately before preparing a different snapshot.`);
  mkdirSync(directory,{recursive:true});
  const dataRoot = mkdtempSync(path.join(directory,"bootstrap-"));
  const report = await bootstrapDevelopmentCatalogue({sourceRoot, dataRoot, applicationRoot:root,log:console.log});
  writeFileSync(path.join(dataRoot,"bootstrap-report.json"),JSON.stringify(report,null,2)+"\n");
  const manifest = await createAlphaSnapshot(dataRoot,seed,path.join(root,"db","migrations","lq"),alpha11 ? ALPHA11_PROFILE : alpha1 ? ALPHA1_PROFILE : undefined);
  console.log(JSON.stringify({seed,dataRoot,manifest},null,2));
} catch (error) {
  console.error("Alpha preparation failed:",error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
