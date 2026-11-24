import { createPortal } from "react-dom";
import type { ProjectDocumentView } from "../../shared/project.js";
import { ShellDialog } from "../app/ShellDialogs.js";

export function PanelEnclosurePrompt({project,onSelect,onCreate,onClose}:{
  project:ProjectDocumentView;onSelect:(uuid:string)=>void;onCreate:()=>void;onClose:()=>void;
}) {
  const roots=project.physicalNodes.filter(node=>node.nodeKind==="enclosure");
  return createPortal(<ShellDialog id="panel-enclosure" title="Scegli una carpenteria" onClose={onClose}>
    <p>{roots.length?"Scegli la carpenteria da usare insieme all’apparecchio per filtrare i pannelli.":
      "Scegli e aggiungi prima una carpenteria. Poi potrai selezionare l’apparecchio e vedere i pannelli compatibili."}</p>
    <div className="reference-device-list">
      {roots.map(root=><button type="button" key={root.uuid} onClick={()=>onSelect(root.uuid)}>
        {project.configuredItems.find(item=>item.uuid===root.itemUuid)?.modelName??root.uuid.slice(0,8)}
      </button>)}
    </div>
    {!roots.length?<button type="button" className="primary" onClick={onCreate}>Scegli carpenteria</button>:null}
  </ShellDialog>,document.body);
}
