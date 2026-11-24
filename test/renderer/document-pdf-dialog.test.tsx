import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DocumentPdfDialog } from "../../src/renderer/app/DocumentPdfDialog.js";
import { fakeProjectApi } from "./fake-api.js";

it("opens Distinta with prices on, optional amounts off and no Preventivo selector", () => {
  const html = renderToStaticMarkup(<DocumentPdfDialog api={fakeProjectApi()} onClose={() => undefined} />);
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Preventivo");
  expect(html).toContain('<input type="checkbox" checked=""/> Mostra prezzi');
  expect(html).toContain('<input type="checkbox"/> Mostra sconti');
  expect(html).toContain('>Anteprima PDF</button>');
  expect(html).toContain('<button type="button">Salva PDF</button>');
});

it("offers a front-specific preview, save and printing flow without commercial document options", () => {
  const html = renderToStaticMarkup(<DocumentPdfDialog api={fakeProjectApi()} initialKind="fronte-quadro"
    frontOptions={{ labels: true, dimensions: true }} onClose={() => undefined} />);
  expect(html).toContain("Fronte Quadro PDF");
  expect(html).toContain("stampare dal visualizzatore");
  expect(html).toContain('>Anteprima PDF</button>');
  expect(html).toContain('<button type="button">Salva PDF</button>');
  expect(html).not.toContain("Mostra prezzi");
  expect(html).not.toContain("<select");
});
