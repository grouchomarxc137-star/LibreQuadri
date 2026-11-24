/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FrontShape, SubjectPreview } from "../../src/renderer/project/FrontShape.js";
import { PhysicalPool, poolEntryDraggable } from "../../src/renderer/project/PhysicalPool.js";
import { FronteQuadro, ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { frontGeometry } from "../../src/renderer/project/front-geometry.js";
import { clientToViewBox, dragGuidance, dropOnTarget, dropSuccessMessage, loadPlacementTargets, pickTarget,
  placementFailureMessage, targetParents, type DragSubject, type LoadedTargets, type TargetEntry,
} from "../../src/renderer/project/placement-drag.js";
import * as workflow from "../../src/renderer/project/placement-workflow.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectPlacementRect, ProjectPlacementTarget } from "../../src/shared/project.js";

const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string, width: number, height: number,
  assetKey: string | null = null): ProjectConfiguredItem => ({
  uuid, modelKind: kind, modelName: code, modelCode: code, modelBrandMarchio: "TEST",
  configLabel: code, physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: `${code}-ARTICLE` }],
  views: [{ viewCode: "front", widthMm: width, heightMm: height, assetKey }], zones: [],
} as unknown as ProjectConfiguredItem);
const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device", x: number, y: number,
  children: ProjectPhysicalNode[] = [], parentUuid: string | null = null): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm: x, yMm: y, viewCode: "front", children, parentUuid,
  zoneNo: null, startUnits: null, slotNo: null, rootXMm: x, rootYMm: y, sortOrder: 0, positionIssue: null,
});
const box = item("box", "enclosure", "BOX", 400, 600);
const tray = item("tray", "support", "TRAY", 200, 100);
const plate = item("plate", "support", "PLATE", 200, 100);
const switchItem = item("switch", "device", "SWITCH", 20, 40);
const rect = (xMm: number, yMm: number, widthMm: number, heightMm: number): ProjectPlacementRect => ({ xMm, yMm, widthMm, heightMm });
const target = (action: "insertPackedChild" | "movePackedNode", parentUuid: string, subject: ProjectPlacementRect,
  extra: object = {}): ProjectPlacementTarget => ({ action, subject, affected: [], ...(action === "insertPackedChild"
    ? { index: 0, input: { itemUuid: "switch", parentUuid, zoneNo: 0, viewCode: "front" } }
    : { nodeUuid: "n", input: { parentUuid, zoneNo: 0, viewCode: "front", index: 0 } }), ...extra } as ProjectPlacementTarget);
const entry = (parentUuid: string, subject: ProjectPlacementRect): TargetEntry =>
  ({ parentUuid, target: target("insertPackedChild", parentUuid, subject) });
const deviceEntry = (parentUuid: string, subject: ProjectPlacementRect, startUnits: number): TargetEntry =>
  ({ parentUuid, target: { action: "placeChild", input: { itemUuid: "switch", parentUuid,
    zoneNo: 0, startUnits, viewCode: "front" }, subject, affected: [] } });
const view = (physicalNodes: ProjectPhysicalNode[], quantities: Record<string, number>,
  configuredItems = [box, tray, plate, switchItem]): ProjectDocumentView => ({ configuredItems, physicalNodes,
  lines: Object.entries(quantities).map(([itemUuid, quantity]) => ({ itemUuid, quantity })) } as unknown as ProjectDocumentView);
const noop = () => undefined;

