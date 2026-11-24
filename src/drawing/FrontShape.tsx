import type { ProjectConfiguredItem } from "../shared/project.js";
import { FrontPrimitive } from "./FrontPrimitive.js";
import { frontShapePrimitive, type FrontAssets } from "./front-primitives.js";
export { previewView, type FrontAssets } from "./front-primitives.js";

type View = ProjectConfiguredItem["views"][number];

export function FrontShape(props: {
  x: number; y: number; width: number; height: number; assetKey: string | null | undefined;
  assets: FrontAssets; className?: string;
}) {
  return <FrontPrimitive primitive={frontShapePrimitive(props)} />;
}

/** Stand-alone preview of one physical view, used in the pool and in the drag ghost. */
export function SubjectPreview({ view, assets, label, className }: {
  view: Pick<View, "widthMm" | "heightMm" | "assetKey"> | undefined; assets: FrontAssets; label: string;
  className?: string;
}) {
  if (!view || !(view.widthMm > 0) || !(view.heightMm > 0)) return null;
  return <svg className={className ?? "subject-preview"} role="img" aria-label={label}
    viewBox={`0 0 ${view.widthMm} ${view.heightMm}`}>
    <FrontShape x={0} y={0} width={view.widthMm} height={view.heightMm} assetKey={view.assetKey} assets={assets} />
  </svg>;
}
