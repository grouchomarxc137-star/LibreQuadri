import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFrontDocument, frontPageLayout } from "../src/main/documents/front-document.js";
import { combinedFrontGeometry } from "../src/drawing/front-geometry.js";

import { frontProject, frontAssets as assets } from "./helpers/front-project.js";

describe("complete printable Fronte Quadro", () => {
  it("preserves the pre-correction SVG markup for every labels/dimensions/vector combination", () => {
    // Captured from 3763fca before replacing React in the main-process generation path.
    const baseline = JSON.parse(readFileSync("test/fixtures/front-svg-before-refactor.json", "utf8")) as
      { vectors: boolean; labels: boolean; dimensions: boolean; hash: string }[];
    for (const entry of baseline) {
      const { html } = buildFrontDocument(frontProject, entry.vectors ? assets : {}, entry);
      const svg = html.slice(html.indexOf('<svg class="front-drawing"'), html.lastIndexOf("</svg>") + 6);
      const hash = createHash("sha256").update(svg.replaceAll("&#x27;", "&#39;")).digest("hex");
      expect(hash, JSON.stringify(entry)).toBe(entry.hash);
    }
  });

  it("uses the same combined geometry, all sectors and off-drawing notes without mutating the snapshot", () => {
    const before = structuredClone(frontProject);
    const document = buildFrontDocument(frontProject, assets, { labels: true, dimensions: true });
    const screen = combinedFrontGeometry(frontProject.physicalNodes, frontProject.configuredItems,
      { dimensions: true, annotations: frontProject.annotations });
    expect(document.viewBox).toEqual(screen.viewBox);
    expect(frontProject).toEqual(before);
    expect(document.html).toContain('transform="translate(650 600)"');
    expect(document.html).toContain('x="136.5" y="123" width="54" height="45"');
    expect(document.html).toContain('d="M 0 0 L 54 45"');
    expect(document.html).toContain('d="M 0 0 L 2 2 Z"');
    expect(document.html).toContain('x="-180" y="-120" width="160" height="90"');
    expect(document.html).toContain('font-size:18px');
    expect(document.html).toContain("1200 mm");
    expect(document.html).toContain("Cliente &amp; C.");
    expect(document.html).toContain("<title>LibreQuadri · Fronte Quadro - Q1 &lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(document.html).not.toContain("<script>");
    expect(document.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("never renders editor-only chrome, hit targets, interaction states or controls", () => {
    const { html } = buildFrontDocument(frontProject, assets, { labels: true, dimensions: true });
    expect(html).not.toMatch(/front-(selection|hover|target|hit|drag|scroll|toolbar)|data-selected|data-editing|textarea|<button|tabindex/);
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain("default-src 'none'");
  });

  it("fits and draws resolved cabinet option artwork even with article labels off", () => {
    const project = { ...frontProject, configuredItems: frontProject.configuredItems.map(item => item.uuid === "case"
      ? { ...item, frontOptionLabels: [{ assetKey: "option", xMm: 100, yMm: 1400, widthMm: 250, heightMm: 20 }] }
      : item) };
    const options = { labels: false, dimensions: false };
    const missing = buildFrontDocument(project, assets, options);
    const available = buildFrontDocument(project, { ...assets, option: assets.vector }, options);
    expect(missing.html).not.toContain("front-option-label");
    expect(available.html.match(/class="front-vector front-option-label"/g)).toHaveLength(1);
    expect(available.html).toContain('x="140" y="1470" width="250" height="20"');
    expect(available.viewBox[1] + available.viewBox[3]).toBeGreaterThanOrEqual(1490);
    expect(available.viewBox[3]).toBeGreaterThan(missing.viewBox[3]);
  });

  it("prints annotation text without painting its background or border for every view option", () => {
    for (const labels of [true, false]) for (const dimensions of [true, false]) {
      const { html } = buildFrontDocument(frontProject, assets, { labels, dimensions });
      const boxStyle = html.match(/\.front-note-box \{([^}]+)\}/)![1]!;
      expect(boxStyle).toMatch(/fill: none;/);
      expect(boxStyle).toMatch(/stroke: none;/);
      expect(html).toMatch(/\.front-note-text \{[^}]*color: #2B3139;/);
      expect(html).toContain("Linea 1\nLinea 2");
      expect(html).toContain('font-size:18px;line-height:1.3');
      expect(html).not.toMatch(/data-selected|data-editing|front-note-outline|front-note-handle/);
    }
  });

  it("honors view toggles and preserves plain device labels when artwork is unavailable", () => {
    const withLabels = buildFrontDocument(frontProject, {}, { labels: true, dimensions: false });
    expect(withLabels.html).toContain(">C16</text>");
    expect(withLabels.html).not.toContain('data-dimension="width"');
    const withoutLabels = buildFrontDocument(frontProject, {}, { labels: false, dimensions: true });
    expect(withoutLabels.html).not.toContain(">C16</text>");
    expect(withoutLabels.html).toContain('data-dimension="width"');
    expect(withoutLabels.html).toContain("Linea 1\nLinea 2");
  });

  it("chooses orientation by the best uniform A4 fit, with deterministic portrait ties", () => {
    const tall = frontPageLayout([0, 0, 600, 1200]);
    expect(tall.landscape).toBe(false);
    const wide = frontPageLayout([-400, -100, 2000, 600]);
    expect(wide.landscape).toBe(true);
    for (const [plan, w, h] of [[tall, 600, 1200], [wide, 2000, 600]] as const) {
      expect(w * plan.scale).toBeLessThanOrEqual(plan.drawingWidthMm);
      expect(h * plan.scale).toBeLessThanOrEqual(plan.drawingHeightMm);
    }
    expect(frontPageLayout([0, 0, 190, 164]).landscape).toBe(false);
    expect(buildFrontDocument(frontProject, assets, { labels: true, dimensions: true }))
      .toEqual(buildFrontDocument(frontProject, assets, { labels: true, dimensions: true }));
  });

  it("refuses empty geometry and explains roots the workspace cannot draw", () => {
    expect(() => buildFrontDocument({ ...frontProject, physicalNodes: [] }, {}, { labels: true, dimensions: false }))
      .toThrow("nessuna geometria");
    const broken = { ...frontProject, physicalNodes: [...frontProject.physicalNodes,
      { ...frontProject.physicalNodes[0]!, uuid: "missing", itemUuid: "absent", children: [] }] };
    expect(buildFrontDocument(broken, assets, { labels: true, dimensions: false }).html)
      .toContain("1 carpenterie non mostrate");
  });
});
