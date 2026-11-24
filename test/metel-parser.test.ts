import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { PRICE_LIST_LAYOUTS } from "../src/main/metel/layouts.js";
import {
  MetelParseError,
  parseMetelSource,
  type ParsedMetelSource,
} from "../src/main/metel/parser.js";

function setRange(target: string[], start: number, length: number, value: string): void {
  const padded = value.padEnd(length, " ").slice(0, length);
  target.splice(start, length, ...padded);
}

function validLsp020(): Buffer {
  const header = Array<string>(177).fill(" ");
  setRange(header, 0, 20, "LISTINO METEL");
  setRange(header, 20, 3, "TST");
  setRange(header, 23, 11, "12345678901");
  setRange(header, 34, 6, "000001");
  setRange(header, 40, 8, "20260101");
  setRange(header, 48, 8, "20260102");
  setRange(header, 56, 30, "Test listino");
  setRange(header, 125, 3, "020");

  const row = Array<string>(PRICE_LIST_LAYOUTS["020"].lineLength).fill(" ");
  setRange(row, 0, 3, "TST");
  setRange(row, 3, 16, "ABC123");
  setRange(row, 19, 13, "1234567890123");
  setRange(row, 32, 43, "Descrizione test");
  setRange(row, 75, 5, "00001");
  setRange(row, 80, 5, "00001");
  setRange(row, 85, 5, "00001");
  setRange(row, 90, 6, "999999");
  setRange(row, 96, 1, "1");
  setRange(row, 97, 11, "00000001234");
  setRange(row, 108, 11, "00000001234");
  setRange(row, 119, 6, "000001");
  setRange(row, 125, 3, "EUR");
  setRange(row, 128, 3, "PCE");
  setRange(row, 131, 1, "0");
  setRange(row, 132, 1, "1");
  setRange(row, 133, 8, "20260102");
  setRange(row, 141, 18, "DISC");
  setRange(row, 159, 18, "STAT");
  return Buffer.from(`${header.join("")}\r\n${row.join("")}\r\n`, "ascii");
}

function replaceAscii(source: Buffer, start: number, value: string): Buffer {
  const result = Buffer.from(source);
  result.write(value, start, value.length, "ascii");
  return result;
}

describe("METEL fixed-width parser validation", () => {
  it("parses the supported v020 layout and normalizes dates", () => {
    const parsed = parseMetelSource(validLsp020());

    expect(parsed.metadata).toMatchObject({
      fileType: "LSP",
      issuerSigla: "TST",
      issuerPiva: "12345678901",
      listinoNumber: "000001",
      validFrom: "2026-01-01",
      lastChangeDate: "2026-01-02",
      layoutVersion: "020",
    });
    expect(parsed.priceListRows[0]).toMatchObject({
      lineNo: 2,
      codice: "ABC123",
      prezzoRivenditoreCents: 1234,
      dataVariazione: "2026-01-02",
      extraV021: null,
    });
  });

  it("rejects unsupported versions", () => {
    const source = replaceAscii(validLsp020(), 125, "022");
    expect(() => parseMetelSource(source)).toThrowError(
      /Unsupported LSP layout version "022"/,
    );
  });

  it("rejects invalid line lengths", () => {
    const source = validLsp020().subarray(0, validLsp020().length - 3);
    expect(() => parseMetelSource(source)).toThrowError(/Invalid LSP line length/);
  });

  it("rejects malformed numeric fields with line and field context", () => {
    const headerBytes = 177 + 2;
    const source = replaceAscii(validLsp020(), headerBytes + 97, "00000X01234");
    expect(() => parseMetelSource(source)).toThrowError(
      /Malformed numeric value.*line 2, field prezzoRivenditoreCents/,
    );
  });

  it("rejects malformed headers", () => {
    expect(() => parseMetelSource(Buffer.from("NOT A METEL FILE\r\n"))).toThrow(
      MetelParseError,
    );
  });

  it("decodes Windows-1252 family descriptions and normalizes CRLF", () => {
    const header = "FAMIGLIE STATISTICHE020".padEnd(94, " ");
    const row = "TSTSIECODE".padEnd(24, " ") + "RELE X TEST".padEnd(70, " ");
    const bytes = Buffer.from(`${header}\r\n${row}\r\n`, "ascii");
    const descriptionOffset = 94 + 2 + 24 + 5;
    bytes[descriptionOffset] = 0xc8;

    const parsed = parseMetelSource(bytes);
    expect(parsed.familyRows[0]?.description).toBe("RELE È TEST");
  });

  it("rejects duplicate family keys within one source", () => {
    const header = "FAMIGLIE STATISTICHE020".padEnd(94, " ");
    const row = (description: string) =>
      `${"TSTTSTCODE-123".padEnd(24, " ")}${description.padEnd(70, " ")}`;
    const bytes = Buffer.from(
      `${header}\r\n${row("First")}\r\n${row("Second")}\r\n`,
      "ascii",
    );

    expect(() => parseMetelSource(bytes)).toThrowError(
      /Duplicate family key first seen on line 2.*line 3, field code/,
    );
  });
});

