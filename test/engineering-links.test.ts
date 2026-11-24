import { afterEach, beforeEach, expect, it } from "vitest";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";
import { refreshEngineeringLinks, synchronizeEngineeringLinkPolicy } from "../src/main/sources/engineering-links.js";

let fixture: CatalogueFixture;
beforeEach(() => {
  fixture = createCatalogueFixture();
  fixture.importDelivery({ issuer: "AAA", listino: "1", validFrom: "2026-01-01", products: [
    { marchio: "AAA", code: "SHARED" }, { marchio: "BBB", code: "SHARED" },
    { marchio: "AAA", code: "UNIQUE" }, { marchio: "AAA-", code: "EXACT" },
  ] });
  fixture.lq.exec(`
    INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES(1,'listino_bt','1','Fixture','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-01-01',1,'{}');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,source_import_id)
      VALUES(1,(SELECT id FROM cat_brand WHERE metel_marchio='AAA'),'import','Import','device','fixture','import',1),
            (2,(SELECT id FROM cat_brand WHERE metel_marchio='AAA'),'manual','Manual','device','fixture','manual',NULL);
    INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,1,1),(2,2,1);
  `);
});
afterEach(() => fixture.close());
const product = (brand: string, code: string) => fixture.lq.prepare(`SELECT p.id FROM cat_product p
  JOIN cat_brand b ON b.id=p.brand_id WHERE b.metel_marchio=? AND p.code_norm=?`).pluck().get(brand, code) as number;
const refresh = () => fixture.lq.transaction(() => refreshEngineeringLinks(fixture.lq))();

