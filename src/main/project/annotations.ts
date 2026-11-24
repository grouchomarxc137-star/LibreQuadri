import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ANNOTATION_FONT_DEFAULT_MM, ANNOTATION_FONT_MAX_MM, ANNOTATION_FONT_MIN_MM, ANNOTATION_MAX_SIZE_MM,
  ANNOTATION_MIN_HEIGHT_MM, ANNOTATION_MIN_WIDTH_MM, annotationMinHeightMm, type ProjectAnnotation, type ProjectAnnotationInput, type ProjectAnnotationPatch } from "../../shared/project.js";

/*
 * Fronte Quadro text boxes (.lqp format 6 notes, format 7 boxes). Project presentation data only:
 * no configured item, physical node, quotation line or catalogue reference is involved, so they
 * are created, edited and read without any catalogue.
 */
export const ANNOTATION_TEXT_MAX = 2000;
export const ANNOTATION_COUNT_MAX = 10_000;
/** Drawing coordinates beyond this are rejected as corrupt rather than drawn. */
export const ANNOTATION_COORDINATE_MAX_MM = 1_000_000;

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("Il testo dell'annotazione non può essere vuoto.");
  if (value.length > ANNOTATION_TEXT_MAX) throw new Error(`Il testo dell'annotazione supera ${ANNOTATION_TEXT_MAX} caratteri.`);
  return value;
}

function coordinate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > ANNOTATION_COORDINATE_MAX_MM)
    throw new Error("Posizione dell'annotazione non valida.");
  return value;
}

function size(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > ANNOTATION_MAX_SIZE_MM)
    throw new Error(`Dimensione dell'annotazione non valida (minimo ${minimum} mm).`);
  return value;
}
function fontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < ANNOTATION_FONT_MIN_MM || value > ANNOTATION_FONT_MAX_MM)
    throw new Error(`Dimensione del testo non valida (da ${ANNOTATION_FONT_MIN_MM} a ${ANNOTATION_FONT_MAX_MM} mm).`);
  return value;
}
const width = (value: unknown) => size(value, ANNOTATION_MIN_WIDTH_MM);
const height = (value: unknown) => size(value, ANNOTATION_MIN_HEIGHT_MM);

export function readAnnotations(db: Database.Database): ProjectAnnotation[] {
  return db.prepare(`SELECT uuid,text,x_mm AS xMm,y_mm AS yMm,width_mm AS widthMm,height_mm AS heightMm,font_size_mm AS fontSizeMm
    FROM prj_annotation ORDER BY sort_order`).all() as ProjectAnnotation[];
}

export function addAnnotation(db: Database.Database, input: ProjectAnnotationInput): string {
  const body = text(input.text), xMm = coordinate(input.xMm), yMm = coordinate(input.yMm);
  const widthMm = width(input.widthMm), fontSizeMm = input.fontSizeMm === undefined ? ANNOTATION_FONT_DEFAULT_MM : fontSize(input.fontSizeMm);
  // A box always holds at least one line of its own text size.
  const heightMm = Math.max(height(input.heightMm), annotationMinHeightMm(fontSizeMm));
  return db.transaction(() => {
    const row = db.prepare("SELECT COUNT(*) AS count,COALESCE(MAX(sort_order),-1) AS last FROM prj_annotation")
      .get() as { count: number; last: number };
    if (row.count >= ANNOTATION_COUNT_MAX) throw new Error("Troppe annotazioni nel progetto.");
    const uuid = randomUUID();
    db.prepare("INSERT INTO prj_annotation(uuid,text,x_mm,y_mm,width_mm,height_mm,font_size_mm,sort_order) VALUES(?,?,?,?,?,?,?,?)")
      .run(uuid, body, xMm, yMm, widthMm, heightMm, fontSizeMm, row.last + 1);
    return uuid;
  })();
}

export function updateAnnotation(db: Database.Database, uuid: string, patch: ProjectAnnotationPatch): void {
  const current = db.prepare(`SELECT text,x_mm AS xMm,y_mm AS yMm,width_mm AS widthMm,height_mm AS heightMm,
    font_size_mm AS fontSizeMm FROM prj_annotation WHERE uuid=?`).get(uuid) as Omit<ProjectAnnotation, "uuid"> | undefined;
  if (!current) throw new Error("Annotazione non trovata.");
  const fontSizeMm = patch.fontSizeMm === undefined ? current.fontSizeMm : fontSize(patch.fontSizeMm);
  // A larger text size never leaves the box shorter than one line of it; a box that was tall enough keeps its height.
  const heightMm = Math.max(patch.heightMm === undefined ? current.heightMm : height(patch.heightMm), annotationMinHeightMm(fontSizeMm));
  db.prepare("UPDATE prj_annotation SET text=?,x_mm=?,y_mm=?,width_mm=?,height_mm=?,font_size_mm=? WHERE uuid=?").run(
    patch.text === undefined ? current.text : text(patch.text),
    patch.xMm === undefined ? current.xMm : coordinate(patch.xMm),
    patch.yMm === undefined ? current.yMm : coordinate(patch.yMm),
    patch.widthMm === undefined ? current.widthMm : width(patch.widthMm), heightMm, fontSizeMm, uuid);
}

export function removeAnnotation(db: Database.Database, uuid: string): void {
  if (db.prepare("DELETE FROM prj_annotation WHERE uuid=?").run(uuid).changes !== 1) throw new Error("Annotazione non trovata.");
}

/**
 * Open-time validation of a document's annotation rows. A format-6 file has no size columns yet
 * (they are added when its working copy is migrated), so they are checked only from format 7;
 * the text size column exists from format 9.
 */
export function validateAnnotationRows(db: Database.Database, formatVersion: number): void {
  const sized = formatVersion >= 7, fonted = formatVersion >= 9;
  const rows = db.prepare(`SELECT uuid,text,x_mm AS xMm,y_mm AS yMm${sized ? ",width_mm AS widthMm,height_mm AS heightMm" : ""}${
    fonted ? ",font_size_mm AS fontSizeMm" : ""} FROM prj_annotation`).all() as ProjectAnnotation[];
  if (rows.length > ANNOTATION_COUNT_MAX) throw new Error("Il progetto supera il limite di righe per prj_annotation.");
  for (const row of rows) {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.uuid)) throw new Error("uuid");
      text(row.text); coordinate(row.xMm); coordinate(row.yMm);
      if (sized) { width(row.widthMm); height(row.heightMm); }
      if (fonted) fontSize(row.fontSizeMm);
    } catch { throw new Error("Il progetto contiene un'annotazione non valida."); }
  }
}
