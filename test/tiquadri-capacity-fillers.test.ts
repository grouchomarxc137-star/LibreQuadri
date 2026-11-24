import { readFileSync } from "node:fs";
import path from "node:path";
import type MDBReader from "mdb-reader";
import { afterEach, describe, expect, it } from "vitest";

import { EngineeringDataWriter } from "../src/main/sources/engineering-writer.js";
import { importCapacityFillers, Report, type CapacityFillerApproval, type ModelIndex } from "../src/main/sources/tiquadri/import.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";

const approval: CapacityFillerApproval = { sourceRef: "TiQuadri ANA_PACK 1777", reviewedName: "Falsi polo", sourceModalita: 13497,
  sourceLabel: 85, capacityKind: "din_rail", evidence: "exe" };
const modalita = (overrides: Record<string, unknown> = {}) => [0, 1, 2, 3, 4].map(delta =>
  ({ Id_Modalita: 13497, ID_Label_Modalita_1: 85, ID_Label_Modalita_2: 0, Aumenta_Famiglia: delta, ...overrides }));
const reader = (rows: Record<string, unknown>[]) =>
  ({ getTable: () => ({ getData: () => rows }) }) as unknown as MDBReader;

describe("reviewed TiQuadri capacity-filler designation", () => {
  let fx: CapacityFillFixture | undefined;
  afterEach(() => { fx?.close(); fx = undefined; });

  const run = async (pack: Record<string, unknown>, definition = modalita()) => {
    fx = await capacityFillFixture({ designate: false });
    // The fixture's filler model stands in for the imported pack: same id map an import would build.
    fx.db.prepare("UPDATE cat_config_model SET code='tq.pack.1777' WHERE id=5").run();
    const importId = fx.db.prepare("SELECT MAX(id) FROM app_source_import").pluck().get() as number;
    const models = { ids: new Map([[1777, 5]]), packs: [{ ID_Pack: 1777, ...pack }], activeArticles: new Map(),
      obsoleteArticles: new Map(), counts: {} } as unknown as ModelIndex;
    const report = new Report();
    const result = importCapacityFillers(fx.db, new EngineeringDataWriter(fx.db), reader(definition), importId, 1, models, report, [approval]);
    const rows = fx.db.prepare("SELECT model_id AS modelId,capacity_kind_code AS kind,source,source_ref AS ref FROM cat_config_capacity_filler").all();
    return { result, report, rows };
  };

  it("designates the pack when name, executable modalità, axis and every option profile agree", async () => {
    const { result, rows, report } = await run({ Descri_Pack: "Falsi polo", Id_Modalita: 13497 });
    expect(result).toEqual({ designated: 1, rejected: 0, widths: { "tq.pack.1777": [1, 2, 3, 4, 5] } });
    expect(rows).toEqual([{ modelId: 5, kind: "din_rail", source: "import", ref: "TiQuadri ANA_PACK 1777" }]);
    expect(report.conflicts).toEqual({});
  });

  it.each([
    ["a renamed pack", { Descri_Pack: "Falsi poli nuovi", Id_Modalita: 13497 }, modalita()],
    ["a different modalità", { Descri_Pack: "Falsi polo", Id_Modalita: 99 }, modalita()],
    ["a second option axis", { Descri_Pack: "Falsi polo", Id_Modalita: 13497 }, modalita({ ID_Label_Modalita_2: 7 })],
    ["an option without a filler profile", { Descri_Pack: "Falsi polo", Id_Modalita: 13497 },
      [...modalita(), { Id_Modalita: 13497, ID_Label_Modalita_1: 85, ID_Label_Modalita_2: 0, Aumenta_Famiglia: 40 }]],
  ])("refuses %s, records a conflict and designates nothing", async (_case, pack, definition) => {
    const { result, rows, report } = await run(pack, definition);
    expect(result).toMatchObject({ designated: 0, rejected: 1 });
    expect(rows).toEqual([]);
    expect(report.conflicts).toEqual({ capacity_filler: 1 });
    expect(fx!.db.prepare("SELECT topic,subject_key FROM cat_source_conflict WHERE topic='capacity_filler'").get())
      .toEqual({ topic: "capacity_filler", subject_key: "tq.pack.1777" });
  });

  it("ships the reviewed filler seed with executable evidence under the current adapter", () => {
    const seed = JSON.parse(readFileSync(path.resolve("db/seed/tiquadri-capacity-fillers.json"), "utf8")) as CapacityFillerApproval[];
    expect(seed).toEqual([expect.objectContaining({ sourceRef: "TiQuadri ANA_PACK 1777", reviewedName: "Falsi polo",
      sourceModalita: 13497, sourceLabel: 85, capacityKind: "din_rail" })]);
    expect(seed[0]!.evidence).toContain("ID_MODALITA=13497");
    expect(TIQUADRI_ENGINEERING_ADAPTER.version).toBe("14");
  });
});
