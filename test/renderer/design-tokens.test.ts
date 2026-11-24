import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** The design-token foundation of docs/R17_VISUAL_DESIGN.md §0 (UI modernization), defined once in styles.css. */
const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first `:root` block (the light, approved theme). */
function rootDeclarations(): Map<string, string> {
  const start = css.indexOf(":root {");
  const body = css.slice(start + ":root {".length, css.indexOf("\n}", start));
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declarations.set(match[1]!, match[2]!.trim());
  return declarations;
}

describe("design tokens", () => {
  const root = rootDeclarations();

  it("defines the radius, spacing, typography, motion, shadow and control scales", () => {
    const expected: Record<string, string> = {
      "--r-0": "0", "--r-xs": "3px", "--r-sm": "6px", "--r-md": "8px", "--r-lg": "10px", "--r-dot": "50%",
      "--sp-2xs": "2px", "--sp-xs": "4px", "--sp-sm": "6px", "--sp-md": "8px", "--sp-lg": "12px", "--sp-xl": "16px", "--sp-2xl": "24px",
      "--fs-caption": "11px", "--fs-small": "12px", "--fs-dense": "12.5px", "--fs-body": "13px", "--fs-title": "15px", "--fs-display": "24px",
      "--fw-regular": "400", "--fw-medium": "500", "--fw-semibold": "600",
      "--dur-fast": "100ms", "--dur-base": "150ms", "--dur-slow": "200ms",
      "--ease-out": "cubic-bezier(0.2, 0, 0, 1)", "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--shadow-1": "0 2px 8px rgb(20 30 45 / 0.10)", "--shadow-2": "0 8px 24px rgb(20 30 45 / 0.16)",
      "--control-sm": "24px", "--control-md": "28px", "--control-lg": "32px", "--control-xl": "36px",
    };
    for (const [name, value] of Object.entries(expected)) expect(root.get(name), name).toBe(value);
  });

  it("defines the Quiet Workbench surfaces on the existing neutrals", () => {
    expect(root.get("--librequadri-sidebar")).toBe("var(--librequadri-surface-2)");
    expect(root.get("--librequadri-bed")).toBe("var(--librequadri-app)");
    expect(root.get("--librequadri-hover-wash")).toBe("rgb(22 25 29 / 0.045)");
    expect(root.get("--librequadri-press-wash")).toBe("rgb(22 25 29 / 0.075)");
    expect(root.get("--shadow-card")).toBe("0 0 0 1px rgb(20 30 45 / 0.08), 0 1px 2px rgb(20 30 45 / 0.06)");
    // The dark theme stays functional: the washes and the card ring have their own values.
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    for (const name of ["--librequadri-hover-wash", "--librequadri-press-wash", "--shadow-card"]) expect(dark).toMatch(new RegExp(`${name}:`));
  });

  it("never rounds more than 10 px and keeps the 11 px type floor", () => {
    for (const name of ["--r-xs", "--r-sm", "--r-md", "--r-lg"]) expect(parseFloat(root.get(name)!)).toBeLessThanOrEqual(10);
    expect(parseFloat(root.get("--fs-caption")!)).toBeGreaterThanOrEqual(11);
  });

  it("maps the existing radius, shadow and control aliases onto the scales", () => {
    expect(root.get("--librequadri-radius")).toBe("var(--r-sm)");
    expect(root.get("--librequadri-radius-tag")).toBe("var(--r-xs)");
    expect(root.get("--librequadri-radius-popover")).toBe("var(--r-md)");
    expect(root.get("--librequadri-shadow-float")).toBe("var(--shadow-1)");
    expect(root.get("--librequadri-control")).toBe("var(--control-md)");
  });

  it("keeps the orange interaction accent and the semantic colours", () => {
    expect(root.get("--librequadri-accent")).toBe("#D96A00");
    expect(root.get("--librequadri-accent-strong")).toBe("#BD5A00");
    expect(root.get("--librequadri-ok")).toBe("#16794A");
    expect(root.get("--librequadri-warn-bg")).toBe("#FFF6D8");
    expect(root.get("--librequadri-error")).toBe("#C42B1C");
  });

  it("collapses every motion duration under prefers-reduced-motion", () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/);
    expect(block).not.toBeNull();
    for (const name of ["--dur-fast", "--dur-base", "--dur-slow"]) expect(block![1]).toMatch(new RegExp(`${name}:\\s*0ms`));
  });

  it("references only defined custom properties (or ones with a fallback)", () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]!));
    const undefinedUses = [...css.matchAll(/var\((--[\w-]+)\s*([,)])/g)]
      .filter(match => match[2] === ")" && !defined.has(match[1]!)).map(match => match[1]!);
    expect(undefinedUses).toEqual([]);
  });
});

