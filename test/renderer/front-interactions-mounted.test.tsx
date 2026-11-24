// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { frontArtworkKey } from "../../src/renderer/project/useFrontAssets.js";
import type { ProjectDocumentView, ProjectPhysicalNode, ProjectPlacementTarget, ProjectConfiguredItem } from "../../src/shared/project.js";
import type { ConfigModelDetail } from "../../src/shared/configuration.js";
import { fakeProjectApi, fakeConfigurationApi, openProject } from "./fake-api.js";
import { frontProject, frontAssets } from "../helpers/front-project.js";

function fixture(multiple=false):ProjectDocumentView {
  const configuredItems=frontProject.configuredItems.map(item=>({...item,modelCode:item.uuid,modelBrandMarchio:'TEST',
    modelDefinitionFingerprint:'definition',configFingerprint:item.uuid,configStatus:'complete',configLabel:item.uuid,
    selections:[],demands:[],zones:[],slots:[],constraints:[],exclusions:[],commercialContribution:'none'} as ProjectConfiguredItem));
  const walk=(node:ProjectPhysicalNode,parentUuid:string|null=null):ProjectPhysicalNode=>({...node,parentUuid,
    rootXMm:node.xMm,rootYMm:node.yMm,sortOrder:0,positionIssue:null,children:node.children.map(child=>walk(child,node.uuid))});
  return {...openProject,annotations:[],configuredItems,physicalNodes:frontProject.physicalNodes.slice(0,multiple?2:1).map(node=>walk(node)),
    lines:configuredItems.map(item=>({uuid:`line-${item.uuid}`,itemUuid:item.uuid,lineType:'item',quantity:1})) as unknown as ProjectDocumentView['lines']};
}
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const emptyNavigation={status:'ready' as const,candidates:[],nodes:[],staleImportIds:[],contextDataUnavailable:0};
let host:HTMLDivElement,root:Root,api:ReturnType<typeof fakeProjectApi>;
let frames:Map<number,FrameRequestCallback>,sequence:number;
const configApi={...fakeConfigurationApi(),modelByCode:async()=>({id:4} as ConfigModelDetail),model:async()=>({
  id:4,code:'device',name:'Device',kind:'device',active:true,obsolete:false,definitionFingerprint:'definition',axes:[]
} as unknown as ConfigModelDetail)};
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('PointerEvent',MouseEvent);
  frames=new Map();sequence=0;
  vi.stubGlobal('requestAnimationFrame',vi.fn((callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;}));
  vi.stubGlobal('cancelAnimationFrame',vi.fn((id:number)=>frames.delete(id)));
  vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:900,height:600,right:900,bottom:600,x:0,y:0,toJSON(){}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api={...fakeProjectApi(),frontAssets:vi.fn(async()=>frontAssets),designNavigation:vi.fn(async()=>emptyNavigation),
    compatiblePanels:vi.fn(async()=>({navigation:emptyNavigation,reference:{ok:true,code:'compatible'}})),
    placementTargets:vi.fn(async()=>({targets:[],diagnostics:[]})),moveNode:vi.fn()};
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
async function mount(project=fixture(),section:'support'|'enclosure'='support'){
  await act(async()=>root.render(<ProgettazioneScreen project={project} api={api} configurationApi={configApi} section={section} onSectionChange={()=>{}} onProjectChange={()=>{}}/>));await flush();
}
function button(label:string){const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label);if(!b)throw Error(`Missing ${label}`);return b;}
async function click(label:string){await act(async()=>button(label).click());await flush();}
async function pointer(target:EventTarget,type:string,x:number,y:number){await act(async()=>target.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y})));await flush();}
async function frame(){await act(async()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb(16));});await flush();}
function point(x:number,y:number){const [vx,vy,w,h]=host.querySelector('svg.front-drawing')!.getAttribute('viewBox')!.split(' ').map(Number) as [number,number,number,number];
  const scale=Math.min(900/w,600/h);return {x:(900-w*scale)/2+(x-vx)*scale,y:(600-h*scale)/2+(y-vy)*scale};}
async function applyReference(){await click('device');await click('Mostra pannelli compatibili');}

