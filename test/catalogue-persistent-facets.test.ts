import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidCatalogueFilterError } from "../src/main/catalogue/attribute-queries.js";
import { browseCatalogue, BROWSE_SCOPE_SQL } from "../src/main/catalogue/browse-queries.js";
import { browseManufacturerNodes } from "../src/main/catalogue/manufacturer-navigation.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import type { CatalogueBrowseRequest, CatalogueBrowseResult } from "../src/shared/catalogue.js";

/*
 * Tree 10 Apparecchi ─ 11 Interruttori ─ 111 Magnetotermici ─ 1111 Unipolari (A)
 *                  │                                        └ 1112 Bipolari (B, C)
 *                  └ 12 Ausiliari (D, E: no technical attributes, METEL family, not configurable)
 * Tree 20 FST ─ 21 Other brand (F, single brand, no attributes)
 */
const roots: string[] = [];
function fixture(): BetterSqlite3.Database {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-facets-"));
  roots.push(root);
  const db = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/lq") });
  db.exec(`INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'ISS');
    INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ALP','Alpha','import'),(2,'BET','Beta','import');
    INSERT INTO cat_category(id,code,name,source) VALUES(1,'devices','Devices','seed'),(2,'misc','Misc','seed');
    INSERT INTO cat_attribute(id,code,name,data_type,source) VALUES
      (1,'color','Color','enum','seed'),(2,'poles','Poles','number','seed'),(3,'single','Single','enum','seed');
    INSERT INTO cat_attribute_option(id,attribute_id,value,label,sort_order,source) VALUES
      (1,1,'red','Red',1,'seed'),(2,1,'blue','Blue',2,'seed'),(3,1,'green','Green',3,'seed'),(4,3,'only','Only',1,'seed');
    INSERT INTO cat_category_attribute(category_id,attribute_id,source) VALUES(1,1,'seed'),(1,2,'seed'),(1,3,'seed');
    INSERT INTO cat_metel_family(id,issuer_id,brand_id,family_type,code,is_known) VALUES
      (1,1,1,'STATISTICA','FST-AUX',1),(2,1,2,'STATISTICA','FST-OTHER',1);
    INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,short_description,is_listed,category_id,statistical_family_id,updated_at) VALUES
      (1,1,'A','A','unipolar red',1,1,NULL,'2026-10-16'),
      (2,1,'B','B','bipolar blue',1,1,NULL,'2026-10-16'),
      (3,2,'C','C','bipolar blue beta',0,1,NULL,'2026-10-16'),
      (4,1,'D','D','auxiliary',1,2,1,'2026-10-16'),
      (5,2,'E','E','auxiliary beta',1,2,1,'2026-10-16'),
      (6,2,'F','F','other tree',1,2,2,'2026-10-16');
    INSERT INTO cat_product_attribute(product_id,attribute_id,option_id,source) VALUES
      (1,1,1,'manual'),(2,1,2,'manual'),(3,1,2,'manual'),(1,3,4,'manual'),(2,3,4,'manual'),(3,3,4,'manual');
    INSERT INTO cat_product_attribute(product_id,attribute_id,value_num,source) VALUES
      (1,2,1,'manual'),(2,2,2,'manual'),(3,2,2,'manual');
    INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable) VALUES
      (10,1,NULL,'t.root','Apparecchi','section','import',1),
      (11,1,10,'t.int','Interruttori','group','import',1),
      (111,1,11,'t.mt','Magnetotermici','group','import',1),
      (1111,1,111,'t.uni','Unipolari','group','import',1),
      (1112,1,111,'t.bi','Bipolari','group','import',1),
      (12,1,10,'t.aux','Ausiliari','group','import',1),
      (20,2,NULL,'fst.root','FST','section','metel',1),
      (21,2,20,'fst.leaf','Other','group','metel',1);
    INSERT INTO cat_range_node_metel_family(node_id,metel_family_id) VALUES(12,1),(21,2);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,active,obsolete) VALUES
      (1,1,'m.uni','Uni','device','x1','import',1,0),(2,1,'m.bi','Bi','device','x2','import',1,0);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1111,1),(1112,2);
    INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(1,1),(2,2),(3,2);`);
  return db;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const attribute = (result: CatalogueBrowseResult, code: string) => result.facets.attributes.find(entry => entry.code === code)!;
const counts = (result: CatalogueBrowseResult, code: string) =>
  Object.fromEntries(attribute(result, code).values.map(entry => [String(entry.value), entry.count]));
const definitionOf = (result: CatalogueBrowseResult) => ({
  brand: result.facets.brand?.values.map(entry => entry.value),
  configurability: result.facets.configurability?.values.map(entry => entry.value),
  attributes: result.facets.attributes.map(entry => [entry.code, entry.values.map(value => value.value)]),
});
const browse = (db: BetterSqlite3.Database, request: CatalogueBrowseRequest) => browseCatalogue(db, request);

describe("persistent hierarchical Catalogo facets", () => {
  it("refreshes cached root definitions after brand changes and never caches a rolled-back state",()=>{
    const db=fixture();
    try {
      expect(browse(db,{nodeId:10}).facets.brand?.values.map(v=>v.value)).toEqual(["ALP","BET"]);
      db.exec("UPDATE cat_brand SET active=0 WHERE id=2");
      expect(browse(db,{nodeId:111}).facets.brand).toBeNull();
      db.exec("BEGIN; UPDATE cat_brand SET active=1 WHERE id=2");
      expect(browse(db,{nodeId:111}).facets.brand?.values.map(v=>v.value)).toEqual(["ALP","BET"]);
      db.exec("ROLLBACK");
      expect(browse(db,{nodeId:111}).facets.brand).toBeNull();
      const other=new BetterSqlite3(db.name);
      try {other.exec("UPDATE cat_brand SET active=1 WHERE id=2");}finally{other.close();}
      expect(browse(db,{nodeId:111}).facets.brand?.values.map(v=>v.value)).toEqual(["ALP","BET"]);
    } finally {db.close();}
  });
  it("invalidates repeated criteria after local/external writes and rolls back transactional counts and definitions", () => {
    const db = fixture();
    try {
      const request = { nodeId: 10, listedOnly: true };
      const first = browse(db, request);
      expect(first.totalCount).toBe(4);
      // A caller cannot mutate cached summaries through a previous response.
      (first.facets.attributes[0]!.values[0]! as { count: number }).count = 999;
      expect(counts(browse(db, request), "color")).toEqual({ red: 1, blue: 1 });
      db.exec("UPDATE cat_product SET is_listed=0 WHERE id=1");
      expect(browse(db, request).totalCount).toBe(3);
      const other = new BetterSqlite3(db.name);
      try { other.exec("UPDATE cat_product SET is_listed=1 WHERE id=1"); } finally { other.close(); }
      expect(browse(db, request).totalCount).toBe(4);
      db.exec("BEGIN; UPDATE cat_product SET is_listed=0 WHERE id=1; UPDATE cat_attribute SET active=0 WHERE code='color'");
      expect(browse(db, request).totalCount).toBe(3);
      expect(browse(db, request).facets.attributes.map(a => a.code)).not.toContain("color");
      db.exec("ROLLBACK");
      expect(browse(db, request).totalCount).toBe(4);
      expect(counts(browse(db, request), "color")).toEqual({ red: 1, blue: 1 });
    } finally { db.close(); }
  });

  it("reuses facet summaries for paging, separates criteria, and evicts least-recently-used summaries", () => {
    const db = fixture();
    const prepared = vi.spyOn(db, "prepare");
    const aggregates = () => prepared.mock.calls.filter(([sql]) => sql.includes("COUNT(DISTINCT pa.product_id)")).length;
    try {
      const first = browse(db, { nodeId: 10, limit: 1 });
      expect(aggregates()).toBe(1); prepared.mockClear();
      const page = browse(db, { nodeId: 10, offset: 1, limit: 2 });
      expect(page.facets).toEqual(first.facets); expect(page.totalCount).toBe(first.totalCount);
      expect(page.products.map(p => p.manufacturerCode)).toEqual(["B", "D"]); expect(aggregates()).toBe(0);
      for (let i = 0; i < 32; i++) browse(db, { nodeId: 10, query: `absent-${i}` });
      prepared.mockClear(); browse(db, { nodeId: 10 }); expect(aggregates()).toBe(1);
      prepared.mockClear(); browse(db, { nodeId: 10, brandMarchio: ["BET"] }); expect(aggregates()).toBe(1);
      expect(counts(browse(db, { nodeId: 10, brandMarchio: ["BET"] }), "poles")).toEqual({ 1: 0, 2: 1 });
    } finally { prepared.mockRestore(); db.close(); }
  });

  it("keeps the same facet definitions and options from parent to child to leaf", () => {
    const db = fixture();
    try {
      const parent = browse(db, { nodeId: 10 });
      const expected = definitionOf(parent);
      expect(expected).toEqual({ brand: ["ALP", "BET"], configurability: [false, true],
        attributes: [["color", ["red", "blue"]], ["poles", [1, 2]]] });
      for (const nodeId of [11, 111, 1111, 1112, 12]) expect(definitionOf(browse(db, { nodeId })), `node ${nodeId}`).toEqual(expected);
    } finally { db.close(); }
  });

  it("updates counts and applicability for the current node and its descendants", () => {
    const db = fixture();
    try {
      expect(counts(browse(db, { nodeId: 10 }), "color")).toEqual({ red: 1, blue: 2 });
      expect(counts(browse(db, { nodeId: 111 }), "color")).toEqual({ red: 1, blue: 2 });
      expect(counts(browse(db, { nodeId: 1111 }), "color")).toEqual({ red: 1, blue: 0 });
      expect(counts(browse(db, { nodeId: 1112 }), "poles")).toEqual({ 1: 0, 2: 2 });
      const leaf = browse(db, { nodeId: 1111 });
      expect(leaf.totalCount).toBe(1);
      expect(leaf.facets.brand?.values.map(entry => [entry.value, entry.count])).toEqual([["ALP", 1], ["BET", 0]]);
      expect(leaf.facets.configurability?.values.map(entry => [entry.value, entry.count])).toEqual([[false, 0], [true, 1]]);
      expect(leaf.facets.attributes.map(entry => entry.applicable)).toEqual([true, true]);
      const auxiliary = browse(db, { nodeId: 12 });
      expect(auxiliary.totalCount).toBe(2);
      expect(auxiliary.facets.attributes.map(entry => [entry.code, entry.applicable])).toEqual([["color", false], ["poles", false]]);
      expect(auxiliary.facets.attributes.flatMap(entry => entry.values.map(value => value.count))).toEqual([0, 0, 0, 0]);
      expect(auxiliary.facets.configurability?.values.map(entry => [entry.value, entry.count])).toEqual([[false, 2], [true, 0]]);
    } finally { db.close(); }
  });

  it("keeps a facet that narrows to a single value, and does not offer facets that never offer a choice", () => {
    const db = fixture();
    try {
      // `single` has one value in the whole tree: never offered. `color` narrows to one value at the leaf: still offered.
      expect(browse(db, { nodeId: 10 }).facets.attributes.map(entry => entry.code)).not.toContain("single");
      const leaf = browse(db, { nodeId: 1111 });
      expect(attribute(leaf, "color").values.map(entry => [entry.value, entry.count])).toEqual([["red", 1], ["blue", 0]]);
      // A tree with one brand has no brand facet at any depth.
      expect(browse(db, { nodeId: 21 }).facets.brand).toBeNull();
      expect(browse(db, { nodeId: 20 }).facets.brand).toBeNull();
    } finally { db.close(); }
  });

  it("never invents attributes for branches without normalized technical data", () => {
    const db = fixture();
    try {
      const other = browse(db, { nodeId: 21 });
      expect(other.totalCount).toBe(1);
      expect(other.facets.attributes).toEqual([]);
      expect(other.products[0]?.attributes).toEqual([]);
      // Branches that inherit facets from the tree show them as inapplicable, never with counts.
      expect(browse(db, { nodeId: 12 }).facets.attributes.every(entry => !entry.applicable)).toBe(true);
    } finally { db.close(); }
  });

  it("keeps selected zero-count options in the facet, selected and counted as 0", () => {
    const db = fixture();
    try {
      const request = { nodeId: 1111, attributeFilters: [{ attributeCode: "color", values: ["blue"] }] };
      const result = browse(db, request);
      expect(result.totalCount).toBe(0);
      expect(result.products).toEqual([]);
      expect(attribute(result, "color").values.map(entry => [entry.value, entry.count, entry.selected]))
        .toEqual([["red", 1, false], ["blue", 0, true]]);
      // Other facets reflect the active filter: nothing matches, so every count is 0.
      expect(counts(result, "poles")).toEqual({ 1: 0, 2: 0 });
      expect(result.facets.brand?.values.map(entry => entry.count)).toEqual([0, 0]);
    } finally { db.close(); }
  });

  it("carries selections across navigation and applies them to the new branch", () => {
    const db = fixture();
    try {
      const selection = { brandMarchio: ["ALP"], configurable: [true], attributeFilters: [{ attributeCode: "poles", values: [1, 2] }] };
      const root = browse(db, { nodeId: 10, ...selection });
      expect(root.products.map(product => product.manufacturerCode)).toEqual(["A", "B"]);
      const leaf = browse(db, { nodeId: 1112, ...selection });
      expect(leaf.products.map(product => product.manufacturerCode)).toEqual(["B"]);
      expect(leaf.facets.brand?.values.filter(entry => entry.selected).map(entry => entry.value)).toEqual(["ALP"]);
      expect(leaf.facets.configurability?.values.filter(entry => entry.selected).map(entry => entry.value)).toEqual([true]);
      expect(attribute(leaf, "poles").values.filter(entry => entry.selected).map(entry => entry.value)).toEqual([1, 2]);
      expect(counts(leaf, "poles")).toEqual({ 1: 0, 2: 1 });
    } finally { db.close(); }
  });

  it("reports an active filter that the branch cannot satisfy instead of ignoring it", () => {
    const db = fixture();
    try {
      const request = { nodeId: 12, attributeFilters: [{ attributeCode: "poles", values: [2] }] };
      const result = browse(db, request);
      expect(result.totalCount).toBe(0);
      expect(result.products).toEqual([]);
      expect(result.packages).toEqual([]);
      const poles = attribute(result, "poles");
      expect(poles.applicable).toBe(false);
      expect(poles.values.map(entry => [entry.value, entry.count, entry.selected])).toEqual([[1, 0, false], [2, 0, true]]);
    } finally { db.close(); }
  });

  it("keeps a selection whose attribute the whole browsed tree does not define, and rejects only unknown codes", () => {
    const db = fixture();
    try {
      const request = { nodeId: 21, attributeFilters: [{ attributeCode: "color", values: ["red"] }] };
      const result = browse(db, request);
      expect(result.totalCount).toBe(0);
      expect(result.facets.attributes).toEqual([{ code: "color", name: "Color", dataType: "enum", unit: null,
        applicable: false, values: [{ value: "red", label: "Red", count: 0, selected: true }] }]);
      const numeric = browse(db, { nodeId: 21, attributeFilters: [{ attributeCode: "poles", values: [3] }] });
      expect(numeric.facets.attributes[0]?.values).toEqual([{ value: 3, label: null, count: 0, selected: true }]);
      const invalid = (attributeFilters: CatalogueBrowseRequest["attributeFilters"], nodeId = 10) =>
        () => browse(db, { nodeId, attributeFilters });
      expect(invalid([{ attributeCode: "nonsense", values: ["x"] }])).toThrow(InvalidCatalogueFilterError);
      expect(invalid([{ attributeCode: "color", values: ["purple"] }])).toThrow(InvalidCatalogueFilterError);
      expect(invalid([{ attributeCode: "poles", values: ["two"] }])).toThrow(InvalidCatalogueFilterError);
      expect(invalid([{ attributeCode: "color", values: [] }])).toThrow(InvalidCatalogueFilterError);
      expect(invalid([{ attributeCode: "color", values: ["red"] }, { attributeCode: "color", values: ["blue"] }]))
        .toThrow(InvalidCatalogueFilterError);
      expect(() => browse(db, { nodeId: 10, brandMarchio: ["ZZZ"] })).toThrow(InvalidCatalogueFilterError);
    } finally { db.close(); }
  });

  it("keeps brand and configurability selections visible in a tree that does not offer them", () => {
    const db = fixture();
    try {
      const result = browse(db, { nodeId: 21, brandMarchio: ["ALP"], configurable: [true] });
      expect(result.totalCount).toBe(0);
      expect(result.facets.brand?.values).toEqual([{ value: "BET", count: 0, selected: false },
        { value: "ALP", count: 0, selected: true }]);
      expect(result.facets.configurability?.values.filter(entry => entry.selected)).toEqual([{ value: true, count: 0, selected: true }]);
    } finally { db.close(); }
  });

  it("combines search and listed-only with the facets, and keeps the definition fixed", () => {
    const db = fixture();
    try {
      const searched = browse(db, { nodeId: 111, query: "bipolar" });
      expect(searched.totalCount).toBe(2);
      expect(counts(searched, "color")).toEqual({ red: 0, blue: 2 });
      const listed = browse(db, { nodeId: 111, query: "bipolar", listedOnly: true });
      expect(listed.totalCount).toBe(1);
      expect(counts(listed, "color")).toEqual({ red: 0, blue: 1 });
      expect(listed.facets.brand?.values.map(entry => [entry.value, entry.count])).toEqual([["ALP", 1], ["BET", 0]]);
      expect(definitionOf(listed)).toEqual(definitionOf(browse(db, { nodeId: 111 })));
      const none = browse(db, { nodeId: 111, query: "no such article" });
      expect(none.totalCount).toBe(0);
      expect(none.facets.attributes.map(entry => entry.code)).toEqual(["color", "poles"]);
      expect(none.facets.attributes.flatMap(entry => entry.values.map(value => value.count))).toEqual([0, 0, 0, 0]);
    } finally { db.close(); }
  });

  it("pages consistently with the active filters and repeats the same facets on every page", () => {
    const db = fixture();
    try {
      const selection = { nodeId: 10, attributeFilters: [{ attributeCode: "color", values: ["red", "blue"] }] };
      const all = browse(db, selection);
      expect(all.totalCount).toBe(3);
      const pages = [0, 1, 2].map(offset => browse(db, { ...selection, limit: 1, offset }));
      expect(pages.flatMap(page => page.products.map(product => product.manufacturerCode)))
        .toEqual(all.products.map(product => product.manufacturerCode));
      expect(pages.map(page => page.hasMore)).toEqual([true, true, false]);
      for (const page of pages) {
        expect(page.totalCount).toBe(3);
        expect(page.facets).toEqual(all.facets);
      }
    } finally { db.close(); }
  });

  it("derives the facet tree root from the navigation tree and ignores unrelated trees", () => {
    const db = fixture();
    try {
      const nodes = browseManufacturerNodes(db);
      expect(nodes.map(node => node.id).sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 21, 111, 1111, 1112]);
      // The second tree shares no definition with the first.
      expect(definitionOf(browse(db, { nodeId: 20 }))).toEqual({ brand: undefined, configurability: undefined, attributes: [] });
    } finally { db.close(); }
  });
});

