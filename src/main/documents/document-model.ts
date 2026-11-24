import { DEFAULT_DOCUMENT_PDF_OPTIONS, normalizeDocumentPdfOptions, type DocumentPdfOptions, type ProjectDocumentView } from "../../shared/project.js";
import { calculateCommercial, discountAmountE4 } from "../../shared/commercial.js";

export type DocumentKind = "preventivo" | "distinta";
export interface DocumentRow {
  readonly code: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceE4: number | null;
  readonly totalE4: number | null;
  readonly groupTitle?: string;
  readonly discountBp?: number;
  readonly configuredChild?: boolean;
}
export interface DocumentModel {
  readonly kind: DocumentKind;
  readonly title: string;
  readonly projectTitle: string;
  readonly projectDate: string;
  readonly issuedDate: string;
  readonly customer: string;
  readonly customerDescription: string;
  readonly description: string;
  readonly norm: string;
  readonly executor: string;
  readonly rows: readonly DocumentRow[];
  /** Null means at least one commercial row cannot be priced completely. */
  readonly totalE4: number | null;
  readonly materialsSubtotalE4?:number|null;
  readonly globalDiscountBp?:number;
  readonly globalDiscountE4?:number|null;
  readonly materialsAfterGlobalE4?:number|null;
  readonly labourTotalE4?:number;
}

const internalCode = (code: string | null | undefined): boolean =>
  !code || /^(?:tq|sie)\./i.test(code) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(code);
const safeCode = (code: string | null | undefined): string => internalCode(code) ? "—" : code!;
const safeDescription = (value: string | null | undefined): string =>
  !value || /^(?:tq|sie)\./i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ?
    "Descrizione non disponibile" : value;

function completeTotal(rows: readonly DocumentRow[]): number | null {
  let sum = 0;
  for (const row of rows) {
    if (row.totalE4 === null) return null;
    sum += row.totalE4;
    if (!Number.isSafeInteger(sum)) return null;
  }
  return sum;
}

/** Group by saved article identity and commercial terms; sum already-rounded source amounts. */
function discountedMaterials(project: ProjectDocumentView): DocumentRow[] {
  const commercial = calculateCommercial(project);
  const lines = new Map(project.lines.map(line => [line.uuid, line]));
  const items = new Map(project.configuredItems.map(item => [item.uuid, item]));
  const grouped = new Map<string, DocumentRow>();
  for (const group of commercial.groups) for (const row of group.rows) {
    const line = lines.get(row.lineUuid)!;
    const part = row.itemUuid ? items.get(row.itemUuid)?.bom.find(part => part.seq === row.componentSeq) : null;
    const identity = part?.snapshotUuid ?? line.snapshotUuid ?? JSON.stringify([line.brandMarchio, row.code]);
    const key = JSON.stringify([identity, row.unitPriceE4, row.discountBp]);
    const previous = grouped.get(key);
    grouped.set(key, { code: row.code, description: row.description,
      quantity: (previous?.quantity ?? 0) + row.quantity, unitPriceE4: row.unitPriceE4,
      discountBp: row.discountBp, totalE4: row.netE4 === null || previous?.totalE4 === null ? null
        : completeTotal([{ ...row, totalE4: row.netE4 }, ...(previous ? [previous] : [])]),
    });
  }
  return [...grouped.values()].sort((a, b) => a.code.localeCompare(b.code, "it", { numeric: true }));
}

export function buildDocumentModel(project: ProjectDocumentView, kind: DocumentKind, now = new Date(),
  input: DocumentPdfOptions | boolean = DEFAULT_DOCUMENT_PDF_OPTIONS): DocumentModel {
  const options = normalizeDocumentPdfOptions(typeof input === "boolean"
    ? { showPrices: input, showDiscounts: kind === "preventivo", showLabour: kind === "preventivo" } : input);
  const commercial = kind === "preventivo" ? calculateCommercial(project) : null;
  const rows: DocumentRow[] = kind === "distinta"
    ? options.showDiscounts ? discountedMaterials(project) : project.distinta.map(row => ({
      code: safeCode(row.manufacturerCode), description: safeDescription(row.description),
      quantity: row.quantity, unitPriceE4: row.listPriceUnitE4, totalE4: row.listTotalE4,
    }))
    : commercial!.groups.flatMap(group => [
      ...(group.title ? [{code:"",description:"",quantity:0,unitPriceE4:null,totalE4:null,groupTitle:group.title}] : []),
      ...group.rows.map(row => ({code:row.code,description:row.description,quantity:row.quantity,
        unitPriceE4:row.unitPriceE4,totalE4:row.netE4,discountBp:row.discountBp,
        configuredChild:!!group.title})),
    ]);
  const metadata = project.metadata;
  const issuedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const materialsSubtotalE4 = kind === "distinta" ? completeTotal(rows) : commercial!.materialsSubtotalE4;
  const globalDiscountBp = options.showDiscounts ? project.globalDiscountBp ?? 0 : 0;
  const globalDiscountE4 = materialsSubtotalE4 === null ? null : discountAmountE4(materialsSubtotalE4, globalDiscountBp);
  const materialsAfterGlobalE4 = materialsSubtotalE4 === null ? null : materialsSubtotalE4 - globalDiscountE4!;
  const labourTotalE4 = options.showLabour ? project.labourTotalE4 ?? 0 : 0;
  const totalE4 = materialsAfterGlobalE4 === null ? null : completeTotal([
    { totalE4: materialsAfterGlobalE4 } as DocumentRow, { totalE4: labourTotalE4 } as DocumentRow,
  ]);
  return {
    kind, title: kind === "preventivo" ? "PREVENTIVO" : "DISTINTA MATERIALI",
    projectTitle: metadata.title, projectDate: metadata.date, issuedDate,
    customer: metadata.companyName, customerDescription: metadata.companyDescription,
    description: metadata.description, norm: metadata.normCode, executor: metadata.executor,
    rows, totalE4: kind === "preventivo" ? commercial!.finalTotalE4 : totalE4,
    ...(kind === "distinta" ? { materialsSubtotalE4, globalDiscountBp, globalDiscountE4,
      materialsAfterGlobalE4, labourTotalE4 } : {}),
    ...(commercial ? {materialsSubtotalE4:commercial.materialsSubtotalE4,
      globalDiscountBp:commercial.globalDiscountBp,globalDiscountE4:commercial.globalDiscountE4,
      materialsAfterGlobalE4:commercial.materialsAfterGlobalE4,labourTotalE4:commercial.labourTotalE4} : {}),
  };
}
