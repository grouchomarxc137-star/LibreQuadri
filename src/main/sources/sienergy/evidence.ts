import type { SienergySource } from "./reader.js";

/** References are evidence, not additive occupancy: an article can have several views/parts. */
export function mountingEvidence(source: SienergySource, id: string) {
  const result: {profileId:string;drawing:string|null;widthMm:number}[] = [];
  const active = new Set<string>();let visits=0;
  const visit = (key:string) => {
    if(active.has(key))throw new Error(`Cyclic graphical reference ${key}`);
    if(++visits>2000||active.size>64)throw new Error("Graphical reference budget exceeded");
    active.add(key);
    const record = source.records.get(key);
    if (!record) throw new Error(`Unresolved graphical reference ${key}`);
    for (const graphic of record.graphics) {
      if(graphic.representation!==1)continue;
      if (graphic.reference) visit(graphic.reference);
      else if (graphic.widthMm !== null) result.push({profileId:key,drawing:graphic.drawing,widthMm:graphic.widthMm});
    }
    active.delete(key);
  };
  visit(id);
  return result;
}

/** QE's associated-database namespace 1 references the supplied material master. */
export function projectReferenceEvidence(source:SienergySource, project:string) {
  if (!/^EXEL S\.R\.L\. integra5 /.test(project)) throw new Error("Unsupported Sienergy project");
  const billable = new Map<string,number>();
  const graphical: {sourceId:string;identifier:string;quantity:number}[] = [];
  const unresolved:string[] = [];
  let referenceCount=0;
  for (const m of project.matchAll(/1:([0-9a-f]+)\[\d+\]\([^)]*\)\s+([0-9.]+)/g)) {
    referenceCount++;
    const record=source.records.get(m[1]!);
    const quantity=Number(m[2]);
    if (!Number.isFinite(quantity)||quantity<=0) throw new Error(`Invalid project reference quantity ${m[2]}`);
    if (!record) {unresolved.push(m[1]!);continue;}
    if (record.manufacturerCode) billable.set(record.manufacturerCode,(billable.get(record.manufacturerCode)??0)+quantity);
    else graphical.push({sourceId:record.id,identifier:record.identifier,quantity});
  }
  return {referenceCount,billable:[...billable].map(([code,quantity])=>({code,quantity})),graphical,unresolved};
}

/** Source profile taxonomy identifies modular equipment; a numeric span alone is insufficient. */
export function isModularProfile(source:SienergySource,id:string):boolean {
  const profile=source.records.get(id),group=profile?.parentId?source.records.get(profile.parentId):undefined;
  return group?.kind===5&&group.title.toLocaleUpperCase("it-IT")==="MODULARI";
}
