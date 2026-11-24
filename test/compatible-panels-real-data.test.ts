import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { insertConfiguredItem } from "../src/main/project/configured-items.js";
import { placeRoot } from "../src/main/project/physical-placement.js";
import { discoverReferenceDevices, discoverCompatiblePanels, checkConfiguredPanelReference } from "../src/main/project/design-compatibility.js";

const source=process.env['LIBREQUADRI_COMPATIBLE_PANELS_REAL_DB'];
describe.runIf(!!source&&existsSync(source))('configured reference panels on a private installed-catalogue copy',()=>{
  it('reproduces reported examples, configuration-dependent sets and final panel refusals with timings',async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),'librequadri-compatible-panels-real-'));
    const installed=new Database(source!,{readonly:true});
    await installed.backup(path.join(folder,'catalogue.db'));installed.close();
    const catalogue=new Database(path.join(folder,'catalogue.db'),{readonly:true});
    const project=openCurrentProjectDatabase(path.join(folder,'test.lqp'),path.resolve('db/migrations/project'));
    const id=(code:string)=>catalogue.prepare('SELECT id FROM cat_config_model WHERE code=?').pluck().get(code) as number;
    const codes=(ids:number[])=>ids.map(modelId=>getConfigurationModel(catalogue,modelId).code);
    try{
      expect(readEngineeringReadiness(catalogue).sources.find(row=>row.adapterCode==='tiquadri')?.status).toBe('ready');
      project.exec("INSERT INTO prj_group(id,uuid,name,sort_order) VALUES(1,'10000000-0000-4000-8000-000000000001','Quote',0)");
      const enclosure=resolveConfiguration(catalogue,{modelId:id('tq.pack.343'),selectedOptionIds:[]});
      expect(enclosure.status).toBe('complete');
      const itemUuid=insertConfiguredItem(project,enclosure,productId=>getCatalogueProductSnapshot(catalogue,productId),'2026-10-15');
      const parentUuid=placeRoot(project,{itemUuid,rootXMm:0,rootYMm:0,viewCode:'front'});
      const before=project.serialize();project.pragma('query_only=ON');
      const started=performance.now();const references=discoverReferenceDevices(catalogue,project,parentUuid);
      const pickerMs=performance.now()-started;
      expect(references.status).toBe('ready');
      const samples:Array<{code:string;execution:string;count:number;panels:string[];milliseconds:number;referenceCode?:string}>=[];
      let finalRefusals=0;
      for(const code of ['tq.pack.1556','tq.pack.1552','tq.pack.1550']){
        const model=getConfigurationModel(catalogue,id(code));
        if(code!=='tq.pack.1550')expect(references.candidates).toContain(model.id);
        const defaults=resolveConfiguration(catalogue,{modelId:model.id,selectedOptionIds:[]});
        expect(defaults.status).toBe('complete');
        const execution=model.axes.find(axis=>axis.label==='Esecuzione')!;
        for(const option of execution.options.filter(row=>row.active)){
          const selectedOptionIds=[...defaults.selectedOptionIds.filter(selected=>!execution.options.some(row=>row.id===selected)),option.id];
          const request={parentUuid,device:{configuration:{modelId:model.id,selectedOptionIds},definitionFingerprint:model.definitionFingerprint}};
          const start=performance.now();const result=discoverCompatiblePanels(catalogue,project,request);
          const milliseconds=performance.now()-start;
          if(code!=='tq.pack.1550')expect(result.reference.ok).toBe(true);
          expect(result.navigation.status).toBe('ready');
          samples.push({code,execution:option.label,count:result.navigation.candidates.length,panels:codes(result.navigation.candidates),milliseconds,referenceCode:result.reference.code});
          for(const panelId of result.navigation.candidates){
            const panel=resolveConfiguration(catalogue,{modelId:panelId,selectedOptionIds:[]});
            // Discovery uses the base support class; defaults/options are independently verified.
            const checked=checkConfiguredPanelReference(catalogue,project,{...request,panel:{modelId:panelId,selectedOptionIds:panel.selectedOptionIds}});
            if(panel.status==='complete'&&!checked.ok)finalRefusals++;
            const detail=getConfigurationModel(catalogue,panelId);
            for(const axis of detail.axes){
              for(const choice of axis.options.filter(row=>row.active&&row.parentOptionId===null)){
                const selected=[...panel.selectedOptionIds.filter(selected=>!axis.options.some(row=>row.id===selected)),choice.id];
                const resolved=resolveConfiguration(catalogue,{modelId:panelId,selectedOptionIds:selected});
                const final=checkConfiguredPanelReference(catalogue,project,{...request,panel:{modelId:panelId,selectedOptionIds:selected}});
                if(resolved.status==='complete'&&!final.ok)finalRefusals++;
              }
            }
          }
        }
      }
      // Reported counts are reproduced from this fixture, rather than made a universal runtime contract.
      const mw250=samples.find(row=>row.code==='tq.pack.1556'&&row.execution==='Fissa Anteriori')!;
      expect(mw250.count).toBeGreaterThan(0);
      const mw630=samples.filter(row=>row.code==='tq.pack.1552');
      expect(mw630[0]!.panels).not.toEqual(mw630[1]!.panels);
      expect(samples.filter(row=>row.code==='tq.pack.1550').every(row=>row.count===0)).toBe(true);
      expect(project.serialize()).toEqual(before);
      const evidence={referenceCount:references.candidates.length,pickerMs,samples,finalRefusals,
        quickCheck:catalogue.pragma('quick_check'),foreignKeyCheck:catalogue.pragma('foreign_key_check')};
      const evidenceFile=process.env['LIBREQUADRI_COMPATIBLE_PANELS_EVIDENCE'];
      if(evidenceFile)writeFileSync(evidenceFile,JSON.stringify(evidence,null,2)+'\n');
      console.log('COMPATIBLE_PANELS_REAL_EVIDENCE',JSON.stringify(evidence));
    }finally{project.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
  },60_000);
});
