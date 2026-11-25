# History → Finance journal navigation

Implementation commit: **`bdbc7ceed188f7a9902d497fb4a5104ddb2ff370`**.
This supersedes the missing forward-action finding in the historical
[1068f4d combined diagnostic](FINANCE25-ROUNDTRIP.md). PR23 remains draft; no merge.

## Contract owned by PR23

Unified `TransactionHistoryScreen` accepts `onOpenJournal(journalId)`.
For each non-null journal ID exposed by the scoped response, an operator with
`ledger.view` sees **Open journal**. The action passes that exact journal ID,
not the transaction UUID or a reference-derived value.

The Layout handler calls its existing guarded navigation:

```tsx
onOpenJournal={(journalId) => handleNav('ledgerExplorer', { journalId })}
// Ledger destination:
<LedgerOperationsScreen initialJournalId={navContext.journalId} ... />
```

This is Finance #25's existing **shell-context deep-link contract**, not a new URL
hash. No unsupported `#ledger/...` URL has been invented. Opening Ledger clears the
old History hash through normal shell navigation; Finance's return adapter resolves
the authoritative business key and navigates to
`#transaction-history/<TYPE>/<business UUID>`. Normal leave-workspace guards,
ledger.view route checks, backend authorization and institution scoping remain in
force. IDs are read-only navigation inputs, never authority to read the journal.

PR23's standalone Ledger workspace now accepts the same `initialJournalId` prop,
auto-populates and loads that ID using the existing journal loader. No Finance
backend code is imported into PR23. Its initial-ID effect is re-entrant under
StrictMode and principal changes retain the existing keyed workspace isolation.

Distinct states remain:

- Ledger-authorized response with no non-null journal IDs: **No journal recorded.**
- No ledger permission, or no journal projection exposed: **Ledger information
  requires ledger.view.** No Open journal action or exposed UUID in that state.
- Journal ID exposed plus ledger.view: the UUID and **Open journal** action.

A button is only wired where a host supplies the callback; the unified shell does.
Multi-journal lifecycles retain a separate action beside each exposed journal.

## PR23 owns the Layout integration resolution

Reproducible script: `scripts/prepare-history-journal-integration.cjs`.
It builds an ignored archive snapshot with a private temporary Git index; no
branch is switched/created and neither PR is merged into the integration base.

The explicit resolved Layout:

1. Retains one **Transaction History** sidebar destination and the existing guarded
   aliases; does not restore separate `cashIn` / `cashOut` switch cases.
2. Retains the new unified History → journal callback.
3. Keeps exactly one `journalId` declaration in NavContext: both branches add it.
4. Preserves Finance contexts and props: `initialJournalId`, `initialReference`,
   transaction investigation links, reconciliation and banking investigation links.
5. Preserves History hash navigation and Finance's canonical transaction return.

The new minimal Ledger loader in PR23 also overlaps Finance's richer Ledger
workspace. The resolution keeps Finance's metadata, source links, record search,
reversal guards and loaders, while retaining PR23's re-entrant initial-ID effect.
Finance's one-shot `autoOpened` ref caused a blank journal in the real StrictMode
browser: cleanup invalidated the first request, and the second effect skipped the
load. The tiny **finance-loader-compatibility.patch** removes that one-shot guard.
This compatibility resolution is explicitly included in the tested tree, not
silently attributed to an unmodified Finance head. PR25 should adopt it, or retain
it when resolving the eventual integration. No reversal authority is broadened.

Both [Layout resolution](evidence/journal-open/layout-resolution.patch) and
[Finance loader compatibility patch](evidence/journal-open/finance-loader-compatibility.patch)
are attached for coordination. The script refuses unknown heads/conflicts.

## Exact combined browser verification

Finance advanced during this turn. The final successful run uses its new persisted
Bank to Wallet source mapping, not the earlier `891a1c1` missing-source head.

| Input | Exact SHA |
| --- | --- |
| PR23 implementation | `bdbc7ceed188f7a9902d497fb4a5104ddb2ff370` |
| PR25 newer source-mapping head | `8301fa245e686c68a2fdce611c93cc191e2106d3` |
| Unresolved combined tree | `58ef38ef63c51009344ce466dabe125979378759` |
| Explicitly resolved product tree tested | `6df5ba3abdf6a00dffaca78a6b7cb0f3abdde719` |

Fresh disposable PostgreSQL 18.4, **171 migrations from scratch**, genuine workforce
browser sign-in, actual Nest AppModule and synthetic posted records. No browser
API stubs. The controlled sandbox verifier/policy fixture and balanced synthetic
wallet transfer read-model record follow the earlier diagnostic's disclosed setup;
this does not certify wallet-transfer execution or an external bank connection.

**PASS, 67.68 seconds:**

- History exact-reference row → detail → **Open journal** → automatic journal
  inspection (no manual Ledger lookup) → Finance return link → **same canonical
  wallet transfer TYPE/UUID**.
- Same actual click sequence for a CREDITED **Bank to Wallet** record; Finance
  returns the bank intake UUID through `DURABLE_INBOUND_LINK`, not its float receipt
  or journal UUID. Both round trips have fresh screenshots.
- Owner OPERATIONS without ledger.view sees the restricted state and no action;
  both core and Finance journal direct requests return **403**.
- Foreign-institution OPERATIONS sees **404** for both transaction details;
  foreign scoped FINANCE_PREPARER receives **404** on both journal APIs and Ledger UI.
- All 11 exact local passwords authenticate; credential hashes and role-function
  grants remain unchanged. No execution boundaries, schema or mobile changes.

[Results](evidence/journal-open/results.json) contain exact record IDs, source
hashes, migration names, authorization results and 12 screenshot filenames.
[Provenance](evidence/journal-open/integration-provenance.json) records the source
heads and explicit integration resolutions. An evidence-publication commit does
not replace those exact tested inputs. No unmodified-head or combined CI pass is
claimed.

Additional validation: PR23 **5 UI suites / 47 tests pass**, including the actual
shell callback→exact journal request, action permission removal, distinct absent
journal states, legacy aliases, Ledger and navigation regressions. PR23 web types
and production build pass. Combined backend and web types pass after resolution.

## Reproduce / hold

With the pinned commits available and dependencies installed:

```sh
node scripts/prepare-history-journal-integration.cjs \
  bdbc7ceed188f7a9902d497fb4a5104ddb2ff370 \
  8301fa245e686c68a2fdce611c93cc191e2106d3
```

The target `data/validation/finance25-journal-open/` must not already exist.
Start Vite in its Admin Web directory with
`ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3099` and `--host 0.0.0.0`.
Run its copied `test/finance25-history-roundtrip.integration.spec.ts` against a
fully disposable PostgreSQL instance using the standard PG test safety variables
and local config, setting `FINANCE25_EVIDENCE_OUT` to a fresh evidence directory.
The sandbox Chromium needed `LD_LIBRARY_PATH=/tmp/al2023/lib`.

The original diagnostic template/report remain historical evidence and are not
rewritten to claim prior-head success. The new template is separate.

**Hold the merge.** Coordinate/adopt the explicit Layout and loader resolution
with PR25 and rerun against eventual integration heads. Mixed-product query plans
and unresolved legacy/suspense inbound paths remain checklist items. This two-type
browser proof does not establish every historical inbound transition or external
governance approval.
