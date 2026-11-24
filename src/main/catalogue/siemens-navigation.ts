import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export const SIEMENS_CLASSIFICATION = "classified.sie";
const ENGINE_VERSION = 1;
type NavigationNode = { code: string; name: string; parent: string | null; sortOrder: number };
type NavigationRule = { code: string; node: string; families: string[]; descriptionPattern: string;
  codePattern?: string; excludePattern?: string; articleKind?: "accessory" | "fuse_holder"; currentRange?: [number, number] };
export type SiemensNavigationSeed = { version: string; reviewedDelivery: string; accessoryPattern: string;
  nodes: NavigationNode[]; rules: NavigationRule[];
  familyReview: Array<{ code: string; description: string; profile: string; rules: string[]; decision: string; note: string }> };
export type SiemensNavigationArticle = { id: number; manufacturerCode: string; description: string | null;
  familyId: number | null; familyCode: string | null; familyName: string | null;
  familyIssuer: string | null; familyBrand: string | null };
export type NavigationAssignment = { destination: string | null; rule: string; reason: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validateSiemensNavigationSeed(seed: SiemensNavigationSeed): void {
  if (!seed?.version || !Array.isArray(seed.nodes) || !Array.isArray(seed.rules) || !Array.isArray(seed.familyReview))
    throw new Error("Invalid Siemens navigation seed");
  new RegExp(seed.accessoryPattern);
  const nodes = new Map<string, NavigationNode>();
  for (const node of seed.nodes) {
    if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(node.code) || nodes.has(node.code)
      || node.code === "root" || node.code.startsWith("unclassified")
      || !node.name?.trim() || !Number.isSafeInteger(node.sortOrder)
      || (node.parent !== null && !nodes.has(node.parent))) throw new Error(`Invalid Siemens node ${node.code}`);
    nodes.set(node.code, node);
  }
  const families = new Map(seed.familyReview.map(f => [f.code, f]));
  if (families.size !== seed.familyReview.length) throw new Error("Duplicate Siemens family review");
  const codes = new Set<string>();
  for (const rule of seed.rules) {
    if (!rule.code || codes.has(rule.code) || !nodes.has(rule.node)
      || seed.nodes.some(node => node.parent === rule.node) || !rule.families.length
      || rule.families.some(code => !families.has(code) || !families.get(code)!.rules.includes(rule.code))
      || !rule.descriptionPattern.startsWith("^")
      || (rule.articleKind !== undefined && !["accessory", "fuse_holder"].includes(rule.articleKind))
      || (rule.currentRange && !(rule.currentRange[0] > 0 && rule.currentRange[1] >= rule.currentRange[0])))
      throw new Error(`Invalid Siemens rule ${rule.code}`);
    codes.add(rule.code);
    for (const pattern of [rule.descriptionPattern, rule.codePattern, rule.excludePattern]) if (pattern) new RegExp(pattern);
  }
  for (const family of seed.familyReview) if (family.rules.some(code => !codes.has(code)
    || !seed.rules.find(rule => rule.code === code)!.families.includes(family.code)))
    throw new Error(`Invalid Siemens family review ${family.code}`);
}

export function loadSiemensNavigationSeed(folder = path.resolve("db", "seed")): SiemensNavigationSeed {
  const seed = JSON.parse(readFileSync(path.join(folder, "siemens-navigation.json"), "utf8")) as SiemensNavigationSeed;
  validateSiemensNavigationSeed(seed);
  return seed;
}

