import { multiplyAmountE4 } from "../../shared/money.js";
import type { ProjectQuotationLine } from "../../shared/project.js";

export const DEMO_QUANTITY_MAX = 9_999;

export function demoLineTotalE4(line: ProjectQuotationLine): number | null {
  return line.lineTotalE4 ?? (line.unitListPriceE4 === null ? null : multiplyAmountE4(line.unitListPriceE4, line.quantity));
}

export interface DemoQuotationTotals {
  /** Sum of all lines that have a current catalogue price. */
  readonly pricedTotalE4: number;
  readonly unpricedLineCount: number;
  readonly totalQuantity: number;
}

export function demoQuotationTotals(
  lines: readonly ProjectQuotationLine[],
): DemoQuotationTotals {
  let pricedTotalE4 = 0;
  let unpricedLineCount = 0;
  let totalQuantity = 0;
  for (const line of lines) {
    totalQuantity += line.quantity;
    if (line.commercialContribution === "none") continue;
    const lineTotalE4 = demoLineTotalE4(line);
    if (lineTotalE4 === null) {
      unpricedLineCount++;
      continue;
    }
    const nextTotal = pricedTotalE4 + lineTotalE4;
    if (!Number.isSafeInteger(nextTotal)) {
      throw new Error("Demo quotation total exceeds the safe integer range");
    }
    pricedTotalE4 = nextTotal;
  }
  return { pricedTotalE4, unpricedLineCount, totalQuantity };
}
