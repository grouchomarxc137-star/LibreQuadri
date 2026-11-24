import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MainDatabaseService } from "../src/main/database/database-service.js";
import { importMetelDeliveryFromFiles } from "../src/main/metel/dev-import.js";
import { metelFamilyFile, metelLspFile } from "./helpers/metel-files.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "librequadri-dev-import-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(name: string, contents: Buffer): string {
  const filename = path.join(root, name);
  writeFileSync(filename, contents);
  return filename;
}

function importFiles(files: readonly string[], acceptOlderDelivery = false) {
  return importMetelDeliveryFromFiles({
    dataRoot: path.join(root, "data-root"),
    lqMigrationsFolder: path.resolve("db", "migrations", "lq"),
    rawMigrationsFolder: path.resolve("db", "migrations", "raw"),
    files,
    acceptOlderDelivery,
  });
}

function withService<T>(action: (service: MainDatabaseService) => T): T {
  const service = MainDatabaseService.initialize(path.join(root, "data-root"), {
    migrationsFolder: path.resolve("db", "migrations", "lq"),
  });
  try {
    return action(service);
  } finally {
    service.close();
  }
}

const products = [
  {
    marchio: "BTI",
    code: "FN81B16",
    description: "btdin60 - magnetot 1P curva B 16A 6kA",
    priceCents: 1234,
    statisticalFamily: "CIV.-108",
  },
  {
    marchio: "LEG",
    code: "4 060 20",
    description: "cavo H07V-K 1,5 mmq",
    priceCents: 5075,
    multiplier: 100,
    um: "LM",
    discountFamily: "DISC1",
  },
];

