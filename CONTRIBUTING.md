# Contributing

Keep changes focused and describe the resulting application behavior.
Preserve the Electron/React/SQLite boundaries, saved project compatibility,
existing preferences and applied migration history.

1. Work on a dedicated branch.
2. Use small synthetic fixtures. Keep external acceptance inputs behind explicit
   `LIBREQUADRI_*` variables and outside the checkout.
3. Run `npm run typecheck`, `npm test`, `npm run build`,
   `npm run db:check:project-manifest` and `npm run audit:publication`.
4. Include the relevant results and identify skipped external-data tests.
5. Retain dependency licence and attribution notices for third-party components.

Do not commit credentials, real customer projects, private catalogues,
commercial agreements, manufacturer source files or generated builds.
Review the staged diff before pushing.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[docs/EXTERNAL_DATA.md](docs/EXTERNAL_DATA.md) and
[docs/SOURCE_AUDIT.md](docs/SOURCE_AUDIT.md).
