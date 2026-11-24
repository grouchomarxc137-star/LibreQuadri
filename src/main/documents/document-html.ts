import { normalizeDocumentPdfOptions, type DocumentPdfOptions } from "../../shared/project.js";
import type { DocumentModel, DocumentRow } from "./document-model.js";
import { formatMoneyE4 } from "../../shared/money.js";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const money = (value: number | null): string => value === null ? "Da definire" :
  formatMoneyE4(value,"EUR");
const percent = (bp:number):string => bp % 100 === 0 ? String(bp / 100) :
  `${Math.floor(bp / 100)},${String(bp % 100).padStart(2,"0").replace(/0+$/,"")}`;
const date = (value: string): string => /^\d{4}-\d{2}-\d{2}$/.test(value) ?
  `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
const field = (label: string, value: string): string => value.trim() ?
  `<div class="field"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>` : "";

export function buildDocumentHtml(model: DocumentModel, input: DocumentPdfOptions | boolean): string {
  const options = normalizeDocumentPdfOptions(typeof input === "boolean"
    ? { showPrices: input, showDiscounts: model.kind === "preventivo", showLabour: model.kind === "preventivo" } : input);
  const { showPrices, showDiscounts, showLabour } = options;
  const preventivo=showDiscounts;
  const priceHeaders = showPrices ? '<th class="money">Prezzo unitario</th>'+
    (preventivo?'<th class="discount">Sconto</th>':"")+'<th class="money">Totale</th>' : "";
  const columns=showPrices?(preventivo?6:5):3;
  const renderRow = (row:DocumentRow) => row.groupTitle ?
    `<tr class="product-group"><th colspan="${columns}" scope="rowgroup">${escapeHtml(row.groupTitle)}</th></tr>` :
    `<tr${row.configuredChild?' class="configured-child"':''}><td class="code">${escapeHtml(row.code)}</td>` +
    `<td class="description">${escapeHtml(row.description)}</td><td class="quantity">${row.quantity}</td>` +
    (showPrices ? `<td class="money">${money(row.unitPriceE4)}</td>`+
      (preventivo?`<td class="discount">${percent(row.discountBp??0)}%</td>`:"")+
      `<td class="money">${money(row.totalE4)}</td>` : "") + "</tr>";
  const blocks:DocumentRow[][]=[];
  for(const row of model.rows){
    if(!row.configuredChild || blocks.length===0)blocks.push([]);
    blocks[blocks.length-1]!.push(row);
  }
  const rows=blocks.map(block=>`<tbody class="product-block">${block.map(renderRow).join("")}</tbody>`).join("");
  const summaryRow=(label:string,value:number|null,emphasis=false)=>
    `<div class="summary-row${emphasis?' final':''}"><span>${label}</span><strong>${money(value)}</strong></div>`;
  const total = !showPrices ? "" : (showDiscounts || showLabour) ? `<div class="totals commercial-totals">`+
    summaryRow(showDiscounts ? "Materiali dopo sconti di riga" : "Totale materiali di listino",model.materialsSubtotalE4??null)+
    (showDiscounts && model.globalDiscountBp ? `<div class="summary-row"><span>Sconto globale ${percent(model.globalDiscountBp)}%</span><strong>${model.globalDiscountE4==null?"Da definire":`− ${money(model.globalDiscountE4)}`}</strong></div>` : "")+
    (showDiscounts && model.globalDiscountBp ? summaryRow("Materiali dopo sconto globale",model.materialsAfterGlobalE4??null) : "")+
    (showLabour && model.labourTotalE4 ? summaryRow("Mano d'opera",model.labourTotalE4) : "")+
    summaryRow("TOTALE FINALE",model.totalE4,true)+`</div>` :
    `<div class="totals"><span>Totale di listino</span><strong>${money(model.totalE4)}</strong></div>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>LibreQuadri · ${escapeHtml(model.title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>
@page { size: A4; }
* { box-sizing: border-box; }
html,body { margin:0; padding:0; }
body { font: 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; color:#3d2912; background:white; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
.page { padding: 0; }
.mast { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e8d6c0; padding-bottom:12px; margin-bottom:17px; }
.mast small { font-size:10px; color:#806a52; text-transform:uppercase; letter-spacing:.09em; }
.brand { font-size:17px; font-weight:700; }
.hero { border:1px solid #eddcc5; background:#fff8ef; border-radius:12px; padding:16px 19px; margin-bottom:16px; }
.hero h1 { margin:0 0 5px; font-size:22px; letter-spacing:.04em; }
.hero p { margin:0; font-size:13px; font-weight:600; overflow-wrap:anywhere; }
.meta { display:grid; grid-template-columns:1fr 1fr; gap:7px 20px; margin-bottom:16px; }
.field { min-width:0; } .field span { display:block; color:#8a7660; font-size:9px; text-transform:uppercase; letter-spacing:.05em; }
.field strong { display:block; font-weight:500; overflow-wrap:anywhere; white-space:pre-wrap; }
table { width:100%; border-collapse:collapse; table-layout:fixed; }
thead { display:table-header-group; } tr { break-inside:avoid; page-break-inside:avoid; }
.product-block { break-inside:avoid; page-break-inside:avoid; }
th { text-align:left; background:#f5eee5; border-bottom:1px solid #dbcbb6; color:#604932; font-size:10px; padding:8px 7px; }
td { border-bottom:1px solid #eee6dc; padding:7px; vertical-align:top; }
.code { width:20%; overflow-wrap:anywhere; word-break:break-word; }
.description { overflow-wrap:anywhere; white-space:pre-wrap; }
.quantity { width:10%; text-align:right; font-variant-numeric:tabular-nums; }
.money { width:17%; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.discount { width:10%; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.product-group th { background:#fff8ef; border-top:1px solid #dbcbb6; border-bottom:1px solid #ead6ba; font-size:11px; padding:9px 7px; color:#3d2912; break-after:avoid; page-break-after:avoid; }
.configured-child .description { padding-left:18px; }
.totals { margin:15px 0 0 auto; padding:11px 13px; width:48%; background:#fff8ef; border:1px solid #ead6ba; border-radius:8px; display:flex; justify-content:space-between; gap:12px; break-inside:avoid; page-break-inside:avoid; }
.totals strong { white-space:nowrap; }
.commercial-totals { display:block; width:55%; }
.summary-row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; }
.summary-row.final { border-top:1px solid #dbcbb6; margin-top:5px; padding-top:8px; font-size:13px; }
</style></head><body><div class="page"><div class="mast"><strong class="brand">LibreQuadri</strong><small>Configurazione quadri elettrici</small></div>
<div class="hero"><h1>${model.title}</h1><p>${escapeHtml(model.projectTitle)}</p></div>
<div class="meta">${field("Data progetto", date(model.projectDate))}${field("Data emissione", date(model.issuedDate))}${field("Azienda", model.customer)}${field("Descrizione azienda", model.customerDescription)}${field("Descrizione progetto", model.description)}${field("Norma", model.norm)}${field("Preparato da", model.executor)}</div>
<table><thead><tr><th class="code">Codice</th><th>Descrizione</th><th class="quantity">Q.tà</th>${priceHeaders}</tr></thead>${rows}</table>${total}</div></body></html>`;
}