it('offers Duplica beside Rimuovi posizione and disables it after the remaining spot is taken',async()=>{
  const before=fixture();
  const after=fixture();
  const panel=after.physicalNodes[0]!.children[0]!;
  panel.children.push({...panel.children[0]!,uuid:'device-copy',xMm:190,startUnits:2});
  const check=deferred<boolean>();
  api.canDuplicatePlacedItem=vi.fn().mockReturnValueOnce(check.promise).mockResolvedValue(false);
  api.duplicatePlacedItem=vi.fn(async()=>after);
  function Harness(){
    const [project,setProject]=useState(before);
    return <ProgettazioneScreen project={project} api={api} onProjectChange={setProject}/>;
  }
  await act(async()=>root.render(<Harness/>));
  expect(host.querySelector('.properties-placement-actions')).toBeNull();
  const device=host.querySelector('[data-node-uuid=device]')!;
  await pointer(device,'pointerdown',190,180);
  await pointer(device,'pointerup',190,180);
  expect(api.canDuplicatePlacedItem).toHaveBeenCalledWith('device');
  expect([...host.querySelectorAll('.properties-placement-actions button')].map(node=>node.textContent))
    .toEqual(['Rimuovi posizione','Duplica']);
  expect(button('Duplica').disabled).toBe(true);
  await act(async()=>check.resolve(true));
  expect(button('Duplica').disabled).toBe(false);
  await click('Duplica');
  expect(api.duplicatePlacedItem).toHaveBeenCalledExactlyOnceWith('device');
  expect(host.querySelector('[data-node-uuid=device-copy]')).not.toBeNull();
  expect(button('Duplica').disabled).toBe(true);
  await click('Duplica');
  expect(api.duplicatePlacedItem).toHaveBeenCalledOnce();
});

it('keeps text boxes visible and editable when the last carpenteria is removed and added back',async()=>{
  const original:ProjectDocumentView={...fixture(),annotations:[
    {uuid:'left-note',text:'Ingresso',xMm:-400,yMm:40,widthMm:120,heightMm:60,fontSizeMm:12},
    {uuid:'right-note',text:'Uscita',xMm:1200,yMm:620,widthMm:180,heightMm:60,fontSizeMm:12},
  ]};
  const withoutRoot={...original,physicalNodes:[]};
  api.removePhysicalRoot=vi.fn(async()=>withoutRoot);
  let adopt!: (project:ProjectDocumentView)=>void;
  function Harness(){
    const [project,setProject]=useState(original);
    adopt=setProject;
    return <ProgettazioneScreen project={project} api={api} onProjectChange={setProject}/>;
  }
  await act(async()=>root.render(<Harness/>));
  const note=(uuid:string)=>host.querySelector(`[data-annotation-uuid="${uuid}"]`)!;
  const rectangles=()=>original.annotations.map(({uuid})=>{
    const box=note(uuid).querySelector('.front-note-box')!;
    return ['x','y','width','height'].map(name=>Number(box.getAttribute(name)));
  });
  const initialRectangles=rectangles();
  const zoom=host.querySelector<HTMLButtonElement>('[aria-label="Ingrandisci Fronte Quadro"]')!;
  await act(async()=>zoom.click());
  const enclosure=host.querySelector('[data-node-uuid=case]')!;
  await pointer(enclosure,'pointerdown',200,200);
  await pointer(enclosure,'pointerup',200,200);
  await click('Rimuovi carpenteria…');
  await act(async()=>document.querySelector<HTMLButtonElement>('.remove-root-choice')!.click());
  expect(api.removePhysicalRoot).toHaveBeenCalledWith('case','keep-contents');
  expect(host.querySelector('[data-node-uuid=case]')).toBeNull();
  expect(host.querySelector('.front-empty')).toBeNull();
  expect(rectangles()).toEqual(initialRectangles);
  expect(note('left-note').textContent).toContain('Ingresso');
  expect(note('right-note').textContent).toContain('Uscita');
  expect(host.querySelector('.front-zoom')?.textContent).toBe('100%');
  expect(zoom.disabled).toBe(false);
  const drawing=host.querySelector('svg.front-drawing')!;
  const [x,y,width,height]=drawing.getAttribute('viewBox')!.split(' ').map(Number);
  expect(x).toBeLessThanOrEqual(-400);
  expect(y).toBeLessThanOrEqual(40);
  expect(x!+width!).toBeGreaterThanOrEqual(1380);
  expect(y!+height!).toBeGreaterThanOrEqual(680);
  const centre=point(-340,70);
  await pointer(note('left-note'),'pointerdown',centre.x,centre.y);
  await pointer(window,'pointerup',centre.x,centre.y);
  await act(async()=>{drawing.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
  expect(note('left-note').querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Ingresso');

  await act(async()=>adopt(original));
  expect(host.querySelector('[data-node-uuid=case]')).not.toBeNull();
  expect(rectangles()).toEqual(initialRectangles);
  await act(async()=>adopt({...withoutRoot,annotations:[]}));
  expect(host.querySelector('.front-empty')?.textContent).toContain('Aggiungi una carpenteria');
});

describe('Pannelli carpenteria context',()=>{
  it('automatically combines the sole carpenteria and chosen device',async()=>{
    await mount();await click('Pannelli compatibili · Filtra per apparecchio');await applyReference();
    expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({parentUuid:'case'}));
  });
  it('asks for a carpenteria when several exist without focus, then continues to the device chooser',async()=>{
    await mount(fixture(true));await click('Pannelli compatibili · Filtra per apparecchio');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Scegli una carpenteria');
    await act(async()=>document.querySelector<HTMLButtonElement>('[role=dialog] .reference-device-list button:last-child')!.click());await flush();
    await applyReference();expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({parentUuid:'case2'}));
  });
  it('uses the carpenteria clicked in the drawing and resets a filter when that focus changes',async()=>{
    await mount(fixture(true));
    await pointer(host.querySelector('[data-node-uuid=case2]')!,'pointerdown',200,200);
    await pointer(host.querySelector('[data-node-uuid=case2]')!,'pointerup',200,200);
    await click('Pannelli compatibili · Filtra per apparecchio');await applyReference();
    expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({parentUuid:'case2'}));
    await pointer(host.querySelector('[data-node-uuid=case]')!,'pointerdown',200,200);
    await pointer(host.querySelector('[data-node-uuid=case]')!,'pointerup',200,200);
    expect(host.querySelector('.reference-summary')).toBeNull();
    await click('Pannelli compatibili · Filtra per apparecchio');await applyReference();
    expect(api.compatiblePanels).toHaveBeenLastCalledWith(expect.objectContaining({parentUuid:'case'}));
  });
});

