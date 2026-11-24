import type Database from "better-sqlite3";
import { loadSiemensNavigationSeed, SIEMENS_CLASSIFICATION } from "./siemens-navigation.js";

/** Reports persisted navigation assignments, independently of technical attribute coverage. */
export function siemensNavigationReport(db: Database.Database) {
  const seed = loadSiemensNavigationSeed();
  const rows = db.prepare(`SELECT p.id,p.manufacturer_code AS code,p.short_description AS description,
    f.id AS familyId,f.code AS familyCode,f.description AS familyName,i.metel_sigla AS issuer,
    n.code AS destination,np.rule_code AS rule,np.rule_version AS version,np.unresolved_reason AS reason,
    np.taxonomy_fingerprint AS fingerprint
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
    LEFT JOIN cat_metel_family f ON f.id=p.statistical_family_id LEFT JOIN cat_metel_issuer i ON i.id=f.issuer_id
    LEFT JOIN cat_range_node_product np ON np.product_id=p.id AND np.classification_code=?
    LEFT JOIN cat_range_node n ON n.id=np.node_id
    WHERE b.metel_marchio='SIE' AND b.active=1 AND p.import_removed=0 ORDER BY f.code,p.manufacturer_code`)
    .all(SIEMENS_CLASSIFICATION) as Array<{ id: number; code: string; description: string | null;
      familyId: number | null; familyCode: string | null; familyName: string | null; issuer: string | null;
      destination: string | null; rule: string | null; version: string | null; reason: string | null; fingerprint: string | null }>;
  type Family = { code: string; name: string; products: number; assigned: number; unclassified: number;
    missing: number; destinations: Record<string, number>; rules: Record<string, number>; reasons: Record<string, number>; examples: string[] };
  const families = new Map<string, Family>();
  const destinations: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.issuer ?? "none"}:${row.familyId ?? "none"}`;
    const f = families.get(key) ?? { code: row.familyCode ?? "(missing)", name: row.familyName ?? "Senza famiglia statistica",
      products: 0, assigned: 0, unclassified: 0, missing: 0, destinations: {}, rules: {}, reasons: {}, examples: [] };
    families.set(key, f); f.products++;
    if (!row.destination) { f.missing++; continue; }
    if (row.reason === null) f.assigned++; else f.unclassified++;
    const destination = row.destination.replace(`${SIEMENS_CLASSIFICATION}.`, "");
    f.destinations[destination] = (f.destinations[destination] ?? 0) + 1;
    destinations[destination] = (destinations[destination] ?? 0) + 1;
    f.rules[row.rule!] = (f.rules[row.rule!] ?? 0) + 1;
    if (row.reason) f.reasons[row.reason] = (f.reasons[row.reason] ?? 0) + 1;
    if (f.examples.length < 2) f.examples.push(`${row.code}: ${row.description ?? ""}`);
  }
  const list = [...families.values()];
  return { version: seed.version, reviewedDelivery: seed.reviewedDelivery, products: rows.length,
    assigned: list.reduce((sum, f) => sum + f.assigned, 0), unclassified: list.reduce((sum, f) => sum + f.unclassified, 0),
    missing: list.reduce((sum, f) => sum + f.missing, 0), fingerprints: [...new Set(rows.map(row => row.fingerprint))],
    destinations, families: list };
}

export function siemensNavigationMarkdown(report: ReturnType<typeof siemensNavigationReport>): string {
  const esc = (s: string) => s.replaceAll("|", "/").replaceAll("\n", " ");
  const counts = (values: Record<string, number>) => Object.entries(values).map(([key, count]) => `${key}=${count}`).join("; ") || "none";
  return `# Siemens functional navigation review\n\nVersion ${report.version}; reviewed delivery ${report.reviewedDelivery}. ` +
    `${report.families.length} current statistical families, ${report.products} articles: ${report.assigned} classified, ` +
    `${report.unclassified} unclassified, ${report.missing} missing assignments. Fingerprint: ${report.fingerprints.join(", ")}.\n\n` +
    `Generated read-only from a disposable migrated catalogue. Each article has exactly one classifier membership; ` +
    `original FST membership, product identity and price records are retained. Unclassified navigation counts are independent of missing technical filter values.\n\n` +
    `Taxonomy labels and ordering come from the reviewed TiQuadri Apparecchi hierarchy and range-navigation seed. ` +
    `Rules require each article's own description, reviewed SIE-issued family context and, where specified, a reviewed code prefix. ` +
    `Prefixes identify product types, never electrical ratings. Referenced devices after PER/FOR/X cannot identify an accessory. ` +
    `Separate differential blocks, NEOZED/DIAZED and dimensionless SITOR links, PLCs, drives, industrial safety, software, ` +
    `sheet metal and other products without a reviewed applicable type remain unclassified. Contactors require an explicit, unambiguous nominal current in an existing TiQuadri interval.\n\n` +
    `Rules and the review decision for all 212 supplied families: [versioned seed](../db/seed/siemens-navigation.json). ` +
    `Future/unreviewed families and missing/foreign family references fall back explicitly. Conflicting rules always fall back.\n\n` +
    `Reproduce: \`node dist/scripts/siemens-navigation-report.js /absolute/path/to/classified-copy.db output.md\`.\n\n` +
    `## Destinations\n\n| Branch | Articles |\n|---|---:|\n` +
    Object.entries(report.destinations).map(([name, count]) => `| ${esc(name)} | ${count} |`).join("\n") + "\n\n" +
    report.families.map(f => `## ${f.code} — ${esc(f.name)}\n\n` +
      `${f.products} articles; classified ${f.assigned}; unclassified ${f.unclassified}; missing ${f.missing}.\n\n` +
      `Destinations: ${counts(f.destinations)}.\n\nRules: ${counts(f.rules)}. Unresolved: ${counts(f.reasons)}.\n\n` +
      `Imported examples: ${f.examples.map(esc).join("; ")}.\n`).join("\n");
}
