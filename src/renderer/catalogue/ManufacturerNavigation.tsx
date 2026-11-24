import { useEffect,useMemo,useState } from "react";
import type { CatalogueApi,ManufacturerArticle,ManufacturerModel,ManufacturerNode } from "../../shared/catalogue.js";

/** Hierarchy names are shown as they are; display levels are never rendered as a prefix. */
export function manufacturerNodeLabel(node:ManufacturerNode):string {
  return node.name;
}

export function manufacturerChildren(nodes:readonly ManufacturerNode[],parentId:number|null,
  brand=""):ManufacturerNode[] {
  return nodes.filter(node=>node.parentId===parentId&&
    (parentId!==null||!brand||node.brandMarchio===brand));
}

export function ManufacturerNavigation({api,onConfigure,onSearch}:{
  api:CatalogueApi;onConfigure:(productId:number)=>void;onSearch:(code:string)=>void;
}) {
  const [nodes,setNodes]=useState<readonly ManufacturerNode[]>([]);
  const [failed,setFailed]=useState(false);
  const [brand,setBrand]=useState("");
  const [nodeId,setNodeId]=useState<number|null>(null);
  const [modelId,setModelId]=useState<number|null>(null);
  const [models,setModels]=useState<readonly ManufacturerModel[]>([]);
  const [articles,setArticles]=useState<readonly ManufacturerArticle[]>([]);
  const [offset,setOffset]=useState(0);
  const [hasMore,setHasMore]=useState(false);
  const byId=useMemo(()=>new Map(nodes.map(node=>[node.id,node])),[nodes]);
  const brands=useMemo(()=>[...new Set(nodes.map(node=>node.brandMarchio))].sort(),[nodes]);
  useEffect(()=>{let live=true;api.manufacturerNodes().then(value=>{if(live)setNodes(value);},
    ()=>{if(live)setFailed(true);});return()=>{live=false;};},[api]);
  useEffect(()=>{
    if(nodeId===null){setModels([]);return;}
    let live=true;api.manufacturerModels(nodeId).then(value=>{if(live)setModels(value);},
      ()=>{if(live)setFailed(true);});return()=>{live=false;};
  },[api,nodeId]);
  useEffect(()=>{
    if(nodeId===null){setArticles([]);setHasMore(false);return;}
    let live=true;
    const request=modelId===null?{nodeId,offset,limit:100}:{modelId,offset,limit:100};
    api.manufacturerArticles(request).then(value=>{
      if(!live)return;
      setArticles(previous=>offset===0?value:[...previous,...value]);
      setHasMore(value.length===100);
    },()=>{if(live)setFailed(true);});
    return()=>{live=false;};
  },[api,nodeId,modelId,offset]);
  const selected=nodeId===null?null:byId.get(nodeId)??null;
  const path:ManufacturerNode[]=[];
  for(let current:ManufacturerNode|null|undefined=selected;current;
    current=current.parentId===null?undefined:byId.get(current.parentId))path.unshift(current);
  const children=manufacturerChildren(nodes,nodeId,brand);
  const chooseNode=(id:number|null)=>{setNodeId(id);setModelId(null);setOffset(0);setArticles([]);};
  const chooseModel=(id:number|null)=>{setModelId(id);setOffset(0);setArticles([]);};
  return <section className="manufacturer-navigation" aria-label="Navigazione produttore">
    <p className="hint">Esplora la struttura del produttore o le famiglie statistiche METEL.</p>
    {failed?<p role="alert" className="error">Navigazione non disponibile.</p>:null}
    <label>Marchio <select value={brand} onChange={event=>{setBrand(event.target.value);chooseNode(null);}}>
      <option value="">Tutti i marchi</option>{brands.map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>
    <nav aria-label="Percorso produttore" className="manufacturer-path">
      <button type="button" onClick={()=>chooseNode(null)}>Produttori</button>
      {path.map(node=><button key={node.id} type="button" onClick={()=>chooseNode(node.id)}>{manufacturerNodeLabel(node)}</button>)}
    </nav>
    {children.length?<ul className="manufacturer-children">{children.map(node=><li key={node.id}>
      <button type="button" onClick={()=>chooseNode(node.id)}>
        <strong>{manufacturerNodeLabel(node)}</strong> <small>{node.brandMarchio} · {node.source==="metel"?"METEL":"Produttore"}</small>
      </button>
    </li>)}</ul>:null}
    {selected&&models.length?<section aria-label="Modelli"><h3>Modelli</h3><ul className="manufacturer-models">
      {models.map(model=><li key={model.id}><button type="button" aria-pressed={modelId===model.id}
        onClick={()=>chooseModel(model.id)}>{model.name}</button></li>)}
    </ul></section>:null}
    {selected&&modelId!==null?<button type="button" onClick={()=>chooseModel(null)}>Torna ai modelli</button>:null}
    {selected&&articles.length?<section aria-label="Articoli"><h3>Articoli</h3><ul className="manufacturer-articles">
      {articles.map(article=><li key={article.id}><strong>{article.brandMarchio} {article.manufacturerCode}</strong>
        <span>{article.description}</span>
        <button type="button" onClick={()=>onSearch(article.manufacturerCode)}>Scheda</button>
        {article.configurable?<button type="button" onClick={()=>onConfigure(article.id)}>Configura</button>:null}
      </li>)}
    </ul>{hasMore?<button type="button" onClick={()=>setOffset(value=>value+100)}>Mostra altri</button>:null}</section>:null}
  </section>;
}