describe("developer METEL import (existing pipeline, real file text)", () => {
  it("imports LSP/FSC/FST files into a catalogue the service can search", () => {
    const lsp = write("BTILSP020.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products }));
    const fsc = write(
      "BTIFSC.txt",
      metelFamilyFile({ type: "FSC", issuer: "BTI", families: [{ marchio: "LEG", code: "DISC1", description: "Sconto cavi" }] }),
    );
    const fst = write(
      "BTIFST.txt",
      metelFamilyFile({ type: "FST", issuer: "BTI", families: [{ marchio: "BTI", code: "CIV.-108", description: "Protezione" }] }),
    );

    const result = importFiles([lsp, fsc, fst]);
    expect(result.files.map((file) => [file.fileType, file.rowCount])).toEqual([
      ["LSP", 2],
      ["FSC", 1],
      ["FST", 1],
    ]);
    expect(result.delivery).toMatchObject({
      alreadyNormalized: false,
      becameCurrent: true,
      summary: { issuerSigla: "BTI", productCount: 2, priceCount: 2 },
    });

    withService((service) => {
      const magnetot = service.searchCatalogue({ query: "magnetot 16A" });
      expect(magnetot.products).toHaveLength(1);
      expect(magnetot.products[0]).toMatchObject({
        brandMarchio: "BTI",
        manufacturerCode: "FN81B16",
        description: "btdin60 - magnetot 1P curva B 16A 6kA",
        isListed: true,
        price: { unitPriceE4: 123400, priceMultiplier: 1, issuerSigla: "BTI" },
      });

      const cable = service.searchCatalogue({ query: "4 060 20" }).products[0];
      expect(cable).toMatchObject({
        brandMarchio: "LEG",
        manufacturerCode: "4 060 20",
        unitOfMeasure: "LM",
        price: { listPriceE4: 507500, priceMultiplier: 100, unitPriceE4: 5075 },
      });

      expect(service.catalogueOverview()).toMatchObject({
        productCount: 2,
        listedProductCount: 2,
        currentPriceLists: [
          { issuerSigla: "BTI", validFrom: "2026-07-01", listedProductCount: 2 },
        ],
      });
    });
  });

  it("is idempotent: importing the same delivery again changes nothing", () => {
    const lsp = write("a.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products }));
    importFiles([lsp]);
    const again = importFiles([lsp]);
    expect(again.delivery.alreadyNormalized).toBe(true);
    expect(again.files[0]?.alreadyParsed).toBe(true);
    withService((service) => {
      expect(service.catalogueOverview().productCount).toBe(2);
    });
  });

  it("applies a newer listino and delists what it no longer contains", () => {
    importFiles([write("v1.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-01-01", listino: "000001", products }))]);
    importFiles([
      write(
        "v2.txt",
        metelLspFile({
          issuer: "BTI",
          validFrom: "2026-07-01",
          listino: "000002",
          products: [{ ...products[0]!, priceCents: 2000 }],
        }),
      ),
    ]);

    withService((service) => {
      const [kept] = service.searchCatalogue({ query: "FN81B16" }).products;
      expect(kept?.price?.unitPriceE4).toBe(200000);
      const [gone] = service.searchCatalogue({ query: "4 060 20" }).products;
      expect(gone).toMatchObject({ isListed: false, price: null });
    });
  });

  it("requires explicit confirmation for an older delivery", () => {
    importFiles([write("new.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products }))]);
    const older = write("old.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-01-01", listino: "000000", products: [products[0]!] }));

    expect(() => importFiles([older])).toThrow(/requires explicit confirmation/);
    expect(importFiles([older], true).delivery.becameCurrent).toBe(false);
  });

  it("rejects incomplete or ambiguous deliveries before touching the catalogue", () => {
    const fsc = write(
      "only-fsc.txt",
      metelFamilyFile({ type: "FSC", issuer: "BTI", families: [{ marchio: "BTI", code: "X", description: "x" }] }),
    );
    expect(() => importFiles([fsc])).toThrow(/needs exactly one LSP/);
    expect(() => importFiles([])).toThrow(/No METEL files/);

    const first = write("l1.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-01-01", products }));
    const second = write("l2.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-02-01", products }));
    expect(() => importFiles([first, second])).toThrow(/More than one LSP/);
  });

  it("classifies and enriches with the seed from the given folder, not the working directory", () => {
    const seedFolder = path.join(root, "seed");
    mkdirSync(seedFolder);
    writeFileSync(path.join(seedFolder, "categories.json"), JSON.stringify([
      { code: "test", parentCode: null, name: "Test", sortOrder: 0, active: true },
    ]));
    mkdirSync(path.join(seedFolder, "category-mappings"));
    writeFileSync(path.join(seedFolder, "category-mappings", "bti.json"), JSON.stringify([
      { code: "test.civ-108", issuerSigla: "BTI", brandMarchio: "BTI", sourceType: "STATISTICA",
        matchMode: "exact", matchValue: "CIV.-108", categoryCode: "test", priority: 0, notes: null },
    ]));
    writeFileSync(path.join(seedFolder, "attributes.json"), JSON.stringify([
      { code: "poles", name: "Poli", dataType: "enum", unit: null, active: true,
        options: [{ value: "1p", label: "1P", sortOrder: 1, active: true }] },
    ]));
    writeFileSync(path.join(seedFolder, "category-attributes.json"), JSON.stringify([
      { categoryCode: "test", attributeCode: "poles", sortOrder: 1, isFilterable: true, isRequired: false, filterWidget: "checkbox" },
    ]));
    writeFileSync(path.join(seedFolder, "product-families.json"), JSON.stringify([
      { brandMarchio: "BTI", code: "test.family", categoryCode: "test", name: "Custom family",
        series: null, description: null, active: true, axes: ["poles"] },
    ]));
    const fst = write(
      "BTIFST.txt",
      metelFamilyFile({ type: "FST", issuer: "BTI", families: [{ marchio: "BTI", code: "CIV.-108", description: "Protezione" }] }),
    );
    importMetelDeliveryFromFiles({
      dataRoot: path.join(root, "data-root"),
      lqMigrationsFolder: path.resolve("db", "migrations", "lq"),
      rawMigrationsFolder: path.resolve("db", "migrations", "raw"),
      seedFolder,
      files: [write("BTILSP020.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products })), fst],
    });
    const catalogue = new Database(path.join(root, "data-root/data/lq.db"), {readonly: true});
    try {
      expect(catalogue.prepare("SELECT code FROM cat_product_family ORDER BY code").pluck().all())
        .toEqual(["test.family"]);
    } finally { catalogue.close(); }

    withService((service) => {
      const product = service.searchCatalogue({ query: "FN81B16" }).products[0];
      expect(product.category).toEqual({ code: "test", name: "Test" });
      expect(product.attributes).toEqual([
        { code: "poles", name: "Poli", dataType: "enum", unit: null, value: "1p", label: "1P" },
      ]);
    });
    expect(() => importMetelDeliveryFromFiles({
      dataRoot: path.join(root, "other-root"),
      lqMigrationsFolder: path.resolve("db", "migrations", "lq"),
      rawMigrationsFolder: path.resolve("db", "migrations", "raw"),
      seedFolder: path.join(root, "missing-seed"),
      files: [write("other.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products }))],
    })).toThrow(/ENOENT/);
  });

  it("stops serving catalogue queries once the service is closed", () => {
    importFiles([write("a.txt", metelLspFile({ issuer: "BTI", validFrom: "2026-07-01", products }))]);
    const service = MainDatabaseService.initialize(path.join(root, "data-root"), {
      migrationsFolder: path.resolve("db", "migrations", "lq"),
    });
    service.close();
    expect(() => service.searchCatalogue({ query: "FN81B16" })).toThrow(/closed/);
    expect(() => service.catalogueOverview()).toThrow(/closed/);
  });
});
