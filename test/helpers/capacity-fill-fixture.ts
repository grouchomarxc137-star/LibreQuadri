import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createCatalogueFixture } from "./catalogue-fixtures.js";
import { EngineeringDataWriter } from "../../src/main/sources/engineering-writer.js";
import { ENGINEERING_ADAPTERS } from "../../src/main/sources/engineering-adapters.js";
import { ProjectDocumentService, type ProjectDocumentServiceOptions } from "../../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../../src/main/catalogue/configuration-resolver.js";
import { resolveFrontOptionLabels } from "../../src/main/catalogue/front-option-labels.js";
import { getCatalogueProductSnapshot } from "../../src/main/catalogue/catalogue-queries.js";
import { capacityFillerConfigurations } from "../../src/main/catalogue/capacity-fillers.js";
import { guardConfiguredStructuralItem, guardDesignCandidate } from "../../src/main/project/design-compatibility.js";
import { documentTables } from "../../src/main/project/document-history.js";

const adapter = ENGINEERING_ADAPTERS[0]!;

/**
 * A generic (non-BTicino) engineering catalogue for capacity-fill and undo tests:
 *  - "frame" enclosure providing context C1, "bare-frame" enclosure providing nothing;
 *  - "rail-panel" support with one 24-unit din_rail zone; "blind-panel" support (12 units) whose class
 *    no device accepts;
 *  - "device" (demand 6, article PART) and a designated filler model "blank" whose one axis offers
 *    widths 1–5 (article BLANK ×1 per piece whatever the width), restricted to context C1.
 */
