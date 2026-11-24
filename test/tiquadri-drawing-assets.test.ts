import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { convertDxfBlock } from "../src/main/sources/tiquadri/dxf-svg.js";
import { importDrawingBlocks } from "../src/main/sources/tiquadri/drawing-assets.js";
import { parseFrontVectorSvg, readFrontVectorAssets } from "../src/main/catalogue/vector-assets.js";

const temp:string[]=[];
afterEach(()=>{for(const folder of temp.splice(0))rmSync(folder,{recursive:true,force:true});});
const dxf=(...groups:(string|number)[])=>groups.join("\r\n")+"\r\n";
const block=(name:string,...body:(string|number)[])=>dxf(0,"BLOCK",2,name,10,0,20,0,
  ...body,0,"ENDBLK");
const enclosure=block("CASE",0,"LINE",10,0,20,0,11,60,21,0,
  0,"LINE",10,60,20,0,11,60,21,100,0,"LINE",10,60,20,100,11,0,21,100,
  0,"LINE",10,0,20,100,11,0,21,0);
const panel=block("PANEL",0,"SOLID",10,0,20,0,11,40,21,0,12,40,22,5,13,0,23,5,
  0,"CIRCLE",10,20,20,2.5,40,1);
const device=block("DEVICE",0,"POLYLINE",70,1,0,"VERTEX",10,0,20,0,
  0,"VERTEX",10,2,20,0,0,"VERTEX",10,2,20,4,0,"VERTEX",10,0,20,4,
  0,"SEQEND",0,"ARC",10,1,20,2,40,0.5,50,0,51,180);

function setup(){
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-drawings-"));temp.push(folder);
  const db=openMigratedLqDatabase({databaseFilename:path.join(folder,"lq.db"),
    backupDirectory:path.join(folder,"backups"),migrationsFolder:path.resolve("db/migrations/lq")});
  db.exec(`INSERT INTO cat_phys_class(code,name,source) VALUES('test','Test','manual');
    INSERT INTO cat_phys_profile_set(code,name,source) VALUES('test','Test','manual');`);
  const create=db.prepare(`INSERT INTO cat_phys_profile(code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
    VALUES(?,1,?,?,'Test',1,'manual')`);
  const view=db.prepare(`INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,asset_key)
    VALUES(?,'front',?,?,'test',?)`);
  for(const [i,kind,width,height,key] of [[1,"enclosure",600,1000,"Cabinets\\CASE"],
    [2,"support",400,50,"Panels\\PANEL"],[3,"device",20,40,"Devices\\DEVICE"],
    [4,"device",20,40,"Devices\\MISSING"],[5,"device",20,40,"Devices\\BROKEN"]] as const){
    create.run(`test.${i}`,i,kind);view.run(i,width,height,key);
  }
  return {db,folder,assetsRoot:path.join(folder,"assets")};
}