const realDatabase = process.env["LIBREQUADRI_REV83_REAL_DB"];
describe.runIf(!!realDatabase && existsSync(realDatabase))("persistent facets on the populated catalogue", () => {
  it("keeps every tree's facet definitions stable down every branch and counts within the parent's", () => {
    const db = new BetterSqlite3(realDatabase!, { readonly: true });
    try {
      const nodes = browseManufacturerNodes(db);
      const apparecchi = nodes.find(node => node.code === "tq.system.3")!;
      expect(apparecchi).toBeDefined();
      const coverage = db.prepare(`${BROWSE_SCOPE_SQL} SELECT COUNT(*) AS articles,
        SUM(p.category_id IS NOT NULL) AS classified FROM cat_product p
        WHERE p.id IN (SELECT product_id FROM member)`).get({ nodeId: apparecchi.id });
      // These reviewed C–F identities must be loaded; stable empty facets alone are insufficient.
      expect(coverage).toEqual({ articles: 2273, classified: 2273 });
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model WHERE category_source='seed' AND category_id IS NOT NULL AND brand_id=(SELECT id FROM cat_brand WHERE metel_marchio='BTI')").pluck().get()).toBe(1299);
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_offer WHERE status='feasible'").pluck().get()).toBe(264);
      const byParent = new Map<number | null, typeof nodes>();
      for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
      const walk = (node: (typeof nodes)[number], parent: CatalogueBrowseResult | null, depth: number) => {
        const result = browseCatalogue(db, { nodeId: node.id, limit: 1 });
        expect(result.totalCount).toBe(node.articleCount);
        if (parent) {
          expect(definitionOf(result), node.name).toEqual(definitionOf(parent));
          for (const facet of result.facets.attributes) {
            const above = parent.facets.attributes.find(entry => entry.code === facet.code)!;
            for (const value of facet.values) {
              expect(value.count, `${node.name} ${facet.code}=${value.value}`)
                .toBeLessThanOrEqual(above.values.find(entry => entry.value === value.value)!.count);
            }
          }
        }
        if (depth < 4) for (const child of byParent.get(node.id) ?? []) walk(child, result, depth + 1);
      };
      for (const root of byParent.get(null) ?? []) {
        if (root.brandMarchio === "BTI" || root.source === "import") walk(root, null, 0);
      }
    } finally { db.close(); }
  }, 120_000);
  it("returns the advertised technical matches at every applicable Apparecchi hierarchy node", () => {
    const db = new BetterSqlite3(realDatabase!, { readonly: true });
    try {
      const nodes = browseManufacturerNodes(db);
      const root = nodes.find(node => node.code === "tq.system.3")!;
      const byParent = new Map<number | null, typeof nodes>();
      for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
      let verifiedMatches = 0;
      const walk = (node: (typeof nodes)[number]) => {
        const result = browseCatalogue(db, { nodeId: node.id, limit: 1 });
        const attribute = result.facets.attributes.find(facet => facet.applicable && facet.values.some(value => value.count > 0));
        const option = attribute?.values.find(value => value.count > 0);
        if (attribute && option) {
          const matched = browseCatalogue(db, { nodeId: node.id, limit: 1,
            attributeFilters: [{ attributeCode: attribute.code, values: [option.value] }] });
          expect(matched.totalCount + matched.packageCount, `${node.name}: ${attribute.code}=${option.value}`).toBe(option.count);
          expect(matched.products.length + matched.packages.length).toBeGreaterThan(0);
          verifiedMatches++;
        }
        for (const child of byParent.get(node.id) ?? []) walk(child);
      };
      walk(root);
      expect(verifiedMatches).toBeGreaterThan(300);
    } finally { db.close(); }
  }, 120_000);

});
