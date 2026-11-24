import type Database from "better-sqlite3";
import { EXACT_LEGRAND_ARTICLES } from "../../shared/reviewed-article-links.js";

export const ENGINEERING_LINK_POLICY_VERSION = "reviewed-exact-4";
const POLICY_KEY = "catalogue.engineering_link_policy";

// TiQuadri v32 uses BT- on these model choices. ListinoBT ANA_ART confirms the
// exact LEG codes, and their device descriptions agree with the model and rating.
const VERIFIED_LEGRAND_CODES = new Map<string, ReadonlySet<string>>([
  ["tq.pack.12800", new Set(["028517", "028518"])],
  ["tq.pack.12801", new Set(["028510", "028511", "028512", "028513", "028514", "028515", "028516"])],
  ["tq.pack.12802", new Set(["028507", "028508"])],
  ["tq.pack.12803", new Set(["028500", "028501", "028502", "028503", "028504", "028505", "028506"])],
  ["tq.pack.5873", new Set(["414244", "414246"])],
  ["tq.pack.5874", new Set(["414281", "414282", "414283"])],
  ["tq.pack.5875", new Set(["414446", "414447", "414448", "414449", "414450", "414451"])],
]);

/** Upgrade the links before rebuilding the dependent catalogue data at startup. */
export function synchronizeEngineeringLinkPolicy(database: Database.Database): void {
  const installed = database.prepare("SELECT value FROM app_setting WHERE key=?").pluck().get(POLICY_KEY);
  if (installed !== ENGINEERING_LINK_POLICY_VERSION) refreshEngineeringLinks(database);
}

/** Resolve stored article identities after either a source import or a METEL delivery. */
export function refreshEngineeringLinks(database: Database.Database): void {
  const products = database.prepare(`SELECT p.id, b.metel_marchio AS marchio,
    p.code_norm AS code, p.manufacturer_code AS manufacturerCode
    FROM cat_product p JOIN cat_brand b ON b.id = p.brand_id WHERE p.import_removed=0`).all() as
    Array<{ id: number; marchio: string; code: string; manufacturerCode: string }>;
  const byIdentity = new Map(products.map(p => [`${p.marchio}\0${p.code}`, p.id]));
  const byCode = new Map<string, number | null>();
  const byExactIdentity = new Map<string, number | null>();
  const exactCode = (code: string) => code.trim().toUpperCase();
  for (const product of products) {
    byCode.set(product.code,byCode.has(product.code) ? null : product.id);
    if (product.marchio === "BTI" || product.marchio === "LEG" || product.marchio === "SIE") {
      const key = `${product.marchio}\0${exactCode(product.manufacturerCode)}`;
      byExactIdentity.set(key, byExactIdentity.has(key) ? null : product.id);
    }
  }
  const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = database.prepare(`SELECT a.model_id AS owner, a.seq, a.product_id AS productId, a.ref_brand_marchio AS marchio,
    a.ref_manufacturer_code AS code, CASE WHEN m.source='import' THEN m.code END AS importedModel
    FROM cat_config_model_article a JOIN cat_config_model m ON m.id=a.model_id`)
    .all() as Array<{ owner: number; seq: number; productId: number | null; marchio: string; code: string; importedModel: string | null }>;
  const effects = database.prepare(`SELECT e.rule_id AS owner, e.seq, e.product_id AS productId, e.ref_brand_marchio AS marchio,
    e.ref_manufacturer_code AS code, CASE WHEN m.source='import' THEN m.code END AS importedModel
    FROM cat_config_rule_effect e JOIN cat_config_rule r ON r.id=e.rule_id
    JOIN cat_config_model m ON m.id=r.model_id WHERE e.effect_kind='article'`)
    .all() as typeof base;
  const updateBase = database.prepare(`UPDATE cat_config_model_article SET product_id=?
    WHERE model_id=? AND seq=?`);
  const updateEffect = database.prepare(`UPDATE cat_config_rule_effect SET product_id=?
    WHERE rule_id=? AND seq=?`);
  // Resolve each identity once, then use the existing primary keys instead of
  // scanning both reference tables for every distinct manufacturer article.
  const resolved = new Map<string, number | null>();
  for (const [rows, update] of [[base, updateBase], [effects, updateEffect]] as const) {
    for (const { owner, seq, productId: previousId, marchio, code, importedModel } of rows) {
      const exact = exactCode(code);
      const verifiedAlias = marchio === "BTI" && importedModel !== null &&
        VERIFIED_LEGRAND_CODES.get(importedModel)?.has(exact) === true;
      const key = `${marchio}\0${code}\0${verifiedAlias}`;
      let productId = resolved.get(key);
      if (productId === undefined) {
        if (marchio === "BTI") {
          // Punctuation distinguishes real BTicino products (for example T/16 and T1/6).
          const exactMatch = byExactIdentity.get(`BTI\0${exact}`);
          productId = (exactMatch === undefined && verifiedAlias
            ? byExactIdentity.get(`LEG\0${exact}`) : exactMatch) ?? null;
        } else if (marchio === "SIE") {
          // Siemens punctuation and brand are part of the identity; never borrow another brand.
          productId = byExactIdentity.get(`SIE\0${exact}`) ?? null;
        } else if (marchio === "LEG" && EXACT_LEGRAND_ARTICLES.has(normalize(code))) {
          productId = byExactIdentity.get(`LEG\0${exact}`) ?? null;
        } else {
          const normalized = normalize(code);
          productId = byIdentity.get(`${marchio}\0${normalized}`)
            ?? (marchio.endsWith("-") ? null : byCode.get(normalized) ?? null);
        }
        resolved.set(key, productId);
      }
      if (previousId !== productId) update.run(productId, owner, seq);
    }
  }

  database.prepare(`DELETE FROM cat_config_model_entry WHERE model_id IN
    (SELECT id FROM cat_config_model WHERE source='import')`).run();
  database.prepare(`INSERT OR IGNORE INTO cat_config_model_entry(product_id,model_id,option_id)
    SELECT a.product_id,a.model_id,NULL FROM cat_config_model_article a
    JOIN cat_config_model m ON m.id=a.model_id
    WHERE m.source='import' AND a.role='primary' AND a.product_id IS NOT NULL`).run();
  database.prepare(`INSERT OR IGNORE INTO cat_config_model_entry(product_id,model_id,option_id)
    SELECT e.product_id,r.model_id,MIN(CASE WHEN o.parent_option_id IS NULL THEN o.id ELSE NULL END)
    FROM cat_config_rule_effect e JOIN cat_config_rule r ON r.id=e.rule_id
    JOIN cat_config_model m ON m.id=r.model_id
    JOIN cat_config_rule_condition c ON c.rule_id=r.id
    JOIN cat_config_option o ON o.id=c.option_id
    WHERE m.source='import' AND e.effect_kind='article' AND e.article_role='primary'
      AND e.product_id IS NOT NULL
    GROUP BY e.product_id,r.model_id`).run();
  database.prepare(`INSERT INTO app_setting(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value`)
    .run(POLICY_KEY, ENGINEERING_LINK_POLICY_VERSION);
}
