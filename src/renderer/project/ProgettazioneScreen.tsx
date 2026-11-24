import { initialShellState, type DesignSection, type PlacementMode } from "../app/shell-state.js";
import { DinConfigurationDialog } from "./DinConfigurationDialog.js";
import { memo, useMemo, useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref, type ReactNode } from "react";
import type { ProjectAnnotation, ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectRootRemoval, ProjectPlacementSubject } from "../../shared/project.js";
import type { ConfigurationApi } from "../../shared/configuration.js";
import { useStatusActions } from "../app/status.js";
import { Icon } from "../ui/icons.js";
import { FullTextTooltip } from "../ui/FullTextTooltip.js";
import { useSidePanels } from "../ui/useSidePanels.js";
import { useFrontAssets } from "./useFrontAssets.js";
import { StructuralWorkflow } from "./StructuralWorkflow.js";
import { FrontShape, previewView, SubjectPreview, type FrontAssets } from "./FrontShape.js";
import { FrontScrollbar } from "./FrontScrollbar.js";
import { FrontCombinedWidth, FrontDimensions } from "./FrontDimensions.js";
import { FrontAnnotations, NoteFontControls, type NoteLayer } from "./FrontAnnotations.js";
import { useFrontNotes } from "./useFrontNotes.js";
import { PhysicalPool } from "./PhysicalPool.js";
import { PhysicalTree } from "./PhysicalTree.js";
import { clientToViewBox, dragGuidance, dropOnTarget, dropSuccessMessage,
  loadPlacementTargets, pickCombinedTarget, placementFailureMessage, type DragPhase, type DragSubject,
  type LoadedTargets, type Point, type TargetEntry } from "./placement-drag.js";
import { articleCode, countText, designStatusSegments, nodeStartText, occupancyText, targetStartText, unitsToPlace } from "./design-presentation.js";
import { combinedFrontGeometry, drawingScale, ghostSize, keyPanTarget, keyScrollTarget, scrollThumb, scrollThumbY,
  selectionFrame, SELECTION_GAP_MM, wheelPanTarget, type CombinedFrontGeometry, type FrontDrawable, type FrontSector } from "./front-geometry.js";
import { describeSelection, designKeyCommand, designSelectionReducer, hoverHighlights, initialDesignPointer, isSelectable, isTextEntryTarget,
  pressOutcome, selectableUuids, unplaceBlockReason, type CanvasPress, type SelectedObject } from "./design-selection.js";
import { DesignProperties, RemoveCarpenteriaDialog } from "./DesignProperties.js";
import { EnclosureConfigurationDialog, enclosureFailureMessage, submitEnclosureConfiguration } from "./EnclosureConfigurationDialog.js";
import type { ConfigurationRequest } from "../../shared/configuration.js";
import { devicePool, locateNode, structuralPool, submitSelectionUnplacement } from "./placement-workflow.js";
import { structuralDevicePanel } from "./structural-navigation.js";
import { useReadOnlyQuery } from "./panel-reference-state.js";
import { isMacPlatform, registerDocumentEditBlocker, runDocumentEdit } from "../app/edit-commands.js";
import { fillReportMessage } from "./design-presentation.js";

import { FrontCaption, FrontObject, FrontOptionLabels, frontOpening, orderedFront } from "../../drawing/FrontContent.js";
import { DocumentPdfDialog } from "../app/DocumentPdfDialog.js";

const NO_ANNOTATIONS: readonly ProjectAnnotation[] = [];

function physicalItems(project: ProjectDocumentView): ProjectConfiguredItem[] {
  return project.configuredItems.filter(item => item.physStatus === "resolved" &&
    (item.modelKind === "enclosure" || item.modelKind === "support" || item.modelKind === "device"));
}

function itemLabel(item: ProjectConfiguredItem): string {
  const article = item.bom.find(row => row.role === "primary") ?? item.bom[0];
  return `${item.modelName} · ${item.modelBrandMarchio} / ${item.modelCode}${article ? ` · ${article.manufacturerCode}` : ""}`;
}

const KIND_LABEL = { enclosure: "Carpenteria", support: "Pannello", device: "Apparecchio" } as const;

type FrontViewportAction = "in" | "out" | "fit";
/** Zoom belongs to the combined Fronte Quadro, not to any one Carpenteria. */
interface FrontViewportState { zoom:number; }

export function updateFrontViewport(state:FrontViewportState,action:FrontViewportAction):FrontViewportState {
  return {zoom:action==="fit"?1:Math.max(.5,Math.min(4,state.zoom*(action==="in"?1.25:.8)))};
}

/** The drag in progress as the drawing shows it: containers that accept a drop and the snapped target. */
export interface FrontOverlay {
  parents: readonly string[];
  hover: TargetEntry | null;
  subject: DragSubject | null;
}