describe('movement continuity and artwork reuse',()=>{
  const target:ProjectPlacementTarget={action:'moveNode',nodeUuid:'device',input:{itemUuid:'device',parentUuid:'panel',zoneNo:0,startUnits:1,viewCode:'front'},
    subject:{xMm:180,yMm:180,widthMm:54,heightMm:45},affected:[]};
  async function start(){
    api.placementTargets=vi.fn(async()=>({targets:[target],diagnostics:[]}));
    await mount();await click('Libera');await pointer(host.querySelector('[data-node-uuid=device]')!,'pointerdown',10,10);
    const p=point(200,200);return p;
  }
  it('coalesces pointer updates and keeps the exact vector preview until a delayed move finishes',async()=>{
    const pending=deferred<ProjectDocumentView>();api.moveNode=vi.fn(()=>pending.promise);
    const p=await start();expect(host.querySelector('.drag-ghost')).toBeNull();
    await act(async()=>{for(let i=0;i<40;i++)window.dispatchEvent(new MouseEvent('pointermove',{clientX:p.x,clientY:p.y}));});
    expect(frames.size).toBe(1);await frame();
    expect(host.querySelector('.front-target-preview path')).not.toBeNull();
    await pointer(window,'pointerup',p.x,p.y);
    expect(api.moveNode).toHaveBeenCalledOnce();expect(host.querySelector('.front-target-preview path')).not.toBeNull();
    expect(host.querySelector('.front-dragging')).not.toBeNull();
    await act(async()=>pending.resolve(fixture()));
    expect(host.querySelector('.front-target-hover')).toBeNull();expect(host.querySelector('.front-dragging')).toBeNull();
    expect(api.frontAssets).toHaveBeenCalledTimes(1);
  });
  it('restores the original drawing on a refused move and clears scheduled updates on cancellation',async()=>{
    const pending=deferred<ProjectDocumentView>();api.moveNode=vi.fn(()=>pending.promise);
    const p=await start();await pointer(window,'pointermove',p.x,p.y);await frame();await pointer(window,'pointerup',p.x,p.y);
    await act(async()=>pending.reject(new Error('refused')));
    expect(host.textContent).toContain('refused');expect(host.querySelector('.front-target-hover')).toBeNull();
    expect(host.querySelector('[data-node-uuid=device] path')).not.toBeNull();
    await pointer(host.querySelector('[data-node-uuid=device]')!,'pointerdown',10,10);
    await pointer(window,'pointermove',p.x,p.y);
    await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(frames.size).toBe(0);expect(api.moveNode).toHaveBeenCalledTimes(1);expect(host.querySelector('.drag-ghost')).toBeNull();
  });
  it('does not reload artwork for coordinate changes, but reloads changed artwork identities',async()=>{
    const first=fixture();await mount(first);
    const changed=fixture();changed.physicalNodes[0]!.children[0]!.children[0]!.xMm=190;
    expect(frontArtworkKey(changed)).toBe(frontArtworkKey(first));await mount(changed);
    expect(api.frontAssets).toHaveBeenCalledTimes(1);
    const newer={...changed,configuredItems:changed.configuredItems.map(item=>({...item,views:item.views.map(view=>({...view,assetSha256:'new-hash'}))}))};
    await mount(newer);expect(api.frontAssets).toHaveBeenCalledTimes(2);
  });
});

