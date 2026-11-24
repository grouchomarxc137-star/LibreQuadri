import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

// Licensed inputs are optional; all writes happen in fresh scratch roots. These
// are actual compiled CLI/importer tests, with real OS signals and real SQLite.
const baseline = process.env["LIBREQUADRI_CARPENTERIA_REAL_DB"];
const current = process.env["LIBREQUADRI_REV83_REAL_DB"];
const sources = { master: process.env["LIBREQUADRI_TIQUADRI_MDB"], listino: process.env["LIBREQUADRI_LISTINOBT_MDB"],
  dxf: process.env["LIBREQUADRI_TIQUADRI_DXF_MDB"] };
const available = process.platform !== "win32" && [baseline, current, ...Object.values(sources)]
  .every(file => file && existsSync(file));
type Phase = "engineering" | "drawings";
type Witness = { inTransaction: boolean; backups: number; temporary: string; frozen: string[] };
type Delivery = { open: boolean; inTransaction: boolean; backups: number; frozenPresent: boolean; exclusion: string };

// Always probe from another process: opening/closing a raw target FD in the
// lock holder would cancel that process's POSIX locks.
const probe = `import Database from 'better-sqlite3';
try { const db = new Database(process.argv[1], {fileMustExist:true, timeout:0});
  try { db.prepare('SELECT count(*) FROM app_source_import').get(); console.log('UNLOCKED'); }
  finally { db.close(); }
} catch (error) { console.log(error.code); }`;
const snapshot = (db: Database.Database) => db.prepare(`SELECT id,adapter_version,fingerprint FROM app_source_import
  WHERE became_current=1 AND (adapter_code='tiquadri' OR (adapter_code='assets' AND source_label LIKE 'DXF_BLOCK:%'))
  ORDER BY adapter_code`).all() as {id:number;adapter_version:string;fingerprint:string}[];

