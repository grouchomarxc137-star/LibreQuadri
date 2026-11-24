import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { insertConfiguredItem } from "../src/main/project/configured-items.js";

const cataloguePath=process.env["LIBREQUADRI_REV83_REAL_DB"] ?? "";

describe.runIf(existsSync(cataloguePath))("real default-model configured insertion sweep",() => {
  it("inserts every active complete default resolution without overriding the acceptance rule",() => {
    const root=mkdtempSync(path.join(tmpdir(),"lqp-configured-sweep-"));
    const localCatalogue=path.join(root,"lq.db");copyFileSync(cataloguePath,localCatalogue);
    const catalogue=new Database(localCatalogue,{readonly:true});
    const project=openCurrentProjectDatabase(path.join(root,"sweep.lqp"),path.resolve("db/migrations/project"));
    try {
      project.prepare(`INSERT INTO prj_group(id,uuid,name,sort_order)
        VALUES (1,'10000000-0000-4000-8000-000000000001','Sweep',0)`).run();
      const models=catalogue.prepare(`SELECT id,code FROM cat_config_model
        WHERE active=1 AND obsolete=0 ORDER BY id`).all() as {id:number;code:string}[];
      let complete=0,inserted=0;
      const rejections:Array<{model:string;reason:string}>=[];
      for (const model of models) {
        const result=resolveConfiguration(catalogue,{modelId:model.id,selectedOptionIds:[]});
        if (result.status !== "complete") continue;
        complete++;
        project.exec("SAVEPOINT one_item");
        try {
          insertConfiguredItem(project,result,id => getCatalogueProductSnapshot(catalogue,id),
            "2026-09-24T00:00:00.000Z");
          inserted++;
        } catch (error) {
          rejections.push({model:model.code,reason:error instanceof Error?error.message:String(error)});
        } finally {
          project.exec("ROLLBACK TO one_item");project.exec("RELEASE one_item");
        }
      }
      console.log("Configured insertion sweep:",JSON.stringify({active:models.length,complete,inserted,rejections}));
      expect(complete).toBeGreaterThan(0);
      expect(rejections).toEqual([]);
      expect(inserted).toBe(complete);
    } finally {project.close();catalogue.close();rmSync(root,{recursive:true,force:true});}
  },120_000);
});