describe("local drawing asset import",()=>{
  it("keeps foreign source fronts out of TiQuadri basename matching",()=>{
    const {db,assetsRoot}=setup();
    try{
      db.exec(`INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
        VALUES(1,'sienergy','3','Siemens','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','2026-11-23',1,'{}');
        UPDATE cat_phys_profile SET source='import',source_import_id=1 WHERE id=1;
        UPDATE cat_phys_view SET asset_key='sienergy/CASE' WHERE profile_id=1;`);
      const result=importDrawingBlocks({database:db,assetsRoot,source:Buffer.from("foreign collision"),
        sourceName:"source.mdb",blocks:[{NOME:"CASE",CONTENUTO:enclosure},{NOME:"PANEL",CONTENUTO:panel}]});
      expect(result.referenced).toBe(4);expect(result.resolved).toBe(1);
      expect(db.prepare("SELECT COUNT(*) FROM cat_asset_variant WHERE asset_key='sienergy/CASE'").pluck().get()).toBe(0);
      expect(db.prepare("SELECT asset_key FROM cat_phys_view WHERE profile_id=1").pluck().get()).toBe("sienergy/CASE");
    }finally{db.close();}
  });
  it("resolves enclosure, panel, and device keys; persists derived SVGs and serves them through generic assets",()=>{
    const {db,assetsRoot}=setup();
    try {
      const result=importDrawingBlocks({database:db,assetsRoot,source:Buffer.from("synthetic MDB"),
        sourceName:"synthetic.mdb",blocks:[{NOME:"CASE",CONTENUTO:enclosure},
          {NOME:"PANEL",CONTENUTO:panel},{NOME:"DEVICE",CONTENUTO:device},
          {NOME:"BROKEN",CONTENUTO:"0\nBLOCK\ninvalid"}]});
      expect(result).toMatchObject({referenced:5,resolved:3,alreadyImported:false});
      expect(result.missing).toEqual(["Devices\\MISSING"]);
      expect(result.invalid).toEqual(["Devices\\BROKEN"]);
      expect(db.prepare("SELECT COUNT(*) FROM cat_asset_variant").pluck().get()).toBe(3);
      expect(db.prepare("SELECT COUNT(*) FROM cat_asset").pluck().get()).toBe(4);
      expect(db.prepare(`SELECT a.origin AS origin, parent.origin AS parentOrigin,
        l.may_display AS mayDisplay,l.may_embed_in_project AS mayEmbed
        FROM cat_asset_variant v JOIN cat_asset a ON a.id=v.asset_id
        JOIN cat_asset parent ON parent.id=a.derived_from_asset_id
        JOIN cat_asset_license l ON l.code=a.license_code LIMIT 1`).get()).toEqual({
        origin:"derived",parentOrigin:"manufacturer",mayDisplay:1,mayEmbed:0,
      });
      const assets=readFrontVectorAssets(db,assetsRoot,["Cabinets\\CASE","Panels\\PANEL",
        "Devices\\DEVICE","Devices\\MISSING"]);
      expect(Object.keys(assets)).toHaveLength(3);
      expect(assets["Cabinets\\CASE"]!.strokes).toContain("L 60 0");
      expect(assets["Panels\\PANEL"]!.strokes).toContain(" A 1 1 ");
      expect(assets["Panels\\PANEL"]!.fills).toContain(" Z");
      expect(assets["Devices\\DEVICE"]!.strokes).toContain(" A 0.5 0.5 ");
      expect(assets["Devices\\DEVICE"]!.strokes).toContain(" Z");
      expect(importDrawingBlocks({database:db,assetsRoot,source:Buffer.from("synthetic MDB"),
        sourceName:"synthetic.mdb",blocks:[]})).toMatchObject({alreadyImported:true,resolved:3});
    }finally{db.close();}
  });

  it("rejects malformed geometry and tampered assets; an unknown entity cannot inject markup",()=>{
    const renderer=readFileSync("src/renderer/project/ProgettazioneScreen.tsx","utf8");
    expect(renderer).not.toMatch(/BTicino|TiQuadri|File_blocco|BTQuadriDXF|tq\./i);
    expect(()=>convertDxfBlock("0\nBLOCK\n2\nX\n0\nVIEWPORT\n0\nENDBLK\n")).toThrow();
    const parsed=convertDxfBlock(block("X",0,"LINE",10,0,20,0,11,1,21,1,
      0,"VIEWPORT",1,"<script>alert(1)</script>"));
    expect(parsed.unsupported).toEqual(["VIEWPORT"]);
    expect(parsed.svg).not.toContain("script");
    expect(parseFrontVectorSvg(parsed.svg)?.strokes).toContain(" L 1 -1");
    expect(parseFrontVectorSvg(parsed.svg.replace("</svg>","<script/></svg>"))).toBeNull();
    const {db,assetsRoot}=setup();
    try {
      importDrawingBlocks({database:db,assetsRoot,source:Buffer.from("source"),sourceName:"x.mdb",
        blocks:[{NOME:"CASE",CONTENUTO:enclosure}]});
      const rel=db.prepare(`SELECT a.rel_path AS rel FROM cat_asset_variant v JOIN cat_asset a ON a.id=v.asset_id
        WHERE v.asset_key='Cabinets\\CASE'`).get() as {rel:string};
      const filename=path.join(assetsRoot,rel.rel);
      writeFileSync(filename,readFileSync(filename,"utf8")+"<script/>");
      expect(readFrontVectorAssets(db,assetsRoot,["Cabinets\\CASE"])).toEqual({});
    }finally{db.close();}
  });
});