describe("unified physical pool", () => {
  const pool = (structural: workflow.PoolEntry[], devices: workflow.PoolEntry[], hasRoot = true) =>
    renderToStaticMarkup(<PhysicalPool structural={structural} devices={devices} hasRoot={hasRoot} onDragStart={noop} />);
  const entry2 = (i: ProjectConfiguredItem, quantity: number, placed: number): workflow.PoolEntry =>
    ({ item: i, quantity, placed, available: Math.max(0, quantity - placed) });

  it("lists only Pannelli and Apparecchi with units still available", () => {
    const markup = pool([entry2(tray, 3, 1), entry2(plate, 1, 1)], [entry2(switchItem, 2, 0)]);
    expect(markup.match(/<h3[ >]/g)).toHaveLength(1);
    expect(markup).toContain('<h3 id="design-pool-title">Da posizionare</h3>');
    expect(markup).toContain('<span class="dock-count" title="4 disponibili">4</span>');
    expect(markup).toMatch(/<h4><svg [^>]*aria-hidden="true"[^>]*>.*?<\/svg>Pannelli<\/h4><span>2 disponibili<\/span>/);
    expect(markup).toMatch(/<h4><svg [^>]*aria-hidden="true"[^>]*>.*?<\/svg>Apparecchi<\/h4><span>2 disponibili<\/span>/);
    expect(markup).toContain("TRAY-ARTICLE");
    // Availability stays available / Q, with the full wording for assistive technology.
    expect(markup).toContain('<span class="pool-figure">2<span aria-hidden="true">/3</span></span><span class="visually-hidden">2 disponibili su 3</span>');
    expect(markup).toContain('<span class="pool-figure">2<span aria-hidden="true">/2</span></span>');
    expect(markup).not.toContain("pool-meter");
    expect(markup).not.toMatch(/pool-figure[^<]*>.*?<b>/);
    expect(markup).not.toContain("PLATE");
    expect(markup).not.toContain("pool-thumb");
    expect(markup).not.toContain("subject-preview");
    expect(markup.match(/data-draggable="true"/g)).toHaveLength(2);
    expect(markup).toMatch(/data-pool-kind="device" data-draggable="true" aria-disabled="false"/);
    const rows = [...markup.matchAll(/<button[^>]*class="pool-item"[^>]*>(.*?)<\/button>/g)].map(match => match[1]!);
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toMatch(/<span class="pool-text">.*<\/span><span class="pool-count">/);
    expect(poolEntryDraggable(entry2(plate, 1, 1), true)).toBe(false);
    expect(poolEntryDraggable(entry2(tray, 2, 0), false)).toBe(false);
    expect(poolEntryDraggable({ ...entry2(tray, 2, 0), item: { ...tray, physStatus: "not_physical" } as ProjectConfiguredItem }, true)).toBe(false);
    expect(pool([entry2(tray, 1, 0)], [], false)).toContain("Aggiungi prima una carpenteria");
    expect(pool([entry2(tray, 1, 0)], [], false)).not.toContain('data-draggable="true"');
  });

  it("is the only placement area: the old device-only palette, form and panel card are gone", () => {
    const root = node("root", "box", "enclosure", 0, 0, [node("panel", "tray", "support", 10, 20, [], "root")]);
    const markup = renderToStaticMarkup(<ProgettazioneScreen project={view([root], { box: 1, tray: 1, switch: 1 })}
      api={{} as ProjectApi} onProjectChange={noop} />);
    expect(markup.match(/<h3[^>]*>Da posizionare<\/h3>/g)).toHaveLength(1);
    for (const gone of ["Posiziona nel quadro", "Posiziona su pannello", "Posiziona apparecchio", "Pannello / supporto",
      "Zona compatibile", "Apparecchi sul pannello", "Apparecchi del progetto", "front-drop-target"])
      expect(markup).not.toContain(gone);
    expect(markup).not.toMatch(/[^-]draggable="/);
    expect(markup).toContain("Fai doppio clic o trascina sul disegno per posizionare automaticamente.");
  });
});

describe("drag preview", () => {
  const assets = { "panel-art": { viewBox: [-1, -2, 30, 50] as [number, number, number, number], strokeWidth: .1,
    strokes: "M 0 0 L 10 10", fills: "M 0 0 L 1 1 Z" } };
  it("uses the resolved vector when there is one", () => {
    const markup = renderToStaticMarkup(<SubjectPreview view={{ widthMm: 200, heightMm: 100, assetKey: "panel-art" }}
      assets={assets} label="Anteprima" />);
    expect(markup).toContain('viewBox="0 0 200 100"');
    expect(markup).toContain('viewBox="-1 -2 30 50"');
    expect(markup).toContain('d="M 0 0 L 10 10"');
    expect(markup).not.toContain("<rect");
  });
  it("falls back to a plain rectangle of the snapshotted size, without invented artwork", () => {
    for (const assetKey of [null, "unknown-key"]) {
      const markup = renderToStaticMarkup(<SubjectPreview view={{ widthMm: 20, heightMm: 40, assetKey }} assets={assets} label="x" />);
      expect(markup).toContain('viewBox="0 0 20 40"');
      expect(markup).toContain('<rect x="0" y="0" width="20" height="40"');
      expect(markup).not.toContain("<path");
    }
    expect(renderToStaticMarkup(<SubjectPreview view={undefined} assets={assets} label="x" />)).toBe("");
    expect(renderToStaticMarkup(<svg><FrontShape x={5} y={6} width={7} height={8} assetKey="panel-art" assets={assets} /></svg>))
      .toContain('x="5" y="6" width="7" height="8"');
  });
  it("keeps asset artwork out of the pool while retaining the preview component for dragging", () => {
    const withAsset = item("tray", "support", "TRAY", 200, 100, "panel-art");
    const markup = renderToStaticMarkup(<PhysicalPool structural={[{ item: withAsset, quantity: 1, placed: 0, available: 1 }]}
      devices={[]} hasRoot onDragStart={noop} />);
    expect(markup).not.toContain("subject-preview");
    expect(markup).not.toContain('d="M 0 0 L 10 10"');
    expect(renderToStaticMarkup(<SubjectPreview view={withAsset.views[0]} assets={assets} label="Anteprima TRAY" />))
      .toContain('d="M 0 0 L 10 10"');
  });
});

describe("backend targets", () => {
  const root = node("root", "box", "enclosure", 0, 0, [
    node("panel-a", "tray", "support", 10, 20, [], "root"), node("panel-b", "tray", "support", 10, 200, [], "root")]);
  const subject = (kind: "support" | "device", origin: "pool" | "node", extra: Partial<DragSubject> = {}): DragSubject => ({
    origin, kind, item: kind === "support" ? tray : switchItem, ...(origin === "node" ? { nodeUuid: "n" } : {}), ...extra });

  it("asks the backend for the right containers only", async () => {
    expect(targetParents(subject("support", "pool"), root)).toEqual(["root"]);
    expect(targetParents(subject("device", "pool"), root)).toEqual(["panel-a", "panel-b"]);
    expect(targetParents(subject("device", "node"), root)).toEqual(["panel-a", "panel-b"]);
    // A Pannello, pooled or placed, is asked about every visible Carpenteria; the backend decides which accept it.
    expect(targetParents(subject("support", "node", { parentUuid: "root" }), root)).toEqual(["root"]);
    expect(targetParents(subject("support", "node"), root)).toEqual(["root"]);
    const placementTargets = vi.fn(async (request: { parentUuid: string }) => ({
      targets: [target("insertPackedChild", request.parentUuid, rect(20, 30, 20, 40))],
      diagnostics: [{ code: "x", message: "Pieno" }] }));
    const loaded = await loadPlacementTargets({ placementTargets } as unknown as Pick<ProjectApi, "placementTargets">,
      subject("device", "pool"), root);
    expect(placementTargets.mock.calls.map(call => call[0])).toEqual([
      { parentUuid: "panel-a", itemUuid: "switch" }, { parentUuid: "panel-b", itemUuid: "switch" }]);
    expect(loaded.entries.map(found => found.parentUuid)).toEqual(["panel-a", "panel-b"]);
    expect(loaded.diagnostics).toEqual(["Pieno"]);
    await loadPlacementTargets({ placementTargets } as unknown as Pick<ProjectApi, "placementTargets">,
      subject("support", "node", { parentUuid: "root" }), root);
    expect(placementTargets).toHaveBeenLastCalledWith({ parentUuid: "root", nodeUuid: "n", reflow: true });
  });

  it("picks the returned rectangle nearest the pointer, only inside a container that has targets", () => {
    const parents = new Map([["panel-a", rect(10, 20, 200, 100)], ["panel-b", rect(10, 200, 200, 100)]]);
    const entries = [entry("panel-a", rect(20, 30, 20, 40)), entry("panel-a", rect(40, 30, 20, 40)),
      entry("panel-b", rect(20, 210, 20, 40))];
    expect(pickTarget(entries, parents, { x: 52, y: 50 })).toBe(entries[1]);
    expect(pickTarget(entries, parents, { x: 25, y: 60 })).toBe(entries[0]);
    expect(pickTarget(entries, parents, { x: 30, y: 230 })).toBe(entries[2]);
    expect(pickTarget(entries, parents, { x: 300, y: 50 })).toBeNull();
    expect(pickTarget(entries, parents, { x: 30, y: 150 })).toBeNull();
    expect(pickTarget(entries, new Map(), { x: 30, y: 50 })).toBeNull();
    expect(pickTarget([], parents, { x: 30, y: 50 })).toBeNull();
    expect(clientToViewBox({ x: 100, y: 50 }, { left: 0, top: 0, width: 0, height: 10 }, [0, 0, 10, 10])).toBeNull();
    expect(clientToViewBox({ x: 10, y: 50 }, { left: 0, top: 0, width: 200, height: 100 }, [0, 0, 100, 100])).toBeNull();
  });

  it("picks only a device rectangle under the pointer, using centre distance when rectangles overlap", () => {
    const parents = new Map([["panel-a", rect(0, 0, 120, 60)]]);
    const left=deviceEntry("panel-a",rect(10,10,18,30),0);
    const middle=deviceEntry("panel-a",rect(20,10,18,30),1);
    const right=deviceEntry("panel-a",rect(30,10,18,30),2);
    const far=deviceEntry("panel-a",rect(80,10,18,30),7);
    const entries=[left,middle,right,far];
    expect(pickTarget(entries,parents,{x:15,y:20},"device")).toBe(left);
    expect(pickTarget(entries,parents,{x:29,y:20},"device")).toBe(middle);
    expect(pickTarget(entries,parents,{x:43,y:20},"device")).toBe(right);
    expect(pickTarget(entries,parents,{x:60,y:20},"device")).toBeNull();
    expect(pickTarget(entries,parents,{x:65,y:20},"device")).toBeNull();
    expect(pickTarget(entries,parents,{x:95,y:20},"device")).toBe(far);
    // R-16 Pannello picking still uses the nearest target within its container.
    expect(pickTarget(entries,parents,{x:60,y:20},"support")).toBe(right);
    const protruding=deviceEntry("panel-a",rect(115,10,18,30),8);
    expect(pickTarget([protruding],parents,{x:126,y:20},"device")).toBe(protruding);
    expect(pickTarget([protruding],parents,{x:126,y:20},"support")).toBeNull();
  });

  it("keeps device hit-testing exact through all supported Fronte Quadro zoom levels", () => {
    const zoomRoot=node("root","box","enclosure",0,0,[
      node("panel-a","tray","support",150,260,[],"root")]);
    const entries=[deviceEntry("panel-a",rect(170,280,20,40),4),
      deviceEntry("panel-a",rect(179,280,20,40),5)];
    const clientBox={left:120,top:40,width:640,height:480};
    for(const zoom of [0.5,1,1.25,1.5,2,4]){
      const geometry=frontGeometry(zoomRoot,[box,tray],zoom)!;
      const [x,y,w,h]=geometry.viewBox;
      const scale=Math.min(clientBox.width/w,clientBox.height/h);
      const toClient=(point:{x:number;y:number})=>({
        x:clientBox.left+(clientBox.width-w*scale)/2+(point.x-x)*scale,
        y:clientBox.top+(clientBox.height-h*scale)/2+(point.y-y)*scale});
      for(const [drawnPoint,wanted] of [[{x:189,y:300},entries[1]],[{x:220,y:300},null]] as const){
        const drawn=clientToViewBox(toClient(drawnPoint),clientBox,geometry.viewBox)!;
        expect(pickTarget(entries,geometry.parentRects,drawn,"device")).toBe(wanted);
      }
    }
  });

  it("draws exactly the returned rectangles, and only for containers that accept a drop", () => {
    const subject1 = subject("device", "pool");
    const chosen=deviceEntry("panel-a",rect(33.5, 41.25, 18, 77),3);
    const hover = { ...chosen, target: { ...chosen.target,
        affected: [{ nodeUuid: "x", rect: rect(60, 41.25, 18, 77) }] } };
    const markup = renderToStaticMarkup(<FronteQuadro roots={[root]} items={[box, tray, switchItem]}
      overlay={{ parents: ["panel-a"], hover, subject: subject1 }} />);
    expect(markup).toContain('class="front-target-subject" x="33.5" y="41.25" width="18" height="77"');
    expect(markup).toContain('data-action="placeChild"');
    expect(markup).toContain('class="front-target-preview" x="33.5" y="41.25" width="18" height="77"');
    expect(markup).toContain('class="front-target-affected" x="60" y="41.25" width="18" height="77"');
    expect(markup.match(/class="front-target-parent"/g)).toHaveLength(1);
    expect(markup).toContain('data-parent-uuid="panel-a" x="10" y="20" width="200" height="100"');
    expect(markup).not.toContain('data-parent-uuid="panel-b" x=');
    expect(renderToStaticMarkup(<FronteQuadro roots={[root]} items={[box, tray, switchItem]} overlay={null} />))
      .not.toContain("front-target");
  });

  it("uses the vector of the dragged item on the snapped target when one is resolved", () => {
    const art = { ...switchItem, views: [{ viewCode: "front", widthMm: 20, heightMm: 40, assetKey: "dev-art" }] } as unknown as ProjectConfiguredItem;
    const hover = deviceEntry("panel-a",rect(30, 40, 20, 40),2);
    const markup = renderToStaticMarkup(<FronteQuadro roots={[root]} items={[box, tray]}
      assets={{ "dev-art": { viewBox: [0, 0, 4, 8], strokeWidth: .1, strokes: "M 0 0 L 4 8", fills: "" } }}
      overlay={{ parents: ["panel-a"], hover, subject: { origin: "pool", kind: "device", item: art } }} />);
    expect(markup).toContain('class="front-target-preview front-vector" x="30" y="40" width="20" height="40" viewBox="0 0 4 8"');
  });

  it("routes devices only through explicit actions while preserving structural packed placement", async () => {
    const operations={placeStructuralItem:vi.fn().mockResolvedValue(view([],{})),
      placeChild:vi.fn().mockResolvedValue(view([],{})),
      moveNode:vi.fn().mockResolvedValue(view([],{})),
      movePackedNode:vi.fn().mockResolvedValue(view([],{}))};
    const device:DragSubject={origin:"pool",kind:"device",item:switchItem};
    const packed=target("insertPackedChild","panel-a",rect(20,30,20,40));
    await expect(dropOnTarget(operations,device,packed)).rejects.toThrow();
    expect(operations.placeStructuralItem).not.toHaveBeenCalled();
    await dropOnTarget(operations,device,deviceEntry("panel-a",rect(20,30,20,40),2).target);
    expect(operations.placeChild).toHaveBeenCalledOnce();
    const placed:DragSubject={...device,origin:"node",nodeUuid:"n"};
    await expect(dropOnTarget(operations,placed,target("movePackedNode","panel-a",rect(20,30,20,40))))
      .rejects.toThrow();
    expect(operations.movePackedNode).not.toHaveBeenCalled();
    const explicit:ProjectPlacementTarget={action:"moveNode",nodeUuid:"n",input:{itemUuid:"switch",
      parentUuid:"panel-a",zoneNo:0,startUnits:4,viewCode:"front"},subject:rect(40,30,20,40),affected:[]};
    await dropOnTarget(operations,placed,explicit);
    expect(operations.moveNode).toHaveBeenCalledWith("n",explicit.input);
    await dropOnTarget(operations,{origin:"pool",kind:"support",item:tray},packed);
    expect(operations.placeStructuralItem).toHaveBeenCalledOnce();
  });

  it("makes placed Pannelli and Apparecchi draggable from the Fronte Quadro, and not the Carpenteria", () => {
    const tree = node("root", "box", "enclosure", 0, 0, [
      node("panel-a", "tray", "support", 10, 20, [node("dev", "switch", "device", 20, 30, [], "panel-a")], "root")]);
    const markup = renderToStaticMarkup(<FronteQuadro roots={[tree]} items={[box, tray, switchItem]} onNodePointerDown={noop} />);
    expect(markup).toMatch(/data-node-uuid="root" class="front-enclosure"/);
    // The fixture panel has no artwork, so it is also drawn as an outlined mounting area.
    expect(markup).toMatch(/data-node-uuid="panel-a" class="front-support front-draggable front-opening"/);
    expect(markup).toMatch(/data-node-uuid="dev" class="front-device front-draggable"/);
    expect(markup.match(/class="front-hit"/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<FronteQuadro roots={[tree]} items={[box, tray, switchItem]} />)).not.toContain("front-draggable");
    const moving = renderToStaticMarkup(<FronteQuadro roots={[tree]} items={[box, tray, switchItem]} onNodePointerDown={noop}
      overlay={{ parents: [], hover: null, subject: { origin: "node", kind: "device", item: switchItem, nodeUuid: "dev" } }} />);
    expect(moving).toMatch(/data-node-uuid="dev" class="front-device front-draggable front-dragging"/);
  });
});

describe("guidance and failures", () => {
  const device: DragSubject = { origin: "pool", kind: "device", item: switchItem };
  const support: DragSubject = { origin: "pool", kind: "support", item: tray };
  const loaded = (entries: TargetEntry[], diagnostics: string[] = [], parents = ["p"]): LoadedTargets => ({ entries, diagnostics, parents });
  it("explains loading, valid, missing and failed states without backend codes", () => {
    expect(dragGuidance(device, "loading", null, null)).toContain("Verifica");
    expect(dragGuidance(device, "failed", null, null)).toContain("non sono state verificate");
    const some = loaded([entry("p", rect(0, 0, 1, 1))]);
    expect(dragGuidance(device, "ready", some, null)).toContain("Trascina l'apparecchio su un pannello");
    expect(dragGuidance(support, "ready", some, null)).toContain("Trascina il pannello sulla carpenteria");
    expect(dragGuidance(device, "ready", some, some.entries[0]!)).toBe("Rilascia per posizionare qui.");
    expect(dragGuidance({ ...device, origin: "node" }, "ready", some, some.entries[0]!)).toBe("Rilascia per spostare qui.");
    expect(dragGuidance(device, "ready", loaded([], ["L'articolo supera la capacità della zona."]), null))
      .toBe("Nessuna posizione compatibile. L'articolo supera la capacità della zona.");
    expect(dragGuidance(device, "ready", loaded([], [], []), null)).toContain("Nessun pannello in questa carpenteria");
    expect(dropSuccessMessage(device)).toContain("Apparecchio posizionato");
    expect(dropSuccessMessage({ ...support, origin: "node" })).toContain("Pannello spostato");
  });
  it("turns refused or stale drops into plain text", () => {
    expect(placementFailureMessage(new Error("Error invoking remote method 'project:place-structural-item': Error: Modello strutturale non compatibile: required_context_not_provided.")))
      .toBe("Questo pannello non è compatibile con la carpenteria selezionata.");
    expect(placementFailureMessage(new Error("Modello strutturale non compatibile: something_new.")))
      .toBe("La posizione non è più valida: il progetto o il catalogo sono cambiati.");
    expect(placementFailureMessage(new Error("La posizione si sovrappone a un altro articolo."))).toBe("La posizione si sovrappone a un altro articolo.");
    expect(placementFailureMessage("")).toBe("La posizione non è più valida.");
  });
});

describe("the approximate drop system is gone and the renderer holds no compatibility rules", () => {
  it("removes renderer-generated zones and their helpers from the active workflow", () => {
    for (const name of ["validPackedDestinations", "submitCheckedPackedDrop", "packedDestinationKey", "submitPackedPlacement"])
      expect(name in workflow).toBe(false);
    for (const file of ["ProgettazioneScreen.tsx", "PhysicalPool.tsx", "placement-drag.ts", "FrontShape.tsx", "front-geometry.ts"]) {
      const source = readFileSync(`src/renderer/project/${file}`, "utf8");
      expect(source).not.toMatch(/validPackedDestinations|checkPackedChild|packedDestinationKey|front-drop-target|targets\.length|dropTargets|[^-]draggable=/);
      expect(source).not.toMatch(/BTicino|TiQuadri|BTI|Legrand|\btq\.|MDX|Btdin|Megatiker|capacityAmount|pitchMm|nominalPitchMm|displayDivisor|slotNo|requiredViewCode|fitClass|constraints/i);
    }
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx","utf8")).not.toContain("removePackedNode");
  });
  it("keeps the Fronte Quadro zoom controls", () => {
    const root = node("root", "box", "enclosure", 0, 0);
    const markup = renderToStaticMarkup(<ProgettazioneScreen project={view([root], { box: 1 })} api={{} as ProjectApi} onProjectChange={noop} />);
    expect(markup).toContain('aria-label="Riduci Fronte Quadro"');
    expect(markup).toContain('aria-label="Ingrandisci Fronte Quadro"');
    expect(markup).toContain("Adatta vista");
  });
});
