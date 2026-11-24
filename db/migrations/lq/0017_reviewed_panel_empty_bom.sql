-- Additive: do not rebuild the rule table or cascade-delete its conditions/effects.
ALTER TABLE `cat_config_rule` ADD COLUMN `empty_bom_allowed` integer DEFAULT 0 NOT NULL
  CONSTRAINT `cat_config_rule_empty_bom_check` CHECK (`empty_bom_allowed` in (0,1));
--> statement-breakpoint
-- Reviewed source cases only. The complete raw-model fingerprint, exact condition
-- pair, absent base articles and absent article effects must all agree.
UPDATE cat_config_rule SET empty_bom_allowed=1 WHERE id IN (
  SELECT r.id FROM cat_config_rule r
  JOIN cat_config_model m ON m.id=r.model_id
  JOIN cat_brand b ON b.id=m.brand_id
  JOIN app_source_import i ON i.id=m.source_import_id
  WHERE b.metel_marchio='BTI' AND m.source='import' AND m.model_kind='support'
    AND m.commercial_contribution='articles' AND i.adapter_code='tiquadri' AND i.adapter_version='11'
    AND (
      (m.code='tq.pack.1284' AND m.source_ref='TiQuadri ANA_PACK 1284'
        AND m.name='24 Moduli DIN 515x150mm' AND m.definition_fingerprint='3d5a9f4f32cadbf831c20a38778762bdb1feb166d156de8e207c4e8d46b9a332') OR
      (m.code='tq.pack.1285' AND m.source_ref='TiQuadri ANA_PACK 1285'
        AND m.name='24 Moduli DIN 515x200mm' AND m.definition_fingerprint='8d7ee55fc09905cc951fcde6584296cb1fea7f63f094ba59f51876c45897c8ca') OR
      (m.code='tq.pack.1286' AND m.source_ref='TiQuadri ANA_PACK 1286'
        AND m.name='24 Moduli DIN 515x300mm' AND m.definition_fingerprint='06d67e897f103911cff083963b40422c145e7869c78ee334569e0640b2ac2824')
    )
    AND NOT EXISTS (SELECT 1 FROM cat_config_model_article a WHERE a.model_id=m.id)
    AND NOT EXISTS (SELECT 1 FROM cat_config_rule_effect e WHERE e.rule_id=r.id AND e.effect_kind='article')
    AND (SELECT COUNT(*) FROM cat_config_rule_condition c WHERE c.rule_id=r.id)=2
    AND EXISTS (SELECT 1 FROM cat_config_rule_condition c JOIN cat_config_option o ON o.id=c.option_id
      JOIN cat_config_axis a ON a.id=o.axis_id JOIN cat_config_dimension d ON d.id=a.dimension_id
      JOIN cat_config_dimension_value v ON v.id=o.value_id
      WHERE c.rule_id=r.id AND a.model_id=m.id AND d.code='tq.label.54' AND v.code='tq.value.231')
    AND EXISTS (SELECT 1 FROM cat_config_rule_condition c JOIN cat_config_option o ON o.id=c.option_id
      JOIN cat_config_axis a ON a.id=o.axis_id JOIN cat_config_dimension d ON d.id=a.dimension_id
      JOIN cat_config_dimension_value v ON v.id=o.value_id
      WHERE c.rule_id=r.id AND a.model_id=m.id AND d.code='tq.label.53' AND v.code='tq.value.-1')
);

--> statement-breakpoint
-- The reviewed blank strip in the same SDX preset has neither axes nor article
-- source rows. Approve its existing whole-model physical-only classification too.
UPDATE cat_config_model SET commercial_contribution='none'
WHERE code='tq.pack.1283' AND name='Cieco 515x 50mm' AND model_kind='support'
  AND source='import' AND source_ref='TiQuadri ANA_PACK 1283'
  AND definition_fingerprint='12e0ca7c84046eb6035c50e177e0e1dddce7b8e87faaf5b68fdd0107ac090db6'
  AND brand_id IN (SELECT id FROM cat_brand WHERE metel_marchio='BTI')
  AND source_import_id IN (SELECT id FROM app_source_import WHERE adapter_code='tiquadri' AND adapter_version='11')
  AND NOT EXISTS (SELECT 1 FROM cat_config_model_article a WHERE a.model_id=cat_config_model.id)
  AND NOT EXISTS (SELECT 1 FROM cat_config_axis a WHERE a.model_id=cat_config_model.id)
  AND NOT EXISTS (SELECT 1 FROM cat_config_rule r JOIN cat_config_rule_effect e ON e.rule_id=r.id
    WHERE r.model_id=cat_config_model.id AND e.effect_kind='article');
