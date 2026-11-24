import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { projectFormatVersion } from "../src/main/database/project-migrations.js";
import { PROJECT_CHANNELS } from "../src/shared/project.js";
import { registerProjectIpc, type ProjectIpcRegistry } from "../src/main/project/project-ipc.js";

const migrationsFolder = path.resolve("db/migrations/project");
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

/** A service with no catalogue at all: annotations must not need one. */
function catalogueFreeService(folder: string, label: string, migrations = migrationsFolder) {
  return new ProjectDocumentService({
    workingDirectory: path.join(folder, `working-${label}`), incomingDirectory: path.join(folder, `incoming-${label}`),
    backupDirectory: path.join(folder, "backups"), migrationsFolder: migrations, appVersion: "annotation-test",
    resolveCatalogueProduct: () => { throw new Error("empty local catalogue"); },
  });
}
const metadata = (destinationPath: string) => ({ destinationPath, title: "Note", description: "", notes: "", projectType: "civil" as const,
  executor: "", date: "2026-10-02", companyName: "Cliente", companyDescription: "" });
const box = (text: string, xMm = 0, yMm = 0, widthMm = 200, heightMm = 40) => ({ text, xMm, yMm, widthMm, heightMm });
const DEFAULT_FONT = { fontSizeMm: 12 };

async function created() {
  const folder = mkdtempSync(path.join(tmpdir(), "lqp-annotations-")); folders.push(folder);
  const filename = path.join(folder, "note.lqp");
  const service = catalogueFreeService(folder, "writer");
  await service.create(metadata(filename));
  return { folder, filename, service };
}

