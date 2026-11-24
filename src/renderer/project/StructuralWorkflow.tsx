import { configurationCanBeAdded, isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { confirmCatalogueAddition } from "../configuration/out-of-catalogue.js";
import { PanelEnclosurePrompt } from "./PanelEnclosurePrompt.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { STRUCTURAL_ADD_QUANTITY_MAX, STRUCTURAL_ADD_QUANTITY_MIN } from "../../shared/project.js";
import type { ConfigurationApi } from "../../shared/configuration.js";
import type { ReferenceDevice, ProjectApi, ProjectDocumentView, ProjectPhysicalNode } from "../../shared/project.js";
import { useStatusActions } from "../app/status.js";
import { useAddFailureNotice, useQuickAdd } from "../app/QuickAdd.js";
import { useModelConfiguration } from "../configuration/model-configuration.js";
import { configurationRequest } from "../configuration/presentation.js";
import { ConfigurationControls, ConfigurationResultPanel } from "../configuration/ConfigurationScreen.js";
import { ReferenceDevicePicker } from "./ReferenceDevicePicker.js";
import { referenceCompatibilityMessage, useReadOnlyQuery } from "./panel-reference-state.js";
import { DeviceDiscovery } from "./DeviceDiscovery.js";
import { Icon } from "../ui/icons.js";
import { HierarchyTree, initialExpanded, toggleExpanded } from "./HierarchyTree.js";
import { buildNavigationTree, contextUnavailableCount, currentNavigation, eligibleModelId,
  navigationNotice, parsePannelloQuantity, structuralAddLabel, StructuralNavigationSession, submitStructuralAdd,
  type StructuralKind, type StructuralNavigationState } from "./structural-navigation.js";

/** The engineering hierarchy for one structural kind, or the explicit reason none can be offered. */
export function StructuralNavigator({kind,state,expanded,onToggle,modelId,onSelect,onQuickAdd,onRetry,referenceFiltered=false}: {
  referenceFiltered?:boolean;kind:StructuralKind;state:StructuralNavigationState;expanded:ReadonlySet<number>;
  onToggle:(key:number)=>void;modelId:number|null;onSelect:(id:number)=>void;onQuickAdd?:(id:number)=>void;onRetry?:()=>void;
}) {
  const notice=navigationNotice(state,kind);
  const unverified=contextUnavailableCount(state);
  const deviceReady=kind==="device"&&state.phase==="loaded"&&state.navigation.status==="ready";
  const ready=state.phase==="loaded"&&state.navigation.status==="ready"&&state.navigation.candidates.length>0;
  return <div className="structural-navigator">
    {notice?<p className={notice.tone==="alert"?"error":"hint"} role={notice.tone==="alert"?"alert":"status"}>
      {referenceFiltered&&state.phase==="loaded"&&state.navigation.status==="ready"&&state.navigation.candidates.length===0
        ?kind==="enclosure"?"Nessuna carpenteria compatibile con l’apparecchio configurato.":"Nessun pannello compatibile con la carpenteria e l’apparecchio configurato.":notice.text}</p>:null}
    {notice?.retry&&onRetry?<button type="button" onClick={onRetry}>Riprova</button>:null}
    {deviceReady?<DeviceDiscovery key={state.parentUuid} navigation={state.navigation} expanded={expanded}
      onToggle={onToggle} modelId={modelId} onSelect={onSelect} onQuickAdd={onQuickAdd}/>:ready?<HierarchyTree label={kind==="enclosure"?"Carpenterie":"Pannelli compatibili"}
      tree={buildNavigationTree(state.navigation)} expanded={expanded} onToggle={onToggle}
      selectedLeaf={modelId} onSelectLeaf={onSelect} onQuickAddLeaf={onQuickAdd}/>:null}
    {unverified>0?<p className="hint" role="status">
      {unverified===1?"Un modello non è stato incluso perché il suo contesto non è verificabile."
        :`${unverified} modelli non sono stati inclusi perché il loro contesto non è verificabile.`}</p>:null}
  </div>;
}

/**
 * The "Struttura" panel of Progettazione (docs/R17_VISUAL_DESIGN.md §4.3): Carpenterie or
 * Pannelli compatible with the selected Carpenteria, the configuration of the chosen model and
 * its add action. The Carpenteria itself is chosen in the Fronte Quadro toolbar or Albero fisico.
 */
export function StructuralWorkflow({project,api,configurationApi,root,panel,onProjectChange,onRootCreated,section,onSectionChange,panelFocusUuid,onFocusRoot,autoPlace=false}: {
  project:ProjectDocumentView;api:ProjectApi;configurationApi:ConfigurationApi;
  root:ProjectPhysicalNode|undefined;
  /** The placed Pannello whose compatible Apparecchi are offered; chosen by the screen from the selection. */
  panel?:ProjectPhysicalNode;
  panelFocusUuid?:string|null;onFocusRoot?:(uuid:string)=>void;
  onProjectChange:(project:ProjectDocumentView)=>void;
  onRootCreated:(uuid:string)=>void;
  section?:StructuralKind; onSectionChange?:(kind:StructuralKind)=>void;
  autoPlace?:boolean;
}) {
  const [localKind,setKind]=useState<StructuralKind>("enclosure");
  const kind=section??localKind;
  const referenceRoot=panelFocusUuid===undefined?root:project.physicalNodes.find(node=>node.uuid===panelFocusUuid&&node.nodeKind==="enclosure");
  const [choosingRoot,setChoosingRoot]=useState(false);
  const [resumeAfterCreate,setResumeAfterCreate]=useState(false);
  const [pendingRoot,setPendingRoot]=useState<string|null>(null);
  const [filterRoot,setFilterRoot]=useState<string|null>(null);
  const [reference,setReference]=useState<ReferenceDevice|null>(null);
  const [referenceItem,setReferenceItem]=useState<{uuid:string;fingerprint:string;definition:string}|null>(null);
  const [editingReference,setEditingReference]=useState(true);
  const pickerVisible=kind==="enclosure"?filterRoot==="enclosures":kind==="support"&&!!referenceRoot&&filterRoot===referenceRoot.uuid;
  const filterActive=pickerVisible&&reference!==null;
  const filterButton=useRef<HTMLButtonElement>(null);
  const resetFilter=()=>{setFilterRoot(null);setReference(null);setReferenceItem(null);setEditingReference(true);setSelected(null);};
  const removeFilter=()=>{resetFilter();filterButton.current?.focus();};
  const changeKind=(next:StructuralKind)=>{if(next!==kind){resetFilter();if(onSectionChange)onSectionChange(next);else setKind(next);}};
  useEffect(()=>{resetFilter();},[root?.uuid,referenceRoot?.uuid,project.metadata?.uuid,kind]);
  useEffect(()=>{
    if(pendingRoot&&kind==="support"&&referenceRoot?.uuid===pendingRoot){
      setFilterRoot(pendingRoot);setEditingReference(true);setPendingRoot(null);
    }
  },[pendingRoot,kind,referenceRoot?.uuid]);
  useEffect(()=>{setChoosingRoot(false);setResumeAfterCreate(false);setPendingRoot(null);},[project.metadata?.uuid]);
  useEffect(()=>{
    if(referenceItem&&!project.configuredItems.some(item=>item.uuid===referenceItem.uuid&&
      item.configFingerprint===referenceItem.fingerprint&&item.modelDefinitionFingerprint===referenceItem.definition))resetFilter();
  },[project,referenceItem]);
  const [navigation,setNavigation]=useState<StructuralNavigationState>({phase:"loading"});
  const [expanded,setExpanded]=useState<ReadonlySet<number>>(new Set());
  const [reload,setReload]=useState(0);
  const [selected,setSelected]=useState<number|null>(null);
  const {announce}=useStatusActions();
  const quickAdd=useQuickAdd();
  const showAddFailure=useAddFailureNotice();
  const [busy,setBusy]=useState(false);
  /** Pannelli only: how many units one Aggiungi adds (the configured-item quantity). */
  const [quantityText,setQuantityText]=useState("1");
  const quantity=parsePannelloQuantity(quantityText);
  const parentUuid=kind==="support"?(filterActive?referenceRoot?.uuid:root?.uuid):kind==="device"?panel?.uuid:undefined;
  const filterProject=filterActive?project:null;
  const navigationApi=useMemo(()=>({designNavigation:async(requestKind:StructuralKind,uuid?:string)=>{
    if(!filterActive)return api.designNavigation(requestKind,uuid);
    if(!reference)throw new Error("Scegli l’apparecchio di riferimento per filtrare la struttura.");
    const result=kind==="enclosure"?await api.compatibleEnclosures({device:reference}):await api.compatiblePanels({parentUuid:uuid!,device:reference});
    if(!result.reference.ok)throw new Error(referenceCompatibilityMessage(result.reference.code));
    return result.navigation;
  }}),[api,kind,filterActive,reference,filterProject]);
  const [navigationOwner,setNavigationOwner]=useState<typeof navigationApi|null>(null);
  const session=useMemo(()=>new StructuralNavigationSession(navigationApi,next=>{
    setNavigationOwner(navigationApi);setNavigation(next);
  }),[navigationApi]);
  useEffect(()=>{
    session.load(kind,parentUuid);
    return ()=>session.dispose();
  },[session,kind,parentUuid,reload]);
  const visibleNavigation=navigationOwner===navigationApi?navigation:{phase:"loading" as const};
  const current=currentNavigation(visibleNavigation,kind,parentUuid);
  // A choice never outlives the hierarchy that offered it: another root or kind drops it.
  const modelId=eligibleModelId(visibleNavigation,kind,parentUuid,selected);
  useEffect(()=>{
    if(selected!==null&&current.phase==="loaded"&&modelId===null)setSelected(null);
  },[selected,current.phase,modelId]);
  useEffect(()=>{
    if(current.phase==="loaded")setExpanded(initialExpanded(buildNavigationTree(current.navigation)));
  },[current.phase==="loaded"?current.navigation:null]);
  const select=(id:number)=>setSelected(id);
  const {state,session:configuration}=useModelConfiguration(configurationApi,modelId);
  const contextNode=kind==="device"?panel:root;
  const parentItem=project.configuredItems.find(item=>item.uuid===contextNode?.itemUuid);
  const configurationCurrent=modelId!==null&&state.modelId===modelId;
  const request=configurationCurrent?configuration.request():null;
  const checkQuery=useMemo(()=>filterActive&&reference&&request&&state.result&&configurationCanBeAdded(state.result)
    ?kind==="enclosure"?async()=>(await api.compatibleEnclosures({device:reference,enclosure:request})).reference
      :parentUuid?()=>api.checkPanelReference({parentUuid,device:reference,panel:request}):null:null,
    [api,kind,filterActive,reference,parentUuid,JSON.stringify(request),state.result,project]);
  const referenceCheck=useReadOnlyQuery(checkQuery);
  const referenceAllowsAdd=!filterActive||!!referenceCheck?.value?.ok;
  const checkNotice=filterActive&&modelId!==null?(referenceCheck?.error?`Verifica non disponibile: ${referenceCheck.error}`:
    referenceCheck?.value?kind==="enclosure"&&referenceCheck.value.ok?"Carpenteria compatibile per classi e famiglia; verifica ingombri e capacità al posizionamento.":referenceCompatibilityMessage(referenceCheck.value.code):
    !configurationCurrent||state.resolving?kind==="enclosure"?"Risoluzione della carpenteria in corso…":"Risoluzione del pannello in corso…":
    state.modelError||state.resolveError?kind==="enclosure"?"Configurazione della carpenteria non disponibile.":"Configurazione del pannello non disponibile.":
    (!state.result||!configurationCanBeAdded(state.result))?"Completa la configurazione per verificarne la compatibilità.":
    "Verifica della compatibilità in corso…"):null;
  const resumeWithRoot=(uuid:string|undefined)=>{
    if(!uuid||!resumeAfterCreate)return;
    setResumeAfterCreate(false);changeKind("support");setPendingRoot(uuid);
  };
  const add=async()=>{
    if(!request||!state.result||!configurationCanBeAdded(state.result)||!referenceAllowsAdd)return;
    if(kind==="support"&&quantity===null)return;
    const accepted=confirmCatalogueAddition(request,state.result);
    if(!accepted)return;
    setBusy(true);
    try {
      const result=await submitStructuralAdd(api,project,kind,accepted,parentUuid,kind==="support"?quantity??undefined:undefined,filterActive?reference??undefined:undefined);
      if(result.createdRootUuid)onRootCreated(result.createdRootUuid);
      onProjectChange(result.project);
      resumeWithRoot(result.createdRootUuid);
      announce(result.message,"ok");
      setSelected(null);
      setQuantityText("1");
    }catch(caught){showAddFailure?.(caught);}
    finally{setBusy(false);}
  };
  const addFromRow=(id:number)=>{
    if(current.phase!=="loaded"||eligibleModelId(visibleNavigation,kind,parentUuid,id)===null)return;
    const candidate=current.navigation.candidates.find(model=>model.id===id)!;
    const quickRequest=(modelId===id?request:null)??configurationRequest(id,[]);
    setSelected(id);
    quickAdd?.(candidate.name,async(rawApi,latest)=>{
      const resolved=await configurationApi.resolve(quickRequest);
      if(!configurationCanBeAdded(resolved)||!resolved.model.active||resolved.model.obsolete)return null;
      const accepted=confirmCatalogueAddition(quickRequest,resolved);
      if(!accepted)return null;
      const result=await submitStructuralAdd(rawApi,latest,kind,accepted,parentUuid,undefined,filterActive?reference??undefined:undefined,autoPlace);
      if(result.createdRootUuid)onRootCreated(result.createdRootUuid);
      resumeWithRoot(result.createdRootUuid);
      return result.project;
    });
  };
  return <section className="dock-panel structural-workflow" aria-labelledby="design-structure-title">
    <header className="dock-header">
      <h3 id="design-structure-title">Struttura</h3>
      <button type="button" className="icon-button" aria-label="Ricarica la navigazione strutturale"
        title="Ricarica" onClick={()=>setReload(value=>value+1)}><Icon name="refresh"/></button>
    </header>
    <div className="dock-body structural-body">
      {section===undefined?<div className="segmented" role="group" aria-label="Sezione strutturale">
        <button type="button" aria-pressed={kind==="enclosure"} onClick={()=>changeKind("enclosure")}>Carpenterie</button>
        <button type="button" aria-pressed={kind==="support"} onClick={()=>changeKind("support")}>Pannelli</button>
        <button type="button" aria-pressed={kind==="device"} onClick={()=>changeKind("device")}>Apparecchi</button>
      </div>:null}
      {kind!=="enclosure"&&contextNode?<p className="structural-context"
        title={`${kind==="device"?"Apparecchi":"Pannelli"} compatibili con ${parentItem?.modelName??contextNode.uuid.slice(0,8)}`}>
        Compatibili con <strong>{parentItem?.modelName??contextNode.uuid.slice(0,8)}</strong></p>:null}
      <PresetNotices project={project}/>
      {kind!=="device"?<div className="panel-reference-filter">
        <button ref={filterButton} type="button" aria-pressed={filterActive}
          aria-haspopup="dialog" aria-expanded={choosingRoot||pickerVisible&&editingReference} disabled={busy}
          onClick={()=>{
            if(kind==="support"&&!referenceRoot){setChoosingRoot(true);return;}
            setFilterRoot(kind==="enclosure"?"enclosures":referenceRoot!.uuid);setEditingReference(true);
          }}>
          {kind==="enclosure"?"Carpenterie compatibili · Filtra per apparecchio":"Pannelli compatibili · Filtra per apparecchio"}</button>
        {pickerVisible?<ReferenceDevicePicker key={kind==="enclosure"?"enclosures":referenceRoot!.uuid} api={api} enclosures={kind==="enclosure"} project={project} configurationApi={configurationApi}
          editing={editingReference}
          onApply={(device,item)=>{setReference(device);setReferenceItem({uuid:item.uuid,fingerprint:item.configFingerprint,
            definition:item.modelDefinitionFingerprint});setEditingReference(false);setSelected(null);}}
          onEdit={()=>setEditingReference(true)} onRemove={removeFilter}
          onCancel={()=>{if(reference)setEditingReference(false);else{setFilterRoot(null);filterButton.current?.focus();}}}/>:null}
      </div>:null}
      {choosingRoot?<PanelEnclosurePrompt project={project} onClose={()=>setChoosingRoot(false)}
        onSelect={uuid=>{setChoosingRoot(false);onFocusRoot?.(uuid);setPendingRoot(uuid);}}
        onCreate={()=>{setChoosingRoot(false);setResumeAfterCreate(true);changeKind("enclosure");}}/>:null}
      <StructuralNavigator referenceFiltered={filterActive} kind={kind} state={current} expanded={expanded}
        onToggle={key=>setExpanded(previous=>toggleExpanded(previous,key))} modelId={modelId}
        onSelect={select} onQuickAdd={quickAdd?addFromRow:undefined} onRetry={()=>setReload(value=>value+1)}/>
      {filterActive?<p className="hint">Filtro per classi fisiche e contesto. Il posizionamento verifica anche ingombri e capacità.</p>:null}
      {checkNotice?<p className={referenceCheck?.error||referenceCheck?.value&&!referenceCheck.value.ok?"error":"hint"}
        role={referenceCheck?.error||referenceCheck?.value&&!referenceCheck.value.ok?"alert":"status"}>{checkNotice}</p>:null}
      {modelId!==null?<div className="structural-configuration" role="group" aria-label="Configurazione">
        {configurationCurrent&&state.model?<ConfigurationControls model={state.model} result={state.result} busy={busy||state.resolving}
          onChoice={(axisId,optionId)=>configuration.choose(axisId,optionId)} />:null}
        {configurationCurrent&&state.result?<ConfigurationResultPanel result={state.result}/>:null}
      </div>:null}
    </div>
    {configurationCurrent&&state.result?<footer className="dock-footer">
      {isOutOfCatalogue(state.result)?<p className="config-warning">Fuori catalogo · conferma richiesta prima dell’aggiunta. Prezzi METEL mancanti.</p>:null}
      {kind==="support"?<label className="structural-quantity">Quantità
        <input type="number" inputMode="numeric" min={STRUCTURAL_ADD_QUANTITY_MIN} max={STRUCTURAL_ADD_QUANTITY_MAX} step={1}
          value={quantityText} disabled={busy} aria-label="Quantità di pannelli da aggiungere"
          aria-invalid={quantity===null?"true":undefined} title="Pannelli da aggiungere, da 1 a 99: una sola riga con questa quantità"
          onChange={event=>setQuantityText(event.target.value)}/></label>:null}
      <button type="button" className="primary" disabled={busy||!referenceAllowsAdd||state.resolving||state.modelId!==modelId||!configurationCanBeAdded(state.result)||
        (kind!=="enclosure"&&!parentUuid)||(kind==="support"&&quantity===null)} onClick={()=>void add()}>
        {busy?"Aggiunta in corso…":structuralAddLabel(kind)}
      </button>
    </footer>:null}
  </section>;
}

/** Creation diagnostics come from the backend; the renderer never creates supports. */
export function PresetNotices({project}:{project:Pick<ProjectDocumentView,"presetDiagnostics">}) {
  const withheld=project.presetDiagnostics?.filter(row=>row.status==="withheld")??[];
  return withheld.length?<div role="status" className="hint">
    <p>Alcuni pannelli preimpostati non sono stati aggiunti:</p>
    <ul>{withheld.map(row=><li key={row.seq}>{row.modelName??"Pannello"} ({row.seq}): {row.message}
      {row.issues?.map(issue=><span key={`${issue.code}-${issue.axisId??0}`}> {issue.message}</span>)}
    </li>)}</ul>
  </div>:null;
}