export function FronteQuadro({ roots, items, focusUuid, scrollX = null, scrollY = null, dimensions = false, combinedWidths = false,
  annotations = NO_ANNOTATIONS, noteLayer, focusable = false, assets = {}, zoom = 1, overlay, onNodePointerDown, svgRef,
  labels = true, viewportPx = null, selectedUuid = null, hoverUuid = null, onNodeHover }: {
  /** Every placed Carpenteria; each is a sector of the one drawing. */
  roots: readonly ProjectPhysicalNode[]; items: readonly ProjectConfiguredItem[];
  /** The focused Carpenteria: where zoom centres and which caption is emphasised. Never hides another. */
  focusUuid?: string; assets?: FrontAssets; zoom?: number;
  /** Display-only horizontal position of the zoomed drawing (viewBox left edge); null follows the focus. */
  scrollX?: number | null;
  /** Display-only vertical position (viewBox top edge); null follows the focus. */
  scrollY?: number | null;
  /** Show each Carpenteria's overall width and height. Presentation only. */
  dimensions?: boolean;
  combinedWidths?: boolean;
  /** Free-text notes, in drawing coordinates, and the one being edited. */
  annotations?: readonly ProjectAnnotation[]; noteLayer?: NoteLayer;
  /** Let the drawing take keyboard focus, so Left/Right can scroll it. */
  focusable?: boolean;
  overlay?: FrontOverlay | null;
  onNodePointerDown?: (node: ProjectPhysicalNode, event: ReactPointerEvent<SVGGElement>) => void;
  svgRef?: Ref<SVGSVGElement>;
  /** Code labels on objects drawn without a vector; each one still hides when it would not be readable. */
  labels?: boolean;
  /** The drawing's rendered size in CSS pixels, once laid out. */
  viewportPx?: { width: number; height: number } | null;
  /** Persistent selection (orange outline, handles and code tag) and transient hover (neutral outline). */
  selectedUuid?: string | null; hoverUuid?: string | null;
  /** Pointer entering (uuid) or leaving (null) a Carpenteria, Pannello or Apparecchio. */
  onNodeHover?: (uuid: string | null) => void;
}) {
  const geometry = useMemo(()=>combinedFrontGeometry(roots, items, { zoom, focusUuid, viewportPx, scrollX, scrollY, dimensions, combinedWidths, annotations, assets }),
    [roots,items,zoom,focusUuid,viewportPx,scrollX,scrollY,dimensions,combinedWidths,annotations,assets]);
  const orderedSectors=useMemo(()=>new Map(geometry.sectors.map(sector=>[sector,orderedFront(sector)])),[geometry]);
  if (!geometry.contentBounds) return <p className="hint">Vista non disponibile: geometria o posizione mancante nel progetto.</p>;
  const { sectors, viewBox, captionMm, skipped, combinedWidth } = geometry;
  const drawingLabel = sectors.length ? countText(sectors.length, "carpenteria", "carpenterie")
    : countText(annotations.length, "annotazione", "annotazioni");
  const scale = viewportPx ? drawingScale(viewportPx, viewBox) : null;
  const moving = overlay?.subject?.origin === "node" ? overlay.subject.nodeUuid : undefined;
  const hover = overlay?.hover ?? null;
  const hoverView = hover ? overlay?.subject?.item.views.find(view => view.viewCode === hover.target.input.viewCode) : undefined;
  const drawn = (uuid: string | null) => uuid === null ? undefined
    : sectors.flatMap(sector => sector.drawable).find(entry => entry.node.uuid === uuid);
  // The object being moved shows only its drag state; hover never shows during a drag.
  const selectedEntry = selectedUuid !== moving ? drawn(selectedUuid) : undefined;
  const hoverEntry = overlay ? undefined : drawn(hoverUuid);
  const sectorFrame = (sector: FrontSector) => {
    const ordered = orderedSectors.get(sector)!;
    const hovered = hover && sector.parentRects.has(hover.parentUuid) ? hover : null;
    const { offset } = sector;
    return <g key={sector.root.uuid} className="front-sector" data-root-uuid={sector.root.uuid}
      data-focus={sector.root.uuid === focusUuid ? "true" : undefined}
      transform={offset.x !== 0 || offset.y !== 0 ? `translate(${offset.x} ${offset.y})` : undefined}>
      <FrontCaption sector={sector} captionMm={captionMm} />
      {ordered.map(({ node, item, view }) => {
        const draggable = !!onNodePointerDown && (node.nodeKind === "support" || node.nodeKind === "device");
        const hoverable = !!onNodeHover && isSelectable(node);
        const opening = frontOpening({ node, item, view }, assets);
        return <g key={node.uuid} data-node-uuid={node.uuid}
          className={`front-${node.nodeKind}${draggable ? " front-draggable" : ""}${moving === node.uuid ? " front-dragging" : ""}${opening ? " front-opening" : ""}`}
          data-selected={node.uuid === selectedUuid ? "true" : undefined}
          onPointerDown={draggable ? event => onNodePointerDown(node, event) : undefined}
          onPointerEnter={hoverable ? () => onNodeHover(node.uuid) : undefined}
          onPointerLeave={hoverable ? () => onNodeHover(null) : undefined}>
        <title>{`${itemLabel(item)} · ${view.widthMm} × ${view.heightMm} mm · (${node.xMm}, ${node.yMm}) mm`}</title>
        <StableFrontObject node={node} item={item} view={view} assets={assets} labels={labels} scale={scale} />
        {draggable || hoverable ? <rect className="front-hit" x={node.xMm!} y={node.yMm!} width={view.widthMm}
          height={view.heightMm} fill="transparent" /> : null}
      </g>})}
      <FrontOptionLabels sector={sector} assets={assets} />
      {dimensions ? <FrontDimensions dimensions={geometry.dimensionsByRoot.get(sector.root.uuid)!} scale={scale}
        showWidth={!combinedWidth} /> : null}
      {hoverEntry && hoverEntry !== selectedEntry && sector.drawable.includes(hoverEntry) ?
        <rect className="front-hover-outline" data-hover-uuid={hoverEntry.node.uuid} x={hoverEntry.node.xMm! - SELECTION_GAP_MM}
          y={hoverEntry.node.yMm! - SELECTION_GAP_MM} width={hoverEntry.view.widthMm + 2 * SELECTION_GAP_MM}
          height={hoverEntry.view.heightMm + 2 * SELECTION_GAP_MM} /> : null}
      {selectedEntry && sector.drawable.includes(selectedEntry) ? <SelectionOverlay entry={selectedEntry} scale={scale} /> : null}
      {overlay?.parents.map(parentUuid => {
        const rect = sector.parentRects.get(parentUuid);
        return rect ? <rect key={parentUuid} className="front-target-parent" data-parent-uuid={parentUuid}
          x={rect.xMm} y={rect.yMm} width={rect.widthMm} height={rect.heightMm} /> : null;
      })}
      {hovered ? <g className="front-target-hover" data-parent-uuid={hovered.parentUuid}
        data-action={hovered.target.action}>
        {hovered.target.affected.map(entry => <rect key={entry.nodeUuid} className="front-target-affected"
          x={entry.rect.xMm} y={entry.rect.yMm} width={entry.rect.widthMm} height={entry.rect.heightMm} />)}
        <FrontShape className={hoverView?.assetKey && assets[hoverView.assetKey] ? "front-target-preview front-vector" : "front-target-preview"}
          x={hovered.target.subject.xMm} y={hovered.target.subject.yMm} width={hovered.target.subject.widthMm}
          height={hovered.target.subject.heightMm} assetKey={hoverView?.assetKey} assets={assets} />
        <rect className="front-target-subject" x={hovered.target.subject.xMm} y={hovered.target.subject.yMm}
          width={hovered.target.subject.widthMm} height={hovered.target.subject.heightMm} />
      </g> : null}
    </g>;
  };
  return <>
    <svg ref={svgRef} className="front-drawing" role="img"
      aria-label={`Fronte Quadro: ${drawingLabel}`}
      id="front-drawing" tabIndex={focusable ? 0 : undefined} aria-keyshortcuts={focusable ? "ArrowLeft ArrowRight" : undefined}
      viewBox={viewBox.join(" ")}>
      {sectors.map(sectorFrame)}
      {combinedWidth ? <FrontCombinedWidth width={combinedWidth} scale={scale} /> : null}
      <FrontAnnotations notes={annotations} scale={scale} layer={noteLayer} />
    </svg>
    {skipped.length > 0 ? <p className="front-notice" role="status">
      {skipped.length === 1 ? "Una carpenteria non è mostrata: geometria o posizione mancante."
        : `${skipped.length} carpenterie non sono mostrate: geometria o posizione mancante.`}</p> : null}
  </>;
}

/** Vector paths do not change while the pointer moves over the drawing. */
const StableFrontObject=memo(function StableFrontObject({node,item,view,assets,labels,scale}:FrontDrawable&{
  assets:FrontAssets;labels:boolean;scale:number|null;
}){return <FrontObject entry={{node,item,view}} assets={assets} labels={labels} scale={scale}/>;});

/**
 * The selected object (docs/R17_VISUAL_DESIGN.md §3.5): orange outline 1.5 mm outside it with a
 * faint fill, four corner handles and the article code tag at constant on-screen size. Drawn in
 * the object's own sector, so the sector's display offset applies exactly as to the object.
 */