describe("Fronte Quadro text boxes (.lqp format 7, text size from format 9)", () => {
  it("creates, moves, resizes, edits and removes boxes in drawing coordinates", async () => {
    const { service } = await created();
    try {
      const added = service.addAnnotation(box("Prima nota", 123.5, -40, 180.5, 36.2));
      expect(added.dirty).toBe(true);
      expect(added.annotations).toEqual([{ uuid: expect.stringMatching(/^[0-9a-f-]{36}$/), text: "Prima nota", xMm: 123.5, yMm: -40, widthMm: 180.5, heightMm: 36.2, ...DEFAULT_FONT }]);
      const second = service.addAnnotation(box("Seconda\nriga", 10, 20));
      expect(second.annotations.map(note => note.text)).toEqual(["Prima nota", "Seconda\nriga"]);
      const [first, other] = second.annotations;
      expect(service.updateAnnotation(first!.uuid, { text: "Nota corretta" }).annotations[0]).toEqual({ ...first, text: "Nota corretta" });
      const moved = service.updateAnnotation(other!.uuid, { xMm: 11, yMm: 22 }).annotations[1]!;
      expect(moved).toEqual({ ...other, xMm: 11, yMm: 22 });
      const resized = service.updateAnnotation(other!.uuid, { widthMm: 300, heightMm: 90 }).annotations[1]!;
      expect(resized).toEqual({ ...moved, widthMm: 300, heightMm: 90 });
      expect(service.removeAnnotation(first!.uuid).annotations.map(note => note.uuid)).toEqual([other!.uuid]);
      expect(() => service.removeAnnotation(first!.uuid)).toThrow("non trovata");
      expect(() => service.updateAnnotation(first!.uuid, { text: "x" })).toThrow("non trovata");
    } finally { service.discardCurrent(); }
  });

  it("rejects blank or oversized text, bad coordinates and sizes below the minimum or beyond the maximum", async () => {
    const { service } = await created();
    try {
      expect(() => service.addAnnotation(box("   "))).toThrow("vuoto");
      expect(() => service.addAnnotation(box("x".repeat(2001)))).toThrow("2000");
      expect(() => service.addAnnotation(box("ok", Number.NaN))).toThrow("Posizione");
      expect(() => service.addAnnotation(box("ok", 0, 2_000_000))).toThrow("Posizione");
      for (const [w, h] of [[59.9, 40], [200, 23.9], [0, 40], [-5, 40], [Number.NaN, 40], [200, Number.POSITIVE_INFINITY], [100_001, 40]])
        expect(() => service.addAnnotation(box("ok", 0, 0, w, h))).toThrow("Dimensione");
      expect(service.addAnnotation(box("minimo", 0, 0, 60, 24)).annotations).toHaveLength(1);
      const uuid = service.current()!.annotations[0]!.uuid;
      expect(() => service.updateAnnotation(uuid, { text: "" })).toThrow("vuoto");
      expect(() => service.updateAnnotation(uuid, { widthMm: 10 })).toThrow("Dimensione");
      expect(() => service.updateAnnotation(uuid, { heightMm: 1e9 })).toThrow("Dimensione");
      expect(service.current()!.annotations).toEqual([{ uuid, text: "minimo", xMm: 0, yMm: 0, widthMm: 60, heightMm: 24, ...DEFAULT_FONT }]);
    } finally { service.discardCurrent(); }
  });

  it("is project presentation data: no configured item, line, physical node or Distinta row", async () => {
    const { service } = await created();
    try {
      const before = service.current()!;
      const after = service.addAnnotation(box("Solo testo", 5, 6));
      expect(after.lines).toEqual(before.lines);
      expect(after.configuredItems).toEqual(before.configuredItems);
      expect(after.physicalNodes).toEqual(before.physicalNodes);
      expect(after.distinta).toEqual(before.distinta);
    } finally { service.discardCurrent(); }
  });

  it("survives save and a catalogue-free reopen: text, position and size, in order", async () => {
    const { folder, filename, service } = await created();
    service.addAnnotation(box("A", 1.25, 2.5, 90.5, 30.25));
    const view = service.addAnnotation(box("B con\ndue righe", -300, 4000, 500, 120));
    service.updateAnnotation(view.annotations[0]!.uuid, { xMm: 7.5, widthMm: 111 });
    await service.save(); service.close();
    const saved = new Database(filename, { readonly: true });
    try {
      expect(projectFormatVersion(migrationsFolder)).toBe(11);
      expect(saved.prepare("SELECT value FROM lqp_meta WHERE key='format_version'").pluck().get()).toBe("11");
      expect(saved.prepare("SELECT text,x_mm,y_mm,width_mm,height_mm,font_size_mm FROM prj_annotation ORDER BY sort_order").all())
        .toEqual([{ text: "A", x_mm: 7.5, y_mm: 2.5, width_mm: 111, height_mm: 30.25, font_size_mm: 12 },
          { text: "B con\ndue righe", x_mm: -300, y_mm: 4000, width_mm: 500, height_mm: 120, font_size_mm: 12 }]);
      for (const table of ["prj_node", "prj_item", "prj_line"]) expect(saved.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(0);
    } finally { saved.close(); }
    const reader = catalogueFreeService(folder, "reader");
    try {
      const reopened = reader.open(filename);
      expect(reopened.annotations.map(({ text, xMm, yMm, widthMm, heightMm }) => [text, xMm, yMm, widthMm, heightMm]))
        .toEqual([["A", 7.5, 2.5, 111, 30.25], ["B con\ndue righe", -300, 4000, 500, 120]]);
      expect(reader.updateAnnotation(reopened.annotations[0]!.uuid, { text: "A rivista" }).dirty).toBe(true);
      await reader.save();
    } finally { reader.close(); }
    const again = catalogueFreeService(folder, "again");
    try { expect(again.open(filename).annotations.map(note => note.text)).toEqual(["A rivista", "B con\ndue righe"]); }
    finally { again.close(); }
  });

  it("refuses to open a document whose annotation rows are invalid", async () => {
    for (const [label, sql] of [["x", "UPDATE prj_annotation SET x_mm = 1e12"], ["width", "UPDATE prj_annotation SET width_mm = 5"],
      ["height", "UPDATE prj_annotation SET height_mm = -3"], ["huge", "UPDATE prj_annotation SET width_mm = 1e9"]] as const) {
      const { folder, filename, service } = await created();
      service.addAnnotation(box("valida", 0, 0, 100, 40));
      await service.save(); service.close();
      const tamper = new Database(filename);
      try { tamper.pragma("ignore_check_constraints = ON"); tamper.prepare(sql).run(); } finally { tamper.close(); }
      expect(() => catalogueFreeService(folder, `reader-${label}`).open(filename), label).toThrow(/annotazione non valida/);
    }
  });

  it("migrates a format-6 document deterministically: legacy points become sized boxes, with no catalogue", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "lqp-annotations-migrate-")); folders.push(folder);
    // A current document is rewound to a genuine format-6 file: the 0005 table, later schema and history removed.
    const filename = path.join(folder, "old.lqp");
    const writer = catalogueFreeService(folder, "old-writer");
    await writer.create(metadata(filename));
    await writer.save(); writer.close();
    const rewind = new Database(filename);
    try {
      rewind.exec("ALTER TABLE prj_item DROP COLUMN mounting_json; ALTER TABLE prj_item_zone DROP COLUMN mounting_json");
      rewind.exec("ALTER TABLE prj_item DROP COLUMN source_import_fingerprint; ALTER TABLE prj_item DROP COLUMN source_adapter_version; ALTER TABLE prj_item DROP COLUMN source_adapter_code; ALTER TABLE prj_item DROP COLUMN engineering_provenance");
      rewind.exec("DROP TABLE prj_annotation");
      rewind.exec("ALTER TABLE prj_item_bom DROP COLUMN line_discount_bp");
      rewind.exec("ALTER TABLE prj_project DROP COLUMN labour_total_e4");
      rewind.exec(readFileSync(path.join(migrationsFolder, "0005_fronte_annotations.sql"), "utf8").replaceAll("--> statement-breakpoint", ""));
      expect(rewind.prepare("DELETE FROM __drizzle_migrations WHERE created_at > (SELECT created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 5)").run().changes).toBe(5);
      rewind.prepare("UPDATE lqp_meta SET value = '6' WHERE key = 'format_version'").run();
    } finally { rewind.close(); }
    const legacy = ["Breve", "Riga uno\nRiga due\nRiga tre", "x".repeat(700), "y".repeat(2000)];
    const raw = new Database(filename);
    try {
      expect(raw.prepare("SELECT value FROM lqp_meta WHERE key='format_version'").pluck().get()).toBe("6");
      expect((raw.pragma("table_xinfo('prj_annotation')") as { name: string }[]).map(column => column.name)).not.toContain("width_mm");
      const insert = raw.prepare("INSERT INTO prj_annotation(uuid,text,x_mm,y_mm,sort_order) VALUES(?,?,?,?,?)");
      legacy.forEach((text, index) => insert.run(`10000000-0000-4000-8000-00000000000${index + 1}`, text, 100 + index, 200 + index, index));
    } finally { raw.close(); }

    const results: unknown[] = [];
    for (const label of ["first", "second"]) {
      const copy = path.join(folder, `${label}.lqp`); copyFileSync(filename, copy);
      const reader = catalogueFreeService(folder, label);
      try {
        const opened = reader.open(copy);
        results.push(opened.annotations);
        expect(opened.annotations.map(note => note.text)).toEqual(legacy);
        expect(opened.annotations.map(note => [note.xMm, note.yMm])).toEqual([[100, 200], [101, 201], [102, 202], [103, 203]]);
        // 240 mm wide; height = max(40, (newlines + 1 + length / 32) * 16 + 8) from the text alone.
        expect(opened.annotations.map(note => [note.widthMm, note.heightMm])).toEqual([[240, 40], [240, 56], [240, 40 + 0 + (Math.floor(700 / 32) + 1) * 16 - 32], [240, (Math.floor(2000 / 32) + 1) * 16 + 8]]);
        await reader.save();
      } finally { reader.close(); }
      const migrated = new Database(copy, { readonly: true });
      try { expect(migrated.prepare("SELECT value FROM lqp_meta WHERE key='format_version'").pluck().get()).toBe("11"); }
      finally { migrated.close(); }
    }
    expect(results[1]).toEqual(results[0]);
    expect((results[0] as { fontSizeMm: number }[]).map(note => note.fontSizeMm)).toEqual([12, 12, 12, 12]);
  });

  it("migrates a format-8 document: every existing box becomes 12 mm, nothing else changes, no catalogue", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "lqp-annotations-font-migrate-")); folders.push(folder);
    const filename = path.join(folder, "format8.lqp");
    const writer = catalogueFreeService(folder, "f8-writer");
    await writer.create(metadata(filename));
    writer.addAnnotation(box("Uno", 5, 6, 100, 30)); writer.addAnnotation(box("Due", 7, 8, 150, 50));
    await writer.save(); writer.close();
    const rewind = new Database(filename);
    try {
      rewind.exec("ALTER TABLE prj_item DROP COLUMN mounting_json; ALTER TABLE prj_item_zone DROP COLUMN mounting_json");
      rewind.exec("ALTER TABLE prj_item DROP COLUMN source_import_fingerprint; ALTER TABLE prj_item DROP COLUMN source_adapter_version; ALTER TABLE prj_item DROP COLUMN source_adapter_code; ALTER TABLE prj_item DROP COLUMN engineering_provenance");
      rewind.exec("ALTER TABLE prj_annotation DROP COLUMN font_size_mm");
      expect(rewind.prepare("DELETE FROM __drizzle_migrations WHERE created_at > (SELECT created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 7)").run().changes).toBe(3);
      rewind.prepare("UPDATE lqp_meta SET value = '8' WHERE key = 'format_version'").run();
    } finally { rewind.close(); }
    const raw = new Database(filename, { readonly: true });
    try { expect((raw.pragma("table_xinfo('prj_annotation')") as { name: string }[]).map(column => column.name)).not.toContain("font_size_mm"); }
    finally { raw.close(); }
    const reader = catalogueFreeService(folder, "f8-reader");
    try {
      const opened = reader.open(filename);
      expect(opened.annotations.map(({ text, xMm, yMm, widthMm, heightMm, fontSizeMm }) => [text, xMm, yMm, widthMm, heightMm, fontSizeMm]))
        .toEqual([["Uno", 5, 6, 100, 30, 12], ["Due", 7, 8, 150, 50, 12]]);
      await reader.save();
    } finally { reader.close(); }
    const migrated = new Database(filename, { readonly: true });
    try {
      expect(migrated.prepare("SELECT value FROM lqp_meta WHERE key='format_version'").pluck().get()).toBe("11");
      expect(migrated.prepare("SELECT font_size_mm FROM prj_annotation ORDER BY sort_order").pluck().all()).toEqual([12, 12]);
    } finally { migrated.close(); }
  });

  it("keeps one text size per box: default 12, each box its own, only the touched box changes", async () => {
    const { service } = await created();
    try {
      const first = service.addAnnotation(box("Normale", 0, 0, 200, 40)).annotations[0]!;
      expect(first.fontSizeMm).toBe(12);
      const second = service.addAnnotation({ ...box("Grande", 0, 100, 200, 40), fontSizeMm: 28 }).annotations[1]!;
      expect(second.fontSizeMm).toBe(28);
      const changed = service.updateAnnotation(first.uuid, { fontSizeMm: 8 });
      expect(changed.annotations.map(note => note.fontSizeMm)).toEqual([8, 28]);
      expect(changed.annotations[0]).toEqual({ ...first, fontSizeMm: 8 });
      // Text, position and size edits never touch the text size.
      const edited = service.updateAnnotation(second.uuid, { text: "Ancora grande", xMm: 3, widthMm: 250 }).annotations[1]!;
      expect(edited.fontSizeMm).toBe(28);
      for (const fontSizeMm of [6, 60, 6.5, 59.9]) expect(service.updateAnnotation(first.uuid, { fontSizeMm }).annotations[0]!.fontSizeMm).toBe(fontSizeMm);
    } finally { service.discardCurrent(); }
  });

  it("rejects a text size outside 6–60 mm or that is not a finite number", async () => {
    const { service } = await created();
    try {
      for (const fontSizeMm of [5.9, 60.1, 0, -12, Number.NaN, Number.POSITIVE_INFINITY, "12" as unknown as number, null as unknown as number])
        expect(() => service.addAnnotation({ ...box("x"), fontSizeMm }), String(fontSizeMm)).toThrow("Dimensione del testo");
      expect(service.current()!.annotations).toEqual([]);
      const uuid = service.addAnnotation(box("ok")).annotations[0]!.uuid;
      for (const fontSizeMm of [5.9, 60.1, Number.NaN, "18" as unknown as number])
        expect(() => service.updateAnnotation(uuid, { fontSizeMm }), String(fontSizeMm)).toThrow("Dimensione del testo");
      expect(service.current()!.annotations[0]!.fontSizeMm).toBe(12);
    } finally { service.discardCurrent(); }
  });

  it("a larger text size lengthens a box that could not hold one line of it, and never shortens a tall one", async () => {
    const { service } = await created();
    try {
      const short = service.addAnnotation(box("Breve", 0, 0, 200, 24)).annotations[0]!;
      expect(short.heightMm).toBe(24);
      // 60 mm × 1.3 line height + 2 × 3 mm padding = 84 mm.
      const grown = service.updateAnnotation(short.uuid, { fontSizeMm: 60 }).annotations[0]!;
      expect(grown.heightMm).toBe(84);
      expect(grown.fontSizeMm).toBe(60);
      // Going back down keeps the height the box now has.
      expect(service.updateAnnotation(short.uuid, { fontSizeMm: 12 }).annotations[0]!.heightMm).toBe(84);
      // A box that is already tall enough keeps its height.
      const tall = service.addAnnotation(box("Alta", 0, 200, 200, 300)).annotations[1]!;
      expect(service.updateAnnotation(tall.uuid, { fontSizeMm: 60 }).annotations[1]!.heightMm).toBe(300);
      // A new box created with a size is at least one line tall; a 12 mm box keeps the general minimum.
      expect(service.addAnnotation({ ...box("Nuova", 0, 600, 200, 24), fontSizeMm: 28 }).annotations[2]!.heightMm).toBe(Math.ceil((28 * 1.3 + 6) * 10) / 10);
      // Resizing below one line of the box's own size is lifted to it.
      expect(service.updateAnnotation(short.uuid, { fontSizeMm: 28, heightMm: 24 }).annotations[0]!.heightMm).toBe(42.4);
    } finally { service.discardCurrent(); }
  });

  it("saves and reopens each box's text size, with no catalogue", async () => {
    const { folder, filename, service } = await created();
    service.addAnnotation({ ...box("Piccolo"), fontSizeMm: 8 });
    service.addAnnotation(box("Normale", 0, 100));
    service.addAnnotation({ ...box("Molto grande", 0, 200, 300, 120), fontSizeMm: 28 });
    await service.save(); service.close();
    const reader = catalogueFreeService(folder, "font-reader");
    try {
      expect(reader.open(filename).annotations.map(note => [note.text, note.fontSizeMm])).toEqual([["Piccolo", 8], ["Normale", 12], ["Molto grande", 28]]);
      const uuid = reader.current()!.annotations[0]!.uuid;
      expect(reader.updateAnnotation(uuid, { fontSizeMm: 18 }).dirty).toBe(true);
      await reader.save();
    } finally { reader.close(); }
    const again = catalogueFreeService(folder, "font-again");
    try { expect(again.open(filename).annotations.map(note => note.fontSizeMm)).toEqual([18, 12, 28]); }
    finally { again.close(); }
  });

  it("refuses to open a document whose stored text size is outside 6–60 mm", async () => {
    for (const [label, value] of [["small", 5], ["large", 61], ["zero", 0]] as const) {
      const { folder, filename, service } = await created();
      service.addAnnotation(box("valida"));
      await service.save(); service.close();
      const tamper = new Database(filename);
      try { tamper.pragma("ignore_check_constraints = ON"); tamper.prepare("UPDATE prj_annotation SET font_size_mm = ?").run(value); } finally { tamper.close(); }
      expect(() => catalogueFreeService(folder, `font-${label}`).open(filename), label).toThrow(/annotazione non valida/);
    }
  });

  it("validates the IPC payloads before the service is called", () => {
    const handlers = new Map<string, (event: { senderFrame: unknown }, ...args: unknown[]) => unknown>();
    const registry: ProjectIpcRegistry = { handle: (channel, listener) => { handlers.set(channel, listener); }, removeHandler: () => undefined };
    const service = { addAnnotation: vi.fn(() => "view"), updateAnnotation: vi.fn(() => "view"), removeAnnotation: vi.fn(() => "view") };
    registerProjectIpc(registry, service as never, {} as never, () => true, undefined as never);
    const event = { senderFrame: {} };
    const uuid = "10000000-0000-4000-8000-000000000001";
    const add = handlers.get(PROJECT_CHANNELS.addAnnotation)!;
    expect(add(event, box("t", 1, 2, 100, 40))).toBe("view");
    expect(service.addAnnotation).toHaveBeenCalledWith(box("t", 1, 2, 100, 40));
    expect(() => add(event, { ...box("t"), price: 3 })).toThrow("inattesi");
    expect(() => add(event, "text")).toThrow();
    handlers.get(PROJECT_CHANNELS.updateAnnotation)!(event, uuid, { text: "nuovo", widthMm: 90 });
    expect(service.updateAnnotation).toHaveBeenCalledWith(uuid, { text: "nuovo", widthMm: 90 });
    handlers.get(PROJECT_CHANNELS.updateAnnotation)!(event, uuid, { xMm: 1, yMm: 2, heightMm: 33 });
    expect(service.updateAnnotation).toHaveBeenLastCalledWith(uuid, { xMm: 1, yMm: 2, heightMm: 33 });
    expect(() => handlers.get(PROJECT_CHANNELS.updateAnnotation)!(event, "bad", {})).toThrow();
    expect(() => handlers.get(PROJECT_CHANNELS.updateAnnotation)!(event, uuid, { rotation: 3 })).toThrow("inattesi");
    // The text size passes through unchanged on both paths: the service owns the range check.
    handlers.get(PROJECT_CHANNELS.updateAnnotation)!(event, uuid, { fontSizeMm: 18 });
    expect(service.updateAnnotation).toHaveBeenLastCalledWith(uuid, { fontSizeMm: 18 });
    expect(add(event, { ...box("t", 1, 2, 100, 40), fontSizeMm: 28 })).toBe("view");
    expect(service.addAnnotation).toHaveBeenLastCalledWith({ ...box("t", 1, 2, 100, 40), fontSizeMm: 28 });
    handlers.get(PROJECT_CHANNELS.removeAnnotation)!(event, uuid);
    expect(service.removeAnnotation).toHaveBeenCalledWith(uuid);
  });
});
