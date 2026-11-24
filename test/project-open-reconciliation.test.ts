import { suspectSavedArticleLinks } from "../src/shared/reviewed-article-links.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { calculateCommercial } from "../src/shared/commercial.js";
import { adapter, engineeringRefreshFixture } from "./helpers/engineering-refresh-fixture.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

async function setup() {
  const fixture = await engineeringRefreshFixture();
  cleanup.push(fixture.close);
  const reader = new ProjectDocumentService({ ...fixture.options,
    workingDirectory: path.join(fixture.root, "reconciled"), reconcileOnOpen: true });
  cleanup.push(() => reader.close());
  return { ...fixture, reader };
}

it.each([false, true])("verifies identical engineering and adopts safe label changes (%s)", async rename => {
  const f = await setup();
  f.working.exec("UPDATE prj_item SET source_adapter_version='1'");
  f.service.setQuantity(f.deviceLine, 2);
  await f.service.save();
  if (rename) f.db.exec("UPDATE cat_config_model SET name='Corrected device',definition_fingerprint='new' WHERE id=3");
  const saved = readFileSync(f.file);
  const opened = f.reader.open(f.file);
  expect(opened.dirty).toBe(true);
  expect(opened.configuredItems.find(item => item.uuid === f.device)).toMatchObject({
    modelName: rename ? "Corrected device" : "Device", sourceAdapterVersion: adapter.version,
  });
  expect(f.reader.engineeringStatus().counts.current_generation).toBe(3);
  expect(opened.physicalNodes).toEqual(f.service.current()!.physicalNodes);
  expect(readFileSync(f.file)).toEqual(saved);
  expect(f.reader.open(f.file)).toEqual(opened);
  await f.reader.save();
  f.reader.closeCurrent();
  expect(f.reader.open(f.file).dirty).toBe(false);
});

it.each([false, true])("requires review for geometry changes, with a DIN conflict (%s)", async conflict => {
  const f = await setup();
  f.service.placeChild(f.input);
  f.service.placeChild({ ...f.input, startUnits: 1 });
  await f.service.save();
  f.db.exec("UPDATE cat_config_model SET name='Updated panel' WHERE id=2");
  if (conflict) f.db.exec("UPDATE cat_phys_profile_demand SET amount=3 WHERE profile_id=3");
  else f.db.exec("UPDATE cat_phys_view SET height_mm=81 WHERE profile_id=3");
  f.importVersion(adapter.version, "b".repeat(64));
  const opened = f.reader.open(f.file);
  expect(opened.dirty).toBe(false);
  expect(opened.configuredItems.find(item => item.uuid === f.panel)?.modelName).toBe("Panel");
  expect(opened.openReconciliation?.engineeringReview).toContain("Device");
  const plan = f.reader.planEngineeringRefresh();
  expect(plan.canApply).toBe(!conflict);
  expect(plan.items.find(item => item.itemUuid === f.device)?.labelChanges).toContainEqual(conflict
    ? { field: "Ingombro", before: expect.stringContaining("1 "), after: expect.stringContaining("3 ") }
    : { field: "Disegno (front)", before: "18 × 80 mm", after: "18 × 81 mm" });
  expect(plan.newIssues.length > 0).toBe(conflict);
});

