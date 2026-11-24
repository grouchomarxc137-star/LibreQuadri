/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Guards the cascade behind the Catalogo "Componenti del progetto" hover bug: the global
 * `button:hover:not(:disabled)` fill outranks a plain `.project-component-open` rule, so the selected
 * (accent-tinted) row turned grey under the pointer. jsdom does not rank by specificity or match
 * :hover, so the rule ranking is checked from the stylesheet itself; the live computed colours were
 * checked in Electron (STATUS.md).
 */
type Specificity = readonly [number, number, number];

export function specificity(selector: string): Specificity {
  let ids = 0, classes = 0, elements = 0;
  const visit = (text: string) => {
    let rest = text.replace(/\[[^\]]*\]/g, () => { classes++; return " "; });
    rest = rest.replace(/::?(not|is|where|has)\(([^()]*)\)/g, (_all, name: string, inner: string) => {
      if (name === "where") return " ";
      const parts = inner.split(",").map(part => specificity(part.trim()));
      const best = parts.reduce((a, b) => (b[0] - a[0] || b[1] - a[1] || b[2] - a[2]) > 0 ? b : a, [0, 0, 0] as Specificity);
      ids += best[0]; classes += best[1]; elements += best[2];
      return " ";
    });
    rest = rest.replace(/::[\w-]+/g, () => { elements++; return " "; });
    rest = rest.replace(/:[\w-]+/g, () => { classes++; return " "; });
    rest = rest.replace(/#[\w-]+/g, () => { ids++; return " "; });
    rest = rest.replace(/\.[\w-]+/g, () => { classes++; return " "; });
    rest = rest.replace(/(^|[\s>+~])([a-zA-Z][\w-]*)/g, () => { elements++; return " "; });
  };
  visit(selector);
  return [ids, classes, elements];
}
const outranks = (a: Specificity, b: Specificity) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;

const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) =>
  selectors!.trim().split(",").map(selector => ({ selector: selector.trim().replace(/\s+/g, " "), body: body!.trim() })));
const declares = (rule: { body: string }, property: string) =>
  new RegExp(`(^|;)\\s*${property}\\s*:`).test(rule.body);

describe("Componenti del progetto row hover", () => {
  const global = rules.find(rule => rule.selector === "button:hover:not(:disabled)" && declares(rule, "background"))!;
  const pressed = rules.find(rule => rule.selector === "button:active:not(:disabled)" && declares(rule, "background"))!;

  it("computes selector specificity like the browser", () => {
    expect(specificity("button:hover:not(:disabled)")).toEqual([0, 2, 1]);
    expect(specificity(".project-component-open")).toEqual([0, 1, 0]);
    expect(specificity('.project-component-row[data-active="true"] .project-component-open:hover:not(:disabled)')).toEqual([0, 5, 0]);
  });

  it("shows why the plain rule lost: the global fill outranks it", () => {
    const plain = rules.find(rule => rule.selector === ".project-component-open")!;
    expect(outranks(specificity(global.selector), specificity(plain.selector))).toBe(true);
  });

  for (const [state, globalRule] of [["hover:not(:disabled)", global], ["active:not(:disabled)", pressed], ["focus", global]] as const) {
    it(`keeps the selected row transparent over the accent tint on :${state}`, () => {
      const selector = `.project-component-row[data-active="true"] .project-component-open:${state}`;
      const rule = rules.find(entry => entry.selector === selector);
      expect(rule, selector).toBeDefined();
      expect(rule!.body).toMatch(/^background:\s*transparent;?$/);
      expect(outranks(specificity(selector), specificity(globalRule.selector))).toBe(true);
    });
  }

  it("leaves the active tint on the row and the neutral hover for unselected rows", () => {
    const tint = rules.find(rule => rule.selector === '.project-component-row[data-active="true"]')!;
    expect(tint.body).toBe("background: var(--librequadri-accent-tint);");
    const base = rules.find(rule => rule.selector === ".project-component-open")!;
    expect(base.body).toContain("background: transparent");
    // No state override applies outside the selected row, so unselected rows keep the global neutral hover/press fill.
    const overrides = rules.filter(rule => /\.project-component-open:(hover|active|focus)/.test(rule.selector));
    expect(overrides.length).toBeGreaterThan(0);
    for (const rule of overrides) expect(rule.selector).toContain('[data-active="true"]');
    expect(global.body).toBe("background: var(--librequadri-surface-2);");
    expect(pressed.body).toBe("background: var(--librequadri-surface-3);");
  });
});
