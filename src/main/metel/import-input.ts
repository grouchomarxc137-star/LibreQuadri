import path from "node:path";
import { METEL_MAX_SOURCE_BYTES, type MetelInput } from "../../shared/metel-import.js";
import { parseMetelSource, WINDOWS_1252_C1, type ParsedMetelSource } from "./parser.js";
import { assertUniqueMetelDeliveryRows } from "./delivery.js";

/** Preserve fixed-width spaces; pasted Unicode must be representable in Windows-1252. */
export function encodeMetelText(text: string): Uint8Array {
  const codes = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) codes.set(byte>=0x80&&byte<=0x9f ? WINDOWS_1252_C1[byte-0x80]! : String.fromCharCode(byte), byte);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const byte = codes.get(text[index]!);
    if (byte === undefined) throw new Error(`Carattere non Windows-1252 alla posizione ${index + 1}. Seleziona il file originale.`);
    bytes[index] = byte;
  }
  return bytes;
}

export function validateMetelInputs(payload: unknown): MetelInput[] {
  if (!Array.isArray(payload) || payload.length !== 3) throw new Error("Servono esattamente tre file: un LSP, un FSC e un FST.");
  let total = 0;
  return payload.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sorgente METEL non valida.");
    const item = value as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 255 || /[\x00-\x1f/\\]/.test(item.name)) throw new Error("Nome sorgente non valido.");
    const name = path.basename(item.name);
    let input: MetelInput;
    let size: number;
    if (item.kind === "text" && typeof item.text === "string" && Object.keys(item).every(k => ["kind","name","text"].includes(k))) {
      size = item.text.length;
      input = {kind:"text", name, text:item.text};
    } else if (item.kind === "file" && item.bytes instanceof Uint8Array && Object.keys(item).every(k => ["kind","name","bytes"].includes(k))) {
      size = item.bytes.byteLength;
      input = {kind:"file", name, bytes:item.bytes};
    } else throw new Error("Contenuto sorgente non valido.");
    total += size;
    if (!size || size > METEL_MAX_SOURCE_BYTES || total > 2 * METEL_MAX_SOURCE_BYTES) throw new Error("File vuoto o troppo grande (massimo 64 MiB per file, 128 MiB totali).");
    return input.kind === "file" ? {...input,bytes:Uint8Array.from(input.bytes)} : input;
  });
}

export interface ValidatedMetelSource { readonly name: string; readonly bytes: Uint8Array; readonly parsed: ParsedMetelSource }
export function parseCompleteMetelDelivery(inputs: readonly MetelInput[]): ValidatedMetelSource[] {
  const sources = validateMetelInputs(inputs).map(input => {
    try {
      const bytes = input.kind === "text" ? encodeMetelText(input.text) : input.bytes;
      const parsed = parseMetelSource(bytes);
      if (parsed.metadata.fileType === "LSP" && !parsed.priceListRows.length) throw new Error("Il listino LSP non contiene articoli.");
      assertUniqueMetelDeliveryRows(parsed.priceListRows, parsed.familyRows);
      for (const row of parsed.priceListRows) if (row.valuta !== "EUR") throw new Error(`Valuta ${row.valuta} non supportata: sono ammessi solo prezzi EUR.`);
      return {name:input.name,bytes,parsed};
    } catch (error) {
      throw new Error(`${input.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const roles = new Set(sources.map(s => s.parsed.metadata.fileType));
  if (roles.size !== 3) throw new Error("Fornitura incompleta o duplicata: servono un LSP, un FSC e un FST distinti.");
  if (new Set(sources.map(s => s.parsed.metadata.issuerSigla)).size !== 1) throw new Error("I tre file devono appartenere allo stesso emittente METEL.");
  return sources;
}
