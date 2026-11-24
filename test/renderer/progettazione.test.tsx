/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FronteQuadro, ProgettazioneScreen, updateFrontViewport } from "../../src/renderer/project/ProgettazioneScreen.js";
import { availableSlotNumbers, defaultPlacementView, placementInputForSelection, positionStep,
  submitPlacement, submitUnplacement, devicePool, structuralPool, supportsInRoot } from "../../src/renderer/project/placement-workflow.js";
import { articleCode, designStatusSegments, frontLabel, occupancyText, targetStartText, unitsToPlace
  } from "../../src/renderer/project/design-presentation.js";
import { drawingScale, frontGeometry, frontLabelSize, MIN_LABEL_PX } from "../../src/renderer/project/front-geometry.js";
import { PhysicalTree } from "../../src/renderer/project/PhysicalTree.js";
import { PhysicalPool } from "../../src/renderer/project/PhysicalPool.js";
import { StatusStateContext, type StatusState } from "../../src/renderer/app/status.js";
import { StatusBar } from "../../src/renderer/app/StatusBar.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectPlacementTarget } from "../../src/shared/project.js";
import { fakeConfigurationApi } from "./fake-api.js";

const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string,
  width: number, height: number, zones: ProjectConfiguredItem["zones"] = []): ProjectConfiguredItem => ({
  uuid, modelKind: kind, modelName: code, modelCode: code, modelBrandMarchio: "TEST",
  configLabel: `${code} configurato`, physStatus: "resolved",
  bom: [{ role: "primary", manufacturerCode: `${code}-ARTICLE` }],
  views: [{ viewCode: "front", widthMm: width, heightMm: height }], zones,
} as unknown as ProjectConfiguredItem);

const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device",
  xMm: number, yMm: number, children: ProjectPhysicalNode[] = []): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm, yMm, viewCode: "front", children,
  parentUuid: null, zoneNo: null, startUnits: null, slotNo: null, rootXMm: xMm,
  rootYMm: yMm, sortOrder: 0, positionIssue: null,
});

const enclosureZone = [{ zoneNo: 0, layout: "stack", capacityKindLabel: "altezza" }] as unknown as ProjectConfiguredItem["zones"];
const supportZone = [{ zoneNo: 1, layout: "linear", capacityKindLabel: "moduli" }] as unknown as ProjectConfiguredItem["zones"];
const enclosure = item("box", "enclosure", "BOX-A", 400, 600, enclosureZone);
const support = item("tray", "support", "TRAY-B", 200, 100, supportZone);
const device = item("switch", "device", "SWITCH-C", 20, 40);
const project = (physicalNodes: ProjectPhysicalNode[] = []): ProjectDocumentView => ({
  configuredItems: [enclosure, support, device], physicalNodes,
  lines: ["box", "tray", "switch"].map(itemUuid => ({ itemUuid, quantity: 1 })),
} as unknown as ProjectDocumentView);
const api = {} as ProjectApi;

