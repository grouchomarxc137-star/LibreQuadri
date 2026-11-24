import Database from "better-sqlite3";
import { expect, it } from "vitest";

import { readDistinta } from "../src/main/project/configured-items.js";

it("groups ordinary and configured quantities while pricing only from article list snapshots", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE prj_product_snapshot (
      id INTEGER PRIMARY KEY,uuid TEXT,brand_marchio TEXT,manufacturer_code TEXT,
      description TEXT,short_description TEXT,unit_of_measure TEXT,list_price_unit_e4 INTEGER);
      CREATE TABLE prj_line (
        id INTEGER PRIMARY KEY,line_type TEXT,snapshot_id INTEGER,item_id INTEGER,
        quantity INTEGER,sale_price_unit_e4 INTEGER);
      CREATE TABLE prj_item_bom (
        item_id INTEGER,snapshot_id INTEGER,quantity_per_item INTEGER,sale_price_unit_e4 INTEGER);
      INSERT INTO prj_product_snapshot VALUES
        (1,'priced','TEST','A','Article A',NULL,'PCE',12500),
        (2,'unpriced','TEST','B','Article B',NULL,'PCE',NULL);
      INSERT INTO prj_line VALUES
        (1,'product',1,NULL,2,10000),
        (2,'item',NULL,10,3,99000),
        (3,'item',NULL,11,1,15000),
        (4,'product',2,NULL,4,NULL);
      INSERT INTO prj_item_bom VALUES
        (10,1,2,9000),
        (11,1,1,15000);`);

    const expected = [
      {snapshotUuid:"priced",brandMarchio:"TEST",manufacturerCode:"A",
        description:"Article A",unitOfMeasure:"PCE",quantity:9,
        listPriceUnitE4:12500,listTotalE4:112500},
      {snapshotUuid:"unpriced",brandMarchio:"TEST",manufacturerCode:"B",
        description:"Article B",unitOfMeasure:"PCE",quantity:4,
        listPriceUnitE4:null,listTotalE4:null},
    ];
    expect(readDistinta(db)).toEqual(expected);

    db.exec(`UPDATE prj_line SET sale_price_unit_e4=50000;
      UPDATE prj_item_bom SET sale_price_unit_e4=1000;`);
    expect(readDistinta(db)).toEqual(expected);

    db.prepare("UPDATE prj_product_snapshot SET list_price_unit_e4=? WHERE id=1")
      .run(Number.MAX_SAFE_INTEGER);
    expect(() => readDistinta(db)).toThrow("intervallo numerico supportato");
  } finally {
    db.close();
  }
});
