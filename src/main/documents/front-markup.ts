import type { FrontPrimitive, FrontTextStyle } from "../../drawing/front-primitives.js";
import { escapeHtml } from "./document-html.js";

const attributeNames = { className: "class", xmlns: "xmlns", x: "x", y: "y", width: "width", height: "height",
  viewBox: "viewBox", preserveAspectRatio: "preserveAspectRatio", d: "d", fill: "fill", stroke: "stroke",
  strokeWidth: "stroke-width", fontSize: "font-size", textAnchor: "text-anchor", transform: "transform",
  "aria-hidden": "aria-hidden", "data-dimension": "data-dimension" } as const;
const tags = new Set<FrontPrimitive["tag"]>(["svg", "g", "rect", "path", "text", "title", "foreignObject", "div"]);

function textStyle(style: FrontTextStyle): string {
  return `box-sizing:${style.boxSizing};width:${style.width};height:${style.height};padding:${style.padding}px;` +
    `font-size:${style.fontSize}px;line-height:${style.lineHeight}`;
}

/** Serialize only our inert primitive vocabulary; all project text and attribute values are escaped. */
export function frontPrimitiveMarkup(primitive: FrontPrimitive): string {
  if (!tags.has(primitive.tag)) throw new Error("Primitiva Fronte Quadro non valida.");
  const attributes = Object.entries(primitive.attributes).map(([key, value]) => {
    if (value === undefined) return "";
    if (key === "style") return ` style="${escapeHtml(textStyle(value as FrontTextStyle))}"`;
    if (!Object.hasOwn(attributeNames, key)) throw new Error("Attributo Fronte Quadro non valido.");
    const name = attributeNames[key as keyof typeof attributeNames];
    return ` ${name}="${escapeHtml(String(value))}"`;
  }).join("");
  const children = primitive.children.map(child => typeof child === "string" ? escapeHtml(child) : frontPrimitiveMarkup(child)).join("");
  return `<${primitive.tag}${attributes}>${children}</${primitive.tag}>`;
}
