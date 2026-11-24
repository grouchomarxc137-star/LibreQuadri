import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Thin scrollbar for the zoomed Fronte Quadro, horizontal by default. `start` and `size` are
 * fractions of the whole drawing's extent on its axis; `onStart` asks for a new `start`.
 * Display-only: it never touches the project.
 */
export function FrontScrollbar({ start, size, onStart, orientation = "horizontal" }: {
  start: number; size: number; onStart: (start: number) => void; orientation?: "horizontal" | "vertical";
}) {
  const vertical = orientation === "vertical";
  const track = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.max(0, Math.min(1 - size, value));
  const fractionAt = (event: { clientX: number; clientY: number }) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return null;
    const length = vertical ? box.height : box.width;
    return length > 0 ? ((vertical ? event.clientY - box.top : event.clientX - box.left)) / length : null;
  };
  const grabThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = fractionAt(event);
    if (origin === null) return;
    const offset = origin - start;
    const move = (moved: PointerEvent) => {
      const at = fractionAt(moved);
      if (at !== null) onStart(clamp(at - offset));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const jump = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const at = fractionAt(event);
    if (at !== null) onStart(clamp(at - size / 2));
  };
  return <div ref={track} className={vertical ? "front-scrollbar front-scrollbar-vertical" : "front-scrollbar"}
    role="scrollbar" aria-orientation={orientation}
    aria-label={vertical ? "Scorri il Fronte Quadro in verticale" : "Scorri il Fronte Quadro in orizzontale"}
    aria-controls="front-drawing"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(start / Math.max(1e-9, 1 - size) * 100)}
    onPointerDown={jump}>
    <div className="front-scrollbar-thumb"
      style={vertical ? { top: `${start * 100}%`, height: `${size * 100}%` } : { left: `${start * 100}%`, width: `${size * 100}%` }}
      onPointerDown={grabThumb} />
  </div>;
}
