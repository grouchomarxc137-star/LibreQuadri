# Installed brand management


Open **Listino → Gestisci marchi…**, or the matching Start screen button.
The table includes active, disabled and removed brands. Search by code, name or
issuer. Counts describe installed articles and current issuer listings; issuer
details show current listino numbers and validity dates. **Aggiorna listino…**
opens the existing complete-delivery importer.

## Activation

**Disattiva** excludes a brand from ordinary catalogue overview, search,
navigation, browse results/facets and new configuration/design selection.
Direct product/model requests cannot bypass that boundary. A configuration
whose selected BOM uses a disabled brand reports an error instead of being
accepted. **Riattiva** restores visibility without reimporting retained data.
Normal METEL updates preserve an explicit disabled state.

Existing project documents and their working copies are not opened, repriced
or rewritten by either action. Their saved commercial and engineering snapshots
remain authoritative. Verification/refresh against a disabled catalogue model
can be unavailable; this does not rewrite the saved model snapshot.

## Removal

**Rimuovi dati…** first reports article, price-history and family counts, plus
engineering blockers. It requires explicit confirmation. The first release
blocks removal of non-imported brands, brands owning configuration models or
technical navigation, brands referenced by model articles/rules/entries, and
brands with engineering physical mappings. Unresolved explicit references are
also protected. Disabled/obsolete engineering dependencies still count.
Disactivation remains available for these brands.

The worker verifies a catalogue backup, checks the preview's generation again
inside an immediate writer transaction, rechecks dependencies and removes:

- all issuer listings and historical/current product prices for the brand;
- product descriptions, commercial fields, classification, attributes and
  product-family assignments;
- METEL family descriptions, with those families marked unknown;
- derived METEL navigation labels/visibility, with those nodes deactivated.

Product/brand/family identity records, original delivery provenance, shared
price-list headers, archived source files, engineering assets and backups stay.
Removed product identities are explicitly hidden so their IDs can never be
reused for a different article. The table shows **Dati rimossi**, with zero
installed articles. This is removal of installed commercial data, not archive
or backup storage cleanup.

All database writes commit together or roll back. An invalid/expired token,
catalogue change, backup failure or live deletion failure leaves the installed
data unchanged. A successful backup may remain as recovery evidence after a
failed removal. Progress stays in the dialog footer; controls/close are disabled
during work. The shared import worker and project lifecycle guard serialize
catalogue mutations and protect quit/project/configuration operations.

## Reinstallation

Reimport LSP/FSC/FST from the issuer's currently installed delivery, or a new
complete delivery. Explicit removal is tracked by issuer and brand, so the
ordinary repeated-delivery no-op does not prevent reinstallation.
Replaying the current fingerprint restores only removed brands from that
issuer; other brands, prices and provenance are preserved. Older superseded
fingerprints are refused for restoration: use the current or a new delivery.
New deliveries retain the importer's ordinary current/history rules.

Restored articles reuse their original IDs. Only articles actually present in
the incoming LSP become visible; retained missing identities stay hidden.
Remaining removed issuers can be restored separately. Reinstalling a removed
brand reactivates it; subsequent explicit disactivation is still respected.

## Verification

Migration tests cover additive upgrades and retained product/listing/price
data. Import-session tests cover activation, updates while disabled, multi-brand
removal, multi-issuer restoration, same-file restoration, absent identities,
backups, stale previews, rollback, engineering blockers and preserved open/saved
project snapshots across reopen. IPC tests reject untrusted senders and malformed
payloads; mounted UI tests cover preview, confirmation, blockers, busy/close and
expired-plan failures.

Browse membership traverses the selected tree before article tables. Root facet
definitions are cached with local-write/data-version invalidation, bypassed
inside transactions; activation on either connection and rollback are tested.
The source-enabled exhaustive facet walk remains part of acceptance.
