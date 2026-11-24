/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppFrame } from "../../src/renderer/app/App.js";
import { initialShellState, type ShellState } from "../../src/renderer/app/shell-state.js";
import type { ProjectDocumentView } from "../../src/shared/project.js";
import { fakeLqApi, openProject } from "./fake-api.js";

/*
 * Quiet Workbench X1 (docs/R17_VISUAL_DESIGN.md §0.6): surfaces and chrome only. The workspace
 * chrome is modernised; the Fronte Quadro drawing (BTicino artwork, geometry, selection, targets)
 * is never decorated.
 */
const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Declaration blocks as [selector list, declarations] (@media wrappers ignored). */
const rules = (): [string[], string][] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => [match[1]!.split(/,(?![^(]*\))/).map(selector => selector.trim()), match[2]!]);

function frame(project: ProjectDocumentView | null, shell: ShellState = initialShellState): string {
  return renderToStaticMarkup(<AppFrame api={fakeLqApi()} project={project} shell={shell} dispatch={() => undefined}
    overview={null} recent={[]} busy={false} startError={null}
    onProjectChange={() => undefined} onOpenProject={() => undefined} onOpenRecent={() => undefined}
    onForgetRecent={() => undefined} onCreated={() => undefined} />);
}

describe("Fronte Quadro drawing stays undecorated", () => {
  it("gives nothing drawn in the Fronte Quadro rounding, shadow, filter, transition or animation", () => {
    const drawn = /\.(front-drawing|front-sector|front-enclosure|front-support|front-device|front-vector|front-hit|front-hover-outline|front-selection[\w-]*|front-target[\w-]*|front-dimension[\w-]*|front-caption|front-dragging|front-note[\w-]*)\b/;
    const decorated = rules().filter(([selectors]) => selectors.some(selector => drawn.test(selector)));
    expect(decorated.length).toBeGreaterThan(20);
    for (const [selectors, declarations] of decorated)
      expect(`${selectors.join(",")} {${declarations}}`).not.toMatch(
        /(^|[;{\s])(border-radius|box-shadow|filter|backdrop-filter|transition[\w-]*|animation[\w-]*)\s*:/);
  });

  it("puts the inset working-area card on the .design-front wrapper, never on the canvas or the drawing", () => {
    const card = rules().filter(([selectors]) => selectors.includes(".design-front")).map(([, body]) => body).join(";");
    expect(card).toMatch(/border-radius:\s*var\(--r-lg\)/);
    expect(card).toMatch(/box-shadow:\s*var\(--shadow-card\)/);
    expect(card).toMatch(/overflow:\s*hidden/);
    for (const [selectors, body] of rules().filter(([selectors]) => selectors.some(s => /\.front-canvas\b/.test(s))))
      expect(`${selectors.join(",")} {${body}}`).not.toMatch(/(^|[;{\s])(border-radius|box-shadow)\s*:/);
  });
});

describe("workbench chrome markup", () => {
  const design: ShellState = { ...initialShellState, designSection: "enclosure" };

  it("replaces workspace tabs with one Distinta button", () => {
    const html = frame(openProject);
    expect(html).toContain('id="open-distinta"');
    expect(html).not.toMatch(/id="tab-|role="tablist"/);
  });

  it("titles docked panels with their name alone: no decorative header icon", () => {
    const html = frame(openProject, design);
    const headers = [...html.matchAll(/<header class="dock-header">([\s\S]*?)<\/header>/g)].map(match => match[1]!);
    expect(headers.length).toBeGreaterThanOrEqual(4);
    for (const header of headers) expect(header).toMatch(/^<h3[ >]/);
    // Actions in a header stay (Struttura's Ricarica).
    expect(html).toMatch(/<header class="dock-header"><h3 id="design-structure-title">Struttura<\/h3><button[^>]*aria-label="Ricarica la navigazione strutturale"/);
  });

  it("groups the Fronte Quadro view toggles; every toggle and zoom control is unchanged", () => {
    const html = frame(openProject, design);
    const toolbar = html.match(/<header class="front-toolbar">[\s\S]*?<\/header>/)![0];
    expect(toolbar).toMatch(/^<header class="front-toolbar"><h3 id="design-front-title">Fronte Quadro<\/h3>/);
    const group = toolbar.match(/<div class="front-view-toggles" role="group" aria-label="Vista">([\s\S]*?)<\/div>/)![1]!;
    expect([...group.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1])).toEqual(["Etichette", "Quote", "Aggiungi testo"]);
    const mode = toolbar.match(/<div class="front-placement-mode" role="group" aria-label="Modalità di posizionamento">([\s\S]*?)<\/div>/)![1]!;
    expect(mode).toMatch(/Modalità<\/span><button[^>]*class="toolbar-button" aria-pressed="true">Auto<\/button>/);
    expect(mode).toMatch(/<button[^>]*class="toolbar-button" aria-pressed="false">Libera<\/button>/);
    expect(toolbar.indexOf('aria-label="Vista"')).toBeLessThan(toolbar.indexOf('aria-label="Modalità di posizionamento"'));
    expect(toolbar.indexOf('aria-label="Modalità di posizionamento"')).toBeLessThan(toolbar.indexOf('aria-label="Modifica"'));
    expect(toolbar).toMatch(/<div class="front-viewport-controls" role="group" aria-label="Zoom Fronte Quadro">/);
    expect(toolbar).toContain("Adatta vista");
  });
});
