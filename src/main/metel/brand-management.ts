import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { BrandRemovalPreview, ManagedBrand } from "../../shared/brands.js";
import { assertQuickCheck } from "../database/sqlite-connection.js";
import { synchronizeSiemensNavigation, type SiemensNavigationSeed } from "../catalogue/siemens-navigation.js";

/** Worker-owned operations; project documents and source archives are never edited. */
export class BrandManagement {
  private plan: { preview: BrandRemovalPreview; version: number; changes: number } | undefined;
  constructor(private readonly db: Database.Database, private readonly backups: string,
    private readonly progress: (message: string) => void, private readonly navigationSeed?: SiemensNavigationSeed) {}

  list(): ManagedBrand[] {
    return this.db.prepare(`SELECT b.id,b.metel_marchio AS code,b.name,b.active,b.import_removed AS removed,
      COALESCE(SUM(p.import_removed=0),0) AS products,
      COALESCE(SUM(p.is_listed),0) AS listed,
      COALESCE((SELECT GROUP_CONCAT(info, '; ') FROM (
        SELECT i.metel_sigla || COALESCE(' · ' || pl.listino_number || ' · ' || pl.valid_from,'') AS info
        FROM cat_issuer_brand ib JOIN cat_metel_issuer i ON i.id=ib.issuer_id
        LEFT JOIN com_price_list pl ON pl.issuer_id=i.id AND pl.is_current=1
        WHERE ib.brand_id=b.id ORDER BY i.metel_sigla)), '') AS issuers
      FROM cat_brand b LEFT JOIN cat_product p ON p.brand_id=b.id GROUP BY b.id ORDER BY b.metel_marchio`)
      .all().map(row => { const b = row as Omit<ManagedBrand,"active"|"removed"> & {active:number;removed:number};
        return {...b,active:b.active===1,removed:b.removed===1}; });
  }
  private brand(id: number): ManagedBrand {
    const brand = this.list().find(b => b.id===id);
    if (!brand) throw new Error("Marchio non trovato.");
    return brand;
  }
  setActive(id: number, active: boolean): void {
    this.plan=undefined;
    this.db.transaction(() => {
      const brand=this.brand(id);
      if(brand.removed) throw new Error("Reimporta i file METEL prima di riattivare questo marchio.");
      this.db.prepare("UPDATE cat_brand SET active=? WHERE id=?").run(Number(active),id);
      synchronizeSiemensNavigation(this.db, this.navigationSeed);
    }).immediate();
  }
  previewRemoval(id: number): BrandRemovalPreview {
    const brand=this.brand(id), blockers:string[]=[];
    const count=(sql:string)=>this.db.prepare(sql).pluck().get(id) as number;
    if(brand.removed) blockers.push("I dati importati di questo marchio sono già stati rimossi.");
    if(count("SELECT COUNT(*) FROM cat_config_model WHERE brand_id=?")) blockers.push("Il marchio possiede modelli di progettazione: usa Disattiva.");
    if(count(`SELECT COUNT(*) FROM cat_config_model_article a JOIN cat_product p ON p.id=a.product_id WHERE p.brand_id=?`)
      ||count(`SELECT COUNT(*) FROM cat_config_rule_effect e JOIN cat_product p ON p.id=e.product_id WHERE p.brand_id=?`)
      ||count(`SELECT COUNT(*) FROM cat_config_model_entry e JOIN cat_product p ON p.id=e.product_id WHERE p.brand_id=?`)
      ||count(`SELECT COUNT(*) FROM cat_product_physical pp JOIN cat_product p ON p.id=pp.product_id WHERE p.brand_id=?`)
      ||count(`SELECT COUNT(*) FROM cat_config_model_article WHERE ref_brand_marchio=(SELECT metel_marchio FROM cat_brand WHERE id=?)`)
      ||count(`SELECT COUNT(*) FROM cat_config_rule_effect WHERE effect_kind='article' AND ref_brand_marchio=(SELECT metel_marchio FROM cat_brand WHERE id=?)`))
      blockers.push("Altri modelli di progettazione utilizzano questi articoli: usa Disattiva.");
    if(count("SELECT COUNT(*) FROM cat_range_node WHERE brand_id=? AND source<>'metel'"))
      blockers.push("Il marchio possiede una struttura di navigazione tecnica: usa Disattiva.");
    if(this.db.prepare("SELECT source FROM cat_brand WHERE id=?").pluck().get(id)!=="import")
      blockers.push("La rimozione è disponibile per i marchi importati da METEL. Usa Disattiva.");
    const preview={token:randomUUID(),brand,blockers,
      prices:count("SELECT COUNT(*) FROM com_product_price WHERE product_id IN (SELECT id FROM cat_product WHERE brand_id=?)"),
      families:count("SELECT COUNT(*) FROM cat_metel_family WHERE brand_id=?")};
    this.plan={preview,version:this.db.pragma("data_version",{simple:true}) as number,
      changes:this.db.prepare("SELECT total_changes()").pluck().get() as number};
    return preview;
  }
  remove(token: string): void {
    const plan=this.plan;this.plan=undefined;
    if(!plan||plan.preview.token!==token) throw new Error("Anteprima scaduta. Ripeti l’anteprima di rimozione.");
    const unchanged=()=>{
      if(this.db.pragma("data_version",{simple:true})!==plan.version
        ||this.db.prepare("SELECT total_changes()").pluck().get()!==plan.changes)
        throw new Error("Il catalogo è cambiato. Ripeti l’anteprima di rimozione.");
    };
    unchanged();
    if(plan.preview.blockers.length)throw new Error(plan.preview.blockers.join(" "));
    this.progress("Creazione e verifica backup del catalogo…");
    mkdirSync(this.backups,{recursive:true});
    const filename=path.join(this.backups,`brand-${Date.now()}-${randomUUID()}.db`);
    this.db.prepare("VACUUM INTO ?").run(filename);
    const backup=new Database(filename,{readonly:true});
    try {assertQuickCheck(backup);} finally {backup.close();}
    this.progress("Rimozione atomica dei dati commerciali…");
    this.db.transaction(()=>{
      unchanged();
      const id=plan.preview.brand.id;
      // Recheck dependencies under the same writer lock as deletion.
      if(this.previewRemoval(id).blockers.length) throw new Error("Dipendenze cambiate. Ripeti l’anteprima.");
      this.plan=undefined;
      this.db.prepare(`INSERT OR IGNORE INTO app_removed_brand_listing(brand_id,issuer_id)
        SELECT brand_id,issuer_id FROM cat_issuer_brand WHERE brand_id=?`).run(id);
      for(const table of ["com_product_price","cat_product_listing","cat_product_attribute","cat_product_family_assignment","cat_product_physical","cat_range_node_product"])
        this.db.prepare(`DELETE FROM ${table} WHERE product_id IN (SELECT id FROM cat_product WHERE brand_id=?)`).run(id);
      this.db.prepare(`UPDATE cat_product SET governing_issuer_id=NULL,ean=NULL,short_description=NULL,
        unit_of_measure=NULL,pack_qty=NULL,min_order_qty=NULL,order_multiple=NULL,max_order_qty=NULL,
        lead_time_code=NULL,lifecycle_status_code=NULL,is_kit=NULL,electrocod=NULL,
        discount_family_id=NULL,statistical_family_id=NULL,description=NULL,search_text=NULL,
        category_id=NULL,category_source='unmapped',category_mapping_id=NULL,category_model_id=NULL,is_listed=0,import_removed=1,
        updated_at=? WHERE brand_id=?`).run(new Date().toISOString(),id);
      // Family and product identities are retained to avoid reusing portable IDs.
      this.db.prepare("UPDATE cat_metel_family SET description=NULL,is_known=0 WHERE brand_id=?").run(id);
      this.db.prepare("UPDATE cat_range_node SET name=code,active=0,navigable=0 WHERE brand_id=? AND source='metel'").run(id);
      this.db.prepare("UPDATE cat_brand SET active=0,import_removed=1 WHERE id=?").run(id);
      if((this.db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Rimozione annullata: riferimenti non validi.");
    }).immediate();
  }
}
