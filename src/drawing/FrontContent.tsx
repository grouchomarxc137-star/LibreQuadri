import type { ReactNode } from "react";
import type { ProjectAnnotation } from "../shared/project.js";
import { FrontPrimitive } from "./FrontPrimitive.js";
import { frontCaptionPrimitives, frontNotePrimitives, frontObjectPrimitives, frontOptionLabelPrimitives, type FrontAssets } from "./front-primitives.js";
import type { FrontDrawable, FrontSector } from "./front-geometry.js";
export { frontLabel, orderedFront, frontOpening, frontNoteTextStyle } from "./front-primitives.js";

export function FrontObject({ entry, assets, labels, scale }: {
  entry: FrontDrawable; assets: FrontAssets; labels: boolean; scale: number | null;
}) {
  return <>{frontObjectPrimitives(entry, assets, labels, scale).map((primitive, index) =>
    <FrontPrimitive key={index} primitive={primitive} />)}</>;
}

export function FrontCaption({ sector, captionMm }: { sector: FrontSector; captionMm: number | null }) {
  return <>{frontCaptionPrimitives(sector, captionMm).map((primitive, index) =>
    <FrontPrimitive key={index} primitive={primitive} />)}</>;
}

export function FrontOptionLabels({ sector, assets }: { sector: FrontSector; assets: FrontAssets }) {
  return <>{frontOptionLabelPrimitives(sector, assets).map((primitive, index) =>
    <FrontPrimitive key={index} primitive={primitive} />)}</>;
}

export function FrontNoteContent({ note, children }: {
  note: Pick<ProjectAnnotation, "xMm" | "yMm" | "widthMm" | "heightMm" | "fontSizeMm" | "text">;
  children?: ReactNode;
}) {
  const [box, frame] = frontNotePrimitives(note);
  return <><FrontPrimitive primitive={box} /><FrontPrimitive primitive={frame}>{children}</FrontPrimitive></>;
}
