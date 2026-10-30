# Notification Reliability + Provider Security Integration Record — Arena 1 `d212c66` and Arena 2 `d228a36` merged, transfer producer contract corrected

**Date:** 2026-10-28
**Integrator:** Arena 3 (pinned branch `arena/8e59e188-monienaija`)
**Status:** INTEGRATED — all local gates green at the time of writing. **Arena 4 must independently verify the combined application; nothing here declares technical acceptance or production readiness.** Provider activation remains dark; no real vendor call, credential, production migration, or deployment occurred.

---

## 1. Provenance and merge topology

| Item | SHA |
|---|---|
| Prior integrated application (baseline) | `fe06ea8f7f6345db1542a17995c1d17b2aa07631` |
| Prior integration docs HEAD (integration start point) | `08b8329e6f0f8f2e81ee8702ad2855d17f1d3852` |
| Arena 4 fresh independent review of `fe06ea8` (F-01/F-05 FAIL, F-02/F-03/F-04 PASS) | `cfc0dc9901fe66e80ed1d307fdfa6a80370c34b8` |
| Arena 1 notification reliability implementation | `aaa98276efb92268536896f253b87d41d1420abd` |
| Arena 1 branch HEAD (implementation + audit + handoff docs) | `d212c667c431b05b7b1771c27212e9dc7f360d17` |
| Arena 2 F-01 providerRef / F-05 DNS-boolean remediation | `d228a369579636a66a59151411d687a3b569b660` (parent `7d703a3`) |
| **Merge 1 — Arena 1 into baseline** | **`32a2183d7b0f976c51f6a7f53c7e73cb342b9659`** (`08b8329` × `d212c66`) |
| **Merge 2 — Arena 2 remediation** | **`d1813e9be044cec4539dfb48c597dc544485098f`** (`32a2183` × `d228a36`) |
| **Transfer producer contract correction** | **`e70fd0b`** |
| Producer-suite flake fix; **final integrated code SHA** | **`fd6a32b5acffd295b62ca4d346c38f128f336043`** |

Ancestry facts verified before merging:

- Arena 1's branch is a **descendant of the prior docs HEAD** (`merge-base(08b8329, d212c66) = 08b8329`): Arena 1 built directly on `fe06ea8`, merged Arena 4's review record (`438afa1`), then committed the audit (`b476bb6`), implementation (`aaa9827`) and handoff (`d212c66`). Merge 1 was therefore content-fast-forward with **zero conflicts** (recorded as a `--no-ff` merge commit to preserve both parentages).
- Arena 2's remediation branches from `7d703a3` (already an ancestor of the combined app): `merge-base(32a2183, d228a36) = 7d703a3`. Merge 2 applied exactly Arena 2's 17-file delta (+1685/−64).
- No reset, rebase, force-push, or sibling-branch modification at any point; all sibling tips re-verified untouched after pushes.

### Conflict resolution summary (Merge 2)

Conflicts arose in exactly the two files Arena 1 rewrote and Arena 2 patched in their pre-rewrite form:

