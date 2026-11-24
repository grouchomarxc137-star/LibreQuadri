import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifySiemensArticle, loadSiemensNavigationSeed, synchronizeSiemensNavigation,
  validateSiemensNavigationSeed, type SiemensNavigationArticle } from "../src/main/catalogue/siemens-navigation.js";
import { siemensNavigationReport } from "../src/main/catalogue/siemens-navigation-report.js";
import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { browseManufacturerNodes, listManufacturerArticles, manufacturerPositions } from "../src/main/catalogue/manufacturer-navigation.js";
import { BrandManagement } from "../src/main/metel/brand-management.js";
import { normalizeMetelDelivery } from "../src/main/metel/catalogue-normalization.js";
import { createCatalogueFixture, type CatalogueFixture, type FixtureProduct } from "./helpers/catalogue-fixtures.js";

let fixture: CatalogueFixture | undefined;
const folders: string[] = [];
afterEach(() => { fixture?.close(); fixture = undefined; for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const product = (code: string, description: string, statisticalFamily = "P310 I22Y"): FixtureProduct =>
  ({ marchio: "SIE", code, description, statisticalFamily, priceCents: 12345 });
const products = [
  product("5SY62167", "INT MT 2P C16 ICN 6KA ICU 30KA"),
  product("5SY62106", "INT MT 2P B10 ICN 6KA ICU 30KA"),
  product("5SYACCESSORY", "CALOTTA PER INT MT 2P C16 400V 10KA"),
  product("3NA3001", "FUS. NH GL/GG GR.0 500VCA 6A", "P310 I213"),
  product("3NX1015", "MANIGLIA PER FUS. NH GR.00 - 3", "P310 I212"),
  product("3NW1006", "FUS. 10X38 CC 600VCA", "P310 I21B"),
  product("3NW7013", "PORTAFUSIBILI 10X38 1P 32A", "P310 I21B"),
  product("5SM33150KK", "DIFF. 2P 125A 30MA TIPO AC 2UM", "P310 I216"),
  product("5SM23220", "BLOCCO DIFF. 2P 40A 30MA TIPO AC X 5SY", "P310 I22M"),
  product("5TT4930", "CONTATTO AUX,1NA+1NC X 5TT44", "P310 I217"),
  product("5SK91011", "MORSETTO INT CBE 1P+CA 1A", "P310 I217"),
  product("3NW75318HG", "PORTAFUS.CLASS J, 3P 400A 600V, M.SPORG.", "P310 I21B"),
  product("3NW70132", "BASE SEZ.X FUS. CILINDR.10X38 1P 32A 1UM", "P310 I21B"),
  product("6ES7211", "CPU 1211C, DC/DC/DC, 6DI/4DO/2AI", "R132 IC12"),
  { marchio: "SIE", code: "NOFAMILY", description: "INT MT 2P C16" },
];
function deliver(list: FixtureProduct[] = products, date = "2026-01-01") {
  fixture ??= createCatalogueFixture();
  return fixture.importDelivery({ issuer: "SIE", listino: date, validFrom: date, products: list });
}
const node = (suffix: string) => fixture!.lq.prepare("SELECT id FROM cat_range_node WHERE code=?").pluck().get(`classified.sie.${suffix}`) as number;
const assignments = () => fixture!.lq.prepare(`SELECT p.manufacturer_code AS code,n.code AS node,np.rule_code AS rule,
  np.unresolved_reason AS reason FROM cat_range_node_product np JOIN cat_product p ON p.id=np.product_id
  JOIN cat_range_node n ON n.id=np.node_id ORDER BY p.id`).all() as Array<{ code: string; node: string; rule: string; reason: string | null }>;

describe("Siemens functional article navigation", () => {
  it("splits mixed families by each article, separating fuse links, holders, accessories and differential blocks", () => {
    deliver();
    const byCode = Object.fromEntries(assignments().map(a => [a.code, a]));
    expect(byCode["5SY62167"]).toMatchObject({ node: "classified.sie.dispositivi_modulari.magnetotermici", rule: "modular.mt", reason: null });
    expect(byCode["5SYACCESSORY"]).toMatchObject({ node: "classified.sie.dispositivi_modulari.accessori", rule: "modular.accessory" });
    expect(byCode["3NA3001"]!.node).toBe("classified.sie.fusibili.nh");
    expect(byCode["3NX1015"]!.reason).toBe("accessory_without_applicable_type");
    expect(byCode["3NW1006"]!.node).toBe("classified.sie.fusibili.10x38");
    expect(byCode["3NW7013"]!.node).toBe("classified.sie.dispositivi_modulari.portafusibili");
    expect(byCode["5SM33150KK"]!.node).toBe("classified.sie.dispositivi_modulari.differenziali_puri");
    expect(byCode["5SM23220"]!.reason).toBe("insufficient_article_evidence");
    expect(byCode["5TT4930"]!.rule).toBe("modular.accessory");
    expect(byCode["5SK91011"]!.reason).toBe("accessory_without_applicable_type");
    expect(byCode["3NW75318HG"]!.reason).toBe("insufficient_article_evidence");
    expect(byCode["3NW70132"]!.node).toBe("classified.sie.dispositivi_modulari.portafusibili");
    expect(byCode["6ES7211"]!.reason).toBe("no_applicable_reviewed_type");
    expect(byCode["NOFAMILY"]).toMatchObject({ node: "classified.sie.unclassified.family.none", reason: "missing_statistical_family" });
    const report = siemensNavigationReport(fixture!.lq);
    expect(report.products).toBe(products.length);
    expect(report.assigned + report.unclassified).toBe(report.products); expect(report.missing).toBe(0);
    // Navigation and missing technical values are independent: classified accessories can lack
    // ratings, while an unclassified PLC can have valid I/O counts.
    const attributes = (code: string) => fixture!.lq.prepare(`SELECT a.code FROM cat_product_attribute pa
      JOIN cat_attribute a ON a.id=pa.attribute_id JOIN cat_product p ON p.id=pa.product_id
      WHERE p.manufacturer_code=?`).pluck().all(code);
    expect(attributes("5SYACCESSORY")).toEqual(["article_kind"]);
    expect(attributes("6ES7211").length).toBeGreaterThan(1);
    expect(fixture!.lq.prepare("SELECT COUNT(DISTINCT product_id) FROM cat_range_node_product").pluck().get()).toBe(products.length);
    expect(fixture!.lq.prepare("SELECT COUNT(*) FROM cat_config_model").pluck().get()).toBe(0);
  });

  it("counts and browses every ancestor, combining filters, text, pages and stable article/price identities", () => {
    deliver(); const db = fixture!.lq;
    const filters = [{ attributeCode: "trip_curve", values: ["c"] }, { attributeCode: "rated_current", values: [16] }];
    for (const suffix of ["root", "dispositivi_modulari", "dispositivi_modulari.magnetotermici"]) {
      const result = browseCatalogue(db, { nodeId: node(suffix), query: "5SY", attributeFilters: filters });
      expect(result.totalCount).toBe(1); expect(result.products[0]?.manufacturerCode).toBe("5SY62167");
      expect(result.facets.attributes.find(a => a.code === "rated_current")?.values.find(v => v.value === 16)).toMatchObject({ count: 1, selected: true });
      const total = browseCatalogue(db, { nodeId: node(suffix) }).totalCount;
      expect(browseManufacturerNodes(db).find(n => n.id === node(suffix))?.articleCount).toBe(total);
      expect(listManufacturerArticles(db, { nodeId: node(suffix) })).toHaveLength(total);
    }
    const leaf = node("dispositivi_modulari.magnetotermici");
    const page = browseCatalogue(db, { nodeId: leaf, limit: 1 });
    const next = browseCatalogue(db, { nodeId: leaf, limit: 1, offset: 1 });
    expect(page.hasMore).toBe(true); expect(next.hasMore).toBe(false);
    expect(next.products[0]!.id).not.toBe(page.products[0]!.id);
    const positions = manufacturerPositions(db, page.products[0]!.id);
    expect(positions).toHaveLength(2); expect(positions.some(p => p.nodeId === leaf)).toBe(true);
    const fst = positions.find(p => p.nodeId !== leaf)!;
    const original = browseCatalogue(db, { nodeId: fst.nodeId, query: page.products[0]!.manufacturerCode }).products[0];
    expect(original).toEqual(page.products[0]);
    expect(browseManufacturerNodes(db).some(n => n.code === "classified.sie.automazione")).toBe(false);
    expect(browseManufacturerNodes(db).filter(n => n.parentId === node("root")).at(-1)?.name).toBe("Non classificati");
  });

  it("withholds conflicting and referenced types, foreign/unreviewed family context and incomplete evidence", () => {
    const article: SiemensNavigationArticle = { id: 1, manufacturerCode: "5SY62167", description: "INT MT 2P C16",
      familyId: 1, familyCode: "P310 I22Y", familyName: "INT. AUT.", familyIssuer: "SIE", familyBrand: "SIE" };
    expect(classifySiemensArticle({ ...article, description: "UNKNOWN PER INT MT 2P" }).reason).toBe("insufficient_article_evidence");
    expect(classifySiemensArticle({ ...article, familyIssuer: "BTI" }).reason).toBe("foreign_family_context");
    expect(classifySiemensArticle({ ...article, familyBrand: "BTI" }).reason).toBe("foreign_family_context");
    expect(classifySiemensArticle({ ...article, familyCode: "NEW" }).reason).toBe("unreviewed_statistical_family");
    expect(classifySiemensArticle({ ...article, description: null }).reason).toBe("missing_description");
    expect(classifySiemensArticle({ ...article, description: "FUS. NH 10X38", familyCode: "P310 I213" })).toMatchObject({ destination: null, reason: "conflicting_rules" });
    const seed = loadSiemensNavigationSeed(); const conflicting = structuredClone(seed.rules[0]!);
    conflicting.code = "conflict"; seed.rules.push(conflicting);
    for (const f of seed.familyReview) if (conflicting.families.includes(f.code)) f.rules.push("conflict");
    expect(classifySiemensArticle(article, seed)).toMatchObject({ destination: null, reason: "conflicting_rules" });
    seed.nodes[0]!.parent = "does_not_exist";
    expect(() => validateSiemensNavigationSeed(seed)).toThrow("Invalid Siemens node");
  });

  it("reconciles changed articles and seed fingerprints, keeps delisted identities, purges removed memberships and repeats without writes", () => {
    deliver(); const db = fixture!.lq;
    const changes = db.prepare("SELECT total_changes()").pluck().get();
    expect(synchronizeSiemensNavigation(db)).toMatchObject({ changed: 0, removed: 0, products: products.length });
    expect(db.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
    const id = browseCatalogue(db, { nodeId: node("dispositivi_modulari.magnetotermici"), query: "5SY62167" }).products[0]!.id;
    deliver(products.map(p => p.code === "5SY62167" ? { ...p, description: "CALOTTA PER INT MT 2P" } : p), "2026-02-01");
    expect(assignments().find(a => a.code === "5SY62167")?.rule).toBe("modular.accessory");
    db.prepare("UPDATE cat_product SET is_listed=0 WHERE id=?").run(id);
    expect(synchronizeSiemensNavigation(db).products).toBe(products.length);
    db.prepare("UPDATE cat_product SET import_removed=1 WHERE id=?").run(id);
    expect(synchronizeSiemensNavigation(db)).toMatchObject({ removed: 1, products: products.length - 1 });
    db.prepare("UPDATE cat_product SET import_removed=0 WHERE id=?").run(id);
    expect(synchronizeSiemensNavigation(db).changed).toBe(1);
    const seed = loadSiemensNavigationSeed(); seed.version = "test-v2";
    expect(synchronizeSiemensNavigation(db, seed).changed).toBe(products.length);
    expect(db.prepare("SELECT DISTINCT rule_version FROM cat_range_node_product").pluck().all()).toEqual(["test-v2"]);
    expect(db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='5SY62167'").pluck().get()).toBe(id);
    const retired = node("dispositivi_modulari.magnetotermici");
    seed.rules = seed.rules.filter(r => r.code !== "modular.mt");
    seed.nodes = seed.nodes.filter(n => n.code !== "dispositivi_modulari.magnetotermici");
    for (const family of seed.familyReview) family.rules = family.rules.filter(r => r !== "modular.mt");
    synchronizeSiemensNavigation(db, seed);
    expect(assignments().find(a => a.code === "5SY62106")?.reason).toBe("insufficient_article_evidence");
    expect(db.prepare("SELECT COUNT(*) FROM cat_range_node_product WHERE node_id=?").pluck().get(retired)).toBe(0);
    expect(db.prepare("SELECT active FROM cat_range_node WHERE id=?").pluck().get(retired)).toBe(0);
  });

  it("removes/restores the METEL brand atomically with stable product and navigation IDs", () => {
    deliver(); const db = fixture!.lq;
    const backup = mkdtempSync(path.join(tmpdir(), "librequadri-siemens-removal-")); folders.push(backup);
    const manager = new BrandManagement(db, backup, () => {});
    const brand = manager.list().find(b => b.code === "SIE")!;
    const before = assignments(), root = node("root");
    manager.setActive(brand.id, false); expect(browseManufacturerNodes(db)).toEqual([]);
    expect(assignments()).toEqual([]); expect(synchronizeSiemensNavigation(db).removed).toBe(0);
    manager.setActive(brand.id, true); expect(assignments()).toEqual(before);
    const preview = manager.previewRemoval(brand.id); expect(preview.blockers).toEqual([]);
    manager.remove(preview.token); expect(assignments()).toEqual([]); expect(browseManufacturerNodes(db)).toEqual([]);
    const LSP = fixture!.raw.prepare("SELECT file_sha256 FROM raw_file WHERE file_type='LSP'").pluck().get() as string;
    normalizeMetelDelivery({ lqDatabase: db, rawDatabase: fixture!.raw, sources: { LSP } });
    expect(assignments()).toEqual(before); expect(node("root")).toBe(root);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls back normalization and partial assignments when navigation synchronization fails", () => {
    deliver(); const db = fixture!.lq;
    const snapshot = () => ["cat_product", "cat_product_attribute", "cat_range_node_product", "cat_range_node", "app_import_delivery", "app_setting"]
      .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    db.exec("CREATE TRIGGER fail_navigation BEFORE UPDATE ON cat_range_node_product BEGIN SELECT RAISE(ABORT,'forced navigation failure'); END");
    expect(() => deliver(products.map(p => ({ ...p, description: "CHANGED" })), "2026-03-01")).toThrow("forced navigation failure");
    expect(snapshot()).toEqual(before);
    db.exec("DROP TRIGGER fail_navigation");
    const seed = loadSiemensNavigationSeed(); seed.nodes.push({ code: "new", name: "New", parent: null, sortOrder: 11 });
    seed.version = "rollback";
    db.exec("CREATE TRIGGER fail_navigation BEFORE UPDATE ON cat_range_node_product BEGIN SELECT RAISE(ABORT,'forced navigation failure'); END");
    expect(() => synchronizeSiemensNavigation(db, seed)).toThrow("forced navigation failure");
    expect(snapshot()).toEqual(before);
  });
});
