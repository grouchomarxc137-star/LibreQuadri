# Revision 8 configuration query and resolver


The merged Step 9.3 implementation provides the catalogue-side configuration layer in
`src/main/catalogue/configuration-{queries,resolver,ipc}.ts`. It uses only normalized
`cat_config_*`, `cat_phys_*`, catalogue and current METEL price-list records.

The `window.lq.configuration` API provides `ranges(brandMarchio?)`,
`nodeModels(nodeId)`, `productModels(productId)`, `model(modelId)`, and
`resolve({modelId, selectedOptionIds, productId?})`. Range nodes carry parent IDs;
the renderer can construct the hierarchy. `productModels` includes the entry's
preselected option. `model` exposes ordered axes, values, defaults, parent option
IDs, visibility, requirement, binding, budgets and data-only model relations.
Browse results retain active and obsolete flags, including historical imported
models. All IPC requests are checked for trusted renderer origin and bounded
local IDs.

Resolution selects at most one active option per axis. Explicit choices are
validated against the model and retained; a product entry preselects its primary
option unless the caller explicitly chose another option on that axis. Missing
choices use a unique eligible default. A child option is eligible only when its
parent is selected. Required axes without a choice are reported. Hidden axes
follow the same rules. A rule matches when every condition option is selected;
a rule with no conditions always matches. Effects are applied in stored rule and
effect order. Unsupported `inherit_container` binding is reported because
Revision 8 Q13 remains open; the API does not accept placement context yet.

Fixed articles and matching article effects form the BOM. Identical linked
products are aggregated by product ID; unresolved references are aggregated by
brand and manufacturer code. Roles and source identity remain visible. The
governing issuer's listed product, current `com_price_list`, and
`com_product_price.list_price_unit_e4` supply each unit price, as in catalogue
search. Quantity multiplication uses exact integer `_e4` arithmetic. An
unresolved article, missing current METEL price, or inexact fractional product
leaves the full total null while preserving the priced subtotal and every BOM
row. No fallback price is assigned.

`profile_key_delta` is summed within the base profile's set;
`profile_override` selects an explicit profile. Conflicting overrides or an
override combined with a key delta are reported as invalid. Missing keyed
variants yield `no_profile`: the BOM can still be quoted. Demand deltas adjust
integer capacity demands, including DIN 9 mm half-modules. The result includes
the effective profile, fit class, views, zones, slots, demands, and parent or
ancestor accept sets. No placement check runs here. Matching `budget_use` values
are summed against the model's declared budgets.

Issues carry an error or warning severity. Missing prices, unresolved BOM
articles and absent physical profiles remain visible as warnings with an
incomplete result status; impossible selections and budgets are errors.

The fingerprint is SHA-256 of the canonical brand marchio, model code,
definition fingerprint, and sorted dimension/value code pairs. Invalid or
missing required selections have no fingerprint.

Known limits: Revision 8 Q13 prevents container inheritance and context
resolution. Model relations (`join_kit`, `side_panel`, `preset_child`) are exposed
as data, with their application deferred by Q18. The resolver does not interpret
licensed assets or perform placement. Source imports can contain unresolved
article references and absent physical profile variants; those are explicit
in the result.
The supplied TiQuadri import also has three active models with multiple
defaults on one root axis: `tq.pack.1557`, `tq.pack.1559`, and `tq.pack.1561`.
They return `ambiguous_default` until an explicit option is selected or the
source data is corrected.
