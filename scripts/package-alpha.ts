import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { rebuild } from "@electron/rebuild";
import { ALPHA_NAME, ALPHA_VERSION, ALPHA1_NAME, ALPHA1_VERSION, ALPHA11_NAME, ALPHA11_VERSION,
  BETA1_NAME, BETA1_VERSION, BETA1_SEED_DIRECTORY } from "../src/main/alpha/identity.js";
import { ALPHA1_PROFILE, ALPHA11_PROFILE, BETA1_PROFILE, validateAlphaSeed } from "../src/main/alpha/seed.js";
import { generateMacApplicationIcon } from "./macos-icon.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
let staging: string | undefined;
try {
  const args = process.argv.slice(2);
  const alpha1 = args.length === 1 && args[0] === "--alpha1";
  const alpha11 = args.length === 1 && args[0] === "--alpha11";
  const beta1 = args.length === 1 && args[0] === "--beta1";
  if (args.length && !alpha1 && !alpha11 && !beta1) throw new Error("Usage: npm run package:alpha, package:alpha1, package:alpha11 or package:beta1 (first prepare the corresponding seed)");
  const name = beta1 ? BETA1_NAME : alpha11 ? ALPHA11_NAME : alpha1 ? ALPHA1_NAME : ALPHA_NAME;
  const version = beta1 ? BETA1_VERSION : alpha11 ? ALPHA11_VERSION : alpha1 ? ALPHA1_VERSION : ALPHA_VERSION;
  const build = beta1 ? "1" : alpha11 ? "Alpha 1.1" : alpha1 ? "Alpha 1" : "Alpha 0";
  if (process.platform !== "darwin" || !["arm64","x64"].includes(process.arch)) throw new Error("Release packaging requires the target Mac (arm64 or x64)");
  const architecture = process.arch as "arm64" | "x64";
  const directory = path.join(root,"build",beta1 ? "beta-1.0" : alpha11 ? "alpha-1.1" : alpha1 ? "alpha-1" : "alpha");
  const seed = path.join(directory,beta1 ? BETA1_SEED_DIRECTORY : "alpha-seed");
  const manifest = validateAlphaSeed(seed,path.join(root,"db","migrations","lq"),
    beta1 ? BETA1_PROFILE : alpha11 ? ALPHA11_PROFILE : alpha1 ? ALPHA1_PROFILE : undefined);
  const output = path.join(root,"out",beta1 ? "beta-1.0" : alpha11 ? "alpha-1.1" : alpha1 ? "alpha-1" : "alpha-0");
  const artifact = path.join(output,`${name}-darwin-${process.arch}`);
  if (existsSync(artifact)) throw new Error(`Build output already exists: ${artifact}. Archive/remove it deliberately before rebuilding.`);
  const icon = generateMacApplicationIcon(root,path.join(directory,"icon"));
  mkdirSync(directory,{recursive:true});
  staging = mkdtempSync(path.join(directory,"package-"));
  const pkg = JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));
  writeFileSync(path.join(staging,"package.json"),JSON.stringify({name:pkg.name,productName:name,
    version,private:true,type:pkg.type,main:pkg.main,dependencies:pkg.dependencies},null,2));
  if (alpha1 || alpha11 || beta1) writeFileSync(path.join(staging,"build-info.json"),JSON.stringify({
    version,sourceRevision:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
    trackedChanges:execFileSync("git",["diff","HEAD","--name-only"],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean),
    builtAt:new Date().toISOString(),
    ...(beta1 ? { catalogueSha256: manifest.databaseSha256 } : {}),
  },null,2)+"\n");
  // A positive allowlist: no source checkout, tests, private files or .claude.
  cpSync(path.join(root,"dist","src"),path.join(staging,"dist","src"),{recursive:true,filter:p=>!p.endsWith(".map")});
  cpSync(path.join(root,"dist","db"),path.join(staging,"dist","db"),{recursive:true,filter:p=>!p.endsWith(".map")});
  cpSync(path.join(root,"dist","renderer"),path.join(staging,"dist","renderer"),{recursive:true,filter:p=>!p.endsWith(".map")});
  for (const name of ["migrations","seed"]) cpSync(path.join(root,"db",name),path.join(staging,"db",name),{recursive:true});
  const modules = execFileSync("npm",["ls","--omit=dev","--all","--parseable"],{cwd:root,encoding:"utf8"}).trim().split("\n").slice(1);
  for (const module of new Set(modules)) {
    const relative = path.relative(path.join(root,"node_modules"),module);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Dependency outside local node_modules: ${module}`);
    cpSync(module,path.join(staging,"node_modules",relative),{recursive:true,dereference:true});
  }
  const electronVersion = JSON.parse(readFileSync(path.join(root,"node_modules","electron","package.json"),"utf8")).version;
  const sqliteModule = path.join(staging,"node_modules","better-sqlite3");
  if (beta1) {
    // better-sqlite3 13 uses Node-API. Keep only the target binary from the locked npm package.
    const prebuilds = path.join(sqliteModule, "prebuilds");
    const target = `darwin-${architecture}.node`;
    if (!existsSync(path.join(prebuilds, target))) throw new Error("Beta SQLite target binary is missing");
    for (const file of readdirSync(prebuilds)) if (file !== target) rmSync(path.join(prebuilds, file), { recursive: true, force: true });
    for (const directory of ["build", "bin"]) rmSync(path.join(sqliteModule, directory), { recursive: true, force: true });
  } else {
    // Historical Alpha packaging compiles its native module against Electron headers.
    for (const directory of ["prebuilds","build","bin"]) rmSync(path.join(sqliteModule,directory),{recursive:true,force:true});
    await rebuild({buildPath:staging,electronVersion,arch:architecture,force:true,buildFromSource:true,onlyModules:["better-sqlite3"]});
    if (!existsSync(path.join(sqliteModule,"build","Release","better_sqlite3.node"))) throw new Error("Electron SQLite target binary was not produced");
  }
  const electronZipDir = process.env.LIBREQUADRI_ELECTRON_ZIP_DIR;
  const outputs = await packager({dir:staging,name,platform:"darwin",arch:architecture,
    electronVersion,appVersion:version,buildVersion:build,
    appBundleId:beta1 ? "app.librequadri.beta1" : alpha11 ? "app.librequadri.alpha11" : alpha1 ? "app.librequadri.alpha1" : "app.librequadri.alpha",
    ...(electronZipDir ? { electronZipDir } : {}),
    ...(beta1 ? { osxSign: {
      identity: "-", identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
    } } : {}),
    out:output,prune:false,asar:false,extraResource:[seed],icon,
    extendInfo:{CFBundleDisplayName:name},
  });
  console.log(JSON.stringify({version,build,architecture:process.arch,outputs},null,2));
} catch (error) {
  console.error("Release packaging failed:",error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { if (staging) rmSync(staging,{recursive:true,force:true}); }
