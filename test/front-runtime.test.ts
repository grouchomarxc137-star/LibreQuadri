import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { buildFrontDocument } from "../src/main/documents/front-document.js";
import { ProjectPdfService } from "../src/main/documents/pdf-service.js";
import { frontPrimitiveMarkup } from "../src/main/documents/front-markup.js";
import { frontElement, type FrontPrimitive } from "../src/drawing/front-primitives.js";
import { frontProject, frontAssets } from "./helpers/front-project.js";

// Any accidental React import in this main-process graph fails before tests run.
vi.mock("react", () => { throw new Error("React must not load in main PDF generation"); });
vi.mock("react/jsx-runtime", () => { throw new Error("JSX runtime must not load in main PDF generation"); });
vi.mock("react-dom/server", () => { throw new Error("ReactDOM must not load in main PDF generation"); });
vi.mock("electron", () => ({ BrowserWindow: class {}, app: {}, dialog: {} }));

it("loads the real main PDF service and generates a document with React unavailable", () => {
  expect(ProjectPdfService).toBeTypeOf("function");
  expect(buildFrontDocument(frontProject, frontAssets, { labels: true, dimensions: true }).html).toContain("Fronte Quadro");
  for (const file of ["package.json", "package-lock.json"]) {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const manifest = file === "package.json" ? parsed : parsed.packages[""];
    for (const dependency of ["react", "react-dom"]) {
      expect(manifest.dependencies).not.toHaveProperty(dependency);
      expect(manifest.devDependencies[dependency]).toBe("^19.3.0");
      if (file === "package-lock.json") expect(parsed.packages[`node_modules/${dependency}`].dev).toBe(true);
    }
  }
});

it("escapes project text and attributes and refuses executable markup outside the drawing vocabulary", () => {
  const html = frontPrimitiveMarkup(frontElement("text", { className: 'label" onload="alert(1)' }, ['<script>" & \'</script>']));
  expect(html).toBe('<text class="label&quot; onload=&quot;alert(1)">&lt;script&gt;&quot; &amp; &#39;&lt;/script&gt;</text>');
  expect(() => frontPrimitiveMarkup({ tag: "script", attributes: {}, children: [] } as unknown as FrontPrimitive))
    .toThrow("Primitiva");
  for (const attribute of ["onclick", "dangerouslySetInnerHTML", "constructor", "__proto__"])
    expect(() => frontPrimitiveMarkup(frontElement("rect", { [attribute]: "alert(1)" })))
      .toThrow("Attributo");
});
