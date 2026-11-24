// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigurationResult, ConfigModelDetail } from "../../src/shared/configuration.js";
import type { CompatiblePanelNavigation, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode, ReferenceCompatibility, StructuralNavigation } from "../../src/shared/project.js";
import { StructuralWorkflow } from "../../src/renderer/project/StructuralWorkflow.js";
import { fakeProjectApi, fakeConfigurationApi, openProject } from "./fake-api.js";

const rootNode:ProjectPhysicalNode={uuid:'root-a',itemUuid:'enclosure',parentUuid:null,nodeKind:'enclosure',zoneNo:null,
  startUnits:null,slotNo:null,rootXMm:0,rootYMm:0,viewCode:'front',sortOrder:0,xMm:0,yMm:0,positionIssue:null,children:[]};
function model(id:number):ConfigModelDetail{return {id,code:`model.${id}`,name:id===4?'Reference device':id===5?'Other device':'Panel',
  kind:id>=4?'device':'support',brandMarchio:'ACME',active:true,obsolete:false,commercialContribution:'none',
  definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,maxInsertQty:null,budgets:[],relations:[],
  axes:[{id,dimensionCode:'execution',label:id>=4?'Esecuzione':'Cablaggio',sortOrder:0,visibility:'visible',requirement:'optional',
    binding:'none',editableWhenPlaced:true,selectsPrimary:false,options:[1,2].map(value=>({id:id*10+value,axisId:id,valueId:value,
      valueCode:`option-${value}`,label:`Option ${value}`,parentOptionId:null,isDefault:value===1,visible:true,active:true,sortOrder:value}))}]};}
function resolved(id:number,options:number[]=[]):ConfigurationResult{return {model:model(id),selectedOptionIds:options.length?options:[id*10+1],
  defaultedOptionIds:[],commercialContribution:'none',matchingRuleIds:[],fingerprint:'config',status:'complete',issues:[],bom:[],totalE4:null,
  pricedSubtotalE4:0,budgets:[],physical:null,exclusions:[]};}
function navigation(ids:number[]):StructuralNavigation{return {status:'ready',staleImportIds:[],contextDataUnavailable:0,
  candidates:ids.map(model),nodes:ids.length?[{id:100,parentId:null,name:'Catalogue',kind:'section',sortOrder:0,modelIds:ids}]:[]};}
function projectDevice(id:number,option=1):ProjectConfiguredItem{return {
  uuid:`device-${id}-${option}`,modelBrandMarchio:'ACME',modelCode:`model.${id}`,modelName:model(id).name,modelKind:'device',
  commercialContribution:'none',modelDefinitionFingerprint:`definition-${id}`,modelSourceRef:null,
  configFingerprint:`config-${id}-${option}`,configLabel:`Esecuzione: Option ${option}`,configStatus:'complete',physStatus:'resolved',
  profileCode:null,profileName:null,fitClassCode:null,fitClassLabel:null,depthMm:null,outerDepthMm:null,usableDepthMm:null,
  selections:[{dimensionCode:'execution',dimensionLabel:'Esecuzione',valueCode:`option-${option}`,valueLabel:`Option ${option}`,
    selectionSource:'explicit',binding:'none',editableWhenPlaced:true,visible:true}],
  bom:[],demands:[],views:[],zones:[],slots:[],constraints:[],exclusions:[]};}
