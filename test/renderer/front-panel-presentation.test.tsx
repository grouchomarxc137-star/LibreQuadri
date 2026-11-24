import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FronteQuadro } from "../../src/renderer/project/ProgettazioneScreen.js";
import { buildFrontDocument } from "../../src/main/documents/front-document.js";
import { combinedFrontGeometry } from "../../src/drawing/front-geometry.js";
import { frontOpening, frontPrintable } from "../../src/drawing/front-primitives.js";
import { frontProject, frontAssets } from "../helpers/front-project.js";

function fixture(symbolKind:string,assetKey:string|null) {
  return {...structuredClone(frontProject),configuredItems:frontProject.configuredItems.map(item=>item.uuid!=="panel"?item:
    {...item,views:item.views.map(view=>({...view,symbolKind,assetKey}))})};
}
const drawing=(html:string)=>html.slice(html.indexOf('<svg class="front-drawing"'),html.lastIndexOf("</svg>")+6);

it("prints physical panel artwork or a solid fallback, independently of asset availability",()=>{
  for(const key of ["vector","missing",null]) {
    const project=fixture("physical_panel",key),before=structuredClone(project);
    for(const assets of [frontAssets,{}]) {
      const screen=renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems} assets={assets}/>);
      const pdf=buildFrontDocument(project,assets,{labels:true,dimensions:true});
      for(const markup of [screen,drawing(pdf.html)]) {
        expect(markup).not.toContain("front-opening");
        if(key==="vector"&&assets===frontAssets) expect(markup).toContain('d="M 0 0 L 54 45"');
        else expect(markup).toContain('x="90" y="170" width="500" height="200"');
      }
      expect(pdf.html).toMatch(/\.front-support rect \{ fill: #F3F5F7; stroke: #2B3139; \}/);
    }
    expect(project).toEqual(before);
  }
});

it.each(["senza","vector"])("keeps explicit guides selectable and non-printable independently of asset lookup (%s)",key=>{
  const project=fixture("mounting_guide",key),before=structuredClone(project);
  const screen=renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems} assets={frontAssets}
    selectedUuid="panel" onNodePointerDown={()=>undefined} onNodeHover={()=>undefined}/>);
  expect(screen).toContain('front-draggable front-opening');
  expect(screen).toContain('data-selected="true"');
  expect(screen).toContain('class="front-hit" x="90" y="170" width="500" height="200"');
  expect(screen).toContain('class="front-selection');
  expect(readFileSync("src/renderer/styles.css","utf8"))
    .toMatch(/\.front-support\.front-opening rect:not\(\.front-hit\) \{ fill: none;[^}]*stroke-dasharray: 4 2;/);
  for(const labels of [true,false]) for(const dimensions of [true,false]) {
    const pdf=buildFrontDocument(project,frontAssets,{labels,dimensions});
    expect(drawing(pdf.html)).not.toContain('class="front-support');
    expect(drawing(pdf.html)).toContain('class="front-device"');
    expect(drawing(pdf.html)).toContain('d="M 0 0 L 54 45"');
    expect(drawing(pdf.html)).toContain('class="front-enclosure"');
    expect(pdf.viewBox).toEqual(combinedFrontGeometry(project.physicalNodes,project.configuredItems,
      {dimensions,annotations:project.annotations}).viewBox);
  }
  expect(combinedFrontGeometry(project.physicalNodes,project.configuredItems).sectors[0]!.parentRects.get("panel"))
    .toEqual({xMm:90,yMm:170,widthMm:500,heightMm:200});
  expect(project).toEqual(before);
});

it("retains legacy/unclassified presentation without rewriting a snapshot",()=>{
  for(const role of ["panel","din_panel","rectangle","future_role"]) for(const key of [null,"vector"]) {
    const project=fixture(role,key);
    const entry=combinedFrontGeometry(project.physicalNodes,project.configuredItems).sectors[0]!.drawable
      .find(entry=>entry.node.uuid==="panel")!;
    expect(frontOpening(entry,frontAssets)).toBe(key===null);
    expect(frontPrintable(entry)).toBe(true);
    expect(drawing(buildFrontDocument(project,frontAssets,{labels:true,dimensions:false}).html))
      .toContain(key===null?'class="front-support front-opening"':'class="front-support"');
  }
});
