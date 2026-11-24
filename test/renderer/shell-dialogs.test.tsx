import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListinoDialog, ProjectPropertiesDialog, ShellDialog, UnclassifiedDialog } from "../../src/renderer/app/ShellDialogs.js";
import { NewProjectDialog } from "../../src/renderer/project/NewProjectDialog.js";
import type { CatalogueOverview } from "../../src/shared/catalogue.js";
import { fakeCatalogueApi, fakeProjectApi, fakeLqApi, openProject } from "./fake-api.js";
import { dialogTabTarget } from "../../src/renderer/ui/dialog-focus.js";

const markup = (dialog: React.ReactNode) => renderToStaticMarkup(dialog);

describe("R-17 shell dialogs", () => {
  it("contains forward and backward Tab at the modal boundaries, including missing focus and disabled-only states", () => {
    const controls = ["first", "middle", "last"];
    expect(dialogTabTarget(controls, "last", false)).toBe("first");
    expect(dialogTabTarget(controls, "first", true)).toBe("last");
    expect(dialogTabTarget(controls, "middle", false)).toBeNull();
    expect(dialogTabTarget(controls, "middle", true)).toBeNull();
    expect(dialogTabTarget(controls, "outside", false)).toBe("first");
    expect(dialogTabTarget(controls, null, true)).toBe("last");
    expect(dialogTabTarget(["only"], "only", false)).toBe("only");
    expect(dialogTabTarget([], null, false)).toBeNull();
  });
  it("uses a labelled modal with an independent body and footer", () => {
    const html = markup(<ShellDialog id="test" title="Titolo" onClose={() => undefined}><p>Contenuto</p></ShellDialog>);
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="test-title"');
    expect(html).toContain('<header><h2 id="test-title">Titolo</h2></header>');
    expect(html).toContain('<div class="shell-dialog-body"><p>Contenuto</p></div>');
    expect(html).toContain('<footer><button type="button">Chiudi</button></footer>');
  });

  it("keeps all new-project fields, defaults and form actions in the shared frame", () => {
    const html = markup(<NewProjectDialog api={fakeProjectApi()} onCancel={() => undefined} onCreated={() => undefined} />);
    expect(html).toContain('class="shell-dialog shell-dialog-form"');
    expect(html).toContain('id="new-project-form"');
    expect(html).toContain('type="submit" form="new-project-form"');
    expect(html).toContain('type="button">Annulla</button>');
    expect(html).toContain('value="civil" selected=""');
    for (const label of ["Nome progetto", "Percorso salvataggio", "Descrizione", "Note", "Tipologia", "Esecutore", "Data", "Azienda", "Descrizione azienda"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('required=""');
    expect(html).toContain('readOnly=""');
    expect(html).toContain("Sfoglia…");
  });

  it("shows every read-only project property and its editing notice", () => {
    const project = { ...openProject, metadata: { ...openProject.metadata, description: "Quadro principale", notes: "Nota prova", companyDescription: "Impianti" } };
    const html = markup(<ProjectPropertiesDialog project={project} onClose={() => undefined} />);
    for (const value of ["Quadro generale QG1", "Norma civile", "CEI EN 60898", "Quadro principale", "Nota prova", "M. Rossi", "24/09/2026", "Rossi Srl", "Impianti", "QG1 Rossi.lqp", "Revisione", "4"]) {
      expect(html).toContain(value);
    }
    expect(html).toContain("La modifica dei dati di progetto non è ancora disponibile.");
    expect(html).not.toContain("<input");
  });

  it("shows installed listini and requires a complete delivery before verification", () => {
    const empty = markup(<ListinoDialog api={fakeLqApi().metel} overview={null} onClose={() => undefined} />);
    expect(empty).toContain("Nessun listino installato.");
    const overview: CatalogueOverview = { productCount: 24000, listedProductCount: 24000, delistedProductCount: 0,
      classifiedProductCount: 0, unclassifiedProductCount: 24000, listedClassifiedProductCount: 0,
      listedUnclassifiedProductCount: 24000, brands: [],
      currentPriceLists: [{ issuerSigla: "BTI", listinoNumber: "21", validFrom: "2026-07-01", importedAt: "2026-09-23T10:00:00.000Z", listedProductCount: 24000 }] };
    const filled = markup(<ListinoDialog api={fakeLqApi().metel} overview={overview} onClose={() => undefined} />);
    for (const value of ["Emittente", "Listino", "Valido dal", "Articoli a listino", "BTI", "n. 21", "01/07/2026", "24.000"]) expect(filled).toContain(value);
    expect(filled).toContain("Verifica fornitura");
    expect(filled).not.toContain("<textarea");
    expect(filled).toContain("Seleziona file…");
    expect(filled.match(/class="metel-source"/g)).toHaveLength(3);
    expect(filled).toContain('disabled="">Verifica fornitura');
  });

  it("hosts the existing unclassified panel in the wide shell", () => {
    const html = markup(<UnclassifiedDialog api={fakeCatalogueApi()} onClose={() => undefined} />);
    expect(html).toContain('class="shell-dialog shell-dialog-wide"');
    expect(html).toContain('aria-label="Da classificare"');
    expect(html).toContain("Solo prodotti a listino");
    expect(html).toContain("Caricamento famiglie…");
  });
});
