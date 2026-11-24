import { createElement, type ReactNode } from "react";
import type { FrontPrimitive as Primitive } from "./front-primitives.js";

/** React adapter only: the shared primitive model owns all drawing coordinates and content. */
export function FrontPrimitive({ primitive, children }: { primitive: Primitive; children?: ReactNode }) {
  return createElement(primitive.tag, primitive.attributes, children ?? primitive.children.map((child, index) =>
    typeof child === "string" ? child : <FrontPrimitive key={index} primitive={child} />));
}