describe("Progettazione renderer", () => {
  it("zooms only the Fronte Quadro viewBox and fits the selected enclosure again",()=>{
    const root=node("root","box","enclosure",40,70,[node("panel","tray","support",136.5,123)]);
    const withKey={...enclosure,views:[{...enclosure.views[0]!,assetKey:"sample-case"}]};
    const overlay=(hover:boolean)=>({parents:["panel"],subject:{origin:"pool" as const,kind:"device" as const,item:device},
      hover:hover?{parentUuid:"panel",target:{action:"insertPackedChild" as const,index:0,
        input:{itemUuid:"switch",parentUuid:"panel",zoneNo:1,viewCode:"front"},
        subject:{xMm:140,yMm:130,widthMm:20,heightMm:40},affected:[]}}:null});
    const render=(zoom:number)=>renderToStaticMarkup(<FronteQuadro roots={[root]} items={[withKey,support]}
      assets={{"sample-case":{viewBox:[-2,-3,60,100],strokeWidth:.08,strokes:"M 0 0 L 60 100",fills:""}}}
      overlay={overlay(true)} zoom={zoom}/>);
    const viewBox=(html:string)=>html.match(/<svg class="front-drawing"[^>]*viewBox="([^"]+)"/)![1]!
      .split(" ").map(Number);
    const fitted=render(1);
    const zoomedIn=render(updateFrontViewport({zoom:1},"in").zoom);
    const zoomedOut=render(updateFrontViewport({zoom:1},"out").zoom);
    expect(viewBox(zoomedIn)[2]).toBeLessThan(viewBox(fitted)[2]!);
    expect(viewBox(zoomedOut)[2]).toBeGreaterThan(viewBox(fitted)[2]!);
    expect(viewBox(zoomedIn)[3]).toBeLessThan(viewBox(fitted)[3]!);
    expect(zoomedIn.slice(zoomedIn.indexOf(">")+1)).toBe(fitted.slice(fitted.indexOf(">")+1));
    expect(zoomedIn).toContain('class="front-vector"');
    expect(zoomedIn).toContain('class="front-target-subject" x="140" y="130" width="20" height="40"');
    const fittedAgain=updateFrontViewport({zoom:1.25},"fit");
    expect(render(fittedAgain.zoom)).toBe(fitted);
    // Zoom is global to the combined drawing: it is not keyed by, and does not reset with, the focused root.
    expect(updateFrontViewport({zoom:2},"out").zoom).toBeCloseTo(1.6);
    expect(updateFrontViewport({zoom:4},"in").zoom).toBe(4);
    expect(updateFrontViewport({zoom:.5},"out").zoom).toBe(.5);
  });

  it("shows drawing-specific controls without application zoom APIs or settings",()=>{
    const html=renderToStaticMarkup(<ProgettazioneScreen project={project([node("root","box","enclosure",0,0)])}
      api={api} onProjectChange={()=>undefined}/>);
    expect(html).toContain('aria-label="Zoom Fronte Quadro"');
    expect(html).toContain('aria-label="Ingrandisci Fronte Quadro"');
    expect(html).toContain('aria-label="Riduci Fronte Quadro"');
    expect(html).toContain("Adatta vista");
    expect(html).toContain('aria-label="Esporta Fronte Quadro PDF"');
    expect(html).toContain("100%");
    const renderer=readFileSync("src/renderer/project/ProgettazioneScreen.tsx","utf8");
    expect(renderer).not.toMatch(/setZoomLevel|webContents|ui\.zoom_level|app_setting/);
  });

  it("draws an available vector at M1 node coordinates and selected view dimensions, then falls back per node", () => {
    const root={...node("root","box","enclosure",40,70,[node("child","tray","support",136.5,123)]),
      viewCode:"front"};
    const withKey={...enclosure,views:[{...enclosure.views[0]!,assetKey:"sample-case"}]};
    const svg=renderToStaticMarkup(<FronteQuadro roots={[root]} items={[withKey,support]}
      assets={{"sample-case":{viewBox:[-2,-3,60,100],strokeWidth:0.08,
        strokes:"M 0 0 L 60 100",fills:""}}} />);
    expect(svg).toContain('class="front-vector" x="40" y="70" width="400" height="600"');
    expect(svg).toContain('viewBox="-2 -3 60 100"');
    expect(svg).toContain('d="M 0 0 L 60 100"');
    expect(svg).toContain('<rect x="136.5" y="123" width="200" height="100"');
    expect(svg).not.toContain('<rect x="40" y="70"');
  });
  it("maps a root selection to millimetre coordinates", () => {
    expect(placementInputForSelection({ itemUuid:"box", modelKind:"enclosure", viewCode:"front",
      rootXMm:120, rootYMm:80 })).toEqual({ itemUuid:"box", viewCode:"front", rootXMm:120, rootYMm:80 });
  });

  it("converts displayed linear units to raw units, including fractional displayed positions", () => {
    const zone = { ...supportZone[0]!, displayDivisor:2 };
    const base = { itemUuid:"switch", modelKind:"device", viewCode:"front", parentUuid:"panel", zone };
    expect(placementInputForSelection({ ...base, position:3 })?.startUnits).toBe(6);
    expect(placementInputForSelection({ ...base, position:0.5 })?.startUnits).toBe(1);
    expect(positionStep(zone)).toBe(0.5);
    const missingDivisor = { ...zone, displayDivisor:null };
    expect(placementInputForSelection({ ...base, zone:missingDivisor, position:0.5 })?.startUnits).toBe(0.5);
    expect(positionStep(missingDivisor)).toBe("any");
  });

  it("keeps stack positions in millimetres and reflects the snapshot pitch", () => {
    const zone = { ...enclosureZone[0]!, pitchMm:25 };
    expect(placementInputForSelection({ itemUuid:"tray", modelKind:"support", viewCode:"front",
      parentUuid:"root", zone, position:50 })?.startUnits).toBe(50);
    expect(positionStep(zone)).toBe(25);
  });

  it("uses snapshotted free slot numbers and sends slotNo instead of startUnits", () => {
    const zone = { ...enclosureZone[0]!, layout:"slots", zoneNo:3 };
    const parentItem = { ...enclosure, slots:[{zoneNo:3,slotNo:4,xMm:10,yMm:20},
      {zoneNo:3,slotNo:9,xMm:30,yMm:40}] } as ProjectConfiguredItem;
    const parent = { ...node("root","box","enclosure",0,0), children:[
      { ...node("occupied","switch","device",0,0), zoneNo:3, slotNo:4 },
    ] };
    expect(availableSlotNumbers(parentItem,3,parent)).toEqual([9]);
    expect(placementInputForSelection({itemUuid:"switch",modelKind:"device",viewCode:"front",
      parentUuid:"root",zone,slotNo:9,position:0})).toEqual({itemUuid:"switch",parentUuid:"root",
        zoneNo:3,viewCode:"front",slotNo:9});
  });

  it("defaults to the zone-required view when present, otherwise the first snapshot view", () => {
    const views = [{...enclosure.views[0]!,viewCode:"front"},
      {...enclosure.views[0]!,viewCode:"front_alt1"}];
    const zone = { ...supportZone[0]!, requiredViewCode:"front_alt1" };
    expect(defaultPlacementView(views,zone,"")).toBe("front_alt1");
    expect(defaultPlacementView(views,zone,"front")).toBe("front");
    expect(defaultPlacementView(views,{ ...zone, requiredViewCode:"missing" },"")).toBe("front");
  });

  it("is empty without an open project", () => {
    const html = renderToStaticMarkup(<ProgettazioneScreen project={null} api={api}
      onProjectChange={() => undefined} />);
    expect(html).toContain("Apri o crea un progetto");
    expect(html).not.toContain("Articoli fisici configurati");
  });

  it("shows Carpenterie and Pannelli structural entry with selected enclosure context",()=>{
    const empty=renderToStaticMarkup(<ProgettazioneScreen project={project()} api={api}
      configurationApi={fakeConfigurationApi()} onProjectChange={()=>undefined}/>);
    expect(empty).toContain("Carpenterie");
    expect(empty).toContain("Pannelli");
    const populated=renderToStaticMarkup(<ProgettazioneScreen
      project={project([node("root-a","box","enclosure",0,0),node("root-b","box","enclosure",700,0)])}
      api={api} configurationApi={fakeConfigurationApi()} onProjectChange={()=>undefined}/>);
    expect(populated).toContain('<h3 id="design-structure-title">Struttura</h3>');
    expect(populated).not.toContain("Apparecchi del progetto");
    expect(populated).not.toContain("Vai a Configura");
    expect(populated.match(/<h3 id="design-pool-title">Da posizionare<\/h3>/g)).toHaveLength(1);
    // R-17c: no Carpenteria selector anywhere (every Carpenteria is drawn; the Albero fisico sets the focus).
    expect(populated).not.toContain("<select");
    expect(populated).not.toContain("front-root");
    expect(populated).not.toContain("Involucro selezionato");
    expect(populated.indexOf('class="design-structure"')).toBeLessThan(populated.indexOf('class="design-front"'));
    expect(populated.indexOf('class="design-front"')).toBeLessThan(populated.indexOf('class="design-controls"'));
    expect(populated.indexOf("design-structure-title")).toBeLessThan(populated.indexOf("design-front-title"));
    expect(populated.indexOf("design-front-title")).toBeLessThan(populated.indexOf("design-pool-title"));
  });

  it("docks Struttura and Albero fisico left, a dominant Fronte Quadro and Da posizionare with Proprietà right", () => {
    const root = node("root", "box", "enclosure", 0, 0, [
      node("panel", "tray", "support", 10, 20, [node("dev", "switch", "device", 20, 30)])]);
    const html = renderToStaticMarkup(<ProgettazioneScreen project={project([root])} api={api}
      configurationApi={fakeConfigurationApi()} onProjectChange={() => undefined} />);
    const titles = ["design-structure-title", "design-tree-title", "design-front-title", "design-pool-title",
      "design-properties-title"].map(id => html.indexOf(`id="${id}"`));
    expect(titles.every(index => index >= 0)).toBe(true);
    expect(titles).toEqual([...titles].sort((a, b) => a - b));
    // No page heading: the workspace is panels and the drawing.
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("Posiziona gli articoli già configurati");
    // The drawing sits in its own canvas wrapper and carries no framing of its own.
    expect(html).toMatch(/<div class="front-canvas"><svg class="front-drawing" role="img"[^>]*viewBox="[^"]+">/);
    expect(html.match(/<svg class="front-drawing"[^>]*>/)![0]).not.toMatch(/style=|transform=|padding|border/);
    // Albero fisico: counts, kind, article code and coordinates. "Rimuovi posizione" moved to Proprietà (R-17c).
    expect(html).toContain('<span class="dock-count">1 pannello · 1 apparecchio</span>');
    expect(html).toMatch(/data-kind="device"[^>]*>.*?<span class="code">SWITCH-C-ARTICLE<\/span>/);
    expect(html).toContain('<small class="tree-coordinates" title="Posizione x, y: 20, 30 mm">20, 30</small>');
    expect(html).not.toContain("Rimuovi posizione");
    // Proprietà keeps its place and starts empty: nothing is selected until the user chooses an object.
    expect(html).toContain("Nessun oggetto selezionato.");
    expect(html).not.toMatch(/aria-selected="true"|front-selected/);
    // Compact toolbar: labels toggle and zoom; no page-level messages.
    expect(html).toMatch(/aria-pressed="true" aria-label="Etichette"/);
    expect(html).not.toContain("design-message");
  });

  it("shows configured physical items, model and article identity, and placement availability", () => {
    const base = project([node("root", "box", "enclosure", 0, 0)]);
    const threeUnits = {...base,lines:base.lines.map(line => line.itemUuid === "box" ?
      {...line,quantity:3} : line)};
    const html = renderToStaticMarkup(<ProgettazioneScreen project={threeUnits}
      api={api} onProjectChange={() => undefined} />);
    expect(html).toContain("SWITCH-C-ARTICLE");
    expect(html).toContain("1 disponibile su 1");
    expect(html).toContain('<span class="pool-figure">1<span aria-hidden="true">/1</span></span>');
    expect(html).not.toContain("Q 1 · P 0");
    expect(html).toMatch(/data-pool-kind="device" data-draggable="true"[^>]*>.*?<strong>SWITCH-C/);
    expect(html).toContain("TRAY-B-ARTICLE");
    // R-17c: physical actions live in Proprietà and need a selection; the outliner has none.
    expect(html).not.toContain("Rimuovi posizione");
  });

  it("shows the available configuration when a same-named variant is fully placed",()=>{
    const variant={...device,uuid:"switch-variant",configLabel:"Taratura B"};
    const root=node("root","box","enclosure",0,0,[node("panel","tray","support",10,20,[
      node("placed-1","switch","device",20,30),node("placed-2","switch","device",40,30)])]);
    const base=project([root]);
    const view={...base,configuredItems:[...base.configuredItems,variant],lines:[
      ...base.lines.filter(line=>line.itemUuid!=="switch"),
      {itemUuid:"switch",quantity:2},{itemUuid:"switch-variant",quantity:1}] } as ProjectDocumentView;
    expect(devicePool(view).map(entry=>[entry.item.uuid,entry.quantity,entry.placed,entry.available]))
      .toEqual([["switch",2,2,0],["switch-variant",1,0,1]]);
    const html=renderToStaticMarkup(<ProgettazioneScreen project={view} api={api}
      onProjectChange={()=>undefined}/>);
    expect(html.match(/data-pool-kind="device"/g)).toHaveLength(1);
    expect(html).toMatch(/data-pool-kind="device" data-draggable="true"[^>]*>.*?<strong>SWITCH-C/);
    expect(html).not.toContain("data-full-text-always");
    expect(html).toContain("Rif. switch-v");
    expect(html).not.toContain("Taratura B");
  });

  it("derives the structural pool from supports only, with Q, P and Q−P",()=>{
    const otherSupport=item("plate","support","PLATE-D",200,100);
    const root=node("root","box","enclosure",0,0,[node("panel","tray","support",10,20)]);
    const base=project([root]);
    const view={...base,configuredItems:[...base.configuredItems,otherSupport],lines:[
      ...base.lines.filter(line=>line.itemUuid!=="tray"),
      {itemUuid:"tray",quantity:3},{itemUuid:"plate",quantity:1}]} as ProjectDocumentView;
    expect(structuralPool(view).map(entry=>[entry.item.uuid,entry.quantity,entry.placed,entry.available]))
      .toEqual([["tray",3,1,2],["plate",1,0,1]]);
    expect(devicePool(view).map(entry=>entry.item.uuid)).toEqual(["switch"]);
    expect(structuralPool({...view,configuredItems:[enclosure,device]} as ProjectDocumentView)).toEqual([]);
  });

  it("uses backend checking for root and selected parent/zone placement and displays rejection", async () => {
    const view = project();
    const checkPlacement = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, code: "incompatible_parent", message: "Contenitore non compatibile." });
    const placeRoot = vi.fn().mockResolvedValue(view);
    const placeChild = vi.fn().mockResolvedValue(view);
    const actions = { checkPlacement, placeRoot, placeChild };
    const rootInput = { itemUuid: "box", viewCode: "front", rootXMm: 0, rootYMm: 0 };
    const childInput = { itemUuid: "tray", viewCode: "front", parentUuid: "root", zoneNo: 0, startUnits: 50 };
    expect((await submitPlacement(actions, rootInput)).project).toBe(view);
    expect((await submitPlacement(actions, childInput)).project).toBe(view);
    expect(placeRoot).toHaveBeenCalledWith(rootInput);
    expect(placeChild).toHaveBeenCalledWith(childInput);
    expect((await submitPlacement(actions, { ...childInput, itemUuid: "switch" })).message)
      .toBe("Contenitore non compatibile.");
    expect(placeChild).toHaveBeenCalledTimes(1);
  });

  it("renders saved absolute millimetre geometry, labels, and independent enclosure roots", () => {
    const warning = vi.spyOn(console,"error").mockImplementation(() => undefined);
    const nested = node("root-a", "box", "enclosure", 100, 200, [
      node("panel", "tray", "support", 125, 240, [node("component", "switch", "device", 135, 250)]),
    ]);
    const second = node("root-b", "box", "enclosure", 1200, 300);
    const html = renderToStaticMarkup(<FronteQuadro roots={[nested]} items={[enclosure, support, device]} />);
    expect(html).toContain('x="100" y="200" width="400" height="600"');
    expect(html).toContain('x="125" y="240" width="200" height="100"');
    expect(html).toContain('x="135" y="250" width="20" height="40"');
    expect(html).toContain("BOX-A");
    expect(html).toContain("SWITCH-C");
    expect(html).toContain("<title>BOX-A · TEST / BOX-A · BOX-A-ARTICLE · 400 × 600 mm · (100, 200) mm</title>");
    expect(warning).not.toHaveBeenCalled();
    expect(html).not.toContain("1200");
    const secondHtml = renderToStaticMarkup(<FronteQuadro roots={[second]} items={[enclosure, support, device]} />);
    expect(secondHtml).toContain('x="1200" y="300" width="400" height="600"');
    expect(secondHtml).not.toContain("135");
    warning.mockRestore();
  });

  it("no longer offers unplacement from Albero fisico rows; the backend call is unchanged", async () => {
    const root = node("root", "box", "enclosure", 0, 0, [node("panel", "tray", "support", 10, 20)]);
    const html = renderToStaticMarkup(<ProgettazioneScreen project={project([root])} api={api}
      onProjectChange={() => undefined} />);
    expect(html).not.toContain("Rimuovi posizione");
    expect(html).not.toMatch(/class="design-tree-row"[^>]*>(?:(?!<\/li>).)*<button[^>]*icon-button/);
    const unplaceNode = vi.fn().mockResolvedValue(project());
    await submitUnplacement({ unplaceNode }, "panel");
    expect(unplaceNode).toHaveBeenCalledWith("panel");
  });
});

