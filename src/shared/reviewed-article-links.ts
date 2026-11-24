import type { ProjectConfiguredItem } from "./project.js";

export const EXACT_LEGRAND_ARTICLES: ReadonlySet<string> = new Set(["646010", "646020", "646200"]);

// TiQuadri v32 references verified against the source pack and modality rows.
const REVIEWED_PACK_ARTICLES: ReadonlyMap<string, readonly string[]> = new Map([
  ["tq.pack.14172", ["646010"]],
  ["tq.pack.14174", ["646020"]],
  ["tq.pack.17100", ["646200"]],
  ["tq.pack.17835", ["646010"]],
  ["tq.pack.17837", ["646020"]],
  ["tq.pack.18500", ["646010", "646020"]],
]);

export function suspectSavedArticleLinks(items: readonly ProjectConfiguredItem[]) {
  return items.flatMap(item => {
    const expected = REVIEWED_PACK_ARTICLES.get(item.modelCode);
    if (item.modelBrandMarchio !== "BTI" || !expected) return [];
    return item.bom.filter(row => row.brandMarchio === "CAB" && expected.includes(row.manufacturerCode))
      .map(row => ({ itemUuid: item.uuid, seq: row.seq, modelName: item.modelName, snapshotUuid: row.snapshotUuid,
        saved: `CAB/${row.manufacturerCode}`, expected: `LEG/${row.manufacturerCode}` }));
  });
}
