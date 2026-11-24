import { FrontPrimitive } from "./FrontPrimitive.js";
import { frontCombinedWidthPrimitives, frontDimensionPrimitives } from "./front-primitives.js";
import type { CombinedFrontWidth, SectorDimensions } from "./front-geometry.js";

export function FrontDimensions({ dimensions, scale, showWidth }: {
  dimensions: SectorDimensions; scale: number | null; showWidth?: boolean;
}) {
  return <FrontPrimitive primitive={frontDimensionPrimitives(dimensions, scale, showWidth)} />;
}

export function FrontCombinedWidth({ width, scale }: { width: CombinedFrontWidth; scale: number | null }) {
  return <FrontPrimitive primitive={frontCombinedWidthPrimitives(width, scale)} />;
}