function classifier(seed: SiemensNavigationSeed) {
  const accessory = new RegExp(seed.accessoryPattern);
  const rules = seed.rules.map(rule => ({ ...rule, description: new RegExp(rule.descriptionPattern),
    codeMatch: rule.codePattern ? new RegExp(rule.codePattern) : null,
    exclude: rule.excludePattern ? new RegExp(rule.excludePattern) : null }));
  const reviewed = new Map(seed.familyReview.map(f => [f.code, f]));
  return (article: SiemensNavigationArticle): NavigationAssignment => {
    const unresolved = (reason: string, rule = "fallback") => ({ destination: null, rule, reason });
    if (article.familyId === null || article.familyCode === null) return unresolved("missing_statistical_family");
    if (article.familyIssuer !== "SIE" || article.familyBrand !== "SIE") return unresolved("foreign_family_context");
    const family = reviewed.get(article.familyCode);
    if (!family) return unresolved("unreviewed_statistical_family");
    if (!family.rules.length) return unresolved("no_applicable_reviewed_type");
    const description = (article.description ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!description) return unresolved("missing_description");
    // References describe a different object; ratings and types after them never identify this article.
    const own = description.split(/\s+(?:PER|FOR|FUER|FÜR|X)\s+/)[0]!;
    const isAccessory = accessory.test(own);
    const matches = rules.filter(rule => rule.families.includes(article.familyCode!)
      && (rule.articleKind === "accessory" ? isAccessory : rule.articleKind === "fuse_holder"
        ? /^(?:PORTAFUS|BASE (?:SEZ|PORTAFUS))/.test(own) : !isAccessory)
      && rule.description.test(own) && (!rule.codeMatch || rule.codeMatch.test(article.manufacturerCode.toUpperCase()))
      && !rule.exclude?.test(own) && (!rule.currentRange || (() => {
        const currents = [...own.matchAll(/(?<![\w.,/-])(\d+(?:[.,]\d+)?)\s*A\b/g)]
          .map(match => Number(match[1]!.replace(",", ".")));
        return currents.length === 1 && currents[0]! >= rule.currentRange[0] && currents[0]! <= rule.currentRange[1];
      })()));
    if (matches.length > 1) return unresolved("conflicting_rules", matches.map(rule => rule.code).sort().join(","));
    const match = matches[0];
    if (match) return { destination: match.node, rule: match.code, reason: null };
    return unresolved(isAccessory ? "accessory_without_applicable_type" : "insufficient_article_evidence");
  };
}

export function classifySiemensArticle(article: SiemensNavigationArticle, seed = loadSiemensNavigationSeed()): NavigationAssignment {
  validateSiemensNavigationSeed(seed);
  return classifier(seed)(article);
}

