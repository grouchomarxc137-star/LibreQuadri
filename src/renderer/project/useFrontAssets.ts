import { useEffect, useMemo, useState } from "react";
import type { FrontVectorAsset, ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import { flatten } from "./front-geometry.js";

const EMPTY:Record<string,FrontVectorAsset>={};

/** Match the backend's placed/unplaced artwork set. Moving coordinates never invalidates it. */
export function frontArtworkKey(project:ProjectDocumentView|null):string {
  if(!project)return "";
  const nodes=flatten(project.physicalNodes);
  const entries=project.configuredItems.flatMap(item=>{
    const placed=nodes.filter(node=>node.itemUuid===item.uuid);
    const quantity=project.lines?.find(line=>line.itemUuid===item.uuid)?.quantity??0;
    const unplaced=item.physStatus==="resolved"&&quantity>placed.length;
    const views=(item.views??[]).filter(view=>view.assetKey&&(unplaced||placed.some(node=>node.viewCode===view.viewCode)))
      .map(view=>[view.assetKey,view.assetSha256]);
    return [...views, ...(item.frontOptionLabels??[]).map(label=>[label.assetKey,null])];
  });
  return JSON.stringify([...new Set(entries.map(entry=>JSON.stringify(entry)))].sort());
}

export function useFrontAssets(api:Pick<ProjectApi,"frontAssets">,project:ProjectDocumentView|null) {
  const owner=project?.metadata?.uuid??null,key=useMemo(()=>frontArtworkKey(project),[project]);
  const [snapshot,setSnapshot]=useState<{owner:string|null;key:string;assets:Record<string,FrontVectorAsset>}>({owner:null,key:"",assets:EMPTY});
  useEffect(()=>{
    let cancelled=false;
    if(owner&&(snapshot.owner!==owner||snapshot.key!==key))void api.frontAssets().then(assets=>{if(!cancelled)setSnapshot({owner,key,assets});})
      // Keep loaded artwork on failure and retry on the next project update. Never expose another project's artwork.
      .catch(()=>{});
    return ()=>{cancelled=true;};
  },[api,owner,key,project]);
  return snapshot.owner===owner?snapshot.assets:EMPTY;
}
