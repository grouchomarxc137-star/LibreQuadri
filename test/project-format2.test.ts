import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { ProjectDocumentService, type ProjectDocumentServiceOptions } from "../src/main/project/project-document-service.js";
import { createCatalogueFixture } from "./helpers/catalogue-fixtures.js";

const fixture = path.resolve("test/fixtures/quotation-format1.lqp");
const migrationsFolder = path.resolve("db/migrations/project");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function service(root: string, resolveCatalogueProduct: ProjectDocumentServiceOptions["resolveCatalogueProduct"] = vi.fn(() => { throw new Error("empty local catalogue"); })) {
  return new ProjectDocumentService({
    workingDirectory: path.join(root, "working"), incomingDirectory: path.join(root, "incoming"),
    backupDirectory: path.join(root, "backups"), migrationsFolder, appVersion: "format2-test",
    resolveCatalogueProduct,
    now: () => new Date("2026-09-23T12:00:00.000Z"),
  });
}

function fixtureCopy(): { root: string; filename: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lqp-format2-"));
  roots.push(root);
  const filename = path.join(root, "quotation.lqp");
  copyFileSync(fixture, filename);
  return { root, filename };
}

describe("Revision-8 .lqp format 2", () => {
  it("migrates a committed format-1 quotation fixture in the working copy and saves it as the current format (11)", async () => {
    const { root, filename } = fixtureCopy();
    const original = readFileSync(filename);
    const reader = service(root);
    const opened = reader.open(filename);
    expect(opened).toMatchObject({ revision: 1, dirty: false, metadata: { title: "Preventivo formato 1" } });
    expect(opened.lines).toMatchObject([{ manufacturerCode: "FN81B16", quantity: 2,
      unitListPriceE4: 508_001, lineTotalE4: 1_016_002 }]);
    expect(readFileSync(filename)).toEqual(original);

    await reader.save();
    reader.close();
    const upgraded = new Database(filename, { readonly: true });
    try {
      expect(upgraded.prepare("SELECT value FROM lqp_meta WHERE key = 'format_version'").pluck().get()).toBe("11");
      expect(upgraded.prepare("SELECT item_id, snapshot_id, line_total_e4 FROM prj_line").get())
        .toEqual({ item_id: null, snapshot_id: 1, line_total_e4: 1_016_002 });
      expect(upgraded.prepare("SELECT attribute_code, value_num FROM prj_product_snapshot_attribute").get())
        .toEqual({ attribute_code: "rated_current", value_num: 16 });
      expect(upgraded.prepare("SELECT COUNT(*) AS count FROM prj_item").get()).toEqual({ count: 0 });
      expect(upgraded.prepare("SELECT COUNT(*) AS count FROM prj_node").get()).toEqual({ count: 0 });
      expect((upgraded.pragma("foreign_key_check") as unknown[])).toEqual([]);
    } finally { upgraded.close(); }
  });

  it("opens a populated format-2 configured item with an empty local catalogue", async () => {
    const { root, filename } = fixtureCopy();
    const upgrader = service(root);
    upgrader.open(filename);
    await upgrader.save();
    upgrader.close();

    const document = new Database(filename);
    try {
      document.pragma("journal_mode = DELETE");
      document.pragma("foreign_keys = ON");
      document.prepare(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
        model_definition_fingerprint,config_fingerprint,config_label,config_status,primary_snapshot_id,
        phys_status,profile_code,profile_name,fit_class_code,snapshot_taken_at)
        VALUES (1,'60000000-0000-4000-8000-000000000006','BTI','mdx800','MDX800','enclosure',
        'definition-sha','configuration-sha','MDX800 600×1200','complete',1,
        'resolved','profile-1','MDX800','fit-1','2026-09-23T12:00:00.000Z')`).run();
      document.prepare(`INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,dimension_label,
        value_code,value_label,selection_source,binding,editable_when_placed,visible)
        VALUES (1,0,'width','Larghezza','600','600 mm','user','none',1,1)`).run();
      document.prepare(`INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role,sale_price_unit_e4)
        VALUES (1,0,1,1,'primary',508001)`).run();
      document.prepare(`INSERT INTO prj_item_view(item_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind)
        VALUES (1,'front',600,1200,0,0,'enclosure')`).run();
      document.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,capacity_amount,
        origin_x_mm,origin_y_mm,length_mm,breadth_mm,direction,pitch_mm,required_view_code)
        VALUES (1,0,'stack','stack_mm',1100,100,100,1100,400,'vertical',50,'front')`).run();
      document.prepare(`INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity,sale_price_unit_e4,line_total_e4)
        VALUES ('70000000-0000-4000-8000-000000000007',1,1,'item',1,1,508001,508001)`).run();
      document.prepare(`INSERT INTO prj_node(uuid,item_id,node_kind,root_x_mm,root_y_mm,view_code,sort_order)
        VALUES ('80000000-0000-4000-8000-000000000008',1,'enclosure',0,0,'front',0)`).run();
      expect(document.pragma("foreign_key_check")).toEqual([]);
    } finally { document.close(); }


    const emptyCatalogue = createCatalogueFixture();
    expect(emptyCatalogue.lq.prepare("SELECT COUNT(*) AS count FROM cat_product").get()).toEqual({ count: 0 });
    const resolve = vi.fn((id: number) => getCatalogueProductSnapshot(emptyCatalogue.lq, id));
    const reader = service(root, resolve);
    try {
      expect(reader.open(filename).metadata.title).toBe("Preventivo formato 1");
      expect(resolve).not.toHaveBeenCalled();
      expect(reader.current()?.lines.map(line => line.lineType)).toEqual(["product", "item"]);
      expect(reader.current()?.configuredItems).toHaveLength(1);
      const placedLine = reader.current()!.lines.find(line => line.lineType === "item")!;
      expect(() => reader.removeLine(placedLine.uuid)).toThrow("è posizionato");
      expect(reader.current()?.dirty).toBe(false);
      expect(reader.setQuantity(placedLine.uuid,2).lines.find(line => line.lineType === "item"))
        .toMatchObject({quantity:2,lineTotalE4:1_016_002});
    } finally { reader.close(); emptyCatalogue.close(); }

    const tampered = new Database(filename);
    try {
      tampered.pragma("journal_mode = DELETE");
      tampered.exec("DELETE FROM prj_item_bom");
    } finally { tampered.close(); }
    expect(() => service(root).open(filename)).toThrow("non ha articoli nella distinta");

    const cyclic = new Database(filename);
    try {
      cyclic.pragma("journal_mode = DELETE");
      cyclic.exec(`INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role)
        VALUES (1,0,1,1,'primary')`);
      cyclic.exec(`UPDATE prj_node SET parent_id = id, zone_no = 0, start_units = 0,
        root_x_mm = NULL, root_y_mm = NULL`);
    } finally { cyclic.close(); }
    expect(() => service(root).open(filename)).toThrow("contiene un ciclo");
  });
});
