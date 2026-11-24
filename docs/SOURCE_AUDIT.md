# Source audit

Audit date: 24 November 2026.

`npm run audit:publication` inspects every tracked or unignored source file.
It checks credential signatures, credential-bearing URLs, personal filesystem
paths, excluded data formats, unexpected binary
content and the explicitly allowed synthetic SQLite fixture. Findings identify
the file and rule without printing credential values.

The source tree excludes local profiles/databases, customer projects, raw METEL
files, manufacturer source databases, DWG/DXF inputs, private documents,
credentials, environment files and generated builds. `.gitignore` records these
exclusions. External input roles are documented in [EXTERNAL_DATA.md](EXTERNAL_DATA.md).

## Compatibility identifiers

Engineering synchronization validates directory structure and protected profile
locations without product-name matching. See
[EXTERNAL_DATA.md](EXTERNAL_DATA.md#engineering-synchronization).

`lq.db`, migration/schema paths, `.lqp`, `lqp_meta`, `lq_own`, `lq_authored`,
`lq_group`, `LqApi`, `window.lq` and `lq.panel-widths.v1` are storage or API
contracts. Source grouping evidence and seed reference strings remain stable
for catalogue fingerprints and importer consistency.

The only committed binary fixture is `test/fixtures/quotation-format1.lqp`.
It contains one synthetic project/line, example operator/customer labels,
fixed test IDs and amounts, no contact/VAT/address records, zero customer
discount and no embedded artwork. The SVG regression fixture stores hashes.
Other test data is generated in code. Synthetic path tests use fictional users.

The scan is a bounded content check, not a guarantee that every possible secret
pattern can be recognized. Review actual changes and external input provenance
when adding data. Verification results are in [VERIFICATION.md](VERIFICATION.md).
