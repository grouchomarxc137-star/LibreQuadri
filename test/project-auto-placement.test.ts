import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { assessProjectPhysical } from "../src/main/project/physical-placement.js";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";

let fixture: CapacityFillFixture | undefined;
afterEach(() => { fixture?.close(); fixture = undefined; });
const configuration = (modelId: number) => ({ modelId, selectedOptionIds: [] });

it("stacks panels, fills the first panel in position order and undoes adding and placing together", async () => {
  fixture = await capacityFillFixture();
  const { service } = fixture;
  const frame = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[0]!;
  const emptyFrame = fixture.dump();
  const unplaced = service.addConfiguredItem(configuration(3), 1, true, true);
  expect(unplaced.autoPlacement).toBe("unplaced");
  expect(unplaced.physicalNodes[0]?.children).toEqual([]);
  expect(unplaced.configuredItems.some(item => item.modelKind === "device")).toBe(true);
  expect(unplaced.undoToken).toBeDefined();
  service.undo(unplaced.undoToken);
  expect(fixture.dump()).toEqual(emptyFrame);

  const panelRequest = { kind: "support", parentUuid: frame.uuid, place: false, autoPlace: true,
    configuration: configuration(2) } as const;
  const firstPanel = service.addStructural(panelRequest);
  expect(firstPanel.autoPlacement).toBe("placed");
  const beforeSecondPanel = fixture.dump();
  const secondPanel = service.addStructural(panelRequest);
  const [top, bottom] = secondPanel.physicalNodes[0]!.children;
  expect([top?.startUnits, bottom?.startUnits]).toEqual([0, 100]);
  service.undo(secondPanel.undoToken);
  expect(fixture.dump()).toEqual(beforeSecondPanel);
  service.redo();

  for (let index = 0; index < 4; index++)
    expect(service.addConfiguredItem(configuration(3), 1, true, true).autoPlacement).toBe("placed");
  const beforeSpill = fixture.dump();
  const spill = service.addConfiguredItem(configuration(3), 1, true, true);
  const [full, next] = spill.physicalNodes[0]!.children;
  expect(full?.children.map(node => node.startUnits)).toEqual([0, 6, 12, 18]);
  expect(next?.children.map(node => node.startUnits)).toEqual([0]);
  expect(spill.lines.find(line => line.itemUuid === next?.children[0]?.itemUuid)?.quantity).toBe(5);
  service.undo(spill.undoToken);
  expect(fixture.dump()).toEqual(beforeSpill);

  const pooled = service.addConfiguredItem(configuration(3));
  const device = pooled.configuredItems.find(item => item.modelKind === "device")!;
  const placed = service.autoPlaceItem({ itemUuid: device.uuid });
  const placedOnSecond = placed.physicalNodes[0]!.children[1]!.children[0]!;
  expect(placedOnSecond.startUnits).toBe(0);
  const alreadyFirst = service.autoPlaceItem({ nodeUuid: placed.physicalNodes[0]!.children[0]!.children[0]!.uuid });
  expect(alreadyFirst.autoPlacement).toBe("unchanged");
  expect(alreadyFirst.undoToken).toBe(placed.undoToken);
  service.unplaceNode(placed.physicalNodes[0]!.children[0]!.children[1]!.uuid);
  const moved = service.autoPlaceItem({ nodeUuid: placedOnSecond.uuid });
  expect(moved.autoPlacement).toBe("placed");
  expect(moved.physicalNodes[0]?.children[0]?.children.find(node => node.uuid === placedOnSecond.uuid)?.startUnits).toBe(6);
});

it("requires positive immediate-parent compatibility for direct enclosure mounting", async () => {
  fixture = await capacityFillFixture();
  const { service, db } = fixture;
  db.exec(`
    UPDATE cat_phys_zone SET layout = 'slots', capacity_amount = 2, pitch_mm = NULL WHERE profile_id = 1;
    INSERT INTO cat_phys_zone_slot(profile_id,zone_no,slot_no,x_mm,y_mm) VALUES (1,0,1,30,20),(1,0,2,90,20);
    UPDATE cat_phys_constraint SET relation = 'ancestor', accept_set_id = 1 WHERE profile_id = 3;
  `);
  const frame = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[0]!;
  const ancestorOnly = service.addConfiguredItem(configuration(3), 1, true, true);
  expect(ancestorOnly.autoPlacement).toBe("unplaced");
  expect(ancestorOnly.physicalNodes[0]?.children).toEqual([]);
  service.undo(ancestorOnly.undoToken);

  db.exec("UPDATE cat_phys_constraint SET relation = 'parent' WHERE profile_id = 3");
  const direct = service.addConfiguredItem(configuration(3), 1, true, true);
  expect(direct.autoPlacement).toBe("placed");
  expect(direct.physicalNodes[0]?.children[0]).toMatchObject({ nodeKind: "device", parentUuid: frame.uuid, slotNo: 1 });
  const project = new Database(fixture.workingFile(), { readonly: true, fileMustExist: true });
  try {
    expect(assessProjectPhysical(project)).toEqual([]);
  } finally {
    project.close();
  }
});

it("fills a free panel slot ahead of an existing panel without repacking it", async () => {
  fixture = await capacityFillFixture();
  const { service, db } = fixture;
  db.exec(`
    UPDATE cat_phys_zone SET layout = 'slots', capacity_amount = 2, pitch_mm = NULL WHERE profile_id = 1;
    INSERT INTO cat_phys_zone_slot(profile_id,zone_no,slot_no,x_mm,y_mm) VALUES (1,0,1,0,0),(1,0,2,0,120);
  `);
  const frame = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[0]!;
  const panel = fixture.add(2);
  const initial = service.placeStructuralItem({ action: "placeChild",
    input: { itemUuid: panel, parentUuid: frame.uuid, zoneNo: 0, slotNo: 2, viewCode: "front" } });
  const previous = initial.physicalNodes[0]!.children[0]!;
  const placed = service.addStructural({ kind: "support", parentUuid: frame.uuid, place: false, autoPlace: true,
    configuration: configuration(2) });
  expect(placed.autoPlacement).toBe("placed");
  expect(placed.physicalNodes[0]?.children.find(node => node.uuid === previous.uuid)).toEqual(previous);
  const top = placed.physicalNodes[0]!.children.find(node => node.uuid !== previous.uuid)!;
  expect(top.slotNo).toBe(1);
  const device = service.addConfiguredItem(configuration(3), 1, true, true);
  expect(device.physicalNodes[0]?.children.find(node => node.uuid === top.uuid)?.children[0]?.startUnits).toBe(0);
  expect(device.physicalNodes[0]?.children.find(node => node.uuid === previous.uuid)?.children).toEqual([]);

  const right = service.addStructural({ kind: "enclosure", configuration: configuration(1) }).physicalNodes[1]!;
  const overflow = service.addStructural({ kind: "support", parentUuid: frame.uuid, place: false, autoPlace: true,
    configuration: configuration(2) });
  expect(overflow.physicalNodes.find(node => node.uuid === right.uuid)?.children[0]?.slotNo).toBe(1);
});