it('keeps loaded vectors on refresh failure, retries on the next edit, and isolates project switches',async()=>{
  const first=fixture();await mount(first);
  const newer={...first,configuredItems:first.configuredItems.map(item=>({...item,views:item.views.map(view=>({...view,assetSha256:'new'}))}))};
  vi.mocked(api.frontAssets).mockRejectedValueOnce(new Error('offline'));
  await mount(newer);expect(host.querySelector('[data-node-uuid=device] path')).not.toBeNull();
  await mount({...newer,revision:10});expect(api.frontAssets).toHaveBeenCalledTimes(3);
  const pending=deferred<typeof frontAssets>();vi.mocked(api.frontAssets).mockReturnValueOnce(pending.promise);
  await mount({...newer,metadata:{...newer.metadata,uuid:'other-project'}});
  expect(host.querySelector('[data-node-uuid=device] path')).toBeNull();
  await act(async()=>pending.resolve(frontAssets));expect(host.querySelector('[data-node-uuid=device] path')).not.toBeNull();
});


describe('information from right-side list selections',()=>{
  function pool(kind:'device'|'support') { return host.querySelector<HTMLButtonElement>(`.pool-item[data-pool-kind=${kind}]`)!; }
  function properties() { return host.querySelector('.design-properties')!; }
  function unplaced() {
    const project=fixture();
    return {...project,physicalNodes:project.physicalNodes.map(node=>({...node,children:[]}))};
  }
  it.each(['enclosure','support'] as const)('shows unplaced device and panel information in %s without dropping',async(section)=>{
    const project=unplaced();
    api.placeChild=vi.fn();api.placeStructuralItem=vi.fn();
    await mount(project,section);
    await pointer(pool('device'),'pointerdown',10,10);
    await pointer(window,'pointerup',10,10);
    expect(properties().querySelector('.properties-body')?.getAttribute('data-kind')).toBe('device');
    expect(properties().textContent).toContain('TEST · C16');
    expect(properties().textContent).toContain('Posizionati 0 di 1');
    expect(properties().textContent).toContain('Da posizionare 1');
    expect(properties().textContent).toContain('54 × 45');
    expect(properties().querySelector('.properties-thumb path')).not.toBeNull();
    expect(pool('device').getAttribute('aria-pressed')).toBe('true');
    expect(properties().querySelector('button')).toBeNull();
    await act(async()=>pool('support').click());
    expect(properties().querySelector('.properties-body')?.getAttribute('data-kind')).toBe('support');
    expect(pool('device').getAttribute('aria-pressed')).toBe('false');
    expect(pool('support').getAttribute('aria-pressed')).toBe('true');
    expect(properties().textContent).toContain('500 × 200');
    await act(async()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})));
    expect(api.placeChild).not.toHaveBeenCalled();expect(api.placeStructuralItem).not.toHaveBeenCalled();
    expect(project.physicalNodes[0]!.children).toEqual([]);
  });
  it('hides fully placed rows and shows them again when units return to the pool',async()=>{
    await mount(unplaced());
    await act(async()=>pool('device').click());
    expect(properties().textContent).toContain('Da posizionare 1');
    await mount();
    expect(pool('device')).toBeNull();
    expect(pool('support')).toBeNull();
    expect(properties().textContent).toContain('Nessun oggetto selezionato');
    expect(host.querySelector('.design-pool')?.textContent).toContain('Nessun apparecchio da posizionare.');
    expect(host.querySelector('.design-pool')?.textContent).toContain('Nessun pannello da posizionare.');
    await pointer(host.querySelector('[data-node-uuid=device]')!,'pointerdown',10,10);
    await pointer(host.querySelector('[data-node-uuid=device]')!,'pointerup',10,10);
    expect(properties().textContent).toContain('Rimuovi posizione');
    const project=fixture();
    project.physicalNodes[0]!.children[0]!.children=[];
    await mount(project);
    expect(pool('device').dataset.draggable).toBe('true');
    expect(pool('support')).toBeNull();
    expect(pool('device').getAttribute('aria-pressed')).toBe('false');
    await mount(unplaced());
    expect(pool('support').dataset.draggable).toBe('true');
  });
  it('keeps panel drag-and-drop working after list inspection',async()=>{
    const project=unplaced();
    const target:ProjectPlacementTarget={action:'placeChild',input:{itemUuid:'panel',parentUuid:'case',zoneNo:0,startUnits:0,viewCode:'front'},
      subject:{xMm:180,yMm:180,widthMm:54,heightMm:45},affected:[]};
    api.placementTargets=vi.fn(async()=>({targets:[target],diagnostics:[]}));
    api.placeStructuralItem=vi.fn(async()=>project);
    await mount(project);
    await click('Libera');
    await pointer(pool('support'),'pointerdown',10,10);
    expect(properties().textContent).toContain('Da posizionare 1');
    const p=point(200,200);
    await pointer(window,'pointermove',p.x,p.y);await frame();
    expect(host.querySelector('.drag-ghost')).not.toBeNull();
    await pointer(window,'pointerup',p.x,p.y);
    expect(api.placeStructuralItem).toHaveBeenCalledExactlyOnceWith({action:'placeChild',input:target.input});
  });
  it('uses Auto for pool double-clicks and drops on the drawing, and returns to Libera',async()=>{
    const project=unplaced();
    api.autoPlaceItem=vi.fn(async()=>({...project,autoPlacement:'placed' as const}));
    await mount(project);
    expect(button('Libera').getAttribute('aria-pressed')).toBe('false');
    expect(button('Auto').getAttribute('aria-pressed')).toBe('true');
    await act(async()=>{pool('device').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));});
    expect(api.autoPlaceItem).toHaveBeenLastCalledWith({itemUuid:'device'});
    await pointer(pool('support'),'pointerdown',10,10);
    await pointer(window,'pointerup',950,20);
    expect(api.autoPlaceItem).toHaveBeenCalledTimes(1);
    await pointer(pool('support'),'pointerdown',10,10);
    await pointer(window,'pointerup',800,400);
    expect(api.autoPlaceItem).toHaveBeenLastCalledWith({itemUuid:'panel'});
    expect(api.placementTargets).not.toHaveBeenCalled();
    await click('Libera');
    await pointer(pool('support'),'pointerdown',10,10);
    await pointer(window,'pointerup',800,400);
    expect(api.placementTargets).toHaveBeenCalledWith({itemUuid:'panel',parentUuid:'case'});
    expect(api.autoPlaceItem).toHaveBeenCalledTimes(2);
  });
  it('clears list inspection on Escape and isolates it from another document',async()=>{
    await mount(unplaced());await act(async()=>pool('device').click());
    await act(async()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(properties().textContent).toContain('Nessun oggetto selezionato');
    await act(async()=>pool('device').click());
    const next=unplaced();
    await mount({...next,metadata:{...next.metadata,uuid:'another-document'}});
    expect(properties().textContent).toContain('Nessun oggetto selezionato');
  });
});
