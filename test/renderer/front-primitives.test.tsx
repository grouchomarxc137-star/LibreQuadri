import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FrontObject, FrontCaption, FrontNoteContent } from "../../src/drawing/FrontContent.js";
import { FrontDimensions } from "../../src/drawing/FrontDimensions.js";
import { FrontShape } from "../../src/drawing/FrontShape.js";
import { frontShapePrimitive, type FrontPrimitive } from "../../src/drawing/front-primitives.js";
import { combinedFrontGeometry, sectorDimensions } from "../../src/drawing/front-geometry.js";
import { frontPrimitiveMarkup } from "../../src/main/documents/front-markup.js";
import { buildFrontDocument } from "../../src/main/documents/front-document.js";
import { frontProject, frontAssets } from "../helpers/front-project.js";

const sameEntities = (html: string) => html.replaceAll("&#x27;", "&#39;");
it("renders the printable shared primitives identically through the screen adapter and the main serializer", () => {
  for (const labels of [true, false]) for (const dimensions of [true, false]) for (const vectors of [true, false]) {
    const assets = vectors ? frontAssets : {};
    const geometry = combinedFrontGeometry(frontProject.physicalNodes, frontProject.configuredItems,
      { dimensions, annotations: frontProject.annotations });
    const screen = renderToStaticMarkup(<svg className="front-drawing" xmlns="http://www.w3.org/2000/svg"
      viewBox={geometry.viewBox.join(" ")} preserveAspectRatio="xMidYMid meet">
      {geometry.sectors.map(sector => <g key={sector.root.uuid} className="front-sector"
        transform={sector.offset.x || sector.offset.y ? `translate(${sector.offset.x} ${sector.offset.y})` : undefined}>
        <FrontCaption sector={sector} captionMm={geometry.captionMm} />
        {sector.drawable.map(entry => <g key={entry.node.uuid}
          className={`front-${entry.node.nodeKind}${entry.node.nodeKind === "support" ? " front-opening" : ""}`}>
          <FrontObject entry={entry} assets={assets} labels={labels} scale={null}/>
        </g>)}
        {dimensions ? <FrontDimensions dimensions={sectorDimensions(sector)} scale={null}/> : null}
      </g>)}
      <g className="front-annotations">{frontProject.annotations.map(note => <g key={note.uuid} className="front-note">
        <FrontNoteContent note={note}/>
      </g>)}</g>
    </svg>);
    const { html } = buildFrontDocument(frontProject, assets, { labels, dimensions });
    const printed = html.slice(html.indexOf('<svg class="front-drawing"'), html.lastIndexOf("</svg>") + 6);
    expect(sameEntities(printed)).toBe(sameEntities(screen));
  }
});

it("keeps vector and fallback geometry identical at fractional/negative coordinates with alternate asset bounds", () => {
  const assets = { v: { ...frontAssets.vector, viewBox: [-2, -3, 60, 100] as [number, number, number, number] } };
  for (const assetKey of ["v", "missing", null]) {
    const props = { x: -136.5, y: .25, width: 54.5, height: 45, assetKey, assets, className: "sample" };
    expect(frontPrimitiveMarkup(frontShapePrimitive(props))).toBe(renderToStaticMarkup(<FrontShape {...props}/>));
  }
});

it("lets only the screen adapter replace saved text with the editor", () => {
  const note = frontProject.annotations[0]!;
  const editing = renderToStaticMarkup(<FrontNoteContent note={note}><textarea defaultValue="editing"/></FrontNoteContent>);
  expect(editing).toContain("<textarea");
  expect(editing).not.toContain("Linea 1");
  expect(buildFrontDocument(frontProject, {}, { labels: true, dimensions: false }).html).not.toContain("<textarea");
});