export async function capacityFillFixture(options: { fillerWidths?: readonly number[]; designate?: boolean } = {}) {
  const widths = options.fillerWidths ?? [1, 2, 3, 4, 5];
  const f = createCatalogueFixture(), db = f.lq;
  const writer = new EngineeringDataWriter(db);
  db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'GEN','Generic','manual');
    INSERT INTO cat_capacity_kind(code,name,unit_label,display_divisor,nominal_pitch_mm,source)
      VALUES('din_rail','Guida DIN','moduli',2,9,'manual');
    INSERT INTO cat_phys_class(id,code,name,source) VALUES(1,'frame','Frame','manual'),(2,'rail','Rail panel','manual'),
      (3,'dev','Device','manual'),(4,'blind','Blind panel','manual'),(5,'blank','Blank','manual');
    INSERT INTO cat_phys_accept_set(id,code,source) VALUES(1,'frames','manual'),(2,'rails','manual');
    INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(1,1),(2,2);
    INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES(1,'set','Set','manual');
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source) VALUES
      (1,'frame',1,1,'enclosure','Frame',1,'manual'),(2,'rail-panel',1,2,'support','Rail panel',2,'manual'),
      (3,'device',1,3,'device','Device',3,'manual'),(4,'blind-panel',1,4,'support','Blind panel',4,'manual');
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind) VALUES
      (1,'front',500,1000,0,0,'rectangle'),(2,'front',450,100,0,0,'rectangle'),(3,'front',54,45,0,0,'rectangle'),
      (4,'front',300,100,0,0,'rectangle');
    INSERT INTO cat_phys_zone(profile_id,zone_no,layout,capacity_amount,origin_x_mm,origin_y_mm,
      length_mm,breadth_mm,direction,pitch_mm,required_view_code)
      VALUES(1,0,'stack',1000,0,0,1000,500,'vertical',1,'front');
    INSERT INTO cat_phys_zone(profile_id,zone_no,layout,capacity_kind_code,capacity_amount,origin_x_mm,origin_y_mm,direction,required_view_code)
      VALUES(2,0,'linear','din_rail',24,10,20,'horizontal','front'),(4,0,'linear','din_rail',12,10,20,'horizontal','front');
    INSERT INTO cat_phys_profile_demand(profile_id,capacity_kind_code,amount) VALUES(3,'din_rail',6);
    INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(2,'parent',1),(4,'parent',1),(3,'parent',2);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,
      source,context_policy,commercial_contribution) VALUES
      (1,1,'frame','Frame','enclosure',1,'definition','import','unrestricted','none'),
      (2,1,'rail-panel','Rail panel','support',2,'definition','import','unrestricted','none'),
      (3,1,'device','Device','device',3,'definition','import','unrestricted','articles'),
      (4,1,'blind-panel','Blind panel','support',4,'definition','import','unrestricted','none'),
      (5,1,'blank','Blank','device',NULL,'definition','import','restricted','articles'),
      (6,1,'bare-frame','Bare frame','enclosure',1,'definition','import','unrestricted','none');
    INSERT INTO cat_config_context(id,brand_id,code,name,source) VALUES(1,1,'C1','Context 1','manual');
    INSERT INTO cat_config_model_context(model_id,context_id,role) VALUES(1,1,'provides'),(5,1,'accepts');
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,design_navigable)
      VALUES(1,1,'models','Models','section','manual',1);
    INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,level_code,source,design_navigable)
      VALUES(2,1,1,'frames','Frames','level','gamma','manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(2,1),(1,2),(1,3),(1,4),(1,5),(2,6);
    INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(1,1,'width','Larghezza','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,label,sort_order,visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(1,5,1,'Larghezza',0,'visible','required','none',0,0);`);
  // Filler profiles: key 100+width-1, demand = width, 4.5 mm per unit; profile id 100+width.
  const profile = db.prepare(`INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
    VALUES(?,?,1,?,'device',?,5,'manual')`);
  for (const width of [1, 2, 3, 4, 5]) {
    profile.run(100 + width, `blank-${width}`, 99 + width, `Blank ${width}`);
    db.prepare(`INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind)
      VALUES(?,'front',?,45,0,0,'rectangle')`).run(100 + width, 9 * width);
    db.prepare("INSERT INTO cat_phys_profile_demand(profile_id,capacity_kind_code,amount) VALUES(?,'din_rail',?)").run(100 + width, width);
    db.prepare("INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(?,'parent',2)").run(100 + width);
  }
  db.prepare("UPDATE cat_config_model SET base_profile_id=101 WHERE id=5").run();
  widths.forEach((width, index) => {
    db.prepare(`INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(?,1,?,?,'manual')`)
      .run(width, `w${width}`, `${width} unità`);
    db.prepare(`INSERT INTO cat_config_option(id,axis_id,value_id,is_default,visible,active,sort_order) VALUES(?,1,?,?,1,1,?)`)
      .run(width, width, index === 0 ? 1 : 0, index);
    const rule = Number(db.prepare("INSERT INTO cat_config_rule(model_id,seq) VALUES(5,?)").run(index + 1).lastInsertRowid);
    db.prepare("INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(?,?)").run(rule, width);
    db.prepare(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value) VALUES(?,1,'profile_key_delta',?)`)
      .run(rule, width - 1);
  });
  if (options.designate !== false)
    db.exec("INSERT INTO cat_config_capacity_filler(model_id,capacity_kind_code,source,source_ref) VALUES(5,'din_rail','manual','test')");
  writer.transaction(() => {
    const id = writer.beginImport({ adapterCode: adapter.code, adapterVersion: adapter.version, sourceLabel: "Generic",
      fingerprint: "b".repeat(64), importedAt: "2026-10-06", files: [] });
    db.prepare("UPDATE cat_config_model SET source_import_id=? WHERE source='import'").run(id);
    writer.finishImport(id, {});
  });
  f.importDelivery({ issuer: "GEN", listino: "1", validFrom: "2026-09-01", products: [
    { marchio: "GEN", code: "PART", priceCents: 1000, description: "Part" },
    { marchio: "GEN", code: "BLANK", priceCents: 602, description: "Blank strip" },
  ] });
  const product = (code: string) => db.prepare("SELECT id FROM cat_product WHERE manufacturer_code=?").pluck().get(code) as number;
  db.prepare(`INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(3,0,?,'GEN','PART',1,'primary'),(5,0,?,'GEN','BLANK',1,'primary')`).run(product("PART"), product("BLANK"));

  const root = mkdtempSync(path.join(tmpdir(), "librequadri-fill-test-")), file = path.join(root, "case.lqp");
  let catalogueAvailable = true;
  const serviceOptions: ProjectDocumentServiceOptions = {
    workingDirectory: path.join(root, "working"), incomingDirectory: path.join(root, "incoming"),
    backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
    engineeringCatalogue: () => catalogueAvailable ? db : null,
    resolveFrontOptionLabels: (items, placed) => resolveFrontOptionLabels(catalogueAvailable ? db : null, items, placed),
    resolveConfiguration: request => resolveConfiguration(db, request),
    resolveCatalogueProduct: id => getCatalogueProductSnapshot(db, id),
    designGuard: (project, request, configuration) => guardDesignCandidate(db, project, request, { mode: "add", configuration }),
    designItemGuard: (project, request) => guardConfiguredStructuralItem(db, project, request),
    capacityFillers: kind => {
      if (!catalogueAvailable) throw new Error("Catalogo non disponibile.");
      return capacityFillerConfigurations(db, kind);
    },
  };
  const service = new ProjectDocumentService(serviceOptions);
  await service.create({ destinationPath: file, title: "Fill", description: "", notes: "", projectType: "civil", executor: "",
    date: "2026-10-06", companyName: "", companyDescription: "" });
  const add = (modelId: number, quantity = 1, selectedOptionIds: number[] = []) => {
    const code = db.prepare("SELECT code FROM cat_config_model WHERE id=?").pluck().get(modelId) as string;
    return service.addConfiguredItem({ modelId, selectedOptionIds }, quantity).configuredItems.find(item => item.modelCode === code)!.uuid;
  };
  const nodes = () => {
    const flat: { uuid: string; itemUuid: string | null; parentUuid: string | null; nodeKind: string; startUnits: number | null }[] = [];
    const walk = (list: NonNullable<ReturnType<typeof service.current>>["physicalNodes"]) => {
      for (const node of list) { flat.push(node); walk(node.children); }
    };
    walk(service.current()!.physicalNodes);
    return flat;
  };
  const workingFile = () => path.join(root, "working", readdirSync(path.join(root, "working")).find(name => name.endsWith(".lqp"))!);
  /** Every document table of the working copy, storage classes included (lqp_meta is save bookkeeping). */
  const dump = () => {
    const working = new Database(workingFile(), { readonly: true });
    try {
      return Object.fromEntries(documentTables(working).map(table => {
        const columns = working.prepare("SELECT name FROM pragma_table_info(?)").pluck().all(table) as string[];
        return [table, working.prepare(`SELECT ${columns.map(name => `typeof("${name}")||':'||quote("${name}")`).join(",")}
          FROM "${table}" ORDER BY rowid`).raw().all()];
      }));
    } finally { working.close(); }
  };
  return { f, db, root, file, service, serviceOptions, add, nodes, workingFile, dump,
    unavailable: () => { catalogueAvailable = false; },
    close: () => { service.close(); f.close(); rmSync(root, { recursive: true, force: true }); } };
}

export type CapacityFillFixture = Awaited<ReturnType<typeof capacityFillFixture>>;