function SelectionOverlay({ entry, scale }: { entry: FrontDrawable; scale: number | null }) {
  const code = articleCode(entry.item);
  const frame = selectionFrame({ x: entry.node.xMm!, y: entry.node.yMm!, width: entry.view.widthMm,
    height: entry.view.heightMm }, code, scale);
  return <g className="front-selection" data-selection-uuid={entry.node.uuid} aria-hidden="true">
    <rect className="front-selection-outline" x={frame.outline.x} y={frame.outline.y} width={frame.outline.width}
      height={frame.outline.height} />
    {frame.handles.map((handle, index) => <rect key={index} className="front-selection-handle" x={handle.x} y={handle.y}
      width={handle.width} height={handle.height} />)}
    {frame.tag ? <g className="front-selection-tag">
      <rect x={frame.tag.x} y={frame.tag.y} width={frame.tag.width} height={frame.tag.height} />
      <text x={frame.tag.textX} y={frame.tag.textY} fontSize={frame.tag.fontSize}>{code}</text>
    </g> : null}
  </g>;
}

interface DragState {
  id: number; subject: DragSubject; start: Point; pointer: Point; phase: DragPhase;
  loaded: LoadedTargets | null; hover: TargetEntry | null;
  automatic?: boolean;
  /**
   * The pointer has travelled the drag threshold. Targets load from the press (unchanged latency),
   * but nothing about the drag is shown before this: a press that stays put is a click, and it must
   * not look like a drag, a placement preview or a selection.
   */
  moved: boolean;
}
const DRAG_THRESHOLD_PX = 4;

/**
 * Progettazione (docs/R17_VISUAL_DESIGN.md §4.3–4.4): Struttura and Albero fisico on the left,
 * the Fronte Quadro as the dominant centre, Da posizionare and Proprietà on the right. Messages
 * and drag context go to the application status bar; placement stays the backend-validated
 * R-16/R-18 drag and drop over `placementTargets`.
 */
