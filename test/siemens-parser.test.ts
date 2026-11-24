import { describe, expect, it } from "vitest";
import { sieDescriptionParser } from "../src/main/catalogue/parsers/sie-description.js";
import { SIE_FAMILY_PROFILES } from "../src/main/catalogue/parsers/sie-families.js";
import { loadCategorySeed } from "../src/main/catalogue/category-seed.js";
import { loadAttributeSeed } from "../src/main/catalogue/attribute-seed.js";

const parse = (description: string, family = "P310 I22Y", extra = {}) => sieDescriptionParser.parse({
  description, manufacturerCode: "IGNORED", statisticalFamilyCode: family, statisticalFamilyIssuerSigla: "SIE", ...extra,
});
const values = (description: string, family?: string) => Object.fromEntries([...parse(description, family).values].map(([c, v]) => [c, v.value]));

describe("reviewed Siemens descriptions", () => {
  it("reviews every imported family and links valid attributes without changing manufacturer navigation", () => {
    const seed = loadCategorySeed();
    const mappings = seed.mappings.filter(m => m.brandMarchio === "SIE");
    expect(mappings).toHaveLength(212);
    expect(mappings.map(m => m.matchValue).sort()).toEqual(Object.keys(SIE_FAMILY_PROFILES).sort());
    for (const m of mappings) expect(m).toMatchObject({issuerSigla:"SIE",sourceType:"STATISTICA",matchMode:"exact"});
    expect(loadAttributeSeed().attributes.find(a => a.code === "rated_short_circuit_capacity")?.unit).toBe("kA");
  });
  it("separates Icn and Icu and handles combined decimal curve/current tokens", () => {
    expect(values("INT MT 1P+N C1,6 ICN 15KA, ICU 50KA")).toEqual({article_kind:"device",poles:"1p_n",trip_curve:"c",rated_current:1.6,
      rated_short_circuit_capacity:15,rated_ultimate_breaking_capacity:50});
    expect(values("INT. MT ICN 6000A, ICU 6KA 4P B6")).toMatchObject({rated_current:6,rated_short_circuit_capacity:6,rated_ultimate_breaking_capacity:6});
    expect(values("INT MT 1P+N C2 4500A 1UM NEW")).toMatchObject({rated_current:2,declared_breaking_capacity:4.5});
    expect(values("INT MT 3P A2 ICN 10KA ICU 35KA").trip_curve).toBe("a");
  });
  it("leaves multiple unlabelled capacities ambiguous", () => {
    const result = parse("MTD 10KA 20KA 1P+N B25 TIPO A 0,3A", "P310 I215");
    expect(Object.fromEntries([...result.values].map(([c,v])=>[c,v.value]))).toMatchObject({rated_current:25,rated_residual_current:300,residual_current_type:"a"});
    expect(result.ambiguous).toContain("declared_breaking_capacity");
    expect(result.values.has("rated_ultimate_breaking_capacity")).toBe(false);
    expect(values("MTD 10KA 15KA 1P+N B40 TIPO AC30MA", "P310 I215")).toMatchObject({rated_residual_current:30,residual_current_type:"ac"});
  });
  it("separates range settings from In and does not turn Im into In", () => {
    expect(values("INTAUT.3X12A S00 0,11-0,16A 100KA", "R711 I715")).toEqual({article_kind:"device",current_setting_min:0.11,current_setting_max:0.16,declared_breaking_capacity:100});
    expect(values("RELE' TERS00 3,5-5,0 A VT", "R711 I346")).toMatchObject({current_setting_min:3.5,current_setting_max:5});
  });
  it("never borrows ratings from an accessory's target device", () => {
    expect(values("MORS.X COND. CIRC. X 3VA12 6 FORI 3P", "P360 I74L")).toEqual({article_kind:"accessory"});
    expect(values("CALOTTE 3 POLI X 3KL718 SPEC.", "P230 I85F")).toEqual({article_kind:"accessory"});
    expect(values("ACCESSORIO PER INT MT 4P C16 400V 10KA")).toEqual({article_kind:"accessory"});
    expect(values("PROLUNGA LINEA A UN CAVO", "R220 I66B")).toEqual({article_kind:"accessory"});
    expect(values("BOBINA 24V PER CONTATTORE 400V 16A", "R711 I805")).toEqual({article_kind:"accessory",coil_voltage:24});
  });
  it("keeps coil, line, auxiliary and output voltages distinct", () => {
    expect(values("CONT4KW,1L,1R,AC 24V 50HZ,S0 VT", "R711 I336")).toMatchObject({rated_power:4,coil_voltage:24});
    expect(values("CONTACTOR, 160KW/400V/AC-3", "R711 I706")).toMatchObject({rated_voltage:400,rated_power:160});
    expect(values("CONTACTOR, 160KW/400V/AC-3", "R711 I706").coil_voltage).toBeUndefined();
    expect(values("SOFTSTARTER S0 5,5KW 400V, 24V AUS", "R711 I727")).toMatchObject({rated_power:5.5,rated_voltage:400,supply_voltage:24});
    expect(values("SOFTSTARTER 400V 143A AUS 24V AC/DC ML", "R711 I980")).toMatchObject({rated_voltage:400,supply_voltage:24,rated_current:143});
    expect(values("SITOP PSU100L 1AC DC24V 2.5A", "R315 I0HA")).toMatchObject({output_voltage:24,rated_current:2.5});
    const range = parse("G120X IP20 200-240V 2.2KW FSB UF", "R220 I66X");
    expect(range.values.has("rated_voltage")).toBe(false);
    expect(range.ambiguous).toContain("rated_voltage");
    expect(values("FUS. NEOZED GR D01 10A 250VCC 400VCA", "P310 I210").rated_voltage).toBeUndefined();
  });
  it("reads own dimensions, IP, torque and I/O counts without guessing unnamed dimensions", () => {
    expect(values("ARM. VENT. SI IP20 HXWXD 2000X800X1000", "P310 I769")).toMatchObject({ip_rating:"ip20",height:2000,width:800,depth:1000});
    expect(values("ALPHA SP.IP43COMPL.P.LAM.B600 H400 P140", "P320 I22H")).toMatchObject({height:400,width:600,depth:140});
    expect(values("MOTORE SINCRONO 1FK2-HD 0,16 NM", "R220 I66B")).toMatchObject({rated_torque:0.16});
    expect(values("CPU 1211C, DC/DC/DC, 6DI/4DO/2AI", "R132 IC12")).toMatchObject({digital_inputs:6,digital_outputs:4,analog_inputs:2});
    expect(values("ET 200SP, DI 8X24VDC HF", "R135 IC54")).toMatchObject({digital_inputs:8});
    expect(values("ET 200SP, DI 8X24VDC HF", "R135 IC54").supply_voltage).toBeUndefined();
    expect(values("SPD 1P T1+T2 N-PE UC 255V 100KA CS 2UM", "P310 I21E").declared_breaking_capacity).toBeUndefined();
    expect(values("BASE IPXX L1000 P400", "P310 I769").ip_rating).toBeUndefined();
    expect(values("IO-LINK MODULO K20, 4DI-M12", "R711 I340")).toMatchObject({article_kind:"device",digital_inputs:4});
    expect(values("PULS.F.EMERG ROTAZIONE 30MM", "R711 I454").diameter).toBeUndefined();
    expect(parse("ALPHA AS P400 B300 ZOCCOLO AGGIUNTIVO H1", "P320 I22U").ambiguous).toContain("height");
    expect(values("GUIDA L6000MM", "P310 I769").width).toBeUndefined();
    expect(values("TRAFO MON 213KVA 208-550/2X115V IP23", "R716 I872").apparent_power).toBeUndefined();
    expect(values("TRAFO MON 0020KVA 230+-5%/24V IP00", "R716 I872").apparent_power).toBeUndefined();
  });
  it("recognizes electronic trip units without guessing their protection functions", () => {
    expect(values("INT.AUT.3VA 400A 4P 55KA ETU5 LSI L/T", "P360 I74L")).toMatchObject({trip_unit_type:"electronic_lsi"});
    expect(values("INT.AUT.3VA 25A 4P 55KA ETU3 LIG L/T", "P360 I74L")).toMatchObject({trip_unit_type:"electronic"});
  });
  it("parses only explicit software/licence information and leaves upgrade versions unresolved", () => {
    expect(values("STEP 7 V5.7 SP3 JAPANESE DL, FL", "R132 IC10")).toEqual({article_kind:"software",software_version:"v5_7",licence_type:"floating"});
    expect(values("SIRIUS SOFT STARTER ES V18", "R711 I982")).toEqual({article_kind:"software",software_version:"v18"});
    expect(parse("UPG WINCC RT PROF 4096 V11/15->V16", "R1OS IE10").ambiguous).toContain("software_version");
    expect(values("STEP7 SW UPDATE SERVICE SUS", "R134 IC44")).toEqual({article_kind:"software",software_delivery:"sus"});
  });
  it("requires a reviewed Siemens family and issuer; never derives values from codes", () => {
    expect(parse("INT MT 2P C16", "UNKNOWN").values.size).toBe(0);
    expect(parse("INT MT 2P C16", "P310 I22Y", {statisticalFamilyIssuerSigla:"BTI"}).values.size).toBe(0);
    expect(parse("UNRESOLVED", "P310 I22Y", {manufacturerCode:"5SY62167"}).values.size).toBe(0);
  });
});