describe("Progettazione after a Carpenteria is removed", () => {
  // The project the backend leaves after the middle of three roots (x 0, 755, 1510) is removed: the
  // survivors keep their saved X, so the saved coordinates alone still show a 1110 mm hole.
  const survivors = () => [node("root-a", "box", "enclosure", 0, 0, [node("panel-a", "tray", "support", 10, 280)]),
    node("root-c", "box", "enclosure", 1510, 0, [node("panel-c", "tray", "support", 1520, 280)])];
  const screen = (roots: ProjectPhysicalNode[]) => renderToStaticMarkup(<ProgettazioneScreen project={project(roots)} api={api}
    onProjectChange={() => undefined} />);

  it("draws the screen's remaining Carpenterie one gap apart, whatever X they were saved at", () => {
    const html = screen(survivors());
    // Same renderer path the live app takes: the far root is moved left on screen only ...
    expect(html).toContain('data-root-uuid="root-c" transform="translate(-1060 0)"');
    expect(html).not.toContain('data-root-uuid="root-a" transform');
    // ... its saved geometry is still what is drawn inside that shifted group ...
    expect(html).toContain('<rect x="1510" y="0" width="400" height="600"');
    // ... and the viewBox fits the two packed sectors (850 mm), not the saved 1910 mm span.
    const viewBox = html.match(/<svg class="front-drawing"[^>]*viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
    expect(viewBox[2]).toBeLessThan(1000);
    expect(viewBox[2]).toBeGreaterThanOrEqual(850);
    // The Albero fisico keeps showing the saved coordinates.
    expect(html).toContain("1510, 0");
  });

  it("lays the sectors out the same whatever order the roots are supplied in", () => {
    const [a, c] = survivors();
    const placement = (html: string) => [...html.matchAll(/<g class="front-sector" data-root-uuid="([^"]+)"[^>]*?(?: transform="([^"]*)")?>/g)]
      .map(match => [match[1], match[2] ?? null]).sort();
    expect(placement(screen([c!, a!]))).toEqual(placement(screen([a!, c!])));
    expect(placement(screen([a!, c!]))).toEqual([["root-a", null], ["root-c", "translate(-1060 0)"]]);
  });
});

