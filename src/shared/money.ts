const E4_SCALE = 10_000;

/**
 * Multiplies an integer `_e4` amount by an integer quantity without converting
 * money to floating point. The result must remain an exact safe integer.
 */
export function multiplyAmountE4(amountE4: number, quantity: number): number {
  if (!Number.isSafeInteger(amountE4)) {
    throw new Error(`Invalid _e4 amount ${String(amountE4)}`);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`Invalid quantity ${String(quantity)}`);
  }
  const result = amountE4 * quantity;
  if (!Number.isSafeInteger(result)) {
    throw new Error("_e4 multiplication exceeds the safe integer range");
  }
  return result;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Formats an integer amount in 1/10,000 currency units without ever going
 * through floating point. At least two decimals are always shown; the third and
 * fourth only when they are not zero (unit prices derived from a multiplier of
 * 100 or 1000 can carry them).
 *
 *   508000 -> "50,80"     1250 -> "0,125"     12345678 -> "1.234,5678"
 */
export function formatAmountE4(amountE4: number): string {
  if (!Number.isSafeInteger(amountE4)) {
    throw new Error(`Invalid _e4 amount ${String(amountE4)}`);
  }

  const sign = amountE4 < 0 ? "-" : "";
  const absolute = Math.abs(amountE4);
  const remainder = absolute % E4_SCALE;
  const whole = (absolute - remainder) / E4_SCALE;
  const decimals = String(remainder)
    .padStart(4, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");

  return `${sign}${groupThousands(String(whole))},${decimals}`;
}

export function formatMoneyE4(amountE4: number, currency: string): string {
  const symbol = currency === "EUR" ? "€" : currency;
  return `${formatAmountE4(amountE4)} ${symbol}`;
}
