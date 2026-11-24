import { useState } from "react";
import type { StructuralNavigation } from "../../shared/project.js";
import { HierarchyTree } from "./HierarchyTree.js";
import { buildNavigationTree } from "./structural-navigation.js";
import { filterDeviceNavigation, physicalOnlyDevices } from "./device-discovery.js";

export function DeviceDiscovery({ navigation, expanded, onToggle, modelId, onSelect, onQuickAdd, referenceMode=false }: {
  referenceMode?:boolean;navigation: StructuralNavigation; expanded: ReadonlySet<number>; onToggle: (id: number) => void;
  modelId: number | null; onSelect: (id: number) => void;
  onQuickAdd?: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = filterDeviceNavigation(navigation, query);
  const direct = physicalOnlyDevices(filtered);
  const hasPhysicalOnly = physicalOnlyDevices(navigation).length > 0;
  return <>
    {!referenceMode?<p className="hint">Scegli il pannello nell’Albero fisico per vedere gli apparecchi compatibili.</p>:null}
    {!referenceMode && !hasPhysicalOnly ? <p className="hint" role="status">Nessun apparecchio di solo ingombro è disponibile per il pannello corrente.
      Per inserire elementi DIN, seleziona un pannello con guida DIN nell’Albero fisico.</p> : null}
    <label className="device-search">Cerca apparecchi
      <input type="search" autoFocus={referenceMode} value={query} placeholder={referenceMode?"Nome, marchio o codice modello interno":"Nome, marchio o codice"}
        onChange={event => setQuery(event.target.value)} />
    </label>
    {referenceMode?<p className="hint">La ricerca usa i codici modello interni, non i codici articolo commerciali.</p>:null}
    {direct.length ? <div className="device-direct" role="group" aria-label="Solo ingombro">
      <p className="hint">Solo ingombro</p>
      {direct.map(model => <button type="button" key={model.id} className="hierarchy-leaf"
        aria-pressed={model.id === modelId} onClick={() => onSelect(model.id)}
        onDoubleClick={onQuickAdd && (() => onQuickAdd(model.id))}>{model.name}</button>)}
    </div> : null}
    {filtered.nodes.length ? <HierarchyTree label={referenceMode?"Apparecchi di riferimento":"Apparecchi compatibili"} tree={buildNavigationTree(filtered)}
      expanded={query.trim() ? new Set(filtered.nodes.map(node => node.id)) : expanded}
      onToggle={onToggle} selectedLeaf={modelId} onSelectLeaf={onSelect} onQuickAddLeaf={onQuickAdd} />
      : <p className="hint" role="status">Nessun apparecchio corrisponde alla ricerca.</p>}
  </>;
}
