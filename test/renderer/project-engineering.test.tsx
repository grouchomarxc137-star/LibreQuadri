import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { EngineeringDialog, EngineeringPlanReport } from "../../src/renderer/app/EngineeringDialog.js";
import { SavedArticleReviewNotice } from "../../src/renderer/app/ProjectShell.js";
import { frontProject } from "../helpers/front-project.js";
import { StatusProvider } from "../../src/renderer/app/status.js";
import { fakeProjectApi } from "./fake-api.js";
import { shellReducer, initialShellState } from "../../src/renderer/app/shell-state.js";
import type { ProjectEngineeringPlan } from "../../src/shared/project-engineering.js";

it("shows the saved and expected article identities for a reviewed TiQuadri model", () => {
  const item = { ...frontProject.configuredItems[0]!, modelBrandMarchio: "BTI", modelCode: "tq.pack.14172",
    modelName: "iPDU", bom: [{ seq: 0, snapshotUuid: "snapshot", brandMarchio: "CAB", manufacturerCode: "646010",
      description: "Cable cover", quantityPerItem: 1, role: "primary", listPriceUnitE4: 100, salePriceUnitE4: 100 }] };
  const markup = renderToStaticMarkup(<SavedArticleReviewNotice items={[item]} />);
  expect(markup).toContain("iPDU · Salvato CAB/646010 · Riferimento TiQuadri LEG/646010");
  expect(renderToStaticMarkup(<SavedArticleReviewNotice items={[{ ...item, modelCode: "other" }]} />)).toBe("");
});
const plan:ProjectEngineeringPlan={token:"a".repeat(64),canApply:false,counts:{unchanged:5,verify:2,refresh:3,blocked:1},
  items:[{itemUuid:"i",modelCode:"m",modelName:"Pannello",state:"older_adapter",action:"blocked",changes:["labels"],
    labelChanges:[{field:"modelName",before:"Vecchio",after:"Nuovo"}],blockers:["bom_changed"]}],
  blockers:["save_first"],newIssues:[{nodeUuid:"n",code:"over_capacity",message:"Capacità superata."}],
  resolvedIssues:[{nodeUuid:"n",code:"context_unknown",message:"Contesto"}],remainingIssues:[],
  geometryChanges:[{nodeUuid:"n",before:{xMm:0,yMm:0},after:{xMm:0,yMm:20}}]};
it("shows counts, blockers, labels, drawing changes and frozen commercial/position guarantees",()=>{
  const html=renderToStaticMarkup(<EngineeringPlanReport plan={plan}/>);
  for(const text of ["5 invariati","2 verificati","3 aggiornabili","1 bloccati","Salva prima il progetto.",
    "Composizione della distinta cambiata.","Il progetto non è stato modificato.","Vecchio","Nuovo","Capacità superata.",
    "Prezzi, quantità, sconti, manodopera, testi personali e posizioni salvate non cambiano.","posizione calcolata del disegno cambiata","problemi preesistenti risolti"])
    expect(html).toContain(text);
});
it("shows one recovery message for a stale catalogue across multiple items",()=>{
  const blocked=plan.items[0]!;
  const html=renderToStaticMarkup(<EngineeringPlanReport plan={{...plan,blockers:["catalogue_stale"],
    items:["Uno","Due"].map(modelName=>({...blocked,itemUuid:modelName,modelName,changes:[],labelChanges:[],
      blockers:["catalogue_stale"]}))}}/>);
  expect(html.match(/Il catalogo di ingegneria deve essere aggiornato/g)).toHaveLength(1);
  expect(html).not.toContain("<strong>Uno</strong>");
  expect(html).not.toContain("<strong>Due</strong>");
});
it("does not call plan/apply during render and disables apply until an explicitly requested successful plan",()=>{
  const api={...fakeProjectApi(),planEngineeringRefresh:vi.fn(),applyEngineeringRefresh:vi.fn()};
  const html=renderToStaticMarkup(<StatusProvider><EngineeringDialog api={api} onClose={()=>{}} onProjectChange={()=>{}}/></StatusProvider>);
  expect(html).toContain('disabled="">Aggiorna dati di ingegneria</button>');
  expect(api.planEngineeringRefresh).not.toHaveBeenCalled();expect(api.applyEngineeringRefresh).not.toHaveBeenCalled();
});
it("opens verification only from an explicit project command, and closes it when the project closes",()=>{
  expect(shellReducer(initialShellState,{type:"command",command:"project:engineering",projectOpen:false})).toBe(initialShellState);
  const open=shellReducer(initialShellState,{type:"command",command:"project:engineering",projectOpen:true});
  expect(open.dialog).toBe("engineering");expect(shellReducer(open,{type:"project-closed"}).dialog).toBeNull();
});
