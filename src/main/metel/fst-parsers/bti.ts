export interface FstSegment { code: string; name: string }

/** BTI's delivered FST segment is identified by the first two code fields. */
export function parseBtiFstSegment(code: string, description: string | null): FstSegment | null {
  const parts = code.split("-");
  const name = description?.split(" - ")[0]?.trim();
  if (parts.length !== 4 || !parts.every(Boolean) || !name) return null;
  return { code: `${parts[0]}-${parts[1]}`, name };
}