it.each(["eligible", "locked", "missing", "ambiguous", "different unit", "override"] as const)(
  "reprices a shared standalone and configured article only when eligible (%s)", async mode => {
    const f = await setup();
    const id = f.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='PART'").pluck().get() as number;
    const line = f.service.addCatalogueProduct(id, 2).lines.find(row => row.lineType === "product")!;
    f.service.setLineDiscount(line.uuid, 2500);
    if (mode === "locked") f.working.exec("UPDATE prj_item_bom SET price_locked=1");
    if (mode === "override") f.working.exec("UPDATE prj_item_bom SET sale_price_unit_e4=1234");
    await f.service.save();
    const before = f.service.current()!;
    const saved = readFileSync(f.file);
    f.f.importDelivery({ issuer: "GEN", listino: "2", validFrom: "2026-10-02",
      products: [{ marchio: "GEN", code: "PART", priceCents: 2000, description: "Part" }] });
    if (mode === "missing") f.db.exec("DELETE FROM com_product_price");
    if (mode === "ambiguous") {
      f.db.exec("DROP INDEX cat_product_brand_code_unique");
      const columns = (f.db.pragma("table_info(cat_product)") as { name: string }[])
        .filter(column => column.name !== "id").map(column => `"${column.name}"`).join(",");
      f.db.prepare(`INSERT INTO cat_product (${columns}) SELECT ${columns} FROM cat_product WHERE id=?`).run(id);
    }
    if (mode === "different unit") f.db.exec("UPDATE cat_product SET unit_of_measure='M'");
    const opened = f.reader.open(f.file);
    expect(readFileSync(f.file)).toEqual(saved);
    if (mode !== "eligible") {
      expect(opened.dirty).toBe(false);
      expect(opened.openReconciliation).toBeUndefined();
      expect(opened.lines).toEqual(before.lines);
      expect(opened.configuredItems).toEqual(before.configuredItems);
      return;
    }
    expect(opened.dirty).toBe(true);
    expect(opened.lines.find(row => row.uuid === line.uuid)).toMatchObject({
      quantity: 2, lineDiscountBp: 2500, unitListPriceE4: 200_000, lineTotalE4: 400_000,
    });
    expect(opened.configuredItems.find(item => item.uuid === f.device)?.bom[0]).toMatchObject({
      lineDiscountBp: 1250, salePriceUnitE4: 200_000, listPriceUnitE4: 200_000,
    });
    expect(opened.openReconciliation?.pricing).toEqual({
      beforeE4: calculateCommercial(before).finalTotalE4, afterE4: calculateCommercial(opened).finalTotalE4, snapshots: 1,
    });
    f.reader.discardCurrent();
    expect(readFileSync(f.file)).toEqual(saved);
    expect(f.reader.open(f.file).dirty).toBe(true);
    await f.reader.save();
    f.reader.closeCurrent();
    const reopened = f.reader.open(f.file);
    expect(reopened.dirty).toBe(false);
    expect(reopened.openReconciliation).toBeUndefined();
    expect(reopened.lines).toEqual(opened.lines);
  });

it("flags suspect saved TiQuadri articles and preserves their BOM, prices and saved bytes", async () => {
  const f = await setup();
  f.working.prepare("UPDATE prj_item SET model_brand_marchio='BTI',model_code='tq.pack.14172' WHERE uuid=?").run(f.device);
  f.working.exec("UPDATE prj_product_snapshot SET brand_marchio='CAB',manufacturer_code='646010'");
  f.service.setQuantity(f.deviceLine, 2);
  await f.service.save();
  const before = f.service.current()!;
  const bytes = readFileSync(f.file);
  f.f.importDelivery({ issuer: "CAB", listino: "2", validFrom: "2026-10-02",
    products: [{ marchio: "CAB", code: "646010", priceCents: 9999, description: "Cable cover" }] });
  const opened = f.reader.open(f.file);
  expect(opened.dirty).toBe(false);
  expect(opened.configuredItems).toEqual(before.configuredItems);
  expect(opened.distinta).toEqual(before.distinta);
  expect(opened.lines).toEqual(before.lines);
  expect(readFileSync(f.file)).toEqual(bytes);
  expect(suspectSavedArticleLinks(opened.configuredItems)).toMatchObject([{ saved: "CAB/646010", expected: "LEG/646010" }]);
  const unrelated = opened.configuredItems.map(item => ({ ...item, modelCode: "unrelated" }));
  expect(suspectSavedArticleLinks(unrelated)).toEqual([]);
});
