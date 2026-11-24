import { parseBtiFstSegment, type FstSegment } from "./bti.js";

export type FstSegmentParser = (code: string, description: string | null) => FstSegment | null;

/** Optional issuer adapters. Issuers without an adapter retain flat FST navigation. */
const parsers: Readonly<Record<string, FstSegmentParser>> = { BTI: parseBtiFstSegment };

export function fstSegmentParser(issuerSigla: string): FstSegmentParser | undefined {
  return parsers[issuerSigla];
}
