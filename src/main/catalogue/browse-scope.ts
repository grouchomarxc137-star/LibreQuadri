// Browse and navigation use the same active, navigable descendant tree and
// article membership. UNION deduplicates a product reached through multiple
// models, positions, or METEL families within each root's scope.
// Keep the tree first in each membership branch: activation predicates must
// not make SQLite scan an entire brand for a narrow node or facet.
function scopeSql(roots: string): string {
  return `WITH RECURSIVE tree(root_id,id) AS (
    ${roots}
    UNION ALL
    SELECT t.root_id,n.id FROM cat_range_node n INDEXED BY cat_range_node_parent_idx
    JOIN tree t ON n.parent_id=t.id WHERE n.active=1 AND n.navigable=1
      AND n.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
  ), member(root_id,product_id) AS (
    SELECT t.root_id,e.product_id FROM tree t CROSS JOIN cat_range_node_model nm ON nm.node_id=t.id
    CROSS JOIN cat_config_model m ON m.id=nm.model_id
    CROSS JOIN cat_config_model_entry e ON e.model_id=m.id
    CROSS JOIN cat_product active_product ON active_product.id=e.product_id AND active_product.import_removed=0
    WHERE m.active=1 AND m.obsolete=0
      AND EXISTS(SELECT 1 FROM cat_brand b WHERE b.id=m.brand_id AND b.active=1)
      AND EXISTS(SELECT 1 FROM cat_brand b WHERE b.id=active_product.brand_id AND b.active=1)
    UNION
    SELECT t.root_id,p.id FROM tree t CROSS JOIN cat_range_node_metel_family nf ON nf.node_id=t.id
    CROSS JOIN cat_product p INDEXED BY cat_product_statistical_family_idx
      ON p.statistical_family_id=nf.metel_family_id AND p.import_removed=0
    WHERE EXISTS(SELECT 1 FROM cat_brand b WHERE b.id=p.brand_id AND b.active=1)
    UNION
    SELECT t.root_id,p.id FROM tree t CROSS JOIN cat_range_node_product np ON np.node_id=t.id
    CROSS JOIN cat_product p ON p.id=np.product_id AND p.import_removed=0
    WHERE EXISTS(SELECT 1 FROM cat_brand b WHERE b.id=p.brand_id AND b.active=1)
  )`;
}

export const BROWSE_SCOPE_SQL = scopeSql(`SELECT id,id FROM cat_range_node
  WHERE id=@nodeId AND active=1 AND navigable=1 AND brand_id IN (SELECT id FROM cat_brand WHERE active=1)`);

export const NAVIGATION_SCOPE_SQL = scopeSql(`SELECT id,id FROM cat_range_node
  WHERE active=1 AND navigable=1 AND brand_id IN (SELECT id FROM cat_brand WHERE active=1)`);
