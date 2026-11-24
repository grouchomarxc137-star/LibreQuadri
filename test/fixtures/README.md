# Test fixtures

`quotation-format1.lqp` is a synthetic, minimal SQLite format-1 project used to
verify format upgrades. It contains one example quotation line, fixed test
UUIDs and dates, an example operator, an example customer, and deliberately
chosen test amounts. The product code and brand identify a compatibility case;
no customer records, negotiated discounts, contacts, VAT numbers, addresses or
purchase conditions are included. The file was rebuilt into a fresh database
to discard unused pages after sanitization. It is the only allowed `.lqp` file.

`front-svg-before-refactor.json` contains SHA-256 expectations for generated
SVG output from synthetic helpers, not external artwork. The helpers generate
small geometric examples in code. Other in-code samples and amounts in `test/`
are test data; they do not establish manufacturer pricing or licensing rights.

Real-data acceptance tests remain available through explicit
`LIBREQUADRI_*` environment variables. Obtain external data separately and
keep it outside the repository. See `docs/EXTERNAL_DATA.md`.
