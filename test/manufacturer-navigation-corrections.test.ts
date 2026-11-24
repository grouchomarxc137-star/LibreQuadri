import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { browseRangeNodes } from "../src/main/catalogue/configuration-queries.js";
import {
  browseManufacturerNodes, listManufacturerArticles, listManufacturerModels,
  manufacturerPositions,
} from "../src/main/catalogue/manufacturer-navigation.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { parseBtiFstSegment } from "../src/main/metel/fst-parsers/bti.js";
import { synchronizeFstNavigation } from "../src/main/metel/fst-navigation.js";

const roots: string[] = [];
function database(): Database.Database {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-navigation-corrections-"));
  roots.push(root);
  return openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/lq") });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function base(db: Database.Database): void {
  db.exec(`INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'BTI'),(2,'SIE');
    INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES
      (1,'BTI','BTicino','import'),(2,'LEG','Legrand','import');
    INSERT INTO cat_metel_family(id,issuer_id,brand_id,family_type,code,description,is_known) VALUES
      (1,1,1,'STATISTICA','IND.-110-1-1','CENTRALINO - Accessories',1),
      (2,1,1,'STATISTICA','IND.-112-1-1','SISTEMA QUADRO - Panels',1),
      (3,1,1,'STATISTICA','CIV.-102-1-1','MY HOME DOMOTICA - Gateway',1),
      (4,2,2,'STATISTICA','R711 I33A','Flat family',1);
    INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,statistical_family_id,updated_at)
      VALUES(1,1,'A','A',1,'2026-09-23'),(2,1,'B','B',2,'2026-09-23'),
        (3,1,'C','C',3,'2026-09-23'),(4,2,'D','D',4,'2026-09-23');`);
}

describe("Revision 8.1 navigation corrections", () => {
  it("groups BTI by two code components while leaving unadapted issuers flat", () => {
    expect(parseBtiFstSegment("IND.-112-35-139", "SISTEMA QUADRO - PIASTRE E PANNELLI"))
      .toEqual({ code: "IND.-112", name: "SISTEMA QUADRO" });
    const db = database();
    try {
      base(db);
      synchronizeFstNavigation(db);
      const nodes = browseManufacturerNodes(db);
      const leaf = (code: string) => nodes.find(node => node.code.endsWith(`fst.${code}`))!;
      const segment = (code: string) => nodes.find(node => node.id === leaf(code).parentId)!;
      expect(segment("IND.-110-1-1")).toMatchObject({ name: "CENTRALINO", source: "metel" });
      expect(segment("IND.-112-1-1")).toMatchObject({ name: "SISTEMA QUADRO", source: "metel" });
      expect(segment("CIV.-102-1-1")).toMatchObject({ name: "MY HOME DOMOTICA" });
      expect(nodes.find(node => node.id === leaf("R711 I33A").parentId)?.kind).toBe("section");
      expect(nodes.filter(node => node.brandMarchio === "LEG").every(node => node.levelCode !== "segmento"))
        .toBe(true);
    } finally { db.close(); }
  });

  it("replaces derived links atomically, removes stale families and survives a protected root", () => {
    const db = database();
    try {
      base(db);
      synchronizeFstNavigation(db);
      const before = db.prepare(`SELECT code,active,parent_id FROM cat_range_node WHERE source='metel'
        ORDER BY code`).all();
      synchronizeFstNavigation(db);
      expect(db.prepare(`SELECT code,active,parent_id FROM cat_range_node WHERE source='metel'
        ORDER BY code`).all()).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) FROM cat_range_node_metel_family").pluck().get()).toBe(4);
      db.prepare("UPDATE cat_product SET statistical_family_id=NULL WHERE id=2").run();
      synchronizeFstNavigation(db, 1);
      expect(db.prepare(`SELECT active FROM cat_range_node WHERE code LIKE '%.fst.IND.-112-1-1'`)
        .pluck().get()).toBe(0);
      expect(db.prepare(`SELECT COUNT(*) FROM cat_range_node_metel_family nf
        JOIN cat_metel_family f ON f.id=nf.metel_family_id WHERE f.id=2`).pluck().get()).toBe(0);
      db.prepare("UPDATE cat_range_node SET source='manual' WHERE code='metel.1.1.root'").run();
      const result = synchronizeFstNavigation(db, 1);
      expect(result.protectedCollisions).toContain("metel.1.1.root");
      expect(db.prepare("SELECT source FROM cat_range_node WHERE code='metel.1.1.root'").pluck().get())
        .toBe("manual");
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("keeps Configura models when an ancestor is not catalogue navigable and honors catalogue precedence", () => {
    const db = database();
    try {
      base(db);
      db.exec(`INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source)
        VALUES(1,1,'test.model','Test model','device','fingerprint','import'),
          (2,1,'test.no-entry','No entry','device','fingerprint2','import');
        INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable)
          VALUES(100,1,NULL,'test.root','Apparecchi','section','import',0),
            (101,1,100,'test.family','Famiglia','group','import',1);
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(101,1),(101,2);
        INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(1,1);`);
      synchronizeFstNavigation(db);
      expect(browseRangeNodes(db).map(node => node.code)).toEqual(["test.root", "test.family"]);
      expect(browseManufacturerNodes(db).some(node => node.id === 101)).toBe(false);
      expect(listManufacturerArticles(db, { nodeId: 101 })).toEqual([]);
      expect(manufacturerPositions(db, 1).map(position => position.source)).toEqual(["metel"]);
      db.prepare("UPDATE cat_range_node SET navigable=1 WHERE id=100").run();
      expect(browseManufacturerNodes(db, "LEG").some(node => node.id === 101)).toBe(false);
      expect(browseManufacturerNodes(db, "BTI").some(node => node.id === 101)).toBe(true);
      expect(listManufacturerModels(db, 101).map(model => model.code)).toEqual(["test.model"]);
      expect(listManufacturerArticles(db, { nodeId: 101 }).map(item => item.manufacturerCode))
        .toEqual(["A"]);
      expect(listManufacturerArticles(db, { modelId: 1 }).map(item => item.manufacturerCode))
        .toEqual(["A"]);
      expect(manufacturerPositions(db, 1).map(position => position.source)).toEqual(["import"]);
      expect(browseManufacturerNodes(db, "BTI").filter(node => node.parentId === null)[0]?.code)
        .toBe("test.root");
    } finally { db.close(); }
  });

  it("paginates tied manufacturer codes by brand and product ID", () => {
    const db = database();
    try {
      base(db);
      db.exec(`INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,updated_at)
        VALUES(5,1,'X','X','2026-09-23'),(6,2,'X','X','2026-09-23'),
          (7,1,'Y','Y','2026-09-23');
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source)
          VALUES(1,1,'test.model','Test','device','fingerprint','import');
        INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source)
          VALUES(100,1,'test.family','Family','group','import');
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(100,1);
        INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(7,1),(6,1),(5,1);`);
      const ids = [0, 1, 2].flatMap(offset => listManufacturerArticles(db,
        { nodeId: 100, limit: 1, offset }).map(item => item.id));
      expect(ids).toEqual([5, 6, 7]);
      expect([0, 1, 2].flatMap(offset => listManufacturerArticles(db,
        { modelId: 1, limit: 1, offset }).map(item => item.id))).toEqual(ids);
    } finally { db.close(); }
  });
});