describe.runIf(available)("engineering sync CLI pending signals with real MDBs", () => {
  let application: string;
  const active = new Set<number>();
  const roots = new Set<string>();
  beforeAll(() => {
    application = mkdtempSync(path.join(tmpdir(), "librequadri-sync-signal-cli-"));
    writeFileSync(path.join(application, "package.json"), JSON.stringify({type:"module"}));
    symlinkSync(path.resolve("node_modules"), path.join(application, "node_modules"), "dir");
    cpSync(path.resolve("db"), path.join(application, "db"), {recursive:true});
    // Compile current source independently of any preexisting dist build.
    execFileSync(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json",
      "--outDir", path.join(application, "dist")], {cwd:path.resolve("."), stdio:"pipe"});
  }, 60_000);
  afterAll(() => {
    // Never remove the application or its seeds while a child is still active.
    if (active.size === 0) {
      for (const root of roots) rmSync(root, {recursive:true, force:true});
      if (application) rmSync(application, {recursive:true, force:true});
    }
  });

  for (const phase of ["engineering", "drawings"] as const) for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`acknowledges ${signal} queued inside the synchronous ${phase} transaction`, async () => {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), "librequadri-sync-signal-target-")));
      roots.add(root);
      const filename = path.join(root, "data/lq.db");
      mkdirSync(path.dirname(filename));
      const original = new Database(phase === "engineering" ? baseline! : current!, {readonly:true});
      try { await original.backup(filename); } finally { original.close(); }
      const setup = new Database(filename);
      let before: ReturnType<typeof snapshot>;
      try {
        setup.pragma("journal_mode = WAL");
        before = snapshot(setup);
        expect(before.find(row => row.adapter_version === (phase === "engineering" ? "10" : TIQUADRI_ENGINEERING_ADAPTER.version))).toBeDefined();
        for (const role of ["master", "listino", "dxf"] as const) {
          const metadata = setup.prepare(`SELECT f.file_sha256, f.byte_size FROM app_source_import_file f
            JOIN app_source_import i ON i.id=f.import_id WHERE i.became_current=1 AND f.role=?`).get(role) as
            {file_sha256:string;byte_size:number};
          const digest = createHash("sha256");
          for await (const bytes of createReadStream(sources[role]!)) digest.update(bytes);
          expect(statSync(sources[role]!).size).toBe(metadata.byte_size);
          expect(digest.digest("hex")).toBe(metadata.file_sha256);
          const directory = path.join(root, role === "dxf" ? "assets/tiquadri-dxf" : "imports/tiquadri");
          mkdirSync(directory, {recursive:true});
          copyFileSync(sources[role]!, path.join(directory, `${metadata.file_sha256}.mdb`));
        }
        if (phase === "drawings") setup.prepare(`UPDATE cat_phys_view SET asset_key='signal-regression-only'
          WHERE (profile_id,view_code)=(SELECT profile_id,view_code FROM cat_phys_view WHERE asset_key IS NOT NULL LIMIT 1)`).run();
      } finally { setup.close(); }

      const marker = path.join(root, "operation.json"), deliveryFile = path.join(root, "delivery.json");
      const release = path.join(root, "release"), preload = path.join(root, "witness.mjs");
      // Instrument boundaries, never replace an import/backup or install signal
      // handlers. The gate blocks the actual transaction's synchronous stack.
      writeFileSync(preload, `import fs from 'node:fs';
import path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {execFileSync} from 'node:child_process';
const Database=createRequire(${JSON.stringify(path.join(application, "package.json"))})('better-sqlite3');
const filename=${JSON.stringify(filename)}, phase=${JSON.stringify(phase)}, requested=${JSON.stringify(signal)};
let temporary, holder, backups=0, witnessed=false;
const mkdtemp=fs.mkdtempSync;
fs.mkdtempSync=function(prefix,...args) { const value=mkdtemp.call(this,prefix,...args);
  if (String(prefix).includes('librequadri-engineering-sync-')) temporary=value; return value; };
syncBuiltinESMExports();
const backup=Database.prototype.backup;
Database.prototype.backup=async function(...args) { backups++; try {return await backup.apply(this,args);} finally {backups--;} };
function frozen() { return ['master','listino','dxf'].flatMap(role=>fs.readdirSync(path.join(temporary,role)).map(name=>path.join(temporary,role,name))); }
function witness(db) {
  if (witnessed || db.name!==filename) return;
  witnessed=true; holder=db;
  fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({inTransaction:db.inTransaction,backups,temporary,frozen:frozen()}));
  const deadline=Date.now()+30000, sleep=new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(${JSON.stringify(release)})) {
    if (Date.now()>deadline) throw new Error('Signal regression gate timed out');
    Atomics.wait(sleep,0,0,10);
  }
}
const exec=Database.prototype.exec;
Database.prototype.exec=function(sql) { const result=exec.call(this,sql);
  if (phase==='engineering' && sql==='PRAGMA defer_foreign_keys = ON') witness(this); return result; };
const prepare=Database.prototype.prepare;
Database.prototype.prepare=function(sql) {
  if (phase==='drawings' && sql===\"UPDATE app_source_import SET became_current=0 WHERE adapter_code='assets' AND source_label LIKE 'DXF_BLOCK:%'\") witness(this);
  return prepare.call(this,sql);
};
const stderr=process.stderr.write.bind(process.stderr);
process.stderr.write=function(chunk,...args) {
  if (String(chunk).includes(requested+' received;')) {
    const exclusion=execFileSync(process.execPath,['--input-type=module','-e',${JSON.stringify(probe)},filename],{encoding:'utf8'}).trim();
    fs.writeFileSync(${JSON.stringify(deliveryFile)},JSON.stringify({open:holder.open,inTransaction:holder.inTransaction,backups,
      frozenPresent:frozen().every(file=>fs.existsSync(file)),exclusion}));
  }
  return stderr(chunk,...args);
};
`);
      const child = spawn(process.execPath, ["--import", preload, path.join(application, "dist/scripts/sync-engineering.js"),
        "--data-dir", root], {cwd:application, stdio:["ignore", "pipe", "pipe"]});
      active.add(child.pid!);
      let stdout = "", stderr = "", closed = false;
      child.stdout.on("data", data => { stdout += data; });
      child.stderr.on("data", data => { stderr += data; });
      const exited = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => { closed=true; active.delete(child.pid!); resolve({code,signal}); });
      });
      try {
        const deadline = Date.now() + 90_000;
        while (!existsSync(marker)) {
          if (closed || Date.now() > deadline) throw new Error(`CLI did not reach ${phase} transaction: ${stderr}`);
          await setTimeout(20);
        }
        const witness = JSON.parse(readFileSync(marker, "utf8")) as Witness;
        expect(witness).toMatchObject({inTransaction:true, backups:0});
        expect(witness.frozen).toHaveLength(3);
        expect(witness.frozen.every(file => existsSync(file))).toBe(true);
        expect(execFileSync(process.execPath, ["--input-type=module", "-e", probe, filename],
          {cwd:application, encoding:"utf8"}).trim()).toBe("SQLITE_BUSY");
        expect(child.kill(signal)).toBe(true);
        await setTimeout(30);
        expect(closed).toBe(false);
        expect(existsSync(deliveryFile)).toBe(false); // signal is pending on the blocked event loop
        writeFileSync(release, "settle");
        const result = await exited;
        expect(result, stderr).toEqual({code:signal === "SIGINT" ? 130 : 143, signal:null});
        expect(stderr).toContain(`${signal} received;`);
        expect(stderr).toContain(`Engineering sync interrupted:`);
        expect(stderr).toContain(`interrupted by ${signal}`);
        expect(stdout).toBe("");
        const delivery = JSON.parse(readFileSync(deliveryFile, "utf8")) as Delivery;
        expect(delivery).toEqual({open:true, inTransaction:false, backups:0, frozenPresent:true, exclusion:"SQLITE_BUSY"});
        expect(existsSync(witness.temporary)).toBe(false);
        const verify = new Database(filename, {fileMustExist:true, timeout:0});
        try {
          expect(verify.pragma("quick_check", {simple:true})).toBe("ok");
          expect(verify.pragma("foreign_key_check")).toEqual([]);
          const after = snapshot(verify);
          if (phase === "engineering") {
            expect(after.find(row => row.adapter_version === TIQUADRI_ENGINEERING_ADAPTER.version)).toBeDefined();
            expect(after[0]).toEqual(before[0]); // drawings never start after engineering interruption
            expect(stderr).not.toContain("Synchronizing drawings");
          } else {
            expect(after[1]).toEqual(before[1]); // engineering stays current
            expect(after[0]!.fingerprint).not.toBe(before[0]!.fingerprint);
          }
        } finally { verify.close(); }
        const cli = path.join(application, "dist/scripts/sync-engineering.js");
        const check = spawnSync(process.execPath, [cli, "--data-dir", root, "--check"], {cwd:application, encoding:"utf8"});
        expect(check.status, check.stderr).toBe(phase === "engineering" ? 2 : 0);
        expect(JSON.parse(check.stdout)).toMatchObject({engineeringNeeded:false, drawingsNeeded:phase === "engineering"});
        if (phase === "drawings") {
          const noOp = spawnSync(process.execPath, [cli, "--data-dir", root], {cwd:application, encoding:"utf8"});
          expect(noOp.status, noOp.stderr).toBe(0);
          expect(JSON.parse(noOp.stdout)).toMatchObject({engineeringImported:false, drawingsImported:false});
          expect(noOp.stderr).not.toContain("interrupted");
        }
        expect(readdirSync(path.join(root, "backups"))).toHaveLength(1);
        process.stdout.write(JSON.stringify({phase, requestedSignal:signal, ...result, gateInTransaction:witness.inTransaction,
          delivery, temporaryRemoved:!existsSync(witness.temporary), quickCheck:"ok", foreignKeys:[], checkExit:check.status}) + "\n");
      } finally {
        // Release even on assertion failure; await the live operation before any
        // deletion. On a hang the runner may time out, but no reaper deletes inputs.
        writeFileSync(release, "settle");
        await exited;
        if (closed) { rmSync(root, {recursive:true, force:true}); roots.delete(root); }
      }
    }, 240_000);
  }
});
