import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { guardConfiguredStructuralItem, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import type { ConfigurationRequest } from "../src/shared/configuration.js";

/*
 * Optional real-data check, only run when LIBREQUADRI_REV83_REAL_DB points at a populated engineering catalogue.
 * It picks supports and enclosure pairs from the data itself (no model is named): a support that can be
 * newly placed in both A and B must also be movable A -> B, from a format-4 snapshot, and for a legacy
 * snapshot (no context facts) through the live guard; without a guard a legacy different-model move stays refused.
 */
const filename=process.env["LIBREQUADRI_REV83_REAL_DB"];
describe.runIf(!!filename&&existsSync(filename))("real catalogue: a support placeable in A and B is movable A -> B",()=>{
  let catalogue!:Database.Database;
  let supports:number[]=[];
  const complete=(modelId:number):ConfigurationRequest|null=>{
    let result=resolveConfiguration(catalogue,{modelId,selectedOptionIds:[]});
    if(result.status==="complete")return {modelId,selectedOptionIds:[]};
    const picks=result.model.axes.flatMap(axis=>axis.options.slice(0,1).map(option=>option.id));
    result=resolveConfiguration(catalogue,{modelId,selectedOptionIds:picks});
    return result.status==="complete"?{modelId,selectedOptionIds:picks}:null;
  };
  // Enclosure models physically and contextually accepting a support, from the catalogue's own tables.
  const enclosuresFor=(supportId:number)=>catalogue.prepare(`SELECT DISTINCT e.id FROM cat_config_model s
    JOIN cat_phys_profile sp ON sp.id=s.base_profile_id JOIN cat_phys_constraint sc ON sc.profile_id=sp.id AND sc.relation='parent'
    JOIN cat_phys_accept_set_member sm ON sm.set_id=sc.accept_set_id JOIN cat_phys_profile ep ON ep.fit_class_id=sm.class_id
    JOIN cat_config_model e ON e.base_profile_id=ep.id AND e.model_kind='enclosure' AND e.active=1 AND e.obsolete=0
    WHERE s.id=? AND EXISTS (SELECT 1 FROM cat_config_model_context a JOIN cat_config_model_context p
      ON p.context_id=a.context_id AND p.role='provides' AND p.model_id=e.id WHERE a.model_id=s.id AND a.role='accepts')
    ORDER BY e.id`).pluck().all(supportId) as number[];
  beforeAll(()=>{
    catalogue=new Database(filename!,{readonly:true});
    supports=(catalogue.prepare(`SELECT id FROM cat_config_model WHERE model_kind='support' AND active=1 AND obsolete=0 ORDER BY id`)
      .pluck().all() as number[]).filter(id=>enclosuresFor(id).length>=2).slice(0,3);
  });

  async function scenario(supportId:number,rootA:number,rootB:number,mode:"snapshot"|"legacy-guard"|"legacy-offline") {
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-real-move-"));
    try {
      const guard=mode!=="legacy-offline";
      const service=new ProjectDocumentService({workingDirectory:path.join(folder,"w"),incomingDirectory:path.join(folder,"i"),
        backupDirectory:path.join(folder,"b"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveCatalogueProduct:id=>getCatalogueProductSnapshot(catalogue,id),
        resolveConfiguration:request=>{const result=resolveConfiguration(catalogue,request);
          if(mode!=="snapshot")delete (result as {context?:unknown}).context;return result;},
        designGuard:(project,request,configuration)=>guardDesignCandidate(catalogue,project,request,{mode:"add",configuration}),
        ...(guard?{designItemGuard:(project,request)=>guardConfiguredStructuralItem(catalogue,project,request)}:{})});
      await service.create({destinationPath:path.join(folder,"c.lqp"),title:"T",description:"",notes:"",projectType:"civil",
        executor:"",date:"2026-09-29",companyName:"C",companyDescription:""});
      service.addStructural({kind:"enclosure",configuration:complete(rootA)!});
      const two=service.addStructural({kind:"enclosure",configuration:complete(rootB)!});
      const [a,b]=two.physicalNodes.filter(node=>node.nodeKind==="enclosure");
      const pooled=service.addStructural({kind:"support",parentUuid:a!.uuid,place:false,configuration:complete(supportId)!});
      const item=pooled.configuredItems.find(entry=>entry.modelKind==="support")!;
      // New placement into A and into B (offered by the same guard the write uses).
      const newB=service.placementTargets({parentUuid:b!.uuid,itemUuid:item.uuid});
      const newA=service.placementTargets({parentUuid:a!.uuid,itemUuid:item.uuid});
      if(!guard)return {newA:newA.targets.length,newB:newB.targets.length,moved:null,offered:null};
      expect(newA.targets.length).toBeGreaterThan(0);
      const placed=service.placeStructuralItem({action:"placeChild",input:newA.targets[0]!.input as never});
      const node=placed.physicalNodes.flatMap(entry=>entry.children).find(entry=>entry.nodeKind==="support")!;
      const offered=service.placementTargets({parentUuid:b!.uuid,nodeUuid:node.uuid});
      const target=offered.targets[0];
      const moved=target?service.moveNode(node.uuid,target.input as never):null;
      return {newA:newA.targets.length,newB:newB.targets.length,offered:offered.targets.length,
        moved:moved?.physicalNodes.flatMap(entry=>entry.children).find(entry=>entry.uuid===node.uuid)?.parentUuid===b!.uuid};
    } finally { rmSync(folder,{recursive:true,force:true}); }
  }

  it("moves A -> B from a format-4 snapshot, and for legacy snapshots through the live guard",async()=>{
    expect(supports.length).toBeGreaterThan(0);
    let checked=0;
    for(const supportId of supports){
      const roots=enclosuresFor(supportId).filter(id=>complete(id)&&complete(supportId));
      for(let index=0;index+1<Math.min(roots.length,3);index++){
        for(const mode of ["snapshot","legacy-guard"] as const){
          const result=await scenario(supportId,roots[index]!,roots[index+1]!,mode);
          if(!result||result.newB===0)continue;
          expect(result,`${mode} ${supportId} ${roots[index]} -> ${roots[index+1]}`).toMatchObject({offered:expect.any(Number),moved:true});
          expect(result.offered).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  },240_000);
});