const sampleRoot = process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const samplePaths = {
  btiLsp: path.join(sampleRoot, "BTILSP021.txt", "BTILSP021.txt"),
  btiFsc: path.join(sampleRoot, "BTIFSC.txt", "BTIFSC.txt"),
  btiFst: path.join(sampleRoot, "BTIFST.txt", "BTIFST.txt"),
  sieLsp: path.join(sampleRoot, "SIELSP_20260701.txt", "SIELSP_20260701.txt"),
  sieFsc: path.join(sampleRoot, "SIEFSC.TXT", "SIEFSC.TXT"),
  sieFst: path.join(sampleRoot, "SIEFST.TXT", "SIEFST.TXT"),
  snrLsp: path.join(sampleRoot, "SNRLSP021.txt", "SNRLSP021.txt"),
  snrFsc: path.join(sampleRoot, "SNRFSC.txt", "SNRFSC.txt"),
  snrFst: path.join(sampleRoot, "SNRFST.txt", "SNRFST.txt"),
} as const;
const realSamplesAvailable = Object.values(samplePaths).every(existsSync);

describe.runIf(realSamplesAvailable)("real supplied METEL samples", () => {
  const parsed = {} as Record<keyof typeof samplePaths, ParsedMetelSource>;

  beforeAll(() => {
    for (const [name, filename] of Object.entries(samplePaths)) {
      parsed[name as keyof typeof samplePaths] = parseMetelSource(
        readFileSync(filename),
      );
    }
  });

  it("matches the documented LSP record and brand counts", () => {
    const expected = {
      btiLsp: {
        version: "021",
        rows: 24_676,
        brands: { BTI: 9_439, LEG: 9_542, IMS: 4_567, ZUC: 560, CAB: 556, NTM: 12 },
      },
      sieLsp: {
        version: "020",
        rows: 68_117,
        brands: { SIE: 64_981, BCT: 3_136 },
      },
      snrLsp: { version: "021", rows: 29_742, brands: { SNR: 29_742 } },
    } as const;

    for (const [name, facts] of Object.entries(expected)) {
      const source = parsed[name as keyof typeof parsed]!;
      expect(source.metadata.layoutVersion).toBe(facts.version);
      expect(source.priceListRows).toHaveLength(facts.rows);
      const brandCounts: Record<string, number> = {};
      for (const row of source.priceListRows) {
        brandCounts[row.marchio] = (brandCounts[row.marchio] ?? 0) + 1;
      }
      expect(brandCounts).toEqual(facts.brands);
    }
  });

  it("parses the real headers and family row counts", () => {
    expect(parsed.btiLsp.metadata).toMatchObject({
      issuerSigla: "BTI",
      issuerPiva: "10991860155",
      listinoNumber: "2126",
      validFrom: "2026-04-01",
      lastChangeDate: "2026-07-01",
    });
    expect(parsed.sieLsp.metadata).toMatchObject({
      issuerSigla: "SIE",
      listinoNumber: "202601",
      layoutVersion: "020",
    });
    expect(parsed.snrLsp.metadata).toMatchObject({
      issuerSigla: "SNR",
      listinoNumber: "202603",
      layoutVersion: "021",
    });

    expect(parsed.btiFsc.familyRows).toHaveLength(66);
    expect(parsed.btiFst.familyRows).toHaveLength(503);
    expect(parsed.sieFsc.familyRows).toHaveLength(125);
    expect(parsed.sieFst.familyRows).toHaveLength(237);
    expect(parsed.snrFsc.familyRows).toHaveLength(84);
    expect(parsed.snrFst.familyRows).toHaveLength(99);
    expect(parsed.sieFst.familyRows.some((row) => row.description.includes("RELÈ"))).toBe(true);
  });

  it("keeps every supplied family key unique and preserves 18-character codes", () => {
    for (const name of [
      "btiFsc",
      "btiFst",
      "sieFsc",
      "sieFst",
      "snrFsc",
      "snrFst",
    ] as const) {
      const source = parsed[name];
      const keys = new Set(
        source.familyRows.map(
          (row) =>
            `${row.issuerSigla}\0${row.marchio}\0${row.familyType}\0${row.code}`,
        ),
      );
      expect(keys.size).toBe(source.familyRows.length);
    }

    expect(parsed.btiFst.familyRows).toHaveLength(503);
    expect(
      parsed.btiFst.familyRows.some(
        (row) => row.code === "CIV.-108-112-427",
      ),
    ).toBe(true);
  });

  it("matches the documented price, unit and composed-product facts", () => {
    const allRows = [
      ...parsed.btiLsp.priceListRows,
      ...parsed.sieLsp.priceListRows,
      ...parsed.snrLsp.priceListRows,
    ];
    expect(
      allRows.every(
        (row) => row.prezzoRivenditoreCents === row.prezzoPubblicoCents,
      ),
    ).toBe(true);
    expect(new Set(allRows.map((row) => row.um))).toEqual(
      new Set(["PCE", "LM", "BRD"]),
    );
    expect(parsed.snrLsp.priceListRows.filter((row) => row.composto === 1)).toHaveLength(
      463,
    );
  });

  it("preserves the complete unconfirmed v021 trailing area without guessing", () => {
    const row = parsed.btiLsp.priceListRows.find(
      (candidate) => candidate.codice === "004877",
    );
    expect(row?.extraV021).toHaveLength(56);
    expect(row?.extraV021).toBe(
      "3622".padEnd(31, " ") + "0103245060048778300000015",
    );
    expect(row?.electrocod).toBeNull();
    expect(parsed.sieLsp.priceListRows[0]?.extraV021).toBeNull();
  });

  it("resolves all supplied BTicino family references using complete codes", () => {
    const statisticalKeys = new Set(
      parsed.btiFst.familyRows.map(
        (row) => `${row.issuerSigla}\0${row.marchio}\0${row.code}`,
      ),
    );
    const discountKeys = new Set(
      parsed.btiFsc.familyRows.map(
        (row) => `${row.issuerSigla}\0${row.marchio}\0${row.code}`,
      ),
    );
    const missingStatistical = parsed.btiLsp.priceListRows.filter(
      (row) =>
        row.famigliaStatistica !== null &&
        !statisticalKeys.has(`BTI\0${row.marchio}\0${row.famigliaStatistica}`),
    );
    const missingDiscount = parsed.btiLsp.priceListRows.filter(
      (row) =>
        row.famigliaSconto !== null &&
        !discountKeys.has(`BTI\0${row.marchio}\0${row.famigliaSconto}`),
    );

    expect(missingStatistical).toHaveLength(0);
    expect(missingDiscount).toHaveLength(0);
  });
});
