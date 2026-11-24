import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { duplicateConfiguredItem } from "../src/main/project/configured-items.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { devicePool } from "../src/renderer/project/placement-workflow.js";
import type { ConfigurationRequest, ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource } from "../src/shared/project.js";

const cataloguePath = process.env["LIBREQUADRI_REV83_REAL_DB"] ?? "";
const migrationsFolder = path.resolve("db/migrations/project");
const metadata = (destinationPath:string) => ({destinationPath,title:"Configured test",description:"",
  notes:"",projectType:"civil" as const,executor:"",date:"2026-09-24",
  companyName:"Cliente",companyDescription:""});

it("saves and reopens configured placement through ProjectDocumentService without a catalogue",async () => {
  const root = mkdtempSync(path.join(tmpdir(),"lqp-configured-fixture-"));
  const filename = path.join(root,"fixture.lqp");
  const source = (code:string,price:number):CatalogueProductSnapshotSource => ({brandMarchio:"TEST",
    brandName:"Test",manufacturerCode:code,ean:null,shortDescription:code,description:`Article ${code}`,
    unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
    priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-24",
    listPriceUnitE4:price,priceMultiplierOriginal:1,attributes:[]});
  const products = new Map([[1,source("MAIN",10_000)],[2,source("ADDON",20_000)]]);
  const result:ConfigurationResult = {model:{id:1,code:"model",name:"Model",kind:"device",
    brandMarchio:"TEST",active:true,obsolete:false,commercialContribution:"articles",definitionFingerprint:"definition",sourceRef:null,
    baseProfileId:1,maxInsertQty:null,budgets:[],relations:[],axes:[{id:1,dimensionCode:"option",
      label:"Option",sortOrder:0,visibility:"visible",requirement:"required",binding:"none",
      editableWhenPlaced:true,selectsPrimary:true,options:[{id:10,axisId:1,valueId:1,valueCode:"chosen",
        label:"Chosen",parentOptionId:null,isDefault:false,visible:true,active:true,sortOrder:0}]}]},
    selectedOptionIds:[10],defaultedOptionIds:[],commercialContribution:"articles",matchingRuleIds:[],fingerprint:"fingerprint",
    status:"complete",issues:[],bom:[
      {brandMarchio:"TEST",manufacturerCode:"MAIN",productId:1,quantity:2,roles:["primary"],
        linkedBrandMarchio:"TEST",linkedManufacturerCode:"MAIN",priceListinoNumber:"1",priceValidFrom:"2026-09-24",priceMultiplierOriginal:1,
        description:"Article MAIN",unitPriceE4:10_000,rowTotalE4:20_000,currency:"EUR",priceIssuerSigla:"TEST"},
      {brandMarchio:"TEST",manufacturerCode:"ADDON",productId:2,quantity:1,roles:["accessory"],
        linkedBrandMarchio:"TEST",linkedManufacturerCode:"ADDON",priceListinoNumber:"1",priceValidFrom:"2026-09-24",priceMultiplierOriginal:1,
        description:"Article ADDON",unitPriceE4:20_000,rowTotalE4:20_000,currency:"EUR",priceIssuerSigla:"TEST"}],
    totalE4:40_000,pricedSubtotalE4:40_000,budgets:[],physical:{id:1,code:"profile",name:"Profile",
      kind:"device",profileKey:null,fitClass:{id:1,code:"fit",name:"Fit"},depthMm:40,
      outerDepthMm:null,usableDepthMm:null,demands:[{capacityKindCode:"din_rail",amount:6,
        unitLabel:"half modules",displayDivisor:2,nominalPitchMm:9}],views:[{code:"front",
        widthMm:54,heightMm:80,insertDxMm:0,insertDyMm:0,symbolKind:"rectangle",assetKey:null}],
      zones:[{zoneNo:0,layout:"slots",capacityKindCode:null,capacityAmount:2,originXMm:0,
        originYMm:0,lengthMm:null,breadthMm:null,direction:null,pitchMm:null,requiredViewCode:"front"}],
      slots:[{zoneNo:0,slotNo:0,xMm:0,yMm:0},{zoneNo:0,slotNo:1,xMm:90,yMm:0}],constraints:[{relation:"parent",
        acceptSetCode:"set",classCodes:["fit"]}]},exclusions:[{ownDimensionCode:"option",
      ownValueCode:"chosen",ancestorDimensionCode:"other",ancestorValueCode:"blocked"}]};
  const enclosureResult: ConfigurationResult = { ...result,
    model: { ...result.model, id:2, code:"enclosure-model", name:"Enclosure", kind:"enclosure",
      definitionFingerprint:"enclosure-definition" },
    physical: { ...result.physical!, code:"enclosure-profile", kind:"enclosure", constraints:[] },
  };
  let deviceResult = result;
  let corrupt = true;
  const writer = new ProjectDocumentService({workingDirectory:path.join(root,"working"),
    incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
    migrationsFolder,appVersion:"test",resolveConfiguration:request => request.modelId === 2 ? enclosureResult : deviceResult,
    resolveCatalogueProduct:id => {
      const product = products.get(id)!;
      return corrupt && id === 2 ? {...product,attributes:[
        {code:"duplicate",name:"Duplicate",dataType:"text",unit:null,value:"a",label:null},
        {code:"duplicate",name:"Duplicate",dataType:"text",unit:null,value:"b",label:null}]} : product;
    }});
  try {
    await writer.create(metadata(filename));
    expect(() => writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]})).toThrow();
    expect(writer.current()).toMatchObject({dirty:false,configuredItems:[],lines:[],distinta:[]});
    corrupt = false;
    expect(() => writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]},0)).toThrow("Quantità non valida");
    const view = writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]},3);
    expect(view.configuredItems).toHaveLength(1);
    expect(view.configuredItems[0]).toMatchObject({configFingerprint:"fingerprint",
      selections:[{valueCode:"chosen"}],demands:[{amount:6,displayDivisor:2}],
      zones:[{layout:"slots"}],slots:[{slotNo:0},{slotNo:1}],constraints:[{classCode:"fit"}],
      exclusions:[{ancestorValueCode:"blocked"}]});
    expect(view.lines).toMatchObject([{lineType:"item",quantity:3,lineTotalE4:120_000}]);
    expect(view.distinta.map(row => row.manufacturerCode)).toEqual(["ADDON","MAIN"]);
    expect(view.distinta.map(row => row.quantity)).toEqual([3,6]);
    expect(view.distinta.map(row => [row.listPriceUnitE4,row.listTotalE4]))
      .toEqual([[20_000,60_000],[10_000,60_000]]);
    const discounted=writer.setComponentDiscount(view.configuredItems[0]!.uuid,1,1250);
    expect(discounted.configuredItems[0]!.bom[1]!.lineDiscountBp).toBe(1250);
    writer.setGlobalDiscount(1000);
    writer.setLabourTotal(2_000_000);
    expect(writer.current()!.dirty).toBe(true);
    await writer.save();
    expect(writer.current()!.dirty).toBe(false);
    const commercialReader=new ProjectDocumentService({workingDirectory:path.join(root,"commercial-working"),
      incomingDirectory:path.join(root,"offline-incoming"),backupDirectory:path.join(root,"offline-backups"),
      migrationsFolder,appVersion:"test",resolveCatalogueProduct:()=>{throw new Error("catalogue unavailable")}});
    try {
      const opened=commercialReader.open(filename);
      expect(opened.configuredItems[0]!.bom[1]!.lineDiscountBp).toBe(1250);
      expect(opened).toMatchObject({globalDiscountBp:1000,labourTotalE4:2_000_000,dirty:false});
      const copy=await commercialReader.saveAs(path.join(root,"commercial-copy.lqp"));
      expect(copy.configuredItems[0]!.bom[1]!.lineDiscountBp).toBe(1250);
      expect(copy).toMatchObject({globalDiscountBp:1000,labourTotalE4:2_000_000,dirty:false});
    } finally {commercialReader.close();}
    writer.setComponentDiscount(view.configuredItems[0]!.uuid,1,0);
    writer.setGlobalDiscount(0);
    writer.setLabourTotal(0);
    const activePath = path.join(root,"working",readdirSync(path.join(root,"working"))
      .find(name=>name.endsWith(".lqp"))!);
    const raw = new Database(activePath);
    raw.prepare(`UPDATE prj_line SET description_override='Reviewed label',line_discount_bp=250,
      price_locked=1 WHERE uuid=?`).run(view.lines[0]!.uuid);
    const duplicated = writer.duplicateConfiguredItem(view.lines[0]!.uuid);
    const storedLine = raw.prepare(`SELECT uuid,group_id AS groupId,sort_order AS sortOrder,
      line_type AS lineType,snapshot_id AS snapshotId,item_id AS itemId,
      description_override AS descriptionOverride,quantity,purchase_discount_chain AS purchaseDiscountChain,
      purchase_discount_bp AS purchaseDiscountBp,net_cost_unit_e4 AS netCostUnitE4,
      markup_bp AS markupBp,sale_price_unit_e4 AS salePriceUnitE4,
      line_discount_bp AS lineDiscountBp,line_total_e4 AS lineTotalE4,price_locked AS priceLocked
      FROM prj_line WHERE uuid=?`);
    const sourceLine = storedLine.get(view.lines[0]!.uuid) as Record<string,unknown>;
    const copiedLine = storedLine.get(duplicated.lines[1]!.uuid) as Record<string,unknown>;
    expect(copiedLine).toEqual({
      uuid:duplicated.lines[1]!.uuid,groupId:sourceLine["groupId"],sortOrder:Number(sourceLine["sortOrder"])+1,
      lineType:"item",snapshotId:null,itemId:expect.any(Number),descriptionOverride:"Reviewed label",
      quantity:1,purchaseDiscountChain:null,purchaseDiscountBp:null,netCostUnitE4:null,markupBp:null,
      salePriceUnitE4:40_000,lineDiscountBp:250,lineTotalE4:40_000,priceLocked:1,
    });
    expect(copiedLine["uuid"]).not.toBe(sourceLine["uuid"]);
    expect(copiedLine["itemId"]).not.toBe(sourceLine["itemId"]);
    expect(sourceLine["quantity"]).toBe(3);
    expect(raw.prepare("SELECT COUNT(*) FROM prj_node").pluck().get()).toBe(0);
    raw.prepare(`UPDATE prj_line SET description_override=NULL,line_discount_bp=0,
      price_locked=0 WHERE uuid=?`).run(view.lines[0]!.uuid);
    raw.close();
    expect(duplicated.lines.map(line => line.quantity)).toEqual([3,1]);
    expect(duplicated.configuredItems).toHaveLength(2);
    expect(duplicated.configuredItems[1]!.uuid).not.toBe(duplicated.configuredItems[0]!.uuid);
    expect(duplicated.configuredItems[1]!.selections).toEqual(duplicated.configuredItems[0]!.selections);
    expect(duplicated.configuredItems[1]!.bom).toEqual(duplicated.configuredItems[0]!.bom);
    writer.setComponentDiscount(duplicated.configuredItems[1]!.uuid,1,1250);
    const reapplied = writer.replaceConfiguredItem(duplicated.lines[1]!.uuid,
      {modelId:1,selectedOptionIds:[10]});
    expect(reapplied.lines.map(line=>line.quantity)).toEqual([3,1]);
    expect(reapplied.configuredItems).toHaveLength(2);
    expect(reapplied.configuredItems[1]!.bom[1]!.lineDiscountBp).toBe(1250);
    const duplicateLineUuid = reapplied.lines[1]!.uuid;
    deviceResult = { ...result, fingerprint:"duplicate-edited", selectedOptionIds:[11],
      model:{...result.model,axes:[{...result.model.axes[0]!,options:[...result.model.axes[0]!.options,
        {...result.model.axes[0]!.options[0]!,id:11,valueCode:"other",label:"Other"}]}]} };
    const editedDuplicate = writer.replaceConfiguredItem(duplicateLineUuid,{modelId:1,selectedOptionIds:[11]});
    expect(editedDuplicate.configuredItems.find(item => item.uuid === view.configuredItems[0]!.uuid)?.selections)
      .toEqual(view.configuredItems[0]!.selections);
    expect(editedDuplicate.configuredItems.find(item => item.configFingerprint === "duplicate-edited")?.selections)
      .toMatchObject([{valueCode:"other"}]);
    const editedLineUuid = editedDuplicate.lines.find(line => line.itemUuid ===
      editedDuplicate.configuredItems.find(item => item.configFingerprint === "duplicate-edited")!.uuid)!.uuid;
    writer.setQuantity(view.lines[0]!.uuid,4);
    expect(writer.current()!.lines.find(line => line.uuid === editedLineUuid)?.quantity).toBe(1);
    writer.setQuantity(view.lines[0]!.uuid,3);
    writer.removeLine(editedLineUuid);
    deviceResult = result;
    const ordinary = writer.addCatalogueProduct(1, 2);
    const ordinaryLine = ordinary.lines.find(line => line.lineType === "product")!;
    deviceResult = { ...result, fingerprint: "converted-ordinary" };
    const converted = writer.replaceConfiguredItem(ordinaryLine.uuid,
      { modelId: 1, selectedOptionIds: [10], productId: 1 });
    expect(converted.lines.find(line => line.uuid === ordinaryLine.uuid)).toBeUndefined();
    expect(converted.lines.find(line => line.lineType === "item" && line.quantity === 2))
      .toMatchObject({ quantity: 2 });
    expect(converted.configuredItems).toHaveLength(2);
    const extra = writer.addCatalogueProduct(2, 1);
    const convertedLineUuid = converted.lines.find(line => line.lineType === "item" && line.quantity === 2)!.uuid;
    const extraLineUuid = extra.lines.find(line => line.lineType === "product")!.uuid;
    expect(writer.removeLines([convertedLineUuid,extraLineUuid]).lines).toHaveLength(1);
    deviceResult = result;
    await writer.save();
    const beforeRejectedMerge = readFileSync(filename);
    const workingPath = path.join(root,"working",readdirSync(path.join(root,"working"))
      .find(name => name.endsWith(".lqp"))!);
    const workingCounts = () => {
      const db = new Database(workingPath,{readonly:true});
      try {return ["prj_item","prj_line","prj_item_bom","prj_product_snapshot"]
        .map(table => db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());}
      finally {db.close();}
    };
    const countsBeforeRejectedMerge = workingCounts();
    const changedSnapshots: Array<[string,ConfigurationResult]> = [
      ["view dimensions",{...result,physical:{...result.physical!,views:[
        {...result.physical!.views[0]!,widthMm:55}]}}],
      ["demand capacity",{...result,physical:{...result.physical!,demands:[
        {...result.physical!.demands[0]!,amount:7}]}}],
      ["zone capacity",{...result,physical:{...result.physical!,zones:[
        {...result.physical!.zones[0]!,capacityAmount:3}]}}],
      ["slot position",{...result,physical:{...result.physical!,slots:[
        {...result.physical!.slots[0]!,xMm:1}]}}],
      ["placement constraint",{...result,physical:{...result.physical!,constraints:[
        {...result.physical!.constraints[0]!,classCodes:["different-fit"]}]}}],
      ["exclusion",{...result,exclusions:[
        {...result.exclusions[0]!,ancestorValueCode:"different"}]}],
      ["model definition",{...result,model:{...result.model,definitionFingerprint:"different-definition"}}],
      ["selection binding",{...result,model:{...result.model,axes:[
        {...result.model.axes[0]!,binding:"match_container"}]}}],
    ];
    for (const [name,changed] of changedSnapshots) {
      deviceResult = changed;
      expect(() => writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]}),name)
        .toThrow("I dati tecnici della configurazione sono diversi dalla versione già nel progetto");
      expect(writer.current()).toMatchObject({dirty:false,lines:[{quantity:3}],
        configuredItems:[{bom:[{},{}]}]});
      expect(workingCounts()).toEqual(countsBeforeRejectedMerge);
      expect(readFileSync(filename)).toEqual(beforeRejectedMerge);
    }
    deviceResult = {...result,bom:[...result.bom].reverse()};
    const merged = writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]},2);
    expect(merged.configuredItems).toHaveLength(1);
    expect(merged.lines).toMatchObject([{uuid:view.lines[0]!.uuid,quantity:5,lineTotalE4:200_000}]);
    expect(merged.configuredItems[0]!.bom).toEqual(view.configuredItems[0]!.bom);
    deviceResult = result;
    products.set(1,{...source("MAIN",10_000),priceListinoNumber:"2"});
    deviceResult = {...result,bom:[{...result.bom[0]!,priceListinoNumber:"2"},result.bom[1]!]};
    expect(() => writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]}))
      .toThrow("prezzo o listino diverso");
    expect(writer.current()!.lines[0]!.quantity).toBe(5);
    products.set(1,source("MAIN",10_000));
    deviceResult = result;
    const increased = writer.setQuantity(view.lines[0]!.uuid,6);
    expect(increased.lines[0]).toMatchObject({quantity:6,lineTotalE4:240_000});
    expect(writer.setQuantity(view.lines[0]!.uuid,4).lines[0]).toMatchObject({quantity:4,lineTotalE4:160_000});
    expect(() => writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]},9_996)).toThrow("9.999");
    expect(writer.current()!.lines[0]!.quantity).toBe(4);
    const withEnclosure = writer.addConfiguredItem({modelId:2,selectedOptionIds:[10]},2);
    expect(withEnclosure.configuredItems).toHaveLength(2);
    const enclosureUuid = withEnclosure.configuredItems.find(item => item.modelKind === "enclosure")!.uuid;
    const rootNode = writer.placeRoot({itemUuid:enclosureUuid,rootXMm:120,rootYMm:80,viewCode:"front"});
    expect(rootNode.physicalNodes[0]).toMatchObject({xMm:120,yMm:80});
    const secondRoot = writer.placeRoot({itemUuid:enclosureUuid,rootXMm:700,rootYMm:80,viewCode:"front"});
    expect(secondRoot.physicalNodes).toHaveLength(2);
    expect(writer.checkPlacement({itemUuid:enclosureUuid,rootXMm:1200,rootYMm:80,viewCode:"front"}))
      .toMatchObject({ok:false,code:"quantity_exhausted"});
    expect(() => writer.setQuantity(withEnclosure.lines[1]!.uuid,1)).toThrow("2 unità posizionate");
    expect(() => writer.removeLine(withEnclosure.lines[1]!.uuid)).toThrow("posizionato");
    expect(writer.setQuantity(withEnclosure.lines[1]!.uuid,3).lines[1]!.quantity).toBe(3);
    expect(writer.checkPlacement({itemUuid:enclosureUuid,rootXMm:1200,rootYMm:80,viewCode:"front"}))
      .toEqual({ok:true});
    expect(writer.setQuantity(withEnclosure.lines[1]!.uuid,2).lines[1]!.quantity).toBe(2);
    const placed = writer.placeChild({itemUuid:view.configuredItems[0]!.uuid,
      parentUuid:rootNode.physicalNodes[0]!.uuid,zoneNo:0,slotNo:0,viewCode:"front"});
    expect(() => writer.replaceConfiguredItem(view.lines[0]!.uuid,
      {modelId:1,selectedOptionIds:[10]})).toThrow("posizionato");
    const beforeRejectedBatch = writer.current();
    expect(() => writer.removeLines([withEnclosure.lines[1]!.uuid,view.lines[0]!.uuid])).toThrow("posizionato");
    expect(writer.current()).toEqual(beforeRejectedBatch);
    expect(placed.physicalNodes[0]?.children[0]).toMatchObject({xMm:120,yMm:80,slotNo:0});
    const packedInput={itemUuid:view.configuredItems[0]!.uuid,
      parentUuid:rootNode.physicalNodes[0]!.uuid,zoneNo:0,viewCode:"front"};
    expect(writer.checkPackedChild(packedInput)).toEqual({ok:true});
    const inserted=writer.insertPackedChild(packedInput,0);
    expect(inserted.physicalNodes[0]!.children.map(node=>node.slotNo)).toEqual([0,1]);
    const insertedUuid=inserted.physicalNodes[0]!.children[0]!.uuid;
    const reordered=writer.reorderPackedNode(placed.physicalNodes[0]!.children[0]!.uuid,0);
    expect(reordered.physicalNodes[0]!.children.map(node=>node.uuid))
      .toEqual([placed.physicalNodes[0]!.children[0]!.uuid,insertedUuid]);
    expect(writer.placementTargets({nodeUuid:insertedUuid,parentUuid:rootNode.physicalNodes[0]!.uuid})
      .targets.some(target=>target.action==="moveNode")).toBe(true);
    const moved=writer.movePackedNode(insertedUuid,{parentUuid:rootNode.physicalNodes[0]!.uuid,
      zoneNo:0,viewCode:"front",index:0});
    expect(moved.physicalNodes[0]!.children.map(node=>node.uuid))
      .toEqual([insertedUuid,placed.physicalNodes[0]!.children[0]!.uuid]);
    writer.reorderPackedNode(placed.physicalNodes[0]!.children[0]!.uuid,0);
    const repacked=writer.removePackedNode(placed.physicalNodes[0]!.children[0]!.uuid);
    expect(repacked.physicalNodes[0]!.children).toMatchObject([{uuid:insertedUuid,slotNo:0,xMm:120}]);
    const gapped=writer.moveNode(insertedUuid,{itemUuid:packedInput.itemUuid,
      parentUuid:packedInput.parentUuid,zoneNo:0,slotNo:1,viewCode:"front"});
    expect(gapped.physicalNodes[0]!.children).toMatchObject([{uuid:insertedUuid,slotNo:1}]);
    expect(devicePool(repacked).find(entry=>entry.item.uuid===packedInput.itemUuid))
      .toMatchObject({quantity:4,placed:1,available:3});
    deviceResult = {...result,fingerprint:"different-fingerprint"};
    const distinct = writer.addConfiguredItem({modelId:1,selectedOptionIds:[10]});
    expect(distinct.configuredItems).toHaveLength(3);
    expect(distinct.lines.map(line => line.quantity)).toEqual([4,2,1]);
    const oldLineUuid = distinct.lines[2]!.uuid;
    deviceResult = {...result,fingerprint:"replacement-fingerprint"};
    const replaced = writer.replaceConfiguredItem(oldLineUuid,{modelId:1,selectedOptionIds:[10]});
    expect(replaced.lines).toHaveLength(3);
    expect(replaced.lines.find(line => line.uuid === oldLineUuid)).toBeUndefined();
    expect(replaced.lines.at(-1)).toMatchObject({quantity:1,lineTotalE4:40_000});
    const rejectedBefore = writer.current();
    deviceResult = {...result,status:"incomplete"};
    expect(() => writer.replaceConfiguredItem(replaced.lines.at(-1)!.uuid,
      {modelId:1,selectedOptionIds:[10]})).toThrow("Solo una configurazione completa");
    expect(writer.current()).toEqual(rejectedBefore);
    const finalView = writer.current()!;
    await writer.save(); writer.close();
    for (const table of ["prj_item","prj_line"] as const) {
      const evolvedPath = path.join(root,`${table}-evolved.lqp`);
      copyFileSync(filename,evolvedPath);
      const evolved = new Database(evolvedPath);
      try {
        evolved.exec(`ALTER TABLE ${table} ADD COLUMN unreviewed_duplicate_field TEXT`);
        const before = ["prj_item","prj_line"].map(name =>
          evolved.prepare(`SELECT COUNT(*) FROM ${name}`).pluck().get());
        expect(() => evolved.transaction(() => duplicateConfiguredItem(evolved,
          finalView.lines.at(-1)!.uuid))()).toThrow(`Il formato di ${table} richiede una revisione`);
        expect(["prj_item","prj_line"].map(name =>
          evolved.prepare(`SELECT COUNT(*) FROM ${name}`).pluck().get())).toEqual(before);
      } finally {evolved.close();}
    }
    const saved = new Database(filename,{readonly:true});
    try {
      expect(saved.prepare("SELECT COUNT(*) FROM prj_item").pluck().get()).toBe(3);
      expect(saved.prepare("SELECT COUNT(*) FROM prj_line WHERE line_type='item'").pluck().get()).toBe(3);
      expect(saved.prepare("SELECT COUNT(*) FROM prj_item_bom").pluck().get()).toBe(6);
      expect(saved.prepare("SELECT COUNT(*) FROM prj_product_snapshot").pluck().get()).toBe(2);
    } finally {saved.close();}
    const offline = new ProjectDocumentService({workingDirectory:path.join(root,"offline-working"),
      incomingDirectory:path.join(root,"offline-incoming"),backupDirectory:path.join(root,"backups"),
      migrationsFolder,appVersion:"test",resolveCatalogueProduct:() => {throw new Error("no catalogue");}});
    const reopened = offline.open(filename);
    expect(reopened.configuredItems).toEqual(finalView.configuredItems);
    expect(reopened.physicalNodes).toEqual(finalView.physicalNodes);
    expect(reopened.distinta).toEqual(finalView.distinta);
    expect(reopened.lines.map(line => line.quantity)).toEqual([4,2,1]);
    expect(devicePool(reopened).find(entry=>entry.item.uuid===packedInput.itemUuid))
      .toMatchObject({quantity:4,placed:1,available:3});
    expect(offline.checkPackedChild(packedInput)).toEqual({ok:true});
    const offlineTargets=offline.placementTargets({nodeUuid:insertedUuid,
      parentUuid:rootNode.physicalNodes[0]!.uuid}).targets;
    const freeSlot=offlineTargets.find(target=>target.action==="moveNode"&&target.input.slotNo===0);
    expect(freeSlot).toBeDefined();
    if(freeSlot?.action!=="moveNode")throw new Error("Expected an offline slot move");
    expect(offline.moveNode(insertedUuid,freeSlot.input).physicalNodes[0]!.children)
      .toMatchObject([{uuid:insertedUuid,slotNo:0}]);
    expect(reopened.configuredItems[0]!.bom[0]!.quantityPerItem).toBe(2);
    expect(offline.setQuantity(reopened.lines[0]!.uuid,3).lines[0]).toMatchObject({quantity:3,lineTotalE4:120_000});
    const offlineDuplicate = offline.duplicateConfiguredItem(reopened.lines.at(-1)!.uuid);
    expect(offlineDuplicate.configuredItems).toHaveLength(4);
    expect(offlineDuplicate.lines.at(-1)).toMatchObject({lineType:"item",quantity:1});
    expect(offlineDuplicate.configuredItems.at(-1)!.bom).toEqual(reopened.configuredItems.at(-1)!.bom);
    offline.close();
  } finally {rmSync(root,{recursive:true,force:true});}
},20_000); // Multiple asynchronous backups can exceed the default 5 s under full-suite contention.

