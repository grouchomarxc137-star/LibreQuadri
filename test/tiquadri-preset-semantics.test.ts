import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { modelDefinitionFingerprint, presetPlacementMode } from "../src/main/sources/tiquadri/import.js";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");

describe("TiQuadri preset normalization",()=>{
  it("maps absolute anchors to fixed, offset-free relative rows to packed and keeps relative offsets unknown",()=>{
    expect(presetPlacementMode({Pos_Pan_XY_assoluti:true,Inserimento_X:57,Inserimento_Y:127})).toBe("fixed");
    expect(presetPlacementMode({Pos_Pan_XY_assoluti:true,Inserimento_X:0,Inserimento_Y:0})).toBe("fixed");
    expect(presetPlacementMode({Pos_Pan_XY_assoluti:false,Inserimento_X:0,Inserimento_Y:0})).toBe("packed");
    expect(presetPlacementMode({Pos_Pan_XY_assoluti:false,Inserimento_X:103,Inserimento_Y:50})).toBeNull();
    expect(presetPlacementMode({Pos_Pan_XY_assoluti:false,Inserimento_X:0,Inserimento_Y:40})).toBeNull();
  });

  it("keeps the previous definition identity for models without presets and changes it only for preset parents",()=>{
    const definition=[{ID_Pack:343,Descri_Pack:"Quadro"},[{Id_Modalita:233}],[],[[]]];
    // Adapter 6 identity: sha256 of the JSON definition parts, nothing else.
    expect(modelDefinitionFingerprint(definition,[])).toBe(sha(JSON.stringify(definition)));
    const preset=[{ID_Pack_Quadro:2890,ID_Pack_Pannello:2902,Pos_Pan_XY_assoluti:true,Inserimento_X:57,Inserimento_Y:127}];
    expect(modelDefinitionFingerprint(definition,preset)).not.toBe(sha(JSON.stringify(definition)));
    expect(modelDefinitionFingerprint(definition,[{...preset[0],Inserimento_Y:128}]))
      .not.toBe(modelDefinitionFingerprint(definition,preset));
  });
});