export function ProgettazioneScreen({ project, api, configurationApi, onProjectChange, section = "enclosure", onSectionChange,
  placementMode, onPlacementModeChange, catalogueNavigation, catalogueResults, catalogueDetails, modalOpen = false }: {
  project: ProjectDocumentView | null; api: ProjectApi;
  configurationApi?:ConfigurationApi;
  section?:DesignSection; onSectionChange?:(section:DesignSection)=>void;
  placementMode?:PlacementMode; onPlacementModeChange?:(mode:PlacementMode)=>void;
  catalogueNavigation?:ReactNode; catalogueResults?:ReactNode; catalogueDetails?:ReactNode; modalOpen?:boolean;
  onProjectChange: (project: ProjectDocumentView) => void;
}) {
  const [localPlacementMode,setLocalPlacementMode]=useState(initialShellState.placementMode);
  const mode=placementMode??localPlacementMode;
  const changePlacementMode=onPlacementModeChange??setLocalPlacementMode;
  const [selectedRoot, setSelectedRoot] = useState("");
  const [frontViewport,setFrontViewport]=useState<FrontViewportState>({zoom:1});
  const [error, setError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [dinOpen, setDinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const assets=useFrontAssets(api,project);
  const [pendingDrop,setPendingDrop]=useState<DragState|null>(null);
  const [drag,setDrag]=useState<DragState|null>(null);
  const [labels,setLabels]=useState(true);
  /** Horizontal position of the zoomed drawing (viewBox left edge, mm); null follows the focus. Display-only. */
  const [scrollX,setScrollX]=useState<number|null>(null);
  /** Vertical position of the zoomed drawing (viewBox top edge, mm); null follows the focus. Display-only. */
  const [scrollY,setScrollY]=useState<number|null>(null);
  /** Overall Carpenteria dimensions: off until asked for, and only ever drawn, never stored. */
  const [dimensions,setDimensions]=useState(false);
  const [combinedWidths, setCombinedWidths] = useState(true);
  useEffect(() => setCombinedWidths(true), [project?.metadata?.uuid]);
  const [canvasSize,setCanvasSize]=useState<{width:number;height:number}|null>(null);
  /** Persistent selection and transient hover, shared by Fronte Quadro, Albero fisico and Proprietà. Never the focus. */
  const [pointer,dispatchPointer]=useReducer(designSelectionReducer,initialDesignPointer);
  const [poolSelected,setPoolSelected]=useState<{owner:string;itemUuid:string}|null>(null);
  /** The Carpenteria whose removal is being confirmed. */
  const [removal,setRemoval]=useState<{uuid:string;error:string|null;restoreFocus:Element|null}|null>(null);
  const [reconfiguration,setReconfiguration]=useState<{uuid:string;error:string|null}|null>(null);
  const reconfiguring=useRef(false);
  const {announce,setSegments}=useStatusActions();
  const sectionRef=useRef<HTMLElement|null>(null);
  const catalogueActive=section==="device"&&!!catalogueResults;
  const panels=useSidePanels(catalogueActive?"catalogue":"design",sectionRef,section);
  const press=useRef<CanvasPress|null>(null);
  const dragRef=useRef<DragState|null>(null);
  const dragCounter=useRef(0);
  const svgRef=useRef<SVGSVGElement|null>(null);
  const hitContext=useRef<CombinedFrontGeometry|null>(null);
  const latest=useRef({api,onProjectChange,announce});
  latest.current={api,onProjectChange,announce};
  const keyContext=useRef<{selection:SelectedObject|null;poolSelected:boolean;busy:boolean;dialogOpen:boolean;
    unplace:(target:SelectedObject)=>void;openRemoval:(target:SelectedObject)=>void}|null>(null);
  // Esc clears the selection; Delete/Backspace unplaces it or asks how to remove a Carpenteria. Only while
  // Progettazione is the visible workspace, the key comes from it (or from no focused control), and is not text entry.
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      const section=sectionRef.current,context=keyContext.current;
      if(!section||!context||event.defaultPrevented||section.closest("[hidden]"))return;
      const target=event.target;
      const onPage=target===document.body||target===document.documentElement||target===document;
      if(!onPage&&!(target instanceof Node&&section.contains(target)))return;
      if(event.key==="Escape"&&context.poolSelected&&!context.busy&&!context.dialogOpen&&!isTextEntryTarget(target)){
        setPoolSelected(null);event.preventDefault();return;
      }
      const command=designKeyCommand(event,{selectedKind:context.selection?.kind??null,textEntry:isTextEntryTarget(target),
        dragging:dragRef.current!==null,busy:context.busy,dialogOpen:context.dialogOpen});
      if(!command||!context.selection)return;
      event.preventDefault();
      if(command==="clear")dispatchPointer({type:"clear"});
      else if(command==="unplace")context.unplace(context.selection);
      else context.openRemoval(context.selection);
    };
    window.addEventListener("keydown",key);
    return ()=>window.removeEventListener("keydown",key);
  },[]);
  dragRef.current=drag;
  // The document must not change under a drag, a pending write or a physical-action dialog.
  const editBlocked=useRef(false);
  editBlocked.current=busy||drag!==null||removal!==null||reconfiguration!==null||dinOpen||pdfOpen||modalOpen;
  useEffect(()=>registerDocumentEditBlocker(()=>editBlocked.current),[]);
  // The drawing's box, for hiding labels that would be too small to read. Hit-testing does not use it.
  const canvasElement=useRef<HTMLDivElement|null>(null);
  const canvasRef=useCallback((element:HTMLDivElement|null)=>{
    canvasElement.current=element;
    if(!element||typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(entries=>{
      const box=entries[0]?.contentRect;
      if(box)setCanvasSize(previous=>previous&&previous.width===box.width&&previous.height===box.height
        ?previous:{width:box.width,height:box.height});
    });
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);

  // Every placed Carpenteria is shown at once; `root` is only the focus.
  const roots=useMemo(()=>project?.physicalNodes.filter(node=>node.nodeKind==="enclosure")??[],[project?.physicalNodes]);
  const root=roots.find(node=>node.uuid===selectedRoot)??roots[0];
  const frontZoom=frontViewport.zoom;
  const items=useMemo(()=>project?physicalItems(project):[],[project?.configuredItems]);
  const annotations=project?.annotations??NO_ANNOTATIONS;
  const geometry=useMemo(()=>combinedFrontGeometry(roots,items,{zoom:frontZoom,focusUuid:root?.uuid,viewportPx:canvasSize,scrollX,scrollY,
    dimensions,combinedWidths,annotations,assets}),[roots,items,frontZoom,root?.uuid,canvasSize,scrollX,scrollY,dimensions,combinedWidths,annotations,assets]);
  const hasSectors=geometry.sectors.length>0;
  const hasDrawing=geometry.contentBounds!==null;
  hitContext.current=hasSectors?geometry:null;
  const thumb=scrollThumb(geometry);
  const thumbY=scrollThumbY(geometry);
  const navigation=useRef({geometry,scale:null as number|null});
  navigation.current={geometry,scale:canvasSize&&hasDrawing?drawingScale(canvasSize,geometry.viewBox):null};
  // A view centred on a removed carpenteria may leave some text boxes out of frame.
  useEffect(()=>{
    if(hasSectors)return;
    setFrontViewport(state=>state.zoom===1?state:updateFrontViewport(state,"fit"));
    setScrollX(null);setScrollY(null);
  },[hasSectors,hasDrawing]);
  /** Text boxes: draw, type, select, move, resize, delete. A box press never reaches the objects underneath. */
  const notes=useFrontNotes({annotations,api,onProjectChange,announce,svgRef,sectionRef,viewBox:()=>navigation.current.geometry.viewBox,
    blocked:()=>catalogueActive||busy||removal!==null||reconfiguration!==null||dragRef.current!==null||dinOpen||pdfOpen||modalOpen,physicalDragging:()=>dragRef.current!==null,
    onSelected:()=>{dispatchPointer({type:"clear"});setPoolSelected(null);},setError});
  editBlocked.current ||= notes.gesturing || !!notes.editing || notes.fontSaving;
  useEffect(()=>{
    const focused=document.activeElement;
    if(focused instanceof HTMLElement&&sectionRef.current?.contains(focused)&&focused.closest("[hidden]"))
      sectionRef.current.querySelector<HTMLButtonElement>('.design-sections button[aria-pressed="true"]')?.focus();
  },[section]);
  // Wheel and trackpad gestures over the drawing pan it: each axis follows its own delta (two-axis devices move both),
  // Shift turns a vertical wheel sideways. The listener is native so it can cancel the page scroll.
  useEffect(()=>{
    const element=canvasElement.current;
    if(!element)return;
    const wheel=(event:WheelEvent)=>{
      const {geometry:shown,scale}=navigation.current;
      const next=wheelPanTarget(shown,scale,event);
      if(next===null)return;
      event.preventDefault();
      if(next.x!==null)setScrollX(next.x);
      if(next.y!==null)setScrollY(next.y);
    };
    element.addEventListener("wheel",wheel,{passive:false});
    return ()=>element.removeEventListener("wheel",wheel);
  },[project!==null]);
  // Selection and hover follow node identity: whatever left the project is forgotten, as is a pending removal.
  useEffect(()=>{
    const present=selectableUuids(project?.physicalNodes??[]);
    dispatchPointer({type:"prune",present});
    setRemoval(current=>current&&!present.has(current.uuid)?null:current);
    setReconfiguration(current=>current&&!present.has(current.uuid)?null:current);
  },[project]);
  const selection=describeSelection(project,pointer.selectedUuid);
  const selectedUuid=selection?.node.uuid??null;
  const duplicateNodeUuid=selection&&selection.kind!=="enclosure"?selection.node.uuid:null;
  const duplicateQuery=useMemo(()=>project&&!catalogueActive&&duplicateNodeUuid
    ?()=>api.canDuplicatePlacedItem(duplicateNodeUuid):null,[api,catalogueActive,duplicateNodeUuid,project]);
  const canDuplicate=useReadOnlyQuery(duplicateQuery)?.value===true;
  // A Pannello/Apparecchio/Carpenteria selection (from the drawing or the tree) steps the selected text box aside.
  const clearNoteSelection=notes.clearSelection;
  useEffect(()=>{if(selectedUuid!==null)clearNoteSelection();},[selectedUuid,clearNoteSelection]);
  const structural=project?structuralPool(project):[];
  const devices=project?devicePool(project):[];
  const poolSelection=poolSelected!==null&&poolSelected.owner===project?.metadata?.uuid
    ? [...structural,...devices].find(entry=>entry.available>0&&entry.item.uuid===poolSelected.itemUuid)??null : null;
  const selectedPoolUuid=poolSelection?.item.uuid;
  useEffect(()=>{if(selectedUuid!==null||selectedPoolUuid===undefined)setPoolSelected(null);},[selectedUuid,selectedPoolUuid]);
  const selectPoolItem=(item:ProjectConfiguredItem)=>{
    if(!project||busy||removal||reconfiguration||dinOpen||pdfOpen||modalOpen)return;
    setPoolSelected({owner:project.metadata.uuid,itemUuid:item.uuid});
    dispatchPointer({type:"clear"});
    clearNoteSelection();
  };

  /** Geometry only: which returned target rectangle is under the pointer, in the sector it is over. */
  const computeHover=(pointer:Point,loaded:LoadedTargets|null,subject:DragSubject):TargetEntry|null=>{
    const svg=svgRef.current;const context=hitContext.current;
    if(!svg||!context||!loaded)return null;
    const drawn=clientToViewBox(pointer,svg.getBoundingClientRect(),context.viewBox);
    return drawn?pickCombinedTarget(loaded.entries,context,drawn,subject.kind,subject.nodeUuid)?.entry??null:null;
  };

  const beginDrag=(subject:DragSubject,event:{clientX:number;clientY:number;preventDefault:()=>void})=>{
    if(!root||busy||dragRef.current)return;
    event.preventDefault();
    const id=++dragCounter.current;
    const start={x:event.clientX,y:event.clientY};
    if(mode==="auto"&&subject.origin==="pool"){
      setDrag({id,subject,start,pointer:start,phase:"ready",loaded:null,hover:null,moved:false,automatic:true});
      setError(null);
      return;
    }
    setDrag({id,subject,start,pointer:start,phase:"loading",loaded:null,hover:null,moved:false});
    setError(null);
    loadPlacementTargets(api,subject,root,roots).then(loaded=>{
      if(dragCounter.current!==id)return;
      setDrag(current=>current&&current.id===id?{...current,phase:"ready",loaded,
        hover:computeHover(current.pointer,loaded,current.subject)}:current);
    },error=>{
      if(dragCounter.current!==id)return;
      setDrag(current=>current&&current.id===id?{...current,phase:"failed"}:current);
      // A click (no drag shown) does not report a failure it never showed guidance for.
      if(dragRef.current?.id===id&&dragRef.current.moved)setError(placementFailureMessage(error));
    });
  };

  const placeAutomatically=async(subject:ProjectPlacementSubject)=>{
    const {api,onProjectChange,announce}=latest.current;
    setBusy(true);setError(null);
    try{
      const updated=await api.autoPlaceItem(subject);
      if(updated.autoPlacement==="unplaced"){
        setError("Nessuna posizione compatibile disponibile.");
        announce("Nessuna posizione compatibile disponibile.");
        return;
      }
      onProjectChange(updated);
      announce(updated.autoPlacement==="unchanged"?"L’articolo è già nella prima posizione compatibile.":"Articolo posizionato automaticamente.","ok");
    }catch(error){
      setError(`Posizionamento non eseguito. ${placementFailureMessage(error)}`);
      announce("Posizionamento non eseguito.");
    }finally{setPendingDrop(null);setBusy(false);}
  };

  const dragging=drag!==null;
  useEffect(()=>{
    if(!dragging)return;
    let frame:number|null=null,latestPoint:Point|null=null;
    const clearFrame=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;latestPoint=null;};
    const stop=()=>{clearFrame();dragCounter.current++;setDrag(null);};
    const cancel=()=>{stop();latest.current.announce(null);};
    const move=(event:PointerEvent)=>{
      latestPoint={x:event.clientX,y:event.clientY};
      if(frame!==null)return;
      frame=requestAnimationFrame(()=>{
        frame=null;const pointer=latestPoint!;latestPoint=null;
        setDrag(current=>current?{...current,pointer,
          moved:current.moved||Math.hypot(pointer.x-current.start.x,pointer.y-current.start.y)>=DRAG_THRESHOLD_PX,
          hover:current.phase==="ready"?computeHover(pointer,current.loaded,current.subject):null}:current);
      });
    };
    const finish=(event:PointerEvent)=>{
      const current=dragRef.current;
      if(!current)return;
      const pointer={x:event.clientX,y:event.clientY};
      const moved=Math.hypot(pointer.x-current.start.x,pointer.y-current.start.y)>=DRAG_THRESHOLD_PX;
      stop();
      const {announce}=latest.current;
      // Under the drag threshold this was a click: it selects (see the canvas press) and never moves anything.
      if(!moved){announce(null);return;}
      if(current.automatic){
        const box=svgRef.current?.getBoundingClientRect();
        if(!box||pointer.x<box.left||pointer.x>box.right||pointer.y<box.top||pointer.y>box.bottom){
          announce("Rilascia l’articolo sul disegno per posizionarlo automaticamente.");
          return;
        }
        setPendingDrop({...current,pointer,moved:true});
        void placeAutomatically(current.subject.nodeUuid?{nodeUuid:current.subject.nodeUuid}:{itemUuid:current.subject.item.uuid});
        return;
      }
      const hover=current.phase==="ready"?computeHover(pointer,current.loaded,current.subject):null;
      if(!hover){
        announce(current.phase==="ready"?"Nessuna modifica: rilascia su una posizione evidenziata."
          :"Posizioni non ancora verificate: nessuna modifica.");
        return;
      }
      setPendingDrop({...current,pointer,hover,moved:true});
      setBusy(true);setError(null);
      dropOnTarget(latest.current.api,current.subject,hover.target).then(updated=>{
        latest.current.onProjectChange(updated);
        announce(dropSuccessMessage(current.subject),"ok");
      },error=>{
        setError(`Posizionamento non eseguito. ${placementFailureMessage(error)}`);
        announce("Posizionamento non eseguito.");
      }).finally(()=>{setPendingDrop(null);setBusy(false);});
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")cancel();};
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish);
    window.addEventListener("pointercancel",cancel);
    window.addEventListener("keydown",escape);
    return ()=>{
      clearFrame();
      window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",finish);
      window.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",escape);
    };
  },[dragging]);

  // The drag as the user sees it: only once the pointer has moved past the threshold (see DragState.moved).
  const shown=drag&&drag.moved?drag:pendingDrop;
  // The status bar mirrors the drag guidance (§4.4); the drop result replaces it when the drag ends.
  const guidance=pendingDrop?"Spostamento in corso…":shown?.automatic?"Rilascia sul disegno per posizionare automaticamente.":
    shown?dragGuidance(shown.subject,shown.phase,shown.loaded,shown.hover,roots.length):null;
  const guidanceTone=shown?.hover?"valid":"neutral";
  useEffect(()=>{if(guidance!==null)announce(guidance,guidanceTone);},[announce,guidance,guidanceTone]);

  const configured=new Map(project?.configuredItems.map(item=>[item.uuid,item])??[]);
  const located=shown?.hover?locateNode(roots,shown.hover.parentUuid):undefined;
  const destinationItem=located?.node.itemUuid?configured.get(located.node.itemUuid):undefined;
  const destinationRoot=located&&roots.length>1&&located.root.uuid!==located.node.uuid&&located.root.itemUuid
    ?configured.get(located.root.itemUuid):undefined;
  const destination=shown?.hover?{name:`${destinationItem?.modelName??"posizione evidenziata"}${
    destinationRoot?` · ${destinationRoot.modelName}`:""}`,
    start:targetStartText(shown.hover.target,destinationItem)}:null;
  const segments=designStatusSegments({supportsToPlace:unitsToPlace(structural),devicesToPlace:unitsToPlace(devices),
    zoom:frontZoom,dragging:shown?{code:articleCode(shown.subject.item),occupancy:occupancyText(shown.subject.item)}:null,
    destination,selection:selection?{code:selection.item?articleCode(selection.item):"Codice non disponibile",
      detail:[KIND_LABEL[selection.kind],nodeStartText(selection.node,selection.parentItem)].filter(Boolean).join(" · ")}:null});
  // Publishing unchanged segments is a no-op in the status reducer, so this can run after every render.
  useEffect(()=>{setSegments("design",project?segments:null);});
  useEffect(()=>()=>setSegments("design",null),[setSegments]);

  if (!project) return <section className="design-empty"><h2>Progettazione</h2><p>Apri o crea un progetto per posizionare gli articoli fisici.</p></section>;
  const itemById = new Map(items.map(item => [item.uuid, item]));
  const overlay:FrontOverlay|null=shown&&shown.phase==="ready"&&shown.loaded?{
    parents:[...new Set(shown.loaded.entries.map(entry=>entry.parentUuid))],hover:shown.hover,subject:shown.subject}:null;

  /** "Rimuovi posizione": the backend unplaces the node (a Pannello with its contents); configured items and Q stay. */
  const unplace = async (target: SelectedObject) => {
    const blocked = unplaceBlockReason(target);
    if (blocked) { announce(blocked); return; }
    setBusy(true); setError(null);
    if (target.kind === "enclosure") return;
    try { onProjectChange(await submitSelectionUnplacement(api,target.kind,target.node.uuid));
      announce(`${target.kind==="support"&&target.devices>0?`Pannello e ${countText(target.devices,"apparecchio","apparecchi")} tornati`
        :`${KIND_LABEL[target.kind]} tornato`} tra gli elementi da posizionare. Salva il progetto per conservare le modifiche.`,"ok"); }
    catch (caught) { setError(placementFailureMessage(caught)); announce("Posizione non rimossa."); }
    finally { setBusy(false); }
  };
  const duplicatePlaced=async()=>{
    if(!duplicateNodeUuid||!canDuplicate||busy||dragRef.current)return;
    setBusy(true);setError(null);
    try{
      onProjectChange(await api.duplicatePlacedItem(duplicateNodeUuid));
      announce("Copia posizionata.","ok");
    }catch(caught){
      setError(placementFailureMessage(caught));
      announce("Duplicazione non eseguita.");
    }finally{setBusy(false);}
  };
  const openRemoval=(target:SelectedObject)=>{
    if(target.kind==="enclosure")setRemoval({uuid:target.node.uuid,error:null,
      restoreFocus:typeof document==="undefined"?null:document.activeElement});
  };
  const closeRemoval=()=>{
    const restore=removal?.restoreFocus;
    setRemoval(null);
    const target=restore instanceof HTMLElement||restore instanceof SVGElement?restore:null;
    if(target?.isConnected)target.focus({preventScroll:true});else svgRef.current?.focus({preventScroll:true});
  };
  /** Whole-Carpenteria removal is one backend transaction; the renderer never dismantles the tree. */
  const removeRoot=async(contents:ProjectRootRemoval)=>{
    if(!removal)return;
    setBusy(true);
    try {
      onProjectChange(await api.removePhysicalRoot(removal.uuid,contents));
      closeRemoval();
      announce(contents==="keep-contents"?"Carpenteria rimossa; il contenuto è tornato tra gli elementi da posizionare. Salva il progetto per conservare le modifiche."
        :"Carpenteria e contenuto rimossi dal progetto. Salva il progetto per conservare le modifiche.","ok");
    } catch (caught) {
      setRemoval(current=>current&&{...current,error:`Rimozione non eseguita. ${placementFailureMessage(caught)}`});
    } finally { setBusy(false); }
  };
  const removalTarget=removal?describeSelection(project,removal.uuid):null;
  const reconfigurationTarget=reconfiguration?describeSelection(project,reconfiguration.uuid):null;
  const reconfigure=async(request:ConfigurationRequest)=>{
    if(!reconfiguration||!project||reconfiguring.current)return;
    reconfiguring.current=true;setBusy(true);
    setReconfiguration(current=>current&&{...current,error:null});
    try {
      const result=await submitEnclosureConfiguration(api,project,reconfiguration.uuid,request);
      onProjectChange(result.project);
      setReconfiguration(null);
      announce(result.message,"ok");
    }catch(caught){setReconfiguration(current=>current&&{...current,error:enclosureFailureMessage(caught)});}
    finally{reconfiguring.current=false;setBusy(false);}
  };
  keyContext.current={selection,poolSelected:poolSelection!==null,busy,dialogOpen:catalogueActive||removalTarget!==null||reconfigurationTarget!==null||dinOpen||pdfOpen||modalOpen,unplace,openRemoval};

  /** A press on the drawing: a node (its UUID) or empty drawing space; the release decides whether it was a click. */
  const canvasPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
    press.current=null;
    if(event.button!==0)return;
    const target=event.target as Element;
    const inDrawing=svgRef.current?.contains(target)??false;
    // Controls inside the canvas (scrollbar, messages) are not drawing space.
    if(!inDrawing&&target!==event.currentTarget)return;
    // A text box (or the drawing while a box is being drawn) takes the press: nothing underneath is selected or dragged.
    if(notes.pointerDown(event))return;
    const node=inDrawing?target.closest("[data-node-uuid]"):null;
    press.current={uuid:node?.getAttribute("data-node-uuid")??null,x:event.clientX,y:event.clientY};
  };
  const canvasPointerUp=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const action=pressOutcome(press.current,{x:event.clientX,y:event.clientY},DRAG_THRESHOLD_PX);
    press.current=null;
    if(!action)return;
    setPoolSelected(null);
    dispatchPointer(action);
    // Keyboard commands follow the drawing that was just clicked.
    if(action.type==="select"){
      const selected=describeSelection(project,action.uuid);
      if(selected&&selected.root.uuid!==selectedRoot)focusRoot(selected.root.uuid);
      svgRef.current?.focus({preventScroll:true});
    }
  };
  const hoverNode=(uuid:string|null,source:"tree"|"canvas")=>dispatchPointer({type:"hover",uuid,source});
  const {canvas:canvasHover,tree:treeHover}=hoverHighlights(pointer,drag!==null);
  const selectFromTree=(node:ProjectPhysicalNode,rootUuid:string)=>{
    setPoolSelected(null);
    dispatchPointer({type:"select",uuid:node.uuid});
    if(rootUuid!==selectedRoot)focusRoot(rootUuid);
  };

  const grabNode=(node:ProjectPhysicalNode,event:ReactPointerEvent<SVGGElement>)=>{
    const item=node.itemUuid?itemById.get(node.itemUuid):undefined;
    if(!item||(node.nodeKind!=="support"&&node.nodeKind!=="device"))return;
    beginDrag({origin:"node",kind:node.nodeKind,item,nodeUuid:node.uuid,
      ...(node.parentUuid?{parentUuid:node.parentUuid}:{})},event);
  };
  const zoomTo=(action:FrontViewportAction)=>{
    if(!hasDrawing)return;
    setScrollX(null);setScrollY(null);
    setFrontViewport(state=>updateFrontViewport(state,action));
  };
  const focusRoot=(uuid:string)=>{setScrollX(null);setScrollY(null);setSelectedRoot(uuid);};
  // Arrows scroll only when the drawing itself has focus, never for a control inside or outside it.
  const canvasKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    // Ctrl/Cmd + arrows pan on both axes; never while text is being typed (the annotation form lives in the canvas).
    const pan=isTextEntryTarget(event.target)?null:keyPanTarget(geometry,event,event.target===svgRef.current);
    if(pan){
      event.preventDefault();
      if(pan.x!==null)setScrollX(pan.x);
      if(pan.y!==null)setScrollY(pan.y);
      return;
    }
    const next=keyScrollTarget(geometry,event,event.target===svgRef.current);
    if(next===null)return;
    event.preventDefault();
    setScrollX(next);
  };
  const undoLabel=project?.history?.undoLabel??null,redoLabel=project?.history?.redoLabel??null;
  const shortcuts=isMacPlatform()?{undo:"⌘Z",redo:"⇧⌘Z"}:{undo:"Ctrl+Z",redo:"Ctrl+Y"};
  const documentEdit=(command:"undo"|"redo")=>runDocumentEdit(command,{project,api,adopt:onProjectChange,announce});
  /** Inserisci falsi poli DIN: one backend action over every placed Pannello; Annulla reverts it whole. */
  const fillDin=async()=>{
    if(!root||busy||drag)return;
    setBusy(true);setError(null);
    try{
      const view=await api.fillCapacity({capacityKind:"din_rail"});
      onProjectChange(view);
      announce(fillReportMessage(view.fillReport),view.fillReport?.inserted?"ok":"neutral");
    }catch(failure){
      const message=failure instanceof Error&&failure.message?failure.message:"Inserimento dei falsi poli non riuscito.";
      setError(message);announce("Falsi poli non inseriti.");
    }finally{setBusy(false);}
  };
  const ghostView=drag?previewView(drag.subject.item):undefined;
  const ghost=ghostView?ghostSize(ghostView,canvasSize&&geometry.sectors.length?drawingScale(canvasSize,geometry.viewBox):null)
    :{width:0,height:0};

  return <section className="design-screen" data-catalogue={catalogueActive||undefined} aria-label="Progettazione" ref={panels.ref} style={panels.style}>
    <div className="design-structure">
      {onSectionChange?<div className="segmented design-sections" role="group" aria-label="Sezione progettazione">
        {([ ["device","Apparecchi"], ["enclosure","Carpenterie"], ["support","Pannelli"] ] as const).map(([kind,label]) =>
          <button key={kind} type="button" aria-pressed={section===kind} disabled={busy||!!drag||dinOpen||pdfOpen}
            onClick={()=>onSectionChange(kind)}>{label}</button>)}
      </div>:null}
      <div className="design-catalogue-navigation" hidden={!catalogueActive}>{catalogueNavigation}</div>
      <div className="design-structural-docks" hidden={catalogueActive}>
        {configurationApi?<StructuralWorkflow project={project} api={api} configurationApi={configurationApi}
          section={onSectionChange?(section==="device"?"enclosure":section):undefined} onSectionChange={onSectionChange}
          panel={structuralDevicePanel(selection,root)}
          root={root} panelFocusUuid={roots.length===1?roots[0]!.uuid:roots.find(entry=>entry.uuid===selectedRoot)?.uuid??null}
          onFocusRoot={focusRoot} onProjectChange={onProjectChange} autoPlace={mode==="auto"}
          onRootCreated={uuid=>{focusRoot(uuid);dispatchPointer({type:"select",uuid});}}/>:null}
        <PhysicalTree roots={roots} items={itemById} currentRootUuid={root?.uuid} selectedUuid={selectedUuid}
          hoverUuid={treeHover} onSelect={selectFromTree} onHover={uuid=>hoverNode(uuid,"tree")}/>
      </div>
    </div>
    {panels.divider("left",busy||!!drag||notes.gesturing||!!notes.editing||!!removal||!!reconfiguration||pdfOpen||dinOpen||modalOpen)}
    <div className="design-catalogue-results" hidden={!catalogueActive}>{catalogueResults}</div>
    <section className="design-front" hidden={catalogueActive} aria-labelledby="design-front-title">
      <header className="front-toolbar">
        <h3 id="design-front-title">Fronte Quadro</h3>
        <button type="button" className="toolbar-button" aria-label="Esporta Fronte Quadro PDF"
          title="Esporta o stampa il Fronte Quadro completo"
          disabled={!hasSectors||busy||!!drag||notes.gesturing||!!notes.editing||notes.fontSaving}
          onClick={()=>setPdfOpen(true)}><Icon name="download"/>PDF</button>
        <span className="toolbar-spacer"/>
        <div className="front-view-tools">
          <div className="front-view-toggles" role="group" aria-label="Vista">
            <button type="button" className="icon-button toolbar-toggle" aria-pressed={labels} aria-label="Etichette"
              title="Etichette: codici sugli oggetti senza disegno" disabled={!root} onClick={()=>setLabels(value=>!value)}>
              <Icon name="tag"/></button>
            <button type="button" className="icon-button toolbar-toggle" aria-pressed={dimensions} aria-label="Quote"
              title="Quote: larghezza, altezza e profondità disponibile delle carpenterie" disabled={!root}
              onClick={()=>setDimensions(value=>!value)}><Icon name="dimension"/></button>
            {dimensions && geometry.canCombineWidths ? <button type="button" className="toolbar-button toolbar-toggle"
              aria-pressed={combinedWidths} title="Somma le larghezze delle carpenterie, esclusi gli spazi nel disegno"
              onClick={() => setCombinedWidths(value => !value)}>Larghezze combinate</button> : null}
            <button type="button" className="icon-button toolbar-toggle" aria-pressed={notes.adding} aria-label="Aggiungi testo"
              title="Aggiungi testo: fai clic sul disegno per inserire un'annotazione" disabled={!hasDrawing||busy}
              onClick={notes.toggleAdding}><Icon name="text"/></button>
          </div>
          <span className="toolbar-divider" aria-hidden="true"/>
          <div className="front-placement-mode" role="group" aria-label="Modalità di posizionamento">
            <span aria-hidden="true">Modalità</span>
            <button type="button" className="toolbar-button" aria-pressed={mode==="auto"} disabled={busy||dragging}
              onClick={()=>changePlacementMode("auto")}>Auto</button>
            <button type="button" className="toolbar-button" aria-pressed={mode==="free"} disabled={busy||dragging}
              onClick={()=>changePlacementMode("free")}>Libera</button>
          </div>
        </div>
        <span className="toolbar-divider" aria-hidden="true"/>
        <div className="front-edit-controls" role="group" aria-label="Modifica">
          <button type="button" className="icon-button" aria-label={undoLabel?`Annulla ${undoLabel}`:"Annulla"}
            title={undoLabel?`Annulla ${undoLabel} (${shortcuts.undo})`:`Annulla (${shortcuts.undo})`}
            disabled={!undoLabel||busy||!!drag} onClick={()=>void documentEdit("undo")}><Icon name="undo"/></button>
          <button type="button" className="icon-button" aria-label={redoLabel?`Ripeti ${redoLabel}`:"Ripeti"}
            title={redoLabel?`Ripeti ${redoLabel} (${shortcuts.redo})`:`Ripeti (${shortcuts.redo})`}
            disabled={!redoLabel||busy||!!drag} onClick={()=>void documentEdit("redo")}><Icon name="redo"/></button>
          {configurationApi?<button type="button" className="toolbar-button" disabled={!root||busy||!!drag||notes.gesturing||!!notes.editing}
            onClick={()=>setDinOpen(true)}>DIN generico</button>:null}
          <button type="button" className="toolbar-button" disabled={!root||busy||!!drag}
            title="Inserisci falsi poli DIN: chiude con falsi poli ogni spazio libero delle guide DIN di tutti i pannelli posizionati"
            onClick={()=>void fillDin()}><Icon name="fill"/>Falsi poli DIN</button>
        </div>
        {notes.selectedNote?<NoteFontControls fontSizeMm={notes.selectedNote.fontSizeMm} busy={busy||notes.fontSaving}
          onChange={notes.changeFontSize}/>:null}
        <span className="toolbar-divider" aria-hidden="true"/>
        <div className="front-viewport-controls" role="group" aria-label="Zoom Fronte Quadro">
          <button type="button" className="icon-button" aria-label="Riduci Fronte Quadro" title="Riduci"
            disabled={!hasDrawing||frontZoom<=.5} onClick={()=>zoomTo("out")}><Icon name="minus"/></button>
          <span className="front-zoom" aria-live="polite">{Math.round(frontZoom*100)}%</span>
          <button type="button" className="icon-button" aria-label="Ingrandisci Fronte Quadro" title="Ingrandisci"
            disabled={!hasDrawing||frontZoom>=4} onClick={()=>zoomTo("in")}><Icon name="plus"/></button>
          <button type="button" className="toolbar-button" disabled={!hasDrawing||frontZoom===1}
            onClick={()=>zoomTo("fit")}><Icon name="fit"/>Adatta vista</button>
        </div>
      </header>
      <div className="front-canvas" ref={canvasRef} data-adding-note={notes.adding?"true":undefined}
        onKeyDown={canvasKey} onPointerDown={canvasPointerDown} onPointerUp={canvasPointerUp}>
        {roots.length || annotations.length ? <FronteQuadro roots={roots} focusUuid={root?.uuid} scrollX={scrollX} items={items} assets={assets}
          zoom={frontZoom} scrollY={scrollY} dimensions={dimensions} combinedWidths={combinedWidths} annotations={annotations}
          noteLayer={notes.layer} overlay={overlay} svgRef={svgRef} focusable onNodePointerDown={busy||drag||notes.adding?undefined:grabNode} labels={labels} viewportPx={canvasSize}
          selectedUuid={selectedUuid} hoverUuid={canvasHover} onNodeHover={uuid=>hoverNode(uuid,"canvas")} />
          : <p className="front-empty">Aggiungi una carpenteria da Struttura per vedere il fronte.</p>}
        {thumb?<FrontScrollbar start={thumb.start} size={thumb.size} onStart={start=>{
          const {min,max}=geometry.scrollRange;setScrollX(min+start*(max-min+geometry.viewBox[2]));}}/>:null}
        {thumbY?<FrontScrollbar orientation="vertical" start={thumbY.start} size={thumbY.size} onStart={start=>{
          const {min,max}=geometry.scrollRangeY;setScrollY(min+start*(max-min+geometry.viewBox[3]));}}/>:null}
        {shown ? <div className="front-chip" data-tone={shown.hover?"valid":shown.phase==="failed"?"error":"neutral"}>
          <span className="front-chip-dot" aria-hidden="true"/>
          <span className="front-chip-text"><strong>{guidance}</strong>
            {destination ? <span>{destination.name}{destination.start ? ` · ${destination.start}` : ""}</span>
              : shown.phase==="failed"&&error ? <span>{error}</span> : null}</span>
          <span className="front-chip-key">{pendingDrop?"Attendi…":<><kbd>Esc</kbd> annulla</>}</span>
        </div> : error ? <div className="front-chip" data-tone="error" role="alert">
          <Icon name="alert"/><span className="front-chip-text">{error}</span>
        </div> : null}
      </div>
    </section>
    {panels.divider("right",busy||!!drag||notes.gesturing||!!notes.editing||!!removal||!!reconfiguration||pdfOpen||dinOpen||modalOpen)}
    <div className="design-controls">
      <div className="design-catalogue-details" hidden={!catalogueActive}>{catalogueDetails}</div>
      <div className="design-placement-slot" hidden={catalogueActive}>
      <PhysicalPool structural={structural} devices={devices} hasRoot={!!root}
        activeItemUuid={shown?.subject.origin==="pool"?shown.subject.item.uuid:poolSelection?.item.uuid}
        onSelect={selectPoolItem}
        onAutoPlace={mode==="auto"?item=>{if(!busy&&!dragRef.current)void placeAutomatically({itemUuid:item.uuid});}:undefined}
        onDragStart={(kind,item,event)=>beginDrag({origin:"pool",kind,item},event)} />
      </div>
      <div className="design-properties-slot" hidden={catalogueActive}>
      <DesignProperties selection={selection} poolSelection={poolSelection} assets={assets} busy={busy} onUnplace={target=>void unplace(target)}
        canDuplicate={canDuplicate&&!dragging} onDuplicate={()=>void duplicatePlaced()}
        onRemoveRoot={openRemoval} onReconfigure={configurationApi?target=>{
          if(target.kind==="enclosure"&&!busy&&!drag)setReconfiguration({uuid:target.node.uuid,error:null});
        }:undefined}/>
      </div>
    </div>
    {dinOpen&&configurationApi?<DinConfigurationDialog key={structuralDevicePanel(selection,root)?.uuid??"none"}
      project={project} api={api} configurationApi={configurationApi} panel={structuralDevicePanel(selection,root)}
      onProjectChange={onProjectChange} onClose={()=>setDinOpen(false)}/>:null}
    {removal&&removalTarget?<RemoveCarpenteriaDialog name={removalTarget.item?.modelName??"Carpenteria"}
      supports={removalTarget.supports} devices={removalTarget.devices} busy={busy} error={removal.error}
      onChoose={contents=>void removeRoot(contents)} onCancel={closeRemoval}/>:null}
    {reconfiguration&&reconfigurationTarget?.item&&configurationApi?<EnclosureConfigurationDialog
      key={reconfiguration.uuid} api={configurationApi} item={reconfigurationTarget.item}
      quantity={reconfigurationTarget.quantity} busy={busy} error={reconfiguration.error}
      onApply={request=>void reconfigure(request)} onCancel={()=>{if(!reconfiguring.current)setReconfiguration(null);}}/>:null}
    {drag&&drag.moved?<div className="drag-ghost" aria-hidden="true" data-hovering={drag.hover!==null}
      style={{left:drag.pointer.x,top:drag.pointer.y,
        width:ghost.width,height:ghost.height}}>
      <SubjectPreview view={ghostView} assets={assets} label={`Anteprima ${drag.subject.item.modelName}`} />
    </div>:null}
    {pdfOpen ? <DocumentPdfDialog api={api} initialKind="fronte-quadro" frontOptions={{labels,dimensions,combinedWidths}}
      onClose={()=>setPdfOpen(false)}/> : null}
    <FullTextTooltip scopeRef={sectionRef}/>
  </section>;
}