describe.runIf(existsSync(cataloguePath))("configured item in a portable project, real development catalogue",() => {
  it("snapshots the BTDIN60 accessory configuration, saves, reopens offline, and removes it cleanly",async () => {
    const root = mkdtempSync(path.join(tmpdir(),"lqp-configured-real-"));
    const localCatalogue = path.join(root,"lq.db"); copyFileSync(cataloguePath,localCatalogue);
    const catalogue = new Database(localCatalogue,{readonly:true});
    const filename = path.join(root,"configured.lqp");
    const makeService = (withCatalogue:boolean) => new ProjectDocumentService({
      workingDirectory:path.join(root,`working-${withCatalogue ? "catalogue" : "empty"}`),
      incomingDirectory:path.join(root,`incoming-${withCatalogue ? "catalogue" : "empty"}`),
      backupDirectory:path.join(root,"backups"),migrationsFolder,appVersion:"test",
      resolveCatalogueProduct:withCatalogue ? id => getCatalogueProductSnapshot(catalogue,id)
        : () => {throw new Error("empty local catalogue");},
      resolveConfiguration:withCatalogue ? request => resolveConfiguration(catalogue,request)
        : () => {throw new Error("empty local catalogue");},
    });
    try {
      const modelId = catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.4395'").pluck().get() as number;
      const productId = catalogue.prepare(`SELECT p.id FROM cat_product p JOIN cat_config_model_entry e
        ON e.product_id=p.id WHERE e.model_id=? AND p.manufacturer_code='FN82C16'`).pluck().get(modelId) as number;
      const ruleId = catalogue.prepare(`SELECT r.id FROM cat_config_rule r JOIN cat_config_rule_effect e
        ON e.rule_id=r.id WHERE r.model_id=? AND e.ref_manufacturer_code='F80RC' LIMIT 1`).pluck().get(modelId) as number;
      const selectedOptionIds = catalogue.prepare("SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?")
        .pluck().all(ruleId) as number[];
      const request:ConfigurationRequest = {modelId,productId,selectedOptionIds};
      const resolved = resolveConfiguration(catalogue,request);
      expect(resolved.status).toBe("complete");
      const writer = makeService(true);
      await writer.create(metadata(filename));
      const added = writer.addConfiguredItem(request);
      expect(added.dirty).toBe(true);
      expect(added.configuredItems).toHaveLength(1);
      expect(added.lines).toHaveLength(1);
      expect(added.lines[0]).toMatchObject({lineType:"item",quantity:1,
        itemUuid:added.configuredItems[0]!.uuid,lineTotalE4:resolved.totalE4});
      const item = added.configuredItems[0]!;
      expect(item.configFingerprint).toBe(resolved.fingerprint);
      expect(item.modelCode).toBe(resolved.model.code);
      expect(item.selections.map(selection => selection.valueCode)).toEqual(expect.arrayContaining(
        resolved.model.axes.flatMap(axis => axis.options.filter(option => resolved.selectedOptionIds.includes(option.id))
          .map(option => option.valueCode))));
      expect(item.bom.map(row => row.manufacturerCode)).toEqual(["FN82C16","F80RC"]);
      expect(item.bom.map(row => row.salePriceUnitE4)).toEqual(resolved.bom.map(row => row.unitPriceE4));
      expect(item.demands.find(row => row.capacityKindCode === "din_rail")?.amount).toBe(6);
      expect(item.profileCode).toBe(resolved.physical?.code);
      expect(item.views).toHaveLength(resolved.physical!.views.length);
      expect(item.constraints).toHaveLength(resolved.physical!.constraints.reduce((n,c) => n+c.classCodes.length,0));
      expect(added.distinta.map(row => row.manufacturerCode)).toEqual(["F80RC","FN82C16"]);
      expect(added.distinta.map(row => row.quantity)).toEqual([1,1]);
      await writer.save(); writer.close();
      const saved = new Database(filename,{readonly:true});
      try {
        expect(saved.prepare("SELECT COUNT(*) FROM prj_item").pluck().get()).toBe(1);
        expect(saved.prepare("SELECT COUNT(*) FROM prj_node").pluck().get()).toBe(0);
        expect(saved.pragma("foreign_key_check")).toEqual([]);
      } finally {saved.close();}
      const normal = makeService(true);
      expect(normal.open(filename).configuredItems).toEqual([item]); normal.close();
      const offline = makeService(false);
      const reopened = offline.open(filename);
      expect(reopened.configuredItems).toEqual([item]);
      expect(reopened.distinta).toEqual(added.distinta);
      expect(reopened.lines).toEqual(added.lines);
      expect(offline.setQuantity(reopened.lines[0]!.uuid,2).lines[0]).toMatchObject({
        quantity:2,lineTotalE4:resolved.totalE4! * 2});
      const removed = offline.removeLine(reopened.lines[0]!.uuid);
      expect(removed.configuredItems).toEqual([]);
      expect(removed.lines).toEqual([]);
      expect(removed.distinta).toEqual([]);
      expect(removed.dirty).toBe(true);
      offline.discardCurrent();
    } finally {catalogue.close();rmSync(root,{recursive:true,force:true});}
  });

  it("rejects incomplete resolution without changing the saved document",async () => {
    const root = mkdtempSync(path.join(tmpdir(),"lqp-configured-reject-"));
    const localCatalogue = path.join(root,"lq.db"); copyFileSync(cataloguePath,localCatalogue);
    const catalogue = new Database(localCatalogue,{readonly:true});
    const filename = path.join(root,"reject.lqp");
    const service = new ProjectDocumentService({workingDirectory:path.join(root,"working"),
      incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
      migrationsFolder,appVersion:"test",resolveCatalogueProduct:id => getCatalogueProductSnapshot(catalogue,id),
      resolveConfiguration:request => resolveConfiguration(catalogue,request)});
    try {
      await service.create(metadata(filename));
      const modelId = catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.4395'").pluck().get() as number;
      expect(() => service.addConfiguredItem({modelId,selectedOptionIds:[-1]})).toThrow();
      expect(service.current()).toMatchObject({dirty:false,lines:[],configuredItems:[],distinta:[]});
      service.close();
      const before = readFileSync(filename);
      const failing = new ProjectDocumentService({workingDirectory:path.join(root,"failing-working"),
        incomingDirectory:path.join(root,"failing-incoming"),backupDirectory:path.join(root,"backups"),
        migrationsFolder,appVersion:"test",resolveConfiguration:request => resolveConfiguration(catalogue,request),
        resolveCatalogueProduct:id => {
          const source = getCatalogueProductSnapshot(catalogue,id);
          return source.manufacturerCode === "F80RC" ? {...source,attributes:[
            {code:"duplicate",name:"Duplicate",dataType:"text" as const,unit:null,value:"a",label:null},
            {code:"duplicate",name:"Duplicate",dataType:"text" as const,unit:null,value:"b",label:null},
          ]} : source;
        }});
      failing.open(filename);
      const productId = catalogue.prepare(`SELECT p.id FROM cat_product p JOIN cat_config_model_entry e
        ON e.product_id=p.id WHERE e.model_id=? AND p.manufacturer_code='FN82C16'`).pluck().get(modelId) as number;
      const ruleId = catalogue.prepare(`SELECT r.id FROM cat_config_rule r JOIN cat_config_rule_effect e
        ON e.rule_id=r.id WHERE r.model_id=? AND e.ref_manufacturer_code='F80RC' LIMIT 1`).pluck().get(modelId) as number;
      const selectedOptionIds = catalogue.prepare("SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?")
        .pluck().all(ruleId) as number[];
      expect(() => failing.addConfiguredItem({modelId,productId,selectedOptionIds})).toThrow();
      expect(failing.current()).toMatchObject({dirty:false,lines:[],configuredItems:[],distinta:[]});
      expect(readFileSync(filename)).toEqual(before);
      failing.close();
    } finally {catalogue.close();rmSync(root,{recursive:true,force:true});}
  });

  it("persists a different enclosure model with its container zones",async () => {
    const root = mkdtempSync(path.join(tmpdir(),"lqp-configured-enclosure-"));
    const localCatalogue = path.join(root,"lq.db"); copyFileSync(cataloguePath,localCatalogue);
    const catalogue = new Database(localCatalogue,{readonly:true});
    const filename = path.join(root,"enclosure.lqp");
    const service = new ProjectDocumentService({workingDirectory:path.join(root,"working"),
      incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
      migrationsFolder,appVersion:"test",resolveCatalogueProduct:id => getCatalogueProductSnapshot(catalogue,id),
      resolveConfiguration:request => resolveConfiguration(catalogue,request)});
    try {
      const modelId = catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.343'").pluck().get() as number;
      const resolved = resolveConfiguration(catalogue,{modelId,selectedOptionIds:[]});
      expect(resolved.status).toBe("complete");
      await service.create(metadata(filename));
      const added = service.addConfiguredItem({modelId,selectedOptionIds:[]});
      expect(added.configuredItems[0]?.modelKind).toBe("enclosure");
      expect(added.configuredItems[0]?.bom.length).toBe(resolved.bom.length);
      expect(added.configuredItems[0]?.zones).toHaveLength(resolved.physical!.zones.length);
      expect(added.configuredItems[0]?.slots).toHaveLength(resolved.physical!.slots.length);
      const ordinaryProductId = resolved.bom[0]!.productId!;
      const mixed = service.addCatalogueProduct(ordinaryProductId);
      expect(mixed.lines.map(line => line.lineType)).toEqual(["item","product"]);
      expect(mixed.distinta.find(row => row.manufacturerCode === resolved.bom[0]!.manufacturerCode)?.quantity)
        .toBe(resolved.bom[0]!.quantity + 1);
      await service.save(); service.close();
      const saved = new Database(filename,{readonly:true});
      try {expect(saved.prepare("SELECT COUNT(*) FROM prj_node").pluck().get()).toBe(0);}
      finally {saved.close();}
    } finally {catalogue.close();rmSync(root,{recursive:true,force:true});}
  });
});