describe("Fronte Quadro labels", () => {
  // The article code is what a device is labelled with; here it is short enough to fit the 20 mm device.
  const labelDevice = { ...device, bom: [{ role: "primary", manufacturerCode: "SWITCH-C" }] } as unknown as ProjectConfiguredItem;
  const root = node("root", "box", "enclosure", 0, 0, [node("dev", "switch", "device", 20, 30)]);
  const render = (props: { zoom?: number; labels?: boolean; viewportPx?: { width: number; height: number } | null }) =>
    renderToStaticMarkup(<FronteQuadro roots={[root]} items={[enclosure, labelDevice]} {...props} />);
  const labelled = (html: string) => [...html.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  const named = (uuid: string, kind: "enclosure" | "support" | "device", modelCode: string, modelName: string,
    width: number, height: number, bom: unknown[] = []) => ({
    ...item(uuid, kind, modelCode, width, height), modelName, bom } as unknown as ProjectConfiguredItem);

  it("keeps readable code labels and hides those too small on screen at the current zoom", () => {
    // Before layout there is no scale: every label that fits its object is drawn, as before.
    expect(labelled(render({}))).toEqual(["BOX-A", "SWITCH-C"]);
    const viewportPx = { width: 832, height: 800 };
    const fitted = frontGeometry(root, [enclosure, labelDevice], 1)!;
    const scale = drawingScale(viewportPx, fitted.viewBox)!;
    expect(3 * scale).toBeLessThan(MIN_LABEL_PX);
    expect(labelled(render({ viewportPx }))).toEqual(["BOX-A"]);
    // Zooming in makes the small label readable again; the drawing-unit size is unchanged.
    expect(labelled(render({ viewportPx, zoom: 2 }))).toEqual(["BOX-A", "SWITCH-C"]);
    expect(render({ viewportPx, zoom: 2 })).toContain('<text x="22" y="42" font-size="3">SWITCH-C</text>');
    // The Etichette toggle removes them all.
    expect(labelled(render({ labels: false }))).toEqual([]);
  });

  it("draws an artwork-less support as its outline with no text label, while Albero fisico names it", () => {
    const name = "Finestra 18 moduli DIN per M125";
    const window = named("window", "support", "internal-model-9999", name, 334, 55);
    const frame = named("frame", "enclosure", "enclosure-code-1", "Armadio Y", 448, 622);
    const roots = [node("r", "frame", "enclosure", 0, 0, [node("w", "window", "support", 57, 127)])];
    const html = renderToStaticMarkup(<FronteQuadro roots={roots} items={[frame, window, labelDevice]} />);
    // The measured mounting area is still drawn ...
    expect(html).toMatch(/class="front-support front-opening"/);
    expect(html).toContain('x="57" y="127" width="334" height="55"');
    // ... but carries no text: neither the name nor the internal code is a visible drawing label.
    expect(labelled(html)).toEqual(["Armadio Y"]);
    expect(labelled(html).join(" ")).not.toContain("Finestra");
    expect(labelled(html).join(" ")).not.toContain("internal-model-9999");
    expect(frontLabel(window)).toBeNull();
    // The physical tree still exposes the user-facing name.
    const tree = renderToStaticMarkup(<PhysicalTree roots={roots}
      items={new Map([[frame.uuid, frame], [window.uuid, window]])} currentRootUuid="r"
      onSelect={() => undefined} onHover={() => undefined} />);
    expect(tree).toContain(`<span>${name}</span>`);
    // Its quick full-text reveal repeats exactly that name, never the internal model code.
    expect(tree).toContain(`data-full-text="${name}"`);
    expect(tree).not.toContain("internal-model-9999");
    expect(tree).not.toMatch(/class="tree-label"[^>]*title=/);
  });

  it("labels a device with its primary article code, or its model name when it has none", () => {
    const frame = named("frame", "enclosure", "enclosure-code-1", "Armadio Y", 448, 622);
    const withArticle = named("a", "device", "model-code-a", "Interruttore", 60, 45,
      [{ role: "accessory", manufacturerCode: "ACC-1" }, { role: "primary", manufacturerCode: "ART-77" }]);
    const withoutArticle = named("b", "device", "model-code-b", "Spazio", 90, 45);
    const html = renderToStaticMarkup(<FronteQuadro
      roots={[node("r", "frame", "enclosure", 0, 0, [node("na", "a", "device", 10, 10), node("nb", "b", "device", 100, 10)])]}
      items={[frame, withArticle, withoutArticle]} />);
    expect(labelled(html)).toEqual(["Armadio Y", "ART-77", "Spazio"]);
    expect(labelled(html).join(" ")).not.toMatch(/model-code/);
    expect(frontLabel(withArticle)).toBe("ART-77");
    expect(frontLabel(withoutArticle)).toBe("Spazio");
    expect(frontLabel(named("c", "support", "code", "   ", 10, 10))).toBeNull();
  });

  it("keeps the generic renderer free of source-specific conditions", () => {
    for (const file of ["design-presentation.ts", "ProgettazioneScreen.tsx", "front-geometry.ts"]) {
      const source = readFileSync(`src/renderer/project/${file}`, "utf8");
      expect(source).not.toMatch(/tq\.pack|tiquadri|bticino/i);
    }
  });

  it("hides a label that is wider than its object and measures the drawing like hit-testing does", () => {
    expect(frontLabelSize("SWITCH-C", 20, 40, null)).toBe(3);
    expect(frontLabelSize("A-VERY-LONG-ARTICLE-CODE", 20, 40, null)).toBeNull();
    expect(frontLabelSize("SWITCH-C", 20, 40, MIN_LABEL_PX / 3)).toBe(3);
    expect(frontLabelSize("SWITCH-C", 20, 40, MIN_LABEL_PX / 3 - .01)).toBeNull();
    expect(frontLabelSize("BOX-A", 400, 600, 1)).toBe(10);
    // Meet scaling: the smaller of the two axis ratios, as in clientToViewBox.
    expect(drawingScale({ width: 640, height: 480 }, [0, 0, 320, 480])).toBe(1);
    expect(drawingScale({ width: 0, height: 480 }, [0, 0, 320, 480])).toBeNull();
  });
});

describe("Progettazione context", () => {
  const din = { capacityKindCode: "din_rail", capacityKindLabel: "moduli", amount: 6, displayDivisor: 2, nominalPitchMm: 9 };
  const breaker = { ...device, demands: [din] } as ProjectConfiguredItem;
  const panel = { ...support, zones: [{ ...supportZone[0]!, displayDivisor: 2 }] } as ProjectConfiguredItem;
  const rect = { xMm: 0, yMm: 0, widthMm: 18, heightMm: 45 };

  it("formats occupancy and target starts in the zone's display unit, never raw half-modules", () => {
    expect(occupancyText(breaker)).toBe("3 moduli");
    expect(occupancyText({ ...breaker, demands: [{ ...din, amount: 3 }] } as ProjectConfiguredItem)).toBe("1,5 moduli");
    expect(occupancyText(device)).toBeNull();
    expect(articleCode(breaker)).toBe("SWITCH-C-ARTICLE");
    const placed = (zoneNo: number): ProjectPlacementTarget => ({ action: "placeChild", subject: rect, affected: [],
      input: { itemUuid: "switch", parentUuid: "panel", zoneNo, startUnits: 6, viewCode: "front" } });
    expect(targetStartText(placed(1), panel)).toBe("inizio 3 moduli");
    expect(targetStartText(placed(9), panel)).toBeNull();
    expect(targetStartText(placed(1), undefined)).toBeNull();
    const packed: ProjectPlacementTarget = { action: "insertPackedChild", index: 0, subject: rect, affected: [],
      input: { itemUuid: "tray", parentUuid: "root", zoneNo: 0, viewCode: "front" } };
    expect(targetStartText(packed, enclosure)).toBeNull();
  });

  it("publishes pool counts and zoom, and the drag subject and destination while dragging", () => {
    const pool = (available: number) => ({ item: device, quantity: 5, placed: 5 - available, available });
    expect(unitsToPlace([pool(2), pool(3)])).toBe(5);
    const idle = designStatusSegments({ supportsToPlace: 1, devicesToPlace: 5, zoom: 1.5 });
    expect(idle.map(segment => segment.id)).toEqual(["pool-supports", "pool-devices", "zoom"]);
    const dragging = designStatusSegments({ supportsToPlace: 0, devicesToPlace: 1, zoom: 1,
      dragging: { code: "FN82C16", occupancy: "3 moduli" }, destination: { name: "TRAY-B", start: "inizio 4,5 moduli" } });
    expect(dragging.map(segment => segment.id)).toEqual(["drag", "destination", "pool-supports", "pool-devices", "zoom"]);
    const state: StatusState = { message: "Rilascia per posizionare qui.", tone: "valid", segments: { design: dragging } };
    const bar = renderToStaticMarkup(<StatusStateContext.Provider value={state}>
      <StatusBar overview={null} source="design" /></StatusStateContext.Provider>);
    expect(bar).toContain('<span class="status-valid" aria-hidden="true"></span><span>Rilascia per posizionare qui.</span>');
    expect(bar).not.toContain("status-ok");
    expect(bar).toContain("<span>Trascinamento: <b>FN82C16</b> · 3 moduli</span>");
    expect(bar).toContain("<span>Destinazione: <b>TRAY-B</b> · inizio 4,5 moduli</span>");
    expect(bar).toContain("<span>Da posizionare: <b>0</b> pannelli</span>");
    expect(bar).toContain("<span><b>1</b> apparecchio</span>");
    expect(bar).toContain("<span>Zoom <b>100%</b></span>");
    expect(bar.match(/role="status"/g)).toHaveLength(1);
  });

  it("shows the pool row being dragged as the drag source", () => {
    const entry = (item: ProjectConfiguredItem) => ({ item, quantity: 2, placed: 0, available: 2 });
    const html = renderToStaticMarkup(<PhysicalPool structural={[entry(support)]} devices={[entry(breaker)]}
      hasRoot activeItemUuid="switch" onDragStart={() => undefined} />);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-pool-kind="device" data-draggable="true" aria-disabled="false" data-active="true"/);
    expect(html).toContain('<small><span class="code">SWITCH-C-ARTICLE</span> · 3 moduli</small>');
    expect(html).toContain('<small><span class="code">TRAY-B-ARTICLE</span> · 200 × 100 mm</small>');
  });
});

