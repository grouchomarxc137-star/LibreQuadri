import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { guardDesignCandidate, guardConfiguredStructuralItem } from "../src/main/project/design-compatibility.js";
import { assessProjectPhysical } from "../src/main/project/physical-placement.js";
import { documentTables } from "../src/main/project/document-history.js";
import { readFrontVectorAssets } from "../src/main/catalogue/vector-assets.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

const source = process.env['LIBREQUADRI_REV83_REAL_DB'];
const assetsRoot = process.env['LIBREQUADRI_REV83_REAL_ASSETS'] ?? path.resolve(path.dirname(source ?? '.'),'../assets');
describe.runIf(!!source && existsSync(source))('current HDX post-insertion reconfiguration (private copies)',()=>{
  it.each([1,3])('Q=%i: all eight HDX 108 door/plinth blocks preserve panels/devices/identities and historical commerce',async quantity=>{
    const folder=mkdtempSync(path.join(tmpdir(),'librequadri-enclosure-real-'));
    const original=new Database(source!,{readonly:true});
    try{original.prepare('VACUUM INTO ?').run(path.join(folder,'catalogue.db'));}finally{original.close();}
    const catalogue=new Database(path.join(folder,'catalogue.db'));
    expect(readEngineeringReadiness(catalogue).sources.find(row=>row.adapterCode==='tiquadri'))
      .toMatchObject({status:'ready',installedVersion:TIQUADRI_ENGINEERING_ADAPTER.version,
        requiredVersion:TIQUADRI_ENGINEERING_ADAPTER.version});
    const id=(code:string)=>catalogue.prepare('SELECT id FROM cat_config_model WHERE code=?').pluck().get(code) as number;
    const model=getConfigurationModel(catalogue,id('tq.pack.108'));
    const option=(axis:string,value:number)=>model.axes.find(row=>row.dimensionCode===axis)!.options.find(row=>row.valueCode===`tq.value.${value}`)!.id;
    const options={migrationsFolder:path.resolve('db/migrations/project'),appVersion:'test',
      engineeringCatalogue:()=>catalogue,resolveConfiguration:(request:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(catalogue,request),
      resolveCatalogueProduct:(id:number)=>getCatalogueProductSnapshot(catalogue,id),
      designGuard:(project:Database.Database,request:Parameters<typeof guardDesignCandidate>[2],configuration:Parameters<typeof resolveConfiguration>[1])=>guardDesignCandidate(catalogue,project,request,{mode:'add',configuration}),
      designItemGuard:(project:Database.Database,request:Parameters<typeof guardConfiguredStructuralItem>[2])=>guardConfiguredStructuralItem(catalogue,project,request),
      resolveFrontAssets:(keys:readonly string[])=>readFrontVectorAssets(catalogue,assetsRoot,keys)};
    try {
      for(const [frontIndex,front] of [2,4,6,8].entries()) for(const [delta,plinth] of [[0,22],[4,24]]) {
        const key=`${front}-${plinth}`,file=path.join(folder,key+'.lqp');
        const service=new ProjectDocumentService({...options,workingDirectory:path.join(folder,key,'w'),incomingDirectory:path.join(folder,key,'i'),backupDirectory:path.join(folder,key,'b')});
        let working:Database.Database|undefined;
        try {
          await service.create({destinationPath:file,title:'HDX',description:'',notes:'',projectType:'civil',executor:'',date:'2026-10-09',companyName:'',companyDescription:''});
          const frame=service.addConfiguredItem({modelId:model.id,selectedOptionIds:[]},quantity).configuredItems[0]!.uuid;
          const selected=service.placeRoot({itemUuid:frame,viewCode:'front',rootXMm:100,rootYMm:20}).physicalNodes[0]!.uuid;
          if(quantity>1) service.placeRoot({itemUuid:frame,viewCode:'front',rootXMm:1100,rootYMm:20});
          service.addStructural({kind:'support',parentUuid:selected,configuration:{modelId:id('tq.pack.853'),selectedOptionIds:[]}});
          const panel=service.current()!.physicalNodes[0]!.children[0]!.uuid;
          const device=service.addStructural({kind:'device',parentUuid:panel,place:false,configuration:{modelId:id('tq.pack.1777'),selectedOptionIds:[]}}).configuredItems.find(item=>item.modelCode==='tq.pack.1777')!;
          service.placeChild({itemUuid:device.uuid,parentUuid:panel,zoneNo:0,startUnits:6,viewCode:'front'});
          service.setComponentDiscount(frame,0,1750);service.setGlobalDiscount(500);service.setLabourTotal(12345);
          await service.save();
          working=new Database(path.join(folder,key,'w',readdirSync(path.join(folder,key,'w')).find(name=>name.endsWith('.lqp'))!));
          const dump=()=>Object.fromEntries(documentTables(working!).map(table=>[table,working!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
          const before=service.current()!,beforeDump=dump(),bytes=readFileSync(file);
          const request={modelId:model.id,selectedOptionIds:[option('tq.label.1',front),option('tq.label.3',plinth!)]};
          // Commercial updates do not reinterpret engineering. Retained articles use old snapshots;
          // new door/plinth articles use this current price. Restore catalogue between cases.
          catalogue.exec('UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2');
          const resolved=resolveConfiguration(catalogue,request);
          const after=service.reconfigureEnclosure(selected,request);
          const item=after.configuredItems.find(row=>row.uuid===after.physicalNodes[0]!.itemUuid)!;
          expect(item.profileCode).toBe(`tq.armadi.pack.108.block.${311+frontIndex+delta!}`);
          expect(after.physicalNodes[0]!.uuid).toBe(selected);
          expect(after.physicalNodes[0]!.children).toEqual(before.physicalNodes[0]!.children);
          if(quantity>1)expect(after.physicalNodes[1]).toEqual(before.physicalNodes[1]);
          expect(assessProjectPhysical(working)).toEqual([]);
          const old=before.configuredItems[0]!;
          for(const row of item.bom){
            const retained=old.bom.find(previous=>previous.brandMarchio===row.brandMarchio&&previous.manufacturerCode===row.manufacturerCode);
            const fresh=resolved.bom.find(article=>article.linkedBrandMarchio===row.brandMarchio&&article.linkedManufacturerCode===row.manufacturerCode)!;
            expect(row.salePriceUnitE4).toBe(retained?.salePriceUnitE4??fresh.unitPriceE4);
            expect(row.lineDiscountBp).toBe(retained?.lineDiscountBp??0);
          }
          expect(readFileSync(file)).toEqual(bytes);
          const changed=front!==2||plinth!==22;
          if(changed){
            expect(after.lines.find(line=>line.itemUuid===item.uuid)!.quantity).toBe(1);
            const post=dump();expect(service.undo().dirty).toBe(false);expect(dump()).toEqual(beforeDump);
            expect(service.redo().configuredItems).toEqual(after.configuredItems);expect(dump()).toEqual(post);
          }else{expect(after).toEqual(before);expect(dump()).toEqual(beforeDump);}
          if(front===4&&plinth===24){
            // Actual HDX door A→B→A, with offline persistence before a newer listino.
            const alternative={modelId:model.id,selectedOptionIds:[option('tq.label.1',6),option('tq.label.3',24)]};
            const b=service.reconfigureEnclosure(selected,alternative);
            const bItem=b.configuredItems.find(row=>row.uuid===b.physicalNodes[0]!.itemUuid)!;
            const removed=item.bom.filter(row=>!bItem.bom.some(other=>other.brandMarchio===row.brandMarchio&&other.manufacturerCode===row.manufacturerCode));
            expect(removed.length).toBeGreaterThan(0);
            for(const row of removed)expect(working.prepare('SELECT id FROM prj_product_snapshot WHERE brand_marchio=? AND manufacturer_code=?')
              .get(row.brandMarchio,row.manufacturerCode)).toBeUndefined();
            await service.save();working.close();working=undefined;service.close();
            const offlineCycle=new ProjectDocumentService({...options,workingDirectory:path.join(folder,key,'cycle-offline'),incomingDirectory:path.join(folder,key,'cycle-i'),backupDirectory:path.join(folder,key,'b'),engineeringCatalogue:()=>null,
              resolveConfiguration:()=>{throw new Error('offline');},resolveCatalogueProduct:()=>{throw new Error('offline');}});
            try{expect(offlineCycle.open(file).configuredItems).toEqual(b.configuredItems);await offlineCycle.save();}finally{offlineCycle.close();}
            catalogue.exec('UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2');
            service.open(file);
            working=new Database(path.join(folder,key,'w',readdirSync(path.join(folder,key,'w')).find(name=>name.endsWith('.lqp'))!));
            const restored=service.reconfigureEnclosure(selected,request);
            const aItem=restored.configuredItems.find(row=>row.uuid===restored.physicalNodes[0]!.itemUuid)!;
            const current=resolveConfiguration(catalogue,request);
            for(const row of removed)expect(aItem.bom.find(other=>other.brandMarchio===row.brandMarchio&&other.manufacturerCode===row.manufacturerCode)!.salePriceUnitE4)
              .toBe(current.bom.find(other=>other.linkedBrandMarchio===row.brandMarchio&&other.linkedManufacturerCode===row.manufacturerCode)!.unitPriceE4);
            expect(restored.physicalNodes).toEqual(after.physicalNodes);
            expect(assessProjectPhysical(working)).toEqual([]);
            const restoredDump=dump();service.undo();expect(service.current()!.configuredItems).toEqual(b.configuredItems);
            service.redo();expect(dump()).toEqual(restoredDump);
            catalogue.exec('UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4/2');
          }
          const assets=readFrontVectorAssets(catalogue,assetsRoot,item.views.map(view=>view.assetKey!).filter(Boolean));
          expect(Object.keys(assets)).toEqual(item.views.map(view=>view.assetKey));
          await service.save();const saved=service.current()!;working.close();working=undefined;service.close();
          const offline=new ProjectDocumentService({...options,workingDirectory:path.join(folder,key,'offline'),incomingDirectory:path.join(folder,key,'offline-i'),backupDirectory:path.join(folder,key,'b'),engineeringCatalogue:()=>null,
            resolveConfiguration:()=>{throw new Error('offline');},resolveCatalogueProduct:()=>{throw new Error('offline');}});
          try{expect(offline.open(file)).toMatchObject({configuredItems:saved.configuredItems,physicalNodes:saved.physicalNodes,lines:saved.lines,distinta:saved.distinta});}finally{offline.close();}
          catalogue.exec('UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4/2');
        }finally{working?.close();service.close();}
      }
    }finally{catalogue.close();rmSync(folder,{recursive:true,force:true});}
  },120000);
});