const project:ProjectDocumentView={...openProject,configuredItems:[projectDevice(4),projectDevice(5)]};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
let container:HTMLDivElement,reactRoot:Root;
let api:ReturnType<typeof fakeProjectApi>,configurationApi:ReturnType<typeof fakeConfigurationApi>;
const changed=vi.fn();
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);reactRoot=createRoot(container);
  api={...fakeProjectApi(),designNavigation:vi.fn(async()=>navigation([2])),referenceDevices:vi.fn(async()=>navigation([4,5])),
    compatiblePanels:vi.fn(async()=>({navigation:navigation([2]),reference:{ok:true,code:'compatible'}})),
    checkPanelReference:vi.fn(async()=>({ok:true,code:'compatible'})),addStructural:vi.fn(async()=>openProject)};
  configurationApi={...fakeConfigurationApi(),modelByCode:vi.fn(async (_brand,code)=>model(Number(code.split('.').at(-1)))),model:vi.fn(async id=>model(id)),resolve:vi.fn(async request=>resolved(request.modelId,request.selectedOptionIds))};
  changed.mockClear();
});
afterEach(()=>{act(()=>reactRoot.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
async function mount(root:ProjectPhysicalNode|undefined=rootNode,view=project){await act(async()=>{reactRoot.render(<StructuralWorkflow project={view} api={api}
  configurationApi={configurationApi} root={root} onProjectChange={changed} onRootCreated={()=>undefined}/>);});await flush();}
function button(text:string){const found=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node=>(node.querySelector('.hierarchy-name,.reference-device-name')?.textContent??node.textContent)===text);
  if(!found)throw new Error(`Missing button ${text}: ${container.textContent}`);return found;}
async function click(text:string){await act(async()=>button(text).click());await flush();}
async function choose(label:string,value:string){const select=Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
  .find(node=>node.textContent?.startsWith(label))?.querySelector('select');if(!select)throw new Error(`Missing select ${label}`);
  await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});await flush();}
async function start(){await mount();await click('Pannelli');await click('Pannelli compatibili · Filtra per apparecchio');await click('Reference device');}
async function apply(){await start();await click('Mostra pannelli compatibili');}

