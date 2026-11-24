/**
 * Reviewed ANA_PACK / ANA_MODALITA / ANA_ART_PACK / ANA_ART_MODALITA evidence.
 * These three DIN mounting surfaces have no base articles and no articles for
 * Cablaggio in cavo / Tutte le fasi. Other executions and the optional guide
 * contribute real accessories. A whole-model physical-only designation is incorrect.
 * Fingerprints bind each permission to the complete reviewed raw model definition.
 */
export const REVIEWED_EMPTY_BOM_PANELS = [
  {packId:1284,name:"24 Moduli DIN 515x150mm",rowId:13611,fingerprint:"3d5a9f4f32cadbf831c20a38778762bdb1feb166d156de8e207c4e8d46b9a332"},
  {packId:1285,name:"24 Moduli DIN 515x200mm",rowId:13624,fingerprint:"8d7ee55fc09905cc951fcde6584296cb1fea7f63f094ba59f51876c45897c8ca"},
  {packId:1286,name:"24 Moduli DIN 515x300mm",rowId:13638,fingerprint:"06d67e897f103911cff083963b40422c145e7869c78ee334569e0640b2ac2824"},
] as const;

export function reviewedEmptyBomPanel(packId:number,name:string,fingerprint:string,rowId:number,
  baseArticleCount:number,ruleArticleCount:number):boolean {
  return baseArticleCount===0&&ruleArticleCount===0&&REVIEWED_EMPTY_BOM_PANELS.some(row=>
    row.packId===packId&&row.name===name&&row.fingerprint===fingerprint&&row.rowId===rowId);
}
