import { afterEach, expect, it } from "vitest";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";

let fixture: CapacityFillFixture | undefined;
afterEach(() => { fixture?.close(); fixture = undefined; });
const configuration = (modelId: number) => ({ modelId, selectedOptionIds: [] });

it("duplicates only the panel into the next lower space and undoes the quotation and placement together", async () => {
  fixture = await capacityFillFixture();
  const { db, service } = fixture;
  db.exec(`
    UPDATE cat_phys_zone SET length_mm=300, capacity_amount=300 WHERE profile_id=1;
    UPDATE cat_config_model SET commercial_contribution='articles' WHERE id=2;
    INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
      SELECT 2,0,id,'GEN','PART',1,'primary' FROM cat_product WHERE manufacturer_code='PART';
  `);
  const root = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[0]!;
  const panel = fixture.add(2);
  const original = service.placeStructuralItem({ action: "placeChild",
    input: { itemUuid: panel, parentUuid: root.uuid, zoneNo: 0, startUnits: 100, viewCode: "front" } }).physicalNodes[0]!.children[0]!;
  const device = fixture.add(3);
  service.placeChild({ itemUuid: device, parentUuid: original.uuid, zoneNo: 0, startUnits: 0, viewCode: "front" });
  const before = fixture.dump();
  expect(service.canDuplicatePlacedItem(root.uuid)).toBe(false);
  expect(service.canDuplicatePlacedItem(original.uuid)).toBe(true);
  expect(fixture.dump()).toEqual(before);

  const duplicated = service.duplicatePlacedItem(original.uuid);
  const copy = duplicated.physicalNodes[0]!.children.find(node => node.uuid !== original.uuid)!;
  expect(copy).toMatchObject({ nodeKind: "support", startUnits: 200, children: [] });
  expect(copy.itemUuid).toBe(panel);
  expect(duplicated.physicalNodes[0]!.children.find(node => node.uuid === original.uuid)?.children).toHaveLength(1);
  expect(duplicated.lines.filter(line => line.itemUuid === panel).map(line => line.quantity)).toEqual([2]);
  expect(duplicated.configuredItems.filter(item => item.modelKind === "support")).toHaveLength(1);
  expect(duplicated.distinta.find(row => row.manufacturerCode === "PART")?.quantity).toBe(3);
  expect(duplicated.history?.undoLabel).toBe("Duplica");
  const after = fixture.dump();
  expect(service.canDuplicatePlacedItem(original.uuid)).toBe(false);
  expect(service.canDuplicatePlacedItem(copy.uuid)).toBe(false);
  expect(() => service.duplicatePlacedItem(original.uuid)).toThrow(/Nessuna posizione compatibile/);
  expect(fixture.dump()).toEqual(after);
  service.undo();
  expect(fixture.dump()).toEqual(before);
  service.redo();
  expect(fixture.dump()).toEqual(after);
});

it("fills the next slot in the current panel, skips incompatible panels below and stops at the carpenteria", async () => {
  fixture = await capacityFillFixture();
  const { db, service } = fixture;
  db.exec("UPDATE cat_phys_zone SET capacity_amount=18 WHERE profile_id=2");
  const left = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[0]!;
  const right = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[1]!;
  const rail = fixture.add(2, 4);
  const blind = fixture.add(4);
  const placePanel = (itemUuid: string, parentUuid: string, startUnits: number) => {
    const view = service.placeStructuralItem({ action: "placeChild",
      input: { itemUuid, parentUuid, zoneNo: 0, startUnits, viewCode: "front" } });
    return view.physicalNodes.find(root => root.uuid === parentUuid)!.children.find(node => node.startUnits === startUnits)!;
  };
  const above = placePanel(rail, left.uuid, 0);
  const current = placePanel(rail, left.uuid, 100);
  const incompatible = placePanel(blind, left.uuid, 200);
  const below = placePanel(rail, left.uuid, 300);
  const other = placePanel(rail, right.uuid, 0);
  const itemUuid = fixture.add(3);
  const placed = service.placeChild({ itemUuid, parentUuid: current.uuid, zoneNo: 0, startUnits: 6, viewCode: "front" });
  const source = placed.physicalNodes[0]!.children.find(node => node.uuid === current.uuid)!.children[0]!;
  const sourceItem = placed.configuredItems.find(item => item.uuid === itemUuid)!;

  const first = service.duplicatePlacedItem(source.uuid);
  const currentChildren = first.physicalNodes[0]!.children.find(node => node.uuid === current.uuid)!.children;
  expect(currentChildren.map(node => node.startUnits)).toEqual([6, 12]);
  expect(currentChildren[1]!.itemUuid).toBe(itemUuid);
  expect(first.configuredItems.find(item => item.uuid === itemUuid)).toEqual(sourceItem);
  expect(first.distinta.find(row => row.manufacturerCode === "PART")?.quantity).toBe(2);
  const second = service.duplicatePlacedItem(source.uuid);
  expect(second.physicalNodes[0]!.children.find(node => node.uuid === below.uuid)?.children[0]?.startUnits).toBe(0);
  service.duplicatePlacedItem(source.uuid);
  const full = service.duplicatePlacedItem(source.uuid);
  expect(full.physicalNodes[0]!.children.find(node => node.uuid === below.uuid)?.children.map(node => node.startUnits)).toEqual([0, 6, 12]);
  for (const panel of [above, incompatible, other]) {
    expect(full.physicalNodes.flatMap(root => root.children).find(node => node.uuid === panel.uuid)?.children).toEqual([]);
  }
  expect(full.distinta.find(row => row.manufacturerCode === "PART")?.quantity).toBe(5);
  expect(full.lines.filter(line => line.itemUuid === itemUuid).map(line => line.quantity)).toEqual([5]);
  expect(full.configuredItems.filter(item => item.modelKind === "device")).toHaveLength(1);
  expect(service.canDuplicatePlacedItem(source.uuid)).toBe(false);
});