/** Declaration blocks of styles.css as [selectors, declarations] (@media wrappers ignored). */
function rules(): [string[], string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => [match[1]!.split(/,(?![^(]*\))/).map(selector => selector.trim()), match[2]!]);
}

describe("base control motion (snap in, ease out)", () => {
  const all = rules();
  /** Every declaration of the rules that list this exact selector. */
  const declaration = (selector: string) => {
    const matching = all.filter(([selectors]) => selectors.includes(selector));
    expect(matching.length, selector).toBeGreaterThan(0);
    return matching.map(([, body]) => body).join(";");
  };

  it("fades only the return to rest on buttons; hover and press apply at once", () => {
    expect(declaration("button")).toMatch(/transition:[^;]*var\(--dur-fast\)/);
    expect(declaration("button:hover:not(:disabled)")).toMatch(/transition-duration:\s*0ms/);
    expect(declaration("button:active:not(:disabled)")).toMatch(/transition-duration:\s*0ms/);
  });

  it("applies a pressed segment or toggle at once; only the one that was pressed fades out", () => {
    expect(declaration('.icon-button[aria-pressed="true"]')).toMatch(/transition-duration:\s*0ms/);
    expect(declaration('.segmented button[aria-pressed="true"]')).toMatch(/transition-duration:\s*0ms/);
  });

  it("applies input focus at once and never transitions the keyboard focus outline", () => {
    const field = ':where(input:not([type="checkbox"], [type="radio"], [type="range"]), select, textarea):focus-visible';
    expect(declaration(field)).toMatch(/transition-duration:\s*0ms/);
    for (const [selectors, body] of all.filter(([selectors]) => selectors.some(selector => selector.includes(":focus-visible"))))
      expect(`${selectors.join(",")} {${body}}`, "focus-visible must not delay").not.toMatch(/transition-duration:\s*[1-9]/);
    for (const [, body] of all) expect(body).not.toMatch(/transition(-property)?:[^;]*\boutline/);
  });

  it("transitions only paint properties, with token durations", () => {
    const allowed = new Set(["background-color", "border-color", "color", "box-shadow", "opacity"]);
    for (const [selectors, body] of all) {
      for (const match of body.matchAll(/(^|[;\s])transition:\s*([^;]+);/g)) {
        for (const part of match[2]!.split(/,(?![^(]*\))/)) {
          const [property, duration] = part.trim().split(/\s+/);
          expect(allowed.has(property!), `${selectors.join(",")}: ${property}`).toBe(true);
          expect(duration, selectors.join(",")).toMatch(/^var\(--dur-(fast|base|slow)\)$/);
        }
      }
      for (const match of body.matchAll(/transition-duration:\s*([^;]+);/g)) expect(match[1]!.trim()).toBe("0ms");
    }
  });

  it("never transitions the drawing, which must stay coordinate-exact", () => {
    for (const [selectors, body] of all.filter(([, body]) => /(^|[;\s])transition/.test(body)))
      for (const selector of selectors) expect(selector, "no transition on the drawing").not.toMatch(/\.front-(drawing|canvas|selection|target|vector)/);
  });
});
