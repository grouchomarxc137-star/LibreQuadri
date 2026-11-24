import type { ProjectDocumentView, ProjectQuotationLine } from "./project.js";

export interface CommercialRow {
  readonly key: string;
  readonly parentKey: string | null;
  readonly code: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceE4: number | null;
  readonly discountBp: number;
  readonly grossE4: number | null;
  readonly discountE4: number | null;
  readonly netE4: number | null;
  readonly lineUuid: string;
  readonly itemUuid: string | null;
  readonly componentSeq: number | null;
}
export interface CommercialGroup {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly CommercialRow[];
}
export interface CommercialCalculation {
  readonly groups: readonly CommercialGroup[];
  readonly materialsSubtotalE4: number | null;
  readonly globalDiscountBp: number;
  readonly globalDiscountE4: number | null;
  readonly materialsAfterGlobalE4: number | null;
  readonly labourTotalE4: number;
  readonly finalTotalE4: number | null;
}

export function validateDiscountBp(bp: number): void {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10_000) throw new Error("Sconto percentuale non valido.");
}
export function validateLabourE4(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Importo Mano d'opera non valido.");
}
function safeE4(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error("Il totale supera l'intervallo monetario supportato.");
  return Number(value);
}
function roundPositive(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}
/** Positive percentage discount, rounded half up to one E4 unit. */
export function discountAmountE4(grossE4: number, bp: number): number {
  validateDiscountBp(bp);
  if (!Number.isSafeInteger(grossE4) || grossE4 < 0) throw new Error("Importo riga non valido.");
  return safeE4(roundPositive(BigInt(grossE4) * BigInt(bp), 10_000n));
}
function quantityFraction(quantity:number):{numerator:bigint;denominator:bigint}{
  if(!Number.isFinite(quantity)||quantity<0)throw new Error("Quantità non valida.");
  const match = String(quantity).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error("Quantità non valida.");
  const digits = (match[1]! + (match[2] ?? ""));
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (Math.abs(exponent) > 30) throw new Error("Precisione quantità non supportata.");
  const numerator = BigInt(digits) * (exponent > 0 ? 10n ** BigInt(exponent) : 1n);
  const denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  return {numerator,denominator};
}
/** Converts a finite stored quantity to an exact decimal rational before multiplying money. */
export function grossAmountE4(unitE4: number, quantity: number, count = 1): number {
  if (!Number.isSafeInteger(unitE4) || unitE4 < 0 || !Number.isSafeInteger(count) || count < 0)
    throw new Error("Prezzo o quantità non validi.");
  const {numerator,denominator}=quantityFraction(quantity);
  return safeE4(roundPositive(BigInt(unitE4)*numerator*BigInt(count),denominator));
}
function multipliedQuantity(perItem:number,count:number):number{
  if(!Number.isSafeInteger(count)||count<0)throw new Error("Quantità non valida.");
  const {numerator,denominator}=quantityFraction(perItem);
  return Number(numerator*BigInt(count))/Number(denominator);
}
const safeCode = (code: string | null | undefined): string =>
  !code || /^(?:tq|sie)\./i.test(code) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(code) ? "—" : code;
const safeDescription = (value: string | null | undefined): string =>
  !value || /^(?:tq|sie)\./i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ?
    "Descrizione non disponibile" : value;
function sumComplete(rows: readonly CommercialRow[]): number | null {
  if (rows.some(row => row.netE4 === null)) return null;
  return safeE4(rows.reduce((sum, row) => sum + BigInt(row.netE4!), 0n));
}
function row(input: Omit<CommercialRow, "grossE4" | "discountE4" | "netE4">,
  componentQuantity?:{perItem:number;count:number}): CommercialRow {
  const grossE4 = input.unitPriceE4 === null ? null : componentQuantity ?
    grossAmountE4(input.unitPriceE4,componentQuantity.perItem,componentQuantity.count) :
    grossAmountE4(input.unitPriceE4, input.quantity);
  const discountE4 = grossE4 === null ? null : discountAmountE4(grossE4, input.discountBp);
  return {...input, grossE4, discountE4, netE4: grossE4 === null ? null : grossE4 - discountE4!};
}
export function calculateCommercial(project: Pick<ProjectDocumentView,
  "lines" | "configuredItems" | "globalDiscountBp" | "labourTotalE4">): CommercialCalculation {
  const items = new Map(project.configuredItems.map(item => [item.uuid, item]));
  const groups: CommercialGroup[] = [];
  for (const line of project.lines) {
    if (line.commercialContribution === "none") continue;
    if (line.lineType === "product") {
      groups.push({key: line.uuid, title: "", rows: [row({
        key: line.uuid, parentKey: null, code: safeCode(line.manufacturerCode),
        description: safeDescription(line.description), quantity: line.quantity,
        unitPriceE4: line.unitListPriceE4, discountBp: line.lineDiscountBp ?? 0,
        lineUuid: line.uuid, itemUuid: null, componentSeq: null,
      })]});
      continue;
    }
    const item = line.itemUuid ? items.get(line.itemUuid) : undefined;
    if (!item) throw new Error("Configurazione commerciale mancante nel progetto.");
    const title = safeDescription(line.description && !/^(?:tq|sie)\./i.test(line.description) ? line.description : item.configLabel || item.modelName);
    groups.push({key: line.uuid, title, rows: item.bom.map(component => row({
      key: `${line.uuid}:${component.seq}`, parentKey: line.uuid,
      code: safeCode(component.manufacturerCode), description: safeDescription(component.description),
      quantity: multipliedQuantity(component.quantityPerItem,line.quantity),
      unitPriceE4: component.salePriceUnitE4, discountBp: component.lineDiscountBp ?? 0,
      lineUuid: line.uuid, itemUuid: item.uuid, componentSeq: component.seq,
    },{perItem:component.quantityPerItem,count:line.quantity}))});
  }
  const materialsSubtotalE4 = sumComplete(groups.flatMap(group => group.rows));
  const globalDiscountBp = project.globalDiscountBp ?? 0;
  const labourTotalE4 = project.labourTotalE4 ?? 0;
  validateDiscountBp(globalDiscountBp); validateLabourE4(labourTotalE4);
  const globalDiscountE4 = materialsSubtotalE4 === null ? null : discountAmountE4(materialsSubtotalE4, globalDiscountBp);
  const materialsAfterGlobalE4 = materialsSubtotalE4 === null ? null : materialsSubtotalE4 - globalDiscountE4!;
  const finalTotalE4 = materialsAfterGlobalE4 === null ? null : safeE4(BigInt(materialsAfterGlobalE4) + BigInt(labourTotalE4));
  return {groups, materialsSubtotalE4, globalDiscountBp, globalDiscountE4, materialsAfterGlobalE4,
    labourTotalE4, finalTotalE4};
}