1. `src/notification/notification-dispatcher.service.ts` — Arena 2's hunk wrapped `providerRef` sanitization around the OLD synchronous send flow; Arena 1 moved sending out of the dispatcher into the new `NotificationDeliveryProcessor` (materialize-in-transaction, send-after-commit). **Resolution: keep Arena 1's durable model; re-apply Arena 2's sanitization semantics at the new persistence seam** (see 2 below).
2. `src/notification/notification-worker.service.ts` — Arena 2's hunk wrapped the OLD retry path; Arena 1's worker delegates retries to the processor with lease fencing. **Resolution: keep Arena 1's worker; sanitization applied at the processor boundary.**
3. `test/v1-notification-provider-configuration-01.integration.spec.ts` auto-merged textually but was **semantically incompatible**: Arena 2's new F-01 test 13 fixture predated Arena 1's model (contacts seeded without `verified_at`; `transfer.completed` dispatch payload missing `destinationCustomerId`, which Arena 1's dual-recipient guard requires). **Resolution: fixture-only reconciliation** — added `verified_at NOW()` to the seeded contacts and `destinationCustomerId: custId` (self-transfer dedupe keeps the expected 2 SMS+EMAIL deliveries). **No Arena 2 sentinel assertion was weakened or removed.**

### Cross-branch semantic seam (mission task 4)

`src/notification/notification-delivery-processor.ts` (Arena 1's new send/persistence path, unknown to Arena 2 at remediation time) now applies Arena 2's `sanitizeProviderRefForBoundary(result.providerRef, provider.name)` before `finish()` persists `notification_deliveries.provider_ref`. Combined with Arena 2's adapter-level opaque conversion (Robase/Brevo/Resend derive `pvr1:<vendor>:<32-hex>` keyed-HMAC refs at the source), test-send/status/overview/audit/log boundaries, `sanitizeVendorSendResult` on runtime send delegation, and the additive startup normalization of historical `last_test_provider_ref`, **every write path into persisted provider references is sanitized**. Producer-suite test 1 proves the processor seam end-to-end (a non-conforming synthetic harness ref is persisted only as an opaque `pvr1:` token).

---

## 2. What was integrated

### Arena 1 — notification reliability & privacy foundation (54 files, +3341/−1141 vs baseline)

- Independent `notification.v1` subscription on `notification_outbox_receipts` — never reads/mutates shared `outbox_events.status/attempts/published_at/last_error`; receipts have no cascading outbox FK; row-lock + `SKIP LOCKED` materialization; deliveries+receipt commit in one transaction, provider calls only after commit; bounded 5 materialization attempts → quarantine; replay converges on `(event_key, recipient_id, channel)`.
- `notification_delivery_attempts` + unique lease tokens fence concurrent workers; expired `CLAIMED` (no send started) may retry within cap; expired `STARTED`, provider timeout, or indeterminate post-provider write → `UNKNOWN`, **never auto-resent**; explicit permanent/exhausted → `DEAD`; explicit 4xx (except 408/409) bounded-retry.
- New `notification-delivery-processor.ts` owned send path; dispatcher/worker rewritten around it; `NormalizingSmsNotificationProvider` (Nigerian E.164 convergence, wrapping the configurable SMS token — Arena 2's adapters untouched); verified-contact + explicit-true-preference resolution, fail-closed lookups; allowlisted event-specific payload projections; redacted console simulators; email subject/body/HTML snapshots with retry fidelity; `GET /internal/notifications/outbox-receipts` under existing `notification.view_deliveries`.
- Forward-only migration `1785753600101-NotificationReliability`; production schema-compatibility marker advanced to 0101.

### Arena 2 — F-01 providerRef opacity + F-05 required Brevo DNS booleans (17 files, +1685/−64)

- F-01 (A4 HIGH): successful vendor identifiers (`id`/`messageId`) no longer returned, logged, audited, or persisted raw. Domain-separated keyed HMAC-SHA256 opaque tokens `pvr1:<vendor>:<32-hex>` derived in each adapter; boundary sanitizer idempotent for already-opaque tokens; strict rejection of non-string/whitespace/control-char/>512-char vendor IDs without raw truncation; read-side audit projection sanitizes historical `providerRef`/`lastTestProviderRef` without mutating immutable `audit_events`; additive startup DB normalization of `last_test_provider_ref`.
- F-05 (A4 MEDIUM): `spfConfigured`/`dkimConfigured`/`dmarcConfigured` are **required strict JSON booleans on Brevo proposals** (400 + zero DB/audit mutation when omitted or mistyped; verified in merged source at the controller parse boundary); non-Brevo providers keep them optional (no over-restriction); Admin Web submits explicit `false` values.
- Permanent adversarial regressions: 2xx credential/financial sentinels across Robase/Brevo/Resend over HTTP, FULL status, overview, DB columns, delivery rows, audit JSON and captured logs (integration test 13), plus unit and Admin Web coverage.

### Arena 3 — transfer producer contract correction (commit `e70fd0b`, 4 files +646/−18)

**Defect (confirmed by inspection):** the audited `TransferService` emitted `transfer.completed` with only `{transferId, journalId, paymentReference}` and `transfer.failed` with only `{transferId, failureCode}`. `mapEventToIntents` therefore produced **zero notification intents** and Arena 1's subscriber quarantined every authoritative transfer event (`NO_NOTIFICATION_INTENTS`). Meanwhile `transfer-lifecycle.service.ts` already emitted the full v1 contract via `buildInternalTransferCompletedEvent`.

**Smallest correct change, authoritative state only:**

- `transfer-events.ts`: added `INTERNAL_TRANSFER_FAILED_EVENT_TYPE`, `transferFailedEventKey()`, and two v1 payload builders for the audited path. The completed-event builder mirrors the full `InternalTransferCompletedEvent` v1 shape from the **persisted Transfer entity plus the pessimistically-locked wallets' customer ids** (entity-owned nulls — `commandId`, ledger account ids, `accountingUnit` — faithfully stay null, so the existing transfer-reconciliation exact payload comparison remains satisfied); the legacy `paymentReference` field is retained for existing operational consumers. The failed-event builder carries recipient identity, committed `amountMinor`/`currency`, the stable machine `failureCode`, and an 8-hex public reference derived from the transfer id — **no journalId (none exists for failures), no failureMessage prose, no PIN/secret, no settlement or cash-handover inference**.
- `transfer.service.ts`: completion and all five `markFailed` call sites now emit via `enqueueOnce` with the versioned identity — stable `eventKey` (`transfer.completed|failed:<id>:v1`), `schemaVersion 1`, `RESTRICTED_FINANCIAL`/`A5_TRANSFER_EVENT` classification, `correlationId transfer:<id>` — **inside the same SERIALIZABLE transaction** as the financial state. Recipient ids come from the locked wallet rows (`sourceWallet.customerId`/`destinationWallet.customerId`), never client payload. Wallet customer ids are opaque references; non-customer/system wallets are passed through unchanged and the consumer resolves, suppresses, or quarantines safely. **No transfer amount, fee, ledger posting, limit, commercial-snapshot, or reconciliation logic was altered.**
- Replay semantics: idempotent `createTransfer` replay converges on the same transfer/event/journal (proven); `enqueueOnce` + the unique `event_key` index make duplicate emission structurally impossible.
- Audience semantics preserved: completed → source AND destination SMS (self-transfer deduped by the consumer); failed → source only. Both are the consumer's existing contract, not producer-side invention.
- Privacy: notification payloads are allowlist projections — `journalId`, `paymentReference`, `requestHash`, narration prose, and PIN-like content provably never enter delivery payloads or rendered messages (asserted with sentinels in the new suite).

**Product/policy blockers documented, not invented:** deposit/withdrawal, agent cash-in/out, C2C claim/expiry, and support audience/status producer contracts remain product-owner decisions (per Arena 1's handoff); no automatic C2C expiry disposition; D-01/D-04 compliance policy untouched.

**New producer-shaped real-PG suite** `test/transfer-notification-producer-01.integration.spec.ts` (4 tests, all passing): drives the real `TransferService` (SERIALIZABLE, real ledger) through the real Arena 1 subscriber/dispatcher/processor chain with synthetic recording providers — v1 contract emission from authoritative state; both-audience materialization with distinct E.164 destinations (`+2348030000001/2`); sender-only failure notices; replay/re-drain convergence with zero duplication; exactly one balanced journal for completion and zero for failure (no double posting); atomic rollback when the outbox enqueue fails (no half-committed producer state); shared-outbox row byte-identical across consumer runs; opaque `pvr1:` provider refs via the processor seam; journal/payment/requestHash/prose/PIN sentinel non-disclosure; legacy zero-recipient payloads still quarantined (the consumer never guesses).

---

## 3. Mission verification matrix

| # | Requirement | Status / evidence |
|---|---|---|
| 1 | Branch tips, ancestry, overlap, working-tree safety before merging | ✓ all SHAs ls-remote-verified and fetched by SHA; merge-bases `08b8329`/`7d703a3`; overlap = exactly dispatcher/worker/provider-config-spec; tree clean pre-merge |
| 2 | Merge both branches, no reset/rebase/force-push | ✓ merges `32a2183`, `d1813e9`; only fast-forward pushes to the pinned branch |
| 3 | Conflicts preserve BOTH Arena 1's durable model and Arena 2's controls | ✓ resolution summary above; both models proven by passing suites |
| 4 | Arena 2 providerRef sanitization on the new processor path + dispatcher/worker/test-send/status/audit/logs | ✓ processor seam added; adapters sanitize at source; A2 boundaries intact; producer test 1 asserts `pvr1:` persistence |
| 5 | Provider refs safe across historical reads, startup normalization, retries, UNKNOWN/DEAD | ✓ startup `last_test_provider_ref` normalization; read-side audit projection; retry path asserts pvr1 (test 13); residual caveat in §6 |
| 6 | Independent `notification_outbox_receipts`; no cross-consumer shared-outbox ack/mutation | ✓ zero `UPDATE outbox_events` in the subscriber; reliability suite + producer suite assert byte-identical shared rows |
| 7 | Atomic materialization, idempotency, claim fencing, bounded retries, UNKNOWN handling | ✓ reliability suite passed (lease fencing, expired-STARTED→UNKNOWN without resend, bounded attempts) |
| 8 | Nigerian E.164 normalization, verified contacts, explicit preferences, redacted console logs | ✓ normalizing wrapper in dispatch path (producer suite asserts `+234…` at transport); verified-contact fail-closed; direct-security-logging suite passed |
| 9 | Brevo SPF/DKIM/DMARC required booleans + Admin Web explicit false | ✓ source-verified (required iff Brevo); admin-web 27/27·188 incl. explicit-false tests; F-05 integration coverage in suite test 12/14 |
| 10 | F-02 pinned egress, F-03 atomic quota, F-04 MINIMAL, authorization, MFA, maker-checker, encryption, P0-01/02/03 preserved | ✓ provider-configuration suite (role matrix, quota concurrency reproducer, MINIMAL schema, lifecycle/MFA/self-approval) + compliance/delivery/diagnostics/limits suites all passed |
| — | Migration chain through 0101, 0100→0101 upgrade, production marker, non-destructive, legacy handling | ✓ migration-chain, notification-migration-upgrade-01, v1-release-01 production-readiness sync suites passed; migration reviewed as additive-only with explicit legacy quarantine semantics; forward-only down migration intentional |
| — | Transfer contract correction + producer-shaped tests | ✓ commit `e70fd0b`; suite 4/4 |

---

## 4. Regression evidence (integrator's own execution, sandbox, embedded PostgreSQL 18.4, synthetic providers only)

| Gate | Result |
|---|---|
| Backend `npm run build` | PASS |
| Backend `npx tsc --noEmit` | PASS |
| Backend complete unit suite | **206/206 suites · 2076/2076 tests PASS** |
| Admin Web `ts:check` / tests / build | PASS · **27/27 · 188/188 PASS** · PASS (Vite large-chunk advisory persists) |
| Producer suite (new, run id `trnotp2`) | **1/1 · 4/4 PASS** |
| Coordination batch (run id `intbat1`): provider-configuration-01 (F-01..F-05 + test 13 + reconciled fixtures), notification-reliability, a5-payment-lifecycle, v1-005 delivery, email-01 | **5/5 suites · 113/113 PASS** |
| Migration/diagnostics batch (`intbat2`): notification-migration-upgrade-01, migration-chain, hardening-09 diagnostics, compliance-authorization, a5-transfer-lifecycle | **5/5 · 77/77 PASS** |
| Surface batch (`intbat3`): sprint1-delivery-authorization, notification-registry, sms-v1-01, v1-006 inbox, v1-release-01 production-readiness/migration-sync | **5/5 · 66/66 PASS** |
| Complete sequential PG suite — first attempt (run id `fullint1`, log `full-pg-reliability-integration.log`) | 123/124 files passed; the single failure was the integrator's OWN new producer-suite assertion (`Ref [0-9a-f]{8}`) hitting the template guard that deliberately rejects >=6-digit hex references — a UUID-prefix-dependent test flake, NOT an application defect (see below) |
| Batch-8 in-band recomposition after fix (`batch8rp`, exact 15-file batch) | **15/15 suites · 236/236 PASS** |
| **Complete sequential PG suite — FINAL on final code** (run id `fullint2`, `PG_TEST_CONCURRENCY=1`, log `full-pg-reliability-integration-final.log`) | **124/124 files · 2351/2351 tests PASS · 0 failures** ("all passed"; every batch exit 0; ~50 minutes) |

Per-batch results (final run `fullint2` on `fd6a32b`):

| Batch | Files | Tests |
|---|---|---|
| 1/9 | 15 passed | 515 passed |
| 2/9 | 15 passed | 561 passed |
| 3/9 | 15 passed | 279 passed |
| 4/9 | 15 passed | 224 passed |
| 5/9 | 15 passed | 170 passed |
| 6/9 | 15 passed | 206 passed |
| 7/9 | 15 passed | 188 passed |
| 8/9 | 15 passed | 188 passed |
| 9/9 | 4 passed | 20 passed |
| **Total** | **124 passed** | **2351 passed** |

The one intermediate failure is recorded for transparency: the rendered message was `Transfer of NGN 120.00 completed. Ref your request.` — the template's public-reference guard (`digitCount < 6`) intentionally rejects 8-hex references dominated by digits (financial-identifier shape) and falls back to the safe default. The application behaved correctly; the test assertion was over-specific. Fixed in `fd6a32b` to assert the real contract (`Ref (?:[0-9a-f]{8}|your request)`), verified 3× isolated and via the full 15-suite batch-8 recomposition, then the complete sequential run was repeated end-to-end on the final code.

Constraints honored: no real Robase/Brevo/Resend keys or live vendor requests (fake/local transports only), no provider activation outside test databases, no production migration or deployment, no mobile work, D-01/D-04 untouched, no automatic C2C expiry disposition, sibling branches unmodified.

---

## 5. Changed-file summary

- Merge 1 (`32a2183`): Arena 1's 54 files (+3341/−1141) — notification core (dispatcher/worker/processor/resolver/templates/entity/module), new receipt & attempt tables via migration 0101, admin diagnostics controller, direct-security callers, production-readiness marker, 15 test files, plus Arena 4's review doc and Arena 1 audit/handoff docs.
- Merge 2 (`d1813e9`): Arena 2's 17 files (+1685/−64) — provider-security HMAC module (+181), three adapters, config service/controller, admin provider controller, dispatcher/worker seam hunks (re-applied at the processor), audit.service read-side projection, admin-web domain/workspace/tests, four test files.
- Producer correction (`e70fd0b`): `src/transfer/transfer-events.ts`, `src/transfer/transfer.service.ts`, `test/v1-notification-provider-configuration-01.integration.spec.ts` (fixture reconciliation), new `test/transfer-notification-producer-01.integration.spec.ts`. Flake fix (`fd6a32b`): the producer spec only (+4/−1).

---

## 6. Unresolved items, residual risks, and limitations

- **Arena 4 independent acceptance is required** — this record is integration evidence, not acceptance. Handoff SHA below.
- **Residual F-01 surface (theoretical, pre-production):** historical `notification_deliveries.provider_ref` rows written by pre-F-01 builds would surface verbatim through the authorized delivery-diagnostics read (read-side normalization there was deliberately NOT added because it would rewrite the exact-value assertions of the existing hardening-09 suite — an assertion-weakening change requires Arena 4/product direction). No production rows can exist in this state: providers were never activated outside tests, and all write paths are now sanitized at the adapter AND boundary. Arena 2's audit-read projection and startup `last_test_provider_ref` normalization cover the surfaces Arena 4 actually observed leaking. Flagged for Arena 4's disposition.
- Carried-forward open decisions remain open and unclaimed: D-01, D-04, per-worker customer assignments, global case-number collision (409 oracle), notification dark-launch limits, scoped-audit surface design, provider-activation prerequisites, unknown-non-notification-event quarantine noise (subscription filter ownership), receipt/retention/legal-hold/alerting/redrive design, scheduled-event not-before contract.
- Arena 1's own validation was partial on full PG (24 suites/797 tests before timebox) and Arena 4's last sequential run reached 77/122 files under its 30-minute cap; the complete-run evidence here is from the integrator's environment (~50 minutes for 124 files, serial) only.
- Browser UAT not performed; Admin Web evidence is typecheck/tests/build. Lint gate still fails at pre-existing baseline (four known `customer-registration.service.ts` errors documented by Arena 1; per-file parity not worsened).
- Vite large-chunk (1.24 MB) and dev-tool `npm audit` advisories (deepmerge/esbuild/vite; 0 production-dependency vulnerabilities) persist from Arena 4's review — build/supply-chain hygiene items, not application findings.
- Test counts are exclusively from the integrator's execution on the integrated tree.

---

## 7. Arena 4 handoff

- **Review target (integrated application SHA): `fd6a32b5acffd295b62ca4d346c38f128f336043`** — branch `arena/8e59e188-monienaija`, pushed (this record is committed as its child).
- Merge parents: `32a2183` = `08b8329` × `d212c66`; `d1813e9` = `32a2183` × `d228a36`; producer correction `e70fd0b` on top.
- Suggested focus: F-01 2xx sentinel battery incl. the new processor persistence path and the residual diagnostics-read caveat above; F-05 missing/mistyped/false Brevo DNS booleans (API + Admin Web); F-02/F-03/F-04 re-probes on the rewritten worker/dispatcher wiring; shared-outbox isolation and receipt independence; lease-fencing concurrency (expired CLAIMED vs STARTED→UNKNOWN, no auto-resend); email retry snapshot fidelity; transfer producer contract (v1 emission, both audiences, sender-only failures, replay convergence, atomic rollback, accounting invariants, reconciliation payload exactness); migration 0100→0101 upgrade + legacy quarantine semantics + production marker; complete sequential PG run to completion.
