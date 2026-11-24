import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { classifyPanelPresentation, loadPanelPresentationApprovals } from "../src/main/sources/tiquadri/front-presentation.js";

const approvals = loadPanelPresentationApprovals();
it("designates only the five reviewed Idroboard footprints and preserves ordinary artwork identities", () => {
  expect(approvals.map(row => row.packId)).toEqual([2898,2899,2900,2901,2902]);
  for (const approval of approvals) {
    const panel = { Famiglia_pannelli: approval.panelFamily, Pannello_centralino: true, Pannello_DIN: true,
      File_Blocco: "senza", Larghezza: approval.widthMm, Altezza: approval.heightMm };
    const pack = { ID_Pack: approval.packId, Descri_Pack: approval.reviewedName, Famiglia_Pannelli: approval.panelFamily };
    expect(classifyPanelPresentation(panel,pack,approval)).toEqual({symbol:"mounting_guide",conflict:false});
    for (const [field,value] of Object.entries({Pannello_centralino:false,Pannello_DIN:false,Larghezza:1,Altezza:1,
      Famiglia_pannelli:999,File_Blocco:"real-artwork"}))
      expect(classifyPanelPresentation({...panel,[field]:value},pack,approval)).toMatchObject({conflict:true});
    for (const changed of [undefined,{...pack,ID_Pack:999},{...pack,Descri_Pack:"Renamed"},{...pack,Famiglia_Pannelli:999}])
      expect(classifyPanelPresentation(panel,changed,approval)).toEqual({symbol:"din_panel",conflict:true});
    expect(classifyPanelPresentation({...panel,File_Blocco:"real-artwork"},pack,approval))
      .toEqual({symbol:"physical_panel",conflict:true});
  }
  for (const din of [true,false]) for (const centralino of [true,false])
    expect(classifyPanelPresentation({Pannello_DIN:din,Pannello_centralino:centralino,File_Blocco:"real-artwork"},undefined,undefined))
      .toEqual({symbol:"physical_panel",conflict:false});
  // Other intentional placeholders (SPACE, Calotte, MARINA, Flatwall) keep historical print policy.
  for (const din of [true,false]) expect(classifyPanelPresentation({Pannello_DIN:din,File_Blocco:"senza"},undefined,undefined))
    .toEqual({symbol:din?"din_panel":"panel",conflict:false});
  expect(classifyPanelPresentation({Pannello_DIN:false,File_Blocco:null},undefined,undefined).symbol).toBe("physical_panel");
});

it("rejects malformed, duplicate and evidence-free review metadata", () => {
  const root=mkdtempSync(path.join(tmpdir(),"librequadri-front-seed-"));
  try {
    for (const data of [{},[approvals[0],approvals[0]],[{...approvals[0],widthMm:0}],
      [{...approvals[0],evidence:""}],[{...approvals[0],packId:"2898"}]]) {
      writeFileSync(path.join(root,"tiquadri-front-presentation.json"),JSON.stringify(data));
      expect(()=>loadPanelPresentationApprovals(root)).toThrow("Invalid reviewed");
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
