import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { restoredOptionIds } from "../src/renderer/configuration/model-configuration.js";

const cataloguePath = process.env["LIBREQUADRI_REV83_REAL_DB"] ?? "";

describe.runIf(existsSync(cataloguePath))("GN8813AC16 real configured-line flow", () => {
  it("restores a branched default, adds directly, duplicates and edits the copy independently", async () => {
    const root = mkdtempSync(path.join(tmpdir(),"librequadri-gn-lines-"));
    const localCatalogue = path.join(root,"lq.db");
    copyFileSync(cataloguePath,localCatalogue);
    const catalogue = new Database(localCatalogue,{readonly:true});
    const service = new ProjectDocumentService({workingDirectory:path.join(root,"working"),
      incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveConfiguration:request=>resolveConfiguration(catalogue,request),
      resolveCatalogueProduct:id=>getCatalogueProductSnapshot(catalogue,id)});
    try {
      const article = catalogue.prepare("SELECT id FROM cat_product WHERE manufacturer_code=?")
        .get("GN8813AC16") as {id:number};
      const entry = catalogue.prepare("SELECT model_id AS modelId FROM cat_config_model_entry WHERE product_id=?")
        .get(article.id) as {modelId:number};
      const request = {modelId:entry.modelId,productId:article.id,selectedOptionIds:[]};
      const defaulted = resolveConfiguration(catalogue,request);
      expect(defaulted.status).toBe("complete");
      const phaseAxis = defaulted.model.axes.find(axis=>axis.label==="Fasi di cablaggio")!;
      const phase = phaseAxis.options.find(option=>defaulted.selectedOptionIds.includes(option.id))!;
      expect(phase.label).toBe("L1 - N");
      const saved = defaulted.model.axes.flatMap(axis=>axis.options.filter(option=>
        defaulted.selectedOptionIds.includes(option.id)).map(option=>({
          dimensionCode:axis.dimensionCode,valueCode:option.valueCode,
        })));
      const restored = restoredOptionIds(defaulted.model,saved);
      expect(restored).toContain(phase.id);
      expect(restored.filter(id=>phaseAxis.options.some(option=>option.id===id))).toEqual([phase.id]);
      expect(resolveConfiguration(catalogue,{...request,selectedOptionIds:restored}).status).toBe("complete");

      await service.create({destinationPath:path.join(root,"GN.lqp"),title:"GN test",description:"",
        notes:"",projectType:"civil",executor:"",date:"2026-09-30",companyName:"Test",
        companyDescription:""});
      const added = service.addConfiguredItem(request);
      expect(added.lines).toMatchObject([{lineType:"item",quantity:1}]);
      expect(added.configuredItems[0]!.selections.some(row=>row.dimensionCode===phaseAxis.dimensionCode &&
        row.valueCode===phase.valueCode && row.selectionSource==="default")).toBe(true);
      const duplicated = service.duplicateConfiguredItem(added.lines[0]!.uuid);
      expect(duplicated.lines.map(line=>line.quantity)).toEqual([1,1]);
      expect(duplicated.configuredItems[1]!.uuid).not.toBe(duplicated.configuredItems[0]!.uuid);
      const alternative = phaseAxis.options.find(option=>option.parentOptionId===phase.parentOptionId &&
        option.label==="L2 - N")!;
      const edited = service.replaceConfiguredItem(duplicated.lines[1]!.uuid,
        {...request,selectedOptionIds:[alternative.id]});
      expect(edited.configuredItems.find(item=>item.uuid===added.configuredItems[0]!.uuid)?.configFingerprint)
        .toBe(added.configuredItems[0]!.configFingerprint);
      expect(edited.configuredItems.some(item=>item.selections.some(row=>row.dimensionCode===phaseAxis.dimensionCode &&
        row.valueCode===alternative.valueCode))).toBe(true);
      const increased = service.setQuantity(added.lines[0]!.uuid,2);
      expect(increased.lines.map(line=>line.quantity)).toEqual([2,1]);
      const third = phaseAxis.options.find(option=>option.parentOptionId===phase.parentOptionId &&
        option.label==="L3 - N")!;
      const copyFingerprint = edited.configuredItems.find(item=>item.selections.some(row=>
        row.dimensionCode===phaseAxis.dimensionCode && row.valueCode===alternative.valueCode))!.configFingerprint;
      const changedSource = service.replaceConfiguredItem(added.lines[0]!.uuid,
        {...request,selectedOptionIds:[third.id]});
      expect(changedSource.configuredItems.some(item=>item.configFingerprint===copyFingerprint &&
        item.selections.some(row=>row.valueCode===alternative.valueCode))).toBe(true);
      expect(changedSource.lines.map(line=>line.quantity).sort()).toEqual([1,2]);
    } finally { service.close(); catalogue.close(); rmSync(root,{recursive:true,force:true}); }
  });
});