/** One destination per current SIE article. Navigation never creates products, prices or engineering models. */
export function synchronizeSiemensNavigation(db: Database.Database, seed = loadSiemensNavigationSeed()) {
  validateSiemensNavigationSeed(seed);
  const fingerprint = hash({ engine: ENGINE_VERSION, seed });
  const run = () => {
    const removed = db.prepare(`DELETE FROM cat_range_node_product WHERE classification_code=? AND product_id NOT IN
      (SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
        WHERE b.metel_marchio='SIE' AND b.active=1 AND p.import_removed=0)`).run(SIEMENS_CLASSIFICATION).changes;
    const brand = db.prepare("SELECT id FROM cat_brand WHERE metel_marchio='SIE' AND active=1").get() as { id: number } | undefined;
    if (!brand) {
      db.prepare("UPDATE cat_range_node SET active=0 WHERE source='metel' AND code GLOB 'classified.sie.*' AND active<>0").run();
      return { fingerprint, products: 0, changed: 0, removed };
    }
    const upsertNode = db.prepare(`INSERT INTO cat_range_node
      (brand_id,parent_id,code,name,node_kind,source,navigable,sort_order,source_level,source_ref)
      VALUES (?, ?, ?, ?, ?, 'metel',1,?,'classified',?) ON CONFLICT(brand_id,code) DO UPDATE SET
      parent_id=excluded.parent_id,name=excluded.name,node_kind=excluded.node_kind,
      active=1,navigable=1,sort_order=excluded.sort_order,source_level=excluded.source_level,source_ref=excluded.source_ref
      WHERE cat_range_node.source='metel' AND (cat_range_node.parent_id IS NOT excluded.parent_id
        OR cat_range_node.name<>excluded.name OR cat_range_node.node_kind<>excluded.node_kind
        OR cat_range_node.active<>1 OR cat_range_node.navigable<>1 OR cat_range_node.sort_order<>excluded.sort_order
        OR cat_range_node.source_level IS NOT excluded.source_level OR cat_range_node.source_ref IS NOT excluded.source_ref)`);
    const findNode = db.prepare("SELECT id,source FROM cat_range_node WHERE brand_id=? AND code=?");
    const nodes = new Map<string, number>();
    const node = (code: string, name: string, parentId: number | null, sortOrder: number, kind = "group") => {
      const fullCode = `${SIEMENS_CLASSIFICATION}.${code}`;
      upsertNode.run(brand.id, parentId, fullCode, name, kind, sortOrder, `Siemens navigation ${seed.version}`);
      const row = findNode.get(brand.id, fullCode) as { id: number; source: string };
      if (row.source !== "metel") throw new Error(`Protected Siemens navigation collision: ${fullCode}`);
      nodes.set(code, row.id);
      return row.id;
    };
    const root = node("root", "Apparecchi Siemens", null, 1, "section");
    for (const row of seed.nodes) node(row.code, row.name, row.parent === null ? root : nodes.get(row.parent)!, row.sortOrder);
    const fallback = node("unclassified", "Non classificati", root, 9999);
    const articles = db.prepare(`SELECT p.id,p.manufacturer_code AS manufacturerCode,p.short_description AS description,
      p.statistical_family_id AS familyId,f.code AS familyCode,f.description AS familyName,
      CASE WHEN f.issuer_id=p.governing_issuer_id AND f.family_type='STATISTICA' THEN i.metel_sigla END AS familyIssuer,
      b.metel_marchio AS familyBrand
      FROM cat_product p LEFT JOIN cat_metel_family f ON f.id=p.statistical_family_id
      LEFT JOIN cat_metel_issuer i ON i.id=f.issuer_id LEFT JOIN cat_brand b ON b.id=f.brand_id
      WHERE p.brand_id=? AND p.import_removed=0 ORDER BY p.id`).all(brand.id) as SiemensNavigationArticle[];
    const existing = new Map((db.prepare(`SELECT np.product_id AS id,np.article_fingerprint AS articleFingerprint,
      np.taxonomy_fingerprint AS taxonomyFingerprint,n.parent_id AS parentId
      FROM cat_range_node_product np JOIN cat_range_node n ON n.id=np.node_id WHERE np.classification_code=?`)
      .all(SIEMENS_CLASSIFICATION) as Array<{ id: number; articleFingerprint: string; taxonomyFingerprint: string; parentId: number | null }>).map(row => [row.id, row]));
    const assign = db.prepare(`INSERT INTO cat_range_node_product
      (product_id,classification_code,node_id,rule_code,rule_version,taxonomy_fingerprint,article_fingerprint,unresolved_reason)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(product_id,classification_code) DO UPDATE SET
      node_id=excluded.node_id,rule_code=excluded.rule_code,rule_version=excluded.rule_version,
      taxonomy_fingerprint=excluded.taxonomy_fingerprint,article_fingerprint=excluded.article_fingerprint,
      unresolved_reason=excluded.unresolved_reason`);
    const classify = classifier(seed);
    let changed = 0;
    for (const article of articles) {
      const articleFingerprint = hash(article);
      const previous = existing.get(article.id);
      if (previous?.articleFingerprint === articleFingerprint && previous.taxonomyFingerprint === fingerprint) {
        // Recreate/reactivate fallback node presentation after brand restoration as needed.
        const code = `unclassified.family.${article.familyId ?? "none"}`;
        if (!nodes.has(code) && previous.parentId === fallback)
          node(code, article.familyId === null ? "Senza famiglia statistica" : article.familyName || article.familyCode || "Senza famiglia statistica", fallback, 0);
        continue;
      }
      const result = classify(article);
      const fallbackCode = `unclassified.family.${article.familyId ?? "none"}`;
      const nodeId = result.destination ? nodes.get(result.destination)! : nodes.get(fallbackCode)
        ?? node(fallbackCode, article.familyId === null ? "Senza famiglia statistica" : article.familyName || article.familyCode || "Senza famiglia statistica", fallback, 0);
      assign.run(article.id, SIEMENS_CLASSIFICATION, nodeId, result.rule, seed.version, fingerprint, articleFingerprint, result.reason);
      changed++;
    }
    // Retired rules/types and empty fallback families stay invisible and keep stable IDs for restoration.
    db.prepare(`UPDATE cat_range_node SET active=0 WHERE brand_id=? AND source='metel' AND code GLOB 'classified.sie.*'
      AND id NOT IN (SELECT value FROM json_each(?)) AND active<>0`).run(brand.id, JSON.stringify([...nodes.values()]));
    return { fingerprint, products: articles.length, changed, removed };
  };
  return db.transaction(run)();
}
