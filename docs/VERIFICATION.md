# LibreQuadri verification

Date: 24 November 2026. Environment: macOS, Node.js 25.2.1, npm 11.6.2.

| Check | Result |
| --- | --- |
| Locked dependencies | Passed: 238 packages installed with `npm ci --offline`. Dependency versions and integrity entries are unchanged. |
| Type checking | Passed: main/shared/scripts/tests and renderer configurations. |
| Complete automated suite | **1,870 passed, 13 failed, 123 skipped**; 167 files: 143 passed, 8 failed, 16 skipped. |
| Focused engineering synchronization tests | **54 passed**, including 13 generic directory-policy cases. |
| Production build | Passed: main TypeScript and Vite renderer. Existing renderer chunk-size warning above 500 kB remains. |
| Project schema manifest | Passed. All 73 schema/migration files remain byte-identical. |
| Source content audit | 553 files scanned; zero unexpected technical findings. |
| Obsolete branding audit | No obsolete product-name references in source, documentation, configuration or filenames. |

Commands: `npm run typecheck`, `npm test -- --maxWorkers=4`, `npm run build`,
`npm run db:check:project-manifest` and `npm run audit:publication`.

## Directory-policy coverage

Tests cover unmanaged profiles in standard application-data locations,
managed development/test roots, explicit custom development roots, production
execution, bundles, seed manifests and nested seed trees. They also cover
symlinks into/out of protected profiles, aliased application-data parents,
catalogue aliases/hard links, platform locations and attempted data-dir override
bypasses. Refused production checks leave catalogue bytes unchanged.
The existing sync tests retain archive, backup, locking, cancellation and
manual-override coverage.

## Known failing cases

The full suite is not passing. These 13 existing failure cases remain:

| Test file | Failing cases |
| --- | --- |
| `test/app-shutdown.test.ts` | 3 |
| `test/design-compatibility.test.ts` | 1 |
| `test/package-scripts.test.ts` | 1 |
| `test/recent-projects.test.ts` | 1 |
| `test/renderer/apparecchi-workflow.test.tsx` | 1 |
| `test/renderer/full-text-tooltip.test.tsx` | 1 |
| `test/renderer/scheda-articolo.test.tsx` | 1 |
| `test/tiquadri-navigation-groups.test.ts` | 4 |

They concern a startup database mock, generic module boundaries, the prestart
script expectation, zoom default, navigation/package expectations, tooltip row
identity and disabled configuration actions. No additional failing cases were
introduced and no assertions were weakened to hide failures.

The 123 skipped cases require authorized external data or historical profiles
that were not supplied. They are not manufacturer-data validation. Installer
packaging/signing and populated external-data acceptance were not part of this
verification.

See [SOURCE_AUDIT.md](SOURCE_AUDIT.md) and [EXTERNAL_DATA.md](EXTERNAL_DATA.md).