it("preserves exact identity, unique-code fallback, ambiguity, unresolved brands and duplicate references", () => {
  const cases: Array<[string, string, number | null]> = [
    ["BBB", "sh-a.red", product("BBB", "SHARED")],
    ["OTHER", "u-ni.que", product("AAA", "UNIQUE")],
    ["OTHER", "SHARED", null], ["OTHER-", "UNIQUE", null],
    ["AAA-", "ex-act", product("AAA-", "EXACT")], ["AAA", "MISSING", null],
    ["BBB", "sh-a.red", product("BBB", "SHARED")],
  ];
  const db = fixture.lq;
  const base = db.prepare(`INSERT INTO cat_config_model_article
    (model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role) VALUES(?,?,?,?,?,1,'primary')`);
  const effect = db.prepare(`INSERT INTO cat_config_rule_effect
    (rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
    VALUES(?,?,'article',?,?,?,1,'primary')`);
  for (const owner of [1, 2]) for (const [seq, [brand, code]] of cases.entries()) {
    // Different stale values for the same identity must all be refreshed.
    base.run(owner, seq, owner === 1 ? product("AAA", "SHARED") : null, brand, code);
    effect.run(owner, seq, null, brand, code);
  }
  db.exec(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value)
    VALUES(1,100,'profile_key_delta',2)`);
  db.prepare(`INSERT INTO cat_config_model_entry(product_id,model_id,option_id) VALUES(?,2,NULL)`)
    .run(product("AAA", "SHARED"));
  refresh();
  for (const table of ["cat_config_model_article", "cat_config_rule_effect"]) {
    const owner = table === "cat_config_model_article" ? "model_id" : "rule_id";
    expect(db.prepare(`SELECT product_id FROM ${table} WHERE seq<100 ORDER BY ${owner},seq`).pluck().all())
      .toEqual([1, 2].flatMap(() => cases.map(([, , id]) => id)));
  }
  expect(db.prepare("SELECT int_value FROM cat_config_rule_effect WHERE seq=100").pluck().get()).toBe(2);
  expect(db.prepare("SELECT product_id FROM cat_config_model_entry WHERE model_id=1 ORDER BY product_id").pluck().all())
    .toEqual([...new Set(cases.map(([, , id]) => id).filter(id => id !== null))].sort((a, b) => a! - b!));
  expect(db.prepare("SELECT product_id FROM cat_config_model_entry WHERE model_id=2").pluck().all())
    .toEqual([product("AAA", "SHARED")]);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  // Repeated refreshes must not rewrite already correct article links.
  db.exec(`CREATE TRIGGER reject_base_rewrite BEFORE UPDATE ON cat_config_model_article
    BEGIN SELECT RAISE(ABORT,'unnecessary base update'); END;
    CREATE TRIGGER reject_effect_rewrite BEFORE UPDATE ON cat_config_rule_effect
    BEGIN SELECT RAISE(ABORT,'unnecessary effect update'); END;`);
  expect(refresh).not.toThrow();
});

it("keeps the caller's transaction atomic when a link update fails", () => {
  const db = fixture.lq;
  db.exec(`INSERT INTO cat_config_model_article
    (model_id,seq,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(1,1,'AAA','UNIQUE',1,'primary');
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
    VALUES(1,1,'article','AAA','UNIQUE',1,'primary');
    CREATE TRIGGER fail_effect BEFORE UPDATE ON cat_config_rule_effect
    BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
  expect(refresh).toThrow("injected failure");
  expect(db.prepare("SELECT product_id FROM cat_config_model_article").pluck().get()).toBeNull();
  expect(db.prepare("SELECT product_id FROM cat_config_rule_effect").pluck().get()).toBeNull();
});

it("keeps punctuation in BTicino identities and refuses ambiguous or cross-brand substitutes", () => {
  fixture.importDelivery({ issuer: "BTI", listino: "1", validFrom: "2026-01-01", products: [
    { marchio: "BTI", code: "T1/6" }, { marchio: "BTI", code: "C9250F6" },
    { marchio: "BTI", code: "A/B" }, { marchio: "BTI", code: "AB" },
    { marchio: "BTI", code: "P/Q" }, { marchio: "BTI", code: "p/q" },
    { marchio: "LEG", code: "028500" },
  ] });
  const exact = fixture.lq.prepare("SELECT id FROM cat_product WHERE manufacturer_code='A/B'").pluck().get();
  const db = fixture.lq;
  const base = db.prepare(`INSERT INTO cat_config_model_article
    (model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(1,?,?,'BTI',?,1,'primary')`);
  for (const [seq, [reference, wrongId]] of [
    ["T/16", product("BTI", "T16")], ["C9250F/6", product("BTI", "C9250F6")],
    [" a/b ", null], ["P/Q", product("BTI", "PQ")], ["028500", product("LEG", "028500")],
  ].entries()) base.run(seq, wrongId, reference);

  refresh();

  expect(db.prepare("SELECT product_id FROM cat_config_model_article ORDER BY seq").pluck().all())
    .toEqual([null, null, exact, null, null]);
  expect(db.prepare("SELECT product_id FROM cat_config_model_entry WHERE model_id=1").pluck().all())
    .toEqual([exact]);

  db.exec(`INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,source_import_id)
    VALUES(3,(SELECT id FROM cat_brand WHERE metel_marchio='BTI'),'tq.pack.12803','DMX3','device','fixture','import',1);
    INSERT INTO cat_config_model_article(model_id,seq,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(3,0,'BTI','028500',1,'primary')`);
  refresh();
  expect(db.prepare("SELECT product_id FROM cat_config_model_article WHERE model_id=3").pluck().get())
    .toBe(product("LEG", "028500"));
  expect(db.prepare("SELECT product_id FROM cat_config_model_article WHERE model_id=1 AND seq=4").pluck().get())
    .toBeNull();
});

it("upgrades stored Legrand links without using a matching Cablofil code as a fallback", () => {
  const db = fixture.lq;
  const delivery = (listino: string, leg: string[]) => fixture.importDelivery({
    issuer: "AAA", listino, validFrom: `2026-02-0${listino}`,
    products: [{ marchio: "CAB", code: "646010" }, { marchio: "CAB", code: "646020" },
      { marchio: "CAB", code: "646200" }, ...leg.map(code => ({ marchio: "LEG", code }))],
  });
  delivery("2", ["646010", "646-020"]);
  db.prepare(`INSERT INTO cat_config_model_article
    (model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(1,1,?,'LEG','646200',1,'primary'),(1,2,?,'CAB','646200',1,'primary'),
    (1,3,?,'LEG','646010',1,'primary'),(1,4,?,'LEG','646020',1,'primary')`)
    .run(product("CAB", "646200"), product("CAB", "646200"), product("CAB", "646010"), product("CAB", "646020"));
  db.prepare(`INSERT INTO cat_config_rule_effect
    (rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
    VALUES(1,1,'article',?,'LEG','646200',1,'primary')`).run(product("CAB", "646200"));
  db.prepare("UPDATE app_setting SET value='bticino-exact-2' WHERE key='catalogue.engineering_link_policy'").run();
  db.transaction(() => synchronizeEngineeringLinkPolicy(db))();
  const links = () => db.prepare("SELECT product_id FROM cat_config_model_article ORDER BY seq").pluck().all();
  expect(links()).toEqual([null, product("CAB", "646200"), product("LEG", "646010"), null]);
  expect(db.prepare("SELECT product_id FROM cat_config_rule_effect").pluck().get()).toBeNull();
  delivery("3", ["646010", "646020", "646200"]);
  const exactLeg020 = db.prepare(`SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
    WHERE b.metel_marchio='LEG' AND p.manufacturer_code='646020'`).pluck().get();
  expect(links()).toEqual([product("LEG", "646200"), product("CAB", "646200"), product("LEG", "646010"), exactLeg020]);
  expect(db.prepare("SELECT product_id FROM cat_config_rule_effect").pluck().get()).toBe(product("LEG", "646200"));
  // Inject a case-insensitive exact duplicate to exercise ambiguity without relying on METEL ingestion.
  db.exec(`DROP INDEX cat_product_brand_code_unique;
    INSERT INTO cat_product(brand_id,manufacturer_code,code_norm,short_description,updated_at)
    SELECT brand_id,manufacturer_code,code_norm,short_description,updated_at FROM cat_product
    WHERE id=${product("LEG", "646200")}`);
  refresh();
  expect(links()[0]).toBeNull();
  expect(links()[1]).toBe(product("CAB", "646200"));
});
