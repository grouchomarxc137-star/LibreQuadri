import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getPhysicalProfile } from "../src/main/catalogue/configuration-queries.js";
import { checkPhysicalClasses } from "../src/main/project/physical-class-compatibility.js";
import { discoverDesignCandidates, guardDesignCandidate } from "../src/main/project/design-compatibility.js";

const filename=process.env["LIBREQUADRI_REV83_REAL_DB"];
describe.runIf(!!filename&&existsSync(filename))("Revision 8.3 real catalogue",()=>{
  it("requires the MDX800 root context in addition to physical compatibility",()=>{
    const catalogue=new Database(filename!,{readonly:true});
    const project=new Database(":memory:");
    try {
      const root=catalogue.prepare(`SELECT m.id,m.definition_fingerprint AS fingerprint,
        b.metel_marchio AS brand,c.code AS fit FROM cat_config_model m
        JOIN cat_brand b ON b.id=m.brand_id JOIN cat_phys_profile p ON p.id=m.base_profile_id
        JOIN cat_phys_class c ON c.id=p.fit_class_id WHERE m.code='tq.pack.343'`)
        .get() as {id:number;fingerprint:string;brand:string;fit:string};
      project.exec(`CREATE TABLE prj_item(id INTEGER PRIMARY KEY,model_brand_marchio TEXT,
        model_code TEXT,model_definition_fingerprint TEXT,fit_class_code TEXT);
        CREATE TABLE prj_node(id INTEGER PRIMARY KEY,uuid TEXT,parent_id INTEGER,item_id INTEGER,node_kind TEXT);`);
      project.prepare(`INSERT INTO prj_item VALUES(1,?,'tq.pack.343',?,?)`)
        .run(root.brand,root.fingerprint,root.fit);
      project.exec(`INSERT INTO prj_node VALUES(1,'root',NULL,1,'enclosure')`);
      const physical=catalogue.prepare(`SELECT m.id,m.base_profile_id AS profileId FROM cat_config_model m
        WHERE m.model_kind='support' AND m.active=1 AND m.obsolete=0`).all() as
        {id:number;profileId:number|null}[];
      const eligible=physical.filter(row=>{
        const profile=row.profileId===null?null:getPhysicalProfile(catalogue,row.profileId);
        return profile&&checkPhysicalClasses(profile.constraints,root.fit,[root.fit]).ok;
      });
      expect(eligible).toHaveLength(210);
      const result=discoverDesignCandidates(catalogue,project,{parentUuid:"root",kind:"support"});
      expect(result).toMatchObject({status:"ready",staleImportIds:[],contextDataUnavailable:0});
      expect(result.candidates).toHaveLength(114);
      const code=(id:number)=>catalogue.prepare("SELECT code FROM cat_config_model WHERE id=?")
        .pluck().get(id) as string;
      const panelCandidates=result.candidates.filter(id=>catalogue.prepare(`SELECT p.code
        FROM cat_config_model m JOIN cat_phys_profile p ON p.id=m.base_profile_id WHERE m.id=?`)
        .pluck().get(id)==="tq.pan.6311").map(code);
      expect(panelCandidates).toEqual(["tq.pack.851"]);
      const id=(code:string)=>catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?")
        .pluck().get(code) as number;
      expect(guardDesignCandidate(catalogue,project,{parentUuid:"root",kind:"support",modelId:id("tq.pack.848")}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
      expect(guardDesignCandidate(catalogue,project,{parentUuid:"root",kind:"support",modelId:id("tq.pack.851")}))
        .toEqual({ok:true,code:"compatible"});
      expect(catalogue.prepare(`SELECT COUNT(*) FROM cat_range_node
        WHERE code LIKE 'tq.orphan.%' AND design_navigable=1`).pluck().get()).toBe(0);
      const providerEvidence=catalogue.prepare(`SELECT c.code,
        COUNT(m.id) AS providerCount,
        COALESCE(SUM(CASE WHEN m.active=1 AND m.obsolete=0 THEN 1 ELSE 0 END),0) AS activeCount,
        COALESCE(SUM(CASE WHEN m.obsolete=1 THEN 1 ELSE 0 END),0) AS obsoleteCount
        FROM cat_config_context c LEFT JOIN cat_config_model_context mc
          ON mc.context_id=c.id AND mc.role='provides'
        LEFT JOIN cat_config_model m ON m.id=mc.model_id
        WHERE c.active=1 AND c.code LIKE 'tq.ctx.%' GROUP BY c.id ORDER BY c.code`).all() as
        {code:string;providerCount:number;activeCount:number;obsoleteCount:number}[];
      const noProvider=providerEvidence.filter(row=>row.providerCount===0);
      const obsoleteOnly=providerEvidence.filter(row=>row.providerCount>0&&row.activeCount===0);
      expect(noProvider.map(row=>row.code)).toEqual(["tq.ctx.110","tq.ctx.130","tq.ctx.150"]);
      expect(obsoleteOnly.map(row=>row.code)).toEqual([
        "tq.ctx.200","tq.ctx.220","tq.ctx.460","tq.ctx.461","tq.ctx.494"]);
      expect(obsoleteOnly.every(row=>row.providerCount===row.obsoleteCount)).toBe(true);
      expect(noProvider.length+obsoleteOnly.length).toBe(8);
      const counts=catalogue.prepare(`SELECT
        (SELECT COUNT(*) FROM cat_config_context WHERE active=1 AND code LIKE 'tq.ctx.%') AS classes,
        (SELECT COUNT(*) FROM cat_config_context c WHERE c.active=1 AND c.code LIKE 'tq.ctx.%' AND NOT EXISTS (
          SELECT 1 FROM cat_config_model_context mc JOIN cat_config_model m ON m.id=mc.model_id
          WHERE mc.context_id=c.id AND mc.role='provides')) AS noProvider,
        (SELECT COUNT(DISTINCT mc.model_id) FROM cat_config_model_context mc
          JOIN cat_config_model m ON m.id=mc.model_id WHERE mc.role='provides' AND m.model_kind='enclosure' AND m.brand_id=(SELECT id FROM cat_brand WHERE metel_marchio='BTI')) AS providers,
        (SELECT COUNT(DISTINCT model_id) FROM cat_config_model_context WHERE role='accepts' AND model_id IN (SELECT id FROM cat_config_model WHERE brand_id=(SELECT id FROM cat_brand WHERE metel_marchio='BTI'))) AS acceptors,
        (SELECT COUNT(*) FROM cat_config_model_context WHERE role='accepts' AND model_id IN (SELECT id FROM cat_config_model WHERE brand_id=(SELECT id FROM cat_brand WHERE metel_marchio='BTI'))) AS acceptedRows`)
        .get();
      expect(counts).toEqual({classes:44,noProvider:3,providers:801,acceptors:8470,acceptedRows:44157});
    }finally{project.close();catalogue.close();}
  });
});