/** Declaration blocks of styles.css as [selector list, declarations], @media wrappers ignored. */
function cssRules(): [string[], string][] {
  const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match =>
    [match[1]!.split(",").map(selector => selector.trim()), match[2]!]);
}
/** Classes (and element names) of the element a selector styles: its last compound selector. */
function subject(selector: string): string[] {
  const last = selector.split(/[\s>+~]+/).filter(Boolean).at(-1) ?? "";
  return last.replace(/\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, "").split(/(?=[.#])/).filter(Boolean);
}

describe("Fronte Quadro hit-testing and drag-ghost constraints (docs/R17_VISUAL_DESIGN.md §2)", () => {
  it("gives the drawing <svg> no border, padding or transform; framing lives on the canvas wrapper", () => {
    const rules = cssRules().filter(([selectors]) => selectors.some(selector => subject(selector).includes(".front-drawing")));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, declarations] of rules)
      expect(declarations).not.toMatch(/(^|[;\s])(border|padding|transform|translate|rotate|scale|zoom|margin)[\w-]*\s*:/);
    const canvas = cssRules().find(([selectors]) => selectors.includes(".front-canvas"))![1];
    expect(canvas).toMatch(/background:\s*var\(--librequadri-canvas\)/);
  });

  it("gives no ancestor of the drawing or the fixed drag ghost a containing-block property", () => {
    const ancestors = [".design-screen", ".design-front", ".front-canvas", ".workspace-pane", ".workspace-pane-docked",
      ".workspace-host", ".app-frame", ".project-frame", "html", "body", "#root"];
    const rules = cssRules().filter(([selectors]) =>
      selectors.some(selector => subject(selector).some(part => ancestors.includes(part))));
    expect(rules.length).toBeGreaterThan(5);
    for (const [selectors, declarations] of rules)
      expect(`${selectors.join(",")} {${declarations}}`).not.toMatch(
        /(^|[;{\s])(transform|translate|rotate|scale|filter|backdrop-filter|contain|container|container-type|will-change|perspective)\s*:/);
    // The ghost itself keeps its own centring transform and fixed position.
    const ghost = cssRules().find(([selectors]) => selectors.includes(".drag-ghost"))![1];
    expect(ghost).toMatch(/position:\s*fixed/);
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8"))
      .toMatch(/className="drag-ghost"[^>]*\n?\s*style=\{\{left:drag\.pointer\.x,top:drag\.pointer\.y/);
  });
});


it("draws ordinary article-free preset windows at their snapshotted positions without artwork",()=>{
  const window={...item("window","support","Window",334,55,supportZone),commercialContribution:"none" as const,bom:[]};
  const panels=[127,277,427].map((y,i)=>({...node(`panel-${i}`,"window","support",57,y),slotNo:i+1,rootXMm:null,rootYMm:null}));
  const root=node("root","box","enclosure",0,0,panels);
  const markup=renderToStaticMarkup(<FronteQuadro roots={[root]} items={[enclosure,window]} assets={{}}/>);
  for(const y of [127,277,427])expect(markup).toContain(`x="57" y="${y}" width="334" height="55"`);
  // Physical-only supports without artwork are openings in their container, drawn without a panel fill.
  expect(markup.match(/class="front-support front-opening"/g)).toHaveLength(3);
});

it("draws artless supports as mounting areas and keeps artwork and device fallbacks unchanged",()=>{
  const panel={...item("panel","support","Panel",334,55,supportZone),commercialContribution:"articles" as const};
  const root=node("root","box","enclosure",0,0,[{...node("p","panel","support",57,127),slotNo:1,rootXMm:null,rootYMm:null,
    children:[node("d","switch","device",62,132)]}]);
  const markup=renderToStaticMarkup(<FronteQuadro roots={[root]} items={[enclosure,panel,device]} assets={{}}/>);
  // The rule is physical (no artwork), never commercial.
  expect(markup).toContain(`class="front-support front-opening"`);
  expect(markup).toContain(`class="front-device"`);
  expect(markup).toContain(`class="front-enclosure"`);
  const css=readFileSync("src/renderer/styles.css","utf8");
  expect(css).toMatch(/\.front-support\.front-opening rect:not\(\.front-hit\) \{ fill: none;/);
});
