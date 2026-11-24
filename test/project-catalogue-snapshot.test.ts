import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { createCatalogueFixture } from "./helpers/catalogue-fixtures.js";

describe("real catalogue to portable project snapshot", () => {
  it("keeps stable identity and exact integer _e4 without persisting the local product id", async () => {
    const fixture = createCatalogueFixture();
    const root = mkdtempSync(path.join(tmpdir(), "lqp-real-snapshot-"));
    try {
      fixture.importDelivery({ issuer: "BTI", listino: "021", validFrom: "2026-07-01", products: [{
        marchio: "BTI", code: "FN81B16", ean: "8005543534684",
        description: "btdin60 - magnetot 1P curva B 16A", priceCents: 5_080, multiplier: 1,
      }] });
      const local = fixture.lq.prepare("SELECT id FROM cat_product WHERE manufacturer_code = 'FN81B16'").get() as { id: number };
      const source = getCatalogueProductSnapshot(fixture.lq, local.id);
      expect(source).toMatchObject({
        brandMarchio: "BTI", manufacturerCode: "FN81B16", priceIssuerSigla: "BTI",
        priceListinoNumber: "021", priceValidFrom: "2026-07-01", listPriceUnitE4: 508_000,
      });
      expect(Number.isSafeInteger(source.listPriceUnitE4)).toBe(true);
      expect(source).not.toHaveProperty("id");

      const filename = path.join(root, "real.lqp");
      const service = new ProjectDocumentService({
        workingDirectory: path.join(root, "working"), incomingDirectory: path.join(root, "incoming"),
        backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/project"),
        appVersion: "test", resolveCatalogueProduct: (id) => getCatalogueProductSnapshot(fixture.lq, id),
      });
      await service.create({
        destinationPath: filename, title: "Reale", description: "", notes: "", projectType: "civil",
        executor: "", date: "2026-09-22", companyName: "Cliente", companyDescription: "",
      });
      service.addCatalogueProduct(local.id);
      await service.save();
      service.close();

      const project = new Database(filename, { readonly: true });
      try {
        const row = project.prepare(`SELECT brand_marchio AS brand, manufacturer_code AS code,
          list_price_unit_e4 AS price FROM prj_product_snapshot`).get();
        expect(row).toEqual({ brand: "BTI", code: "FN81B16", price: 508_000 });
        expect((project.pragma("table_xinfo('prj_product_snapshot')") as { name: string }[])
          .map((column) => column.name)).not.toContain("cat_product_id");
      } finally { project.close(); }
    } finally {
      fixture.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
