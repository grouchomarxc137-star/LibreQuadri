/** Pure physical class check shared by offline placement and catalogue design guards. */
export interface PhysicalClassConstraint {
  relation: string;
  classCodes: readonly string[];
}

export type PhysicalClassCompatibility =
  | { ok: true }
  | { ok: false; code: "incompatible_parent" | "incompatible_ancestor" };

export function checkPhysicalClasses(constraints: readonly PhysicalClassConstraint[],
  parentClassCode: string | null, ancestorClassCodes: readonly (string | null)[]):
  PhysicalClassCompatibility {
  for(const constraint of constraints){
    const candidates=constraint.relation==="parent"?[parentClassCode]:ancestorClassCodes;
    if(!candidates.some(code=>code!==null&&constraint.classCodes.includes(code)))
      return {ok:false,code:constraint.relation==="parent"
        ?"incompatible_parent":"incompatible_ancestor"};
  }
  return {ok:true};
}