describe('mounted compatible panel reference workflow',()=>{
  it('keeps ordinary discovery/add unchanged and the normal device tab panel dependent',async()=>{
    await mount();await click('Pannelli');expect(api.referenceDevices).not.toHaveBeenCalled();expect(api.compatiblePanels).not.toHaveBeenCalled();
    await click('Panel');expect(button('Aggiungi').disabled).toBe(false);await click('Aggiungi');
    expect(api.addStructural).toHaveBeenCalledWith({kind:'support',parentUuid:'root-a',configuration:{modelId:2,selectedOptionIds:[]},place:false,quantity:1});
    await click('Apparecchi');expect(container.textContent).toContain('Posiziona prima un pannello');
    expect(container.textContent).not.toContain('Filtra per apparecchio');
  });
  it('preserves ordinary selection/navigation across unrelated project updates and same-tab clicks',async()=>{
    await mount();await click('Pannelli');await click('Panel');const requests=vi.mocked(api.designNavigation).mock.calls.length;
    await mount(rootNode,{...project,dirty:false});
    expect(vi.mocked(api.designNavigation).mock.calls).toHaveLength(requests);
    expect(button('Aggiungi').disabled).toBe(false);
    await click('Pannelli');expect(button('Aggiungi').disabled).toBe(false);
  });
  it('uses a saved project reference without reconfiguration or writes, closes the overlay and checks add',async()=>{
    await apply();expect(api.addStructural).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
    expect(api.compatiblePanels).toHaveBeenLastCalledWith({parentUuid:'root-a',device:{configuration:{modelId:4,selectedOptionIds:[41]},definitionFingerprint:'definition-4'}});
    expect(container.textContent).toContain('Esecuzione: Option 1');expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(configurationApi.resolve).not.toHaveBeenCalled();expect(api.referenceDevices).not.toHaveBeenCalled();
    await click('Panel');expect(api.checkPanelReference).toHaveBeenCalled();expect(button('Aggiungi').disabled).toBe(false);
    const quantity=container.querySelector<HTMLInputElement>('input[type=number]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(quantity,'3');quantity.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('Aggiungi');expect(api.addStructural).toHaveBeenCalledWith(expect.objectContaining({kind:'support',place:false,quantity:3,
      referenceDevice:expect.objectContaining({definitionFingerprint:'definition-4'})}));
  });
  it('blocks while final checks are pending, shows incompatibility, and restores ordinary add after removal',async()=>{
    await apply();await click('Panel');expect(button('Aggiungi').disabled).toBe(false);
    const check=deferred<ReferenceCompatibility>();api.checkPanelReference=vi.fn(()=>check.promise);
    await choose('Cablaggio','22');expect(button('Aggiungi').disabled).toBe(true);
    await act(async()=>check.resolve({ok:false,code:'incompatible_parent'}));expect(button('Aggiungi').disabled).toBe(true);
    expect(container.textContent).toContain('La classe fisica del pannello non è compatibile');
    await click('Rimuovi filtro');await click('Panel');expect(button('Aggiungi').disabled).toBe(false);
    await click('Aggiungi');expect(api.addStructural).toHaveBeenLastCalledWith(expect.not.objectContaining({referenceDevice:expect.anything()}));
  });
  it('ignores old panel lists when a reference changes',async()=>{
    const first=deferred<CompatiblePanelNavigation>(),second=deferred<CompatiblePanelNavigation>();
    api.compatiblePanels=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await apply();await click('Modifica');await click('Other device');await click('Mostra pannelli compatibili');
    await act(async()=>second.resolve({navigation:navigation([]),reference:{ok:true,code:'compatible'}}));
    expect(container.textContent).toContain('Nessun pannello compatibile con la carpenteria e l’apparecchio configurato');
    await act(async()=>first.resolve({navigation:navigation([2]),reference:{ok:true,code:'compatible'}}));
    expect(Array.from(container.querySelectorAll('button')).some(node=>(node.querySelector('.hierarchy-name,.reference-device-name')?.textContent??node.textContent)==='Panel')).toBe(false);
  });
  it('ignores old final-check replies after a newer configuration and after filter removal',async()=>{
    const first=deferred<ReferenceCompatibility>(),second=deferred<ReferenceCompatibility>();
    api.checkPanelReference=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await apply();await click('Panel');await choose('Cablaggio','22');
    await act(async()=>second.resolve({ok:false,code:'incompatible_parent'}));
    await act(async()=>first.resolve({ok:true,code:'compatible'}));expect(button('Aggiungi').disabled).toBe(true);
    await click('Rimuovi filtro');expect(container.textContent).not.toContain('La classe fisica del pannello non è compatibile');
  });
  it('drops the filter on root changes and suppresses old asynchronous lists',async()=>{
    const old=deferred<CompatiblePanelNavigation>();api.compatiblePanels=vi.fn(()=>old.promise);
    await apply();await mount({...rootNode,uuid:'root-b'});
    expect(button('Pannelli compatibili · Filtra per apparecchio').getAttribute('aria-pressed')).toBe('false');
    await act(async()=>old.resolve({navigation:navigation([5]),reference:{ok:true,code:'compatible'}}));
    expect(container.textContent).not.toContain('Other device');expect(api.designNavigation).toHaveBeenLastCalledWith('support','root-b');
  });
  it('opens a labelled modal and cancels with Escape without writes or changing the drawing selection',async()=>{
    await start();expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    const clearDrawingSelection=vi.fn();window.addEventListener('keydown',clearDrawingSelection);
    try{await act(async()=>button('Reference device').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
      expect(clearDrawingSelection).not.toHaveBeenCalled();
    }finally{window.removeEventListener('keydown',clearDrawingSelection);}
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('Pannelli compatibili · Filtra per apparecchio'));
    expect(api.addStructural).not.toHaveBeenCalled();
  });
  it('preserves the applied filter and panel configuration when editing is cancelled',async()=>{
    await apply();await click('Panel');const requests=vi.mocked(api.compatiblePanels).mock.calls.length;
    await click('Modifica');await click('Other device');await click('Annulla');
    expect(button('Aggiungi').disabled).toBe(false);
    expect(api.compatiblePanels).toHaveBeenCalledTimes(requests);
    expect(container.querySelector('.reference-summary')?.textContent).toContain('Reference device');
  });
  it('preserves the ordinary panel configuration when the first selection is cancelled',async()=>{
    await mount();await click('Pannelli');await click('Panel');
    await click('Pannelli compatibili · Filtra per apparecchio');await click('Annulla');
    expect(button('Aggiungi').disabled).toBe(false);expect(api.compatiblePanels).not.toHaveBeenCalled();
  });
  it.each(['Modifica','Rimuovi filtro'])('cancels an applied filter with Escape from %s without clearing drawing selection',async target=>{
    await apply();
    const clearDrawingSelection=vi.fn();
    const screenKey=vi.fn((event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!event.defaultPrevented)clearDrawingSelection();
    });
    window.addEventListener('keydown',screenKey);
    try{
      const control=button(target);control.focus();
      const escape=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
      await act(async()=>control.dispatchEvent(escape));await flush();
      expect(escape.defaultPrevented).toBe(true);
      expect(screenKey).not.toHaveBeenCalled();expect(clearDrawingSelection).not.toHaveBeenCalled();
      expect(container.querySelector('.reference-summary')).toBeNull();
      const activation=button('Pannelli compatibili · Filtra per apparecchio');
      expect(activation.getAttribute('aria-pressed')).toBe('false');expect(document.activeElement).toBe(activation);
      expect(api.designNavigation).toHaveBeenLastCalledWith('support','root-a');
      // Outside the reference summary, the existing screen-level Escape action still receives the key.
      await act(async()=>activation.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
      expect(screenKey).toHaveBeenCalledTimes(1);expect(clearDrawingSelection).toHaveBeenCalledTimes(1);
    }finally{window.removeEventListener('keydown',screenKey);}
  });
  it('shows unavailable saved models and allows retry',async()=>{
    configurationApi.modelByCode=vi.fn(async()=>{throw new Error('offline');});
    await start();expect(button('Mostra pannelli compatibili').disabled).toBe(true);
    expect(document.body.textContent).toContain('offline');expect(api.compatiblePanels).not.toHaveBeenCalled();
    configurationApi.modelByCode=vi.fn(async()=>model(4));await click('Riprova apparecchio');
    expect(button('Mostra pannelli compatibili').disabled).toBe(false);
  });
  it.each(['incomplete','changed','missing choice'])('refuses a %s saved configuration instead of applying defaults',async kind=>{
    const device=projectDevice(4);
    const invalid={...device,...(kind==='incomplete'?{configStatus:'incomplete'}:kind==='changed'?{modelDefinitionFingerprint:'old'}:
      {selections:[{...device.selections[0]!,valueCode:'missing'}]})};
    await mount(rootNode,{...project,configuredItems:[invalid]});await click('Pannelli');
    await click('Pannelli compatibili · Filtra per apparecchio');await click('Reference device');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();expect(button('Mostra pannelli compatibili').disabled).toBe(true);
    expect(api.compatiblePanels).not.toHaveBeenCalled();
  });
  it('shows backend reference refusals without compatible results',async()=>{
    api.compatiblePanels=vi.fn(async()=>({navigation:navigation([2]),reference:{ok:false,code:'model_definition_changed'}}));
    await apply();expect(container.textContent).toContain('La definizione dell’apparecchio è cambiata');
    expect(Array.from(container.querySelectorAll('button')).some(node=>(node.querySelector('.hierarchy-name,.reference-device-name')?.textContent??node.textContent)==='Panel')).toBe(false);
  });
  it('ignores old saved-model replies after a different project device is selected',async()=>{
    const old=deferred<ConfigModelDetail>(),fresh=deferred<ConfigModelDetail>();
    configurationApi.model=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await start();await click('Other device');
    await act(async()=>fresh.resolve(model(5)));await act(async()=>old.resolve(model(4)));
    await click('Mostra pannelli compatibili');
    expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({device:expect.objectContaining({
      configuration:{modelId:5,selectedOptionIds:[51]}})}));
  });
  it('keeps separate saved configurations of the same model and filters by project article codes',async()=>{
    const second={...projectDevice(4,2),bom:[{seq:1,snapshotUuid:'snap',brandMarchio:'ACME',manufacturerCode:'SWITCH-123',
      description:'Sezionatore',quantityPerItem:1,role:'primary',listPriceUnitE4:null,salePriceUnitE4:null}]};
    await mount(rootNode,{...project,configuredItems:[projectDevice(4),second]});await click('Pannelli');
    await click('Pannelli compatibili · Filtra per apparecchio');
    expect(document.querySelectorAll('.reference-device-list button')).toHaveLength(2);
    const search=document.querySelector<HTMLInputElement>('.reference-device-dialog input')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'SWITCH-123');
      search.dispatchEvent(new Event('input',{bubbles:true}));});await flush();
    expect(document.querySelectorAll('.reference-device-list button')).toHaveLength(1);
    await click('Reference device');await click('Mostra pannelli compatibili');
    expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({device:expect.objectContaining({
      configuration:{modelId:4,selectedOptionIds:[42]}})}));
  });
  it('shows an empty project list without offering catalogue devices',async()=>{
    await mount(rootNode,openProject);await click('Pannelli');await click('Pannelli compatibili · Filtra per apparecchio');
    expect(document.body.textContent).toContain('Nessun apparecchio nel progetto');
    expect(button('Mostra pannelli compatibili').disabled).toBe(true);expect(api.referenceDevices).not.toHaveBeenCalled();
  });
  it('drops the applied filter if its saved device is removed or reconfigured',async()=>{
    await apply();await mount(rootNode,{...project,configuredItems:[projectDevice(5)]});
    expect(container.querySelector('.reference-summary')).toBeNull();
    expect(api.designNavigation).toHaveBeenLastCalledWith('support','root-a');
  });
  it('guides the user to choose a carpenteria before selecting a reference',async()=>{
    await act(async()=>reactRoot.render(<StructuralWorkflow project={openProject} api={api} configurationApi={configurationApi}
      root={undefined} onProjectChange={changed} onRootCreated={()=>undefined}/>));await click('Pannelli');
    await click('Pannelli compatibili · Filtra per apparecchio');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Scegli una carpenteria');
    expect(api.compatiblePanels).not.toHaveBeenCalled();
    await click('Scegli carpenteria');
    expect(button('Carpenterie').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('BTicino Carpenterie filter',()=>{
  it('offers only backend-eligible project devices without an existing root, checks configured enclosures and passes the reference to add',async()=>{
    api.enclosureReferenceDevices=vi.fn(async()=>navigation([4]));
    api.compatibleEnclosures=vi.fn(async()=>({navigation:navigation([2]),reference:{ok:true,code:'compatible'}}));
    const device={...projectDevice(4),modelBrandMarchio:'BTI'};
    api.enclosureReferenceDevices=vi.fn(async()=>({...navigation([4]),candidates:[{...model(4),brandMarchio:'BTI'}]}));
    configurationApi.modelByCode=vi.fn(async()=>({...model(4),brandMarchio:'BTI'}));
    await act(async()=>reactRoot.render(<StructuralWorkflow project={{...project,configuredItems:[device,projectDevice(5)]}}
      api={api} configurationApi={configurationApi} root={undefined} onProjectChange={changed} onRootCreated={()=>undefined}/>));await flush();
    await click('Carpenterie compatibili · Filtra per apparecchio');
    expect(document.querySelectorAll('.reference-device-list button')).toHaveLength(1);
    await click('Reference device');await click('Mostra carpenterie compatibili');
    expect(api.compatibleEnclosures).toHaveBeenCalledWith({device:expect.anything()});
    await click('Panel');
    expect(api.compatibleEnclosures).toHaveBeenCalledWith({device:expect.anything(),enclosure:expect.objectContaining({modelId:2})});
    await click('Aggiungi e posiziona carpenteria');
    expect(api.addStructural).toHaveBeenCalledWith(expect.objectContaining({kind:'enclosure',referenceDevice:expect.anything()}));
    expect(api.checkPanelReference).not.toHaveBeenCalled();
  });
});

it('continues the Pannelli filter after the guided creation of its first carpenteria',async()=>{
  const initial:ProjectDocumentView={...project,physicalNodes:[]};
  const added={...project,physicalNodes:[rootNode]};api.addStructural=vi.fn(async()=>added);
  function Guided(){
    const [view,setView]=useState(initial),[focus,setFocus]=useState<string|null>(null);
    const root=view.physicalNodes.find(node=>node.uuid===focus);
    return <StructuralWorkflow project={view} api={api} configurationApi={configurationApi} root={root}
      panelFocusUuid={focus} onFocusRoot={setFocus} onRootCreated={setFocus} onProjectChange={setView}/>;
  }
  await act(async()=>reactRoot.render(<Guided/>));await flush();await click('Pannelli');
  await click('Pannelli compatibili · Filtra per apparecchio');await click('Scegli carpenteria');
  await click('Panel');await click('Aggiungi e posiziona carpenteria');
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Pannelli compatibili');
  expect(api.compatiblePanels).not.toHaveBeenCalled();
  await click('Reference device');await click('Mostra pannelli compatibili');
  expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({parentUuid:'root-a'}));
});
