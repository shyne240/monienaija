# Mission 25C — Notification backend security and completeness remediation

**Date:** 2026-10-31. **Scope:** backend-only remediation and disposable PostgreSQL testing; no Admin Web implementation, live vendor delivery, production migrations/deployment, merge, or new product policy. The detailed frontend handoff is [Mission 25C Arena 2 contract](20261031-MISSION-25C-ARENA2-CONTRACT.md).

## A. Baseline and branch

- User-pinned baseline: `integration/mission-23-fast-uri-security` commit `019de996950b07e9312af455ce0d9b840e6e14f1`. It is an ancestor of the verified remote tip below.
- Assigned branch: `arena/92fd33dd-monienaija`. Its remote tip is `c6ff1f5cec15deb656f781aae36e5d3be937fb47`, the prior **documentation-only Mission 25A** commit. There is no Mission 25C implementation commit or pushed implementation SHA.
- The restored local branch currently points to `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`, not the remote tip. Its Git index is correspondingly stale and the working tree is not clean. A verification-only temporary index against the remote tip identified 17 modified tracked files and the five original untracked 25C files; this reporting-only evidence document is an additional untracked file. No branch ref, repository index, implementation file or commit was changed, and no push or merge was performed during this reporting request.
- The remediations described here are **uncommitted working-tree changes**, not a delivered commit. Integrators must not treat the prior 25A SHA as the 25C implementation SHA. No history was reset/rebased/force-pushed, and no other branch was changed.

## B. Defect matrix

| ID | Baseline finding and evidence | 25C disposition and verification |
|---|---|---|
| H-01 | Governed provider reads could fall back to legacy environment credentials, and caches could advertise an environment provider before governance was known. | **FIXED for the identified routing bypass:** required governance dependency, dark initial cache, validated DB rows, sanitized 503 on unreadable/corrupt data, disabled/missing/incomplete external configuration fails closed on normal sends and controlled test-send. Currently resolved rotated or decrypted credentials are format-checked again without exposing values; missing endpoints and invalid sender/reply-to metadata cannot reach a transport. An explicitly enabled governed `ENV_SECRET` remains supported; non-production console is simulation only. No silent vendor fallback. H-07 is a separate unresolved exact-secret-binding limitation. |
| H-02 | Admin delivery diagnostics projected historical raw correlation/causation, and outbox/event/adapter paths passed unsafe identifiers. | **FIXED at relevant boundaries:** sanitize IDs and errors at write/read/log boundaries, historical provider-test destination and actor projections, plus identifier-shaped fields in shared outbox diagnostic payloads. UUIDs and safe IDs remain useful; authoritative event keys and stored business payloads are not rewritten for display. Real authorized/unauthorized HTTP and fake provider success/error tests cover sentinels. This is bounded pattern/key-based diagnostic protection, not a claim to identify every possible secret embedded in arbitrary prose. Historical rows are not globally backfilled. |
| H-03 | The public-support producer omitted `isInternal:false`, while the consumer correctly rejected unknown visibility. | **FIXED without relaxing isolation:** new public facts carry the explicit marker and a message-derived canonical key; internal notes emit no fact. Subscriber and direct dispatcher verify the committed public message, author and ticket/recipient binding under locks, never select the message body, and quarantine malformed/forged/unknown events. PostgreSQL producer-to-consumer, unauthorized author, forged recipient, private message and duplicate-key tests pass. Historical unmarked facts remain quarantined and are not automatically replayed. |
| H-04 | `deposit.completed`, `deposit.failed`, `withdrawal.completed`, `withdrawal.failed` exist as domain facts but have zero notification mappings; the audit also found Agent cash-in/out and C2C outcome producer gaps. | **BLOCKED — product/security decision and Arena 3 ownership required.** The deposit/withdrawal facts carry `{depositId,journalId}` or `{depositId,failureCode}` and analogous withdrawal fields, not an approved generic customer recipient/channel/content contract. Ordinary Agent cash-in UAT does not authorize generic deposit/withdrawal messages. No speculative mapping, preference exception, journal disclosure, template, duplicate Arena 3 producer, or live send was added. Subscriber quarantines the four unsupported types. |
| H-05 | Temporary-credential response claimed delivery even when sending failed. | **FIXED:** retain the legacy delivery fields while adding `deliveryStatus` and a truthful notice for `NOT_CONFIRMED`, `SIMULATED`, and `PROVIDER_ACCEPTED`. Console results carry an internal simulation marker even if the cached name is stale. Legacy audit action is retained for compatibility with a new truthful `deliveryStatus` metadata field. Provider acceptance is not handset receipt. Fake success/failure tests and real-PG credential tests cover this; plaintext is never added to responses/audit. |
| H-06 | Admin Web's static funding/transfer locks conflict with backend's ordinary-event seed and tests. | **BLOCKED — D-N8:** the old audit recommended additional locks but did not approve which transactional events must be locked. The backend contract explicitly records ordinary events as initially toggleable and its governed test permits a funding change; UI static claims three are locked. No unapproved lock or unlock was invented. Existing SECURITY locks, transaction integrity, MFA and maker-checker remain intact. |
| H-07 | Separate pre-existing governance limitation: an approved `ENV_SECRET` proposal stores only a display fingerprint; activation rereads the environment and runtime continues to read it. A valid-shaped environment secret can change outside the proposal and the four-character display suffix is not a cryptographic binding. | **BLOCKED — Arena 2/security ownership:** this mission preserves the existing governed `ENV_SECRET` mechanism and does not claim that an approval cryptographically binds the exact secret across rotation. Define and implement a separately reviewed secret-rotation/binding design before production use; do not treat a fingerprint as proof of independent approval. |
| M-01 | Support status producer supplies `to`, but the template previously looked only for `status`/`newStatus` and did not use the ticket reference. | **FIXED:** allowlisted `to` and safe short ticket reference render without actor or message disclosure; focused tests cover valid and hostile input. |
| M-02 | In-app inbox is a projection of non-skipped SMS/email rows, ignores the in-app preference and can duplicate an event or show a failed delivery as available. | **UNRESOLVED / POLICY BLOCKED:** no independent in-app delivery, preference or deduplication policy was invented. The existing projection remains. |
| M-03 | Agent contact resolution and PUSH token/provider infrastructure are absent. | **UNRESOLVED / DEPENDENCY:** Agent legs can be skipped and PUSH cannot be represented as delivered. Requires approved Agent contact and device lifecycle design. |
| M-04 | Read-only auditor cannot use the unsafe-method preview POST, and UI/backend preview samples differ. | **HANDOFF / POLICY BLOCKED:** preserve the existing read-only restrictions and Mission 19A exception; Arena 2 must reconcile samples. No broad POST exemption was added. |
| M-05 | Admin Web omits `UNKNOWN`/`DEAD` from useful filters and counters. | **UNRESOLVED / ARENA 2:** the backend exposes the states; no Admin Web files were changed. |
| M-06 | Stored login/device/transaction alert preferences do not establish corresponding notification producers. | **UNRESOLVED / POLICY BLOCKED:** do not infer mandatory security alerts or duplicate Arena 3 producers without an approved contract. |
| M-07 | Provider receipt, bounce and complaint integrations and operational procedures are incomplete. | **UNRESOLVED / OPERATIONS:** no real receipt evidence or webhook was added; `SENT` is provider acceptance or simulation, not end-user receipt. Preserve `UNKNOWN` and retry protections. |
| L-01 | Historical notification contracts and D8 descriptions may be stale. | **DOCUMENTED:** the companion handoff is based on inspected source; Ordinary Agent D8/D9 and C2C locator/release decisions remain open. |
| L-02 | Event classification and service ownership lack a single authoritative catalogue. | **UNRESOLVED / COORDINATION:** catalogue and aliases are documented, but ownership and `transfer.unknown` production require Arena 2/Arena 3 decisions. |

Fail-closed provider checks occur before a send/attempt, but a disable cannot cancel an external request already in flight. The worker defaults off; `SENT` means provider/adapter acceptance (or local simulation), not end-user receipt. No test establishes vendor account, sender-domain authorization, real DNS status, real provider acceptance, receipt, bounce or complaint handling.

## C. Changed files

- `src/notification/notification-provider-config.service.ts`: fail-closed governed routing/cache, validated reads, safe provider snapshots, masked historical test destinations/actor identifiers, explicit console simulation result.
- `src/admin/admin-notification-provider.controller.ts`: mandatory governance dependency, removal of environment-only status fallback, preflight before test-send quota/provider access; existing audit, quota and provider-reference protections preserved.
- `src/admin/admin-notification.controller.ts`, `src/common/sensitive-data-redaction.ts`, `src/operations/outbox.service.ts`: bounded diagnostic identifiers/errors and historical API read masking with symmetric sanitized idempotency comparisons; no stored event identity or financial payload rewrite.
- `src/notification/brevo-email-provider.ts`: only diagnostic event/correlation/recipient log redaction; egress/vendor behavior unchanged. **Coordinate this overlap with Arena 2 F-01/F-05.**
- `src/notification/notification-dispatcher.service.ts`, `src/notification/notification-event-map.ts`, `src/support/support.service.ts`: explicit public marker, source-message verification, authoritative recipient binding, message-key idempotency and safe quarantine.
- `src/notification/notification-template.service.ts`: safe support status/reference resolver. `src/notification/notification.types.ts`: additive simulation marker on internal provider results.
- `src/admin/admin-customer-credentials.controller.ts`: honest credential-delivery response and audit metadata, retaining direct secret-send behavior and legacy fields/action.
- New `test/mission-25c-provider-routing.spec.ts`, `test/mission-25c-notification-diagnostics.spec.ts`, `test/support/mission-25c-network-guard.cjs`; extended real-PG `notification-reliability`, `v1-005`, `v1-006`, `v1-email-notification-01`, and `v1-customer-credentials-01` suites. The guard is test-only and not an OS firewall.
- This report, the Arena 2 contract and the reporting-only test-evidence handoff. No migration, financial posting, authorization catalogue or Admin Web file is changed. Tests exercised synthetic governance/configuration in isolated databases only; no real external provider was activated.

## D. Arena 2 contract and coordination

The [separate contract](20261031-MISSION-25C-ARENA2-CONTRACT.md) lists exact event names/aliases, classifications, channels/recipients, variables, locks, production-versus-simulation distinctions, provider/test-send states, delivery/receipt statuses, API envelopes and error behavior. It supersedes the older *proposed* Admin DTO for this backend snapshot. Arena 2 owns its UI and F-01/F-05; reconcile overlapping hunks in `admin-notification-provider.controller.ts`, `brevo-email-provider.ts`, and `notification-provider-config.service.ts` without losing either agent's fixes. Arena 3 owns integration and overlapping business-event producer/authorization work. This document is coordination, not proof that those agents have integrated the changes.

## E. Test evidence

See the [Mission 25C test-evidence handoff](20261031-MISSION-25C-TEST-EVIDENCE.md) for scope, skipped-test accounting and limitations. The completed command results below were recorded in the session; raw `/home/user` test logs and the last in-flight process did not survive the environment restoration and are not independently available now.

| Check | Actual result and timing |
|---|---|
| Full root unit suite with the final network guard, `npm test` | **228 suites / 2,701 tests passed, exit 0.** Includes provider fakes, diagnostic masking, templates, security and authorization units. |
| Real-PG broad serial notification, provider, support, migration, authorization and Ordinary Agent regression | **26 suites / 524 tests passed, exit 0**, in nine batches (`90, 133, 58, 39, 47, 30, 87, 24, 16` tests). This broad run preceded the final resolved-secret/metadata validation hardening; targeted post-hardening runs below supersede it for those changes. |
| Post-hardening PG financial lifecycle, provider configuration and email HTTP | The first three-suite batch **79/79 passed, batch exit 0**, including `a5-payment-lifecycle`, provider governance and malformed rotated-secret HTTP preflight. The encompassing six-suite command exited 1 because the additional quarantine fixture had increased an old expected count; no implementation failure was implicated. |
| Corrected post-hardening PG quarantine, credential and registry rerun | **3 suites / 39 tests passed, exit 0.** This verifies all four blocked financial facts quarantine without deliveries and preserves the credential/registry tests. |
| Final-guard real-PG provider, HTTP and reliability rerun | **3 suites / 57 tests passed, exit 0**, after correcting that expectation and hardening the guard's promise-based DNS interception. |
| Final-guard real-PG Agent and authorization subset | **Outcome unknown, not counted as passed or skipped.** A seven-suite rerun was started, but the process and its log were unavailable after the session environment was restored. The earlier 26-suite/524-test run did include Agent and authorization suites, before the final provider hardening. |
| `npx tsc --noEmit`; `npm run build` | Both **exit 0** after the implementation changes. |
| Selected ESLint | **14 baseline-clean changed files, exit 0.** A separate five-file comparison has **215 existing errors before and 215 after, zero added by rule/message**; the legacy-file ESLint invocation itself exits 1. Whole-repository lint is not claimed to pass. |
| `git diff --check`; disposable DB cleanup | Diff check **exit 0**. Immediately before the final Agent/auth rerun, the isolated database reported PostgreSQL 18.4 / UTF8 and no non-system databases remained. Cleanup after that last rerun cannot be independently verified because the process and disposable environment are no longer available. |

The initial focused-unit invocation also included one mistyped nonexistent test path and one wrong fake-provider fixture; both were corrected, and the subsequent focused run and final full suite passed. The test-only guard self-test allowed loopback and rejected external socket, promise/callback DNS resolution and fetch; its SHA-256 is `0efeb688e4caf17b351e6221d3619b945d6b88542066214eb431cb1ff3e4df18`.

Reproduction shape (first point `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_ADMIN_NAME` and `DB_NAME` at a **disposable local test cluster**, never production):

```sh
export NODE_ENV=test NODE_OPTIONS="--require=$PWD/test/support/mission-25c-network-guard.cjs"
npm test
PG_TEST_RUN_ID=m25cverify PG_TEST_BATCH_SIZE=3 PG_TEST_CONCURRENCY=1 \
  node scripts/run-pg-integration-tests.js --runTestsByPath \
  test/v1-email-notification-01.integration.spec.ts \
  test/v1-notification-provider-configuration-01.integration.spec.ts \
  test/notification-reliability.integration.spec.ts
npx tsc --noEmit
npm run build
```

Safety: all exercised providers used fakes or console simulation; Node tests were preloaded with `test/support/mission-25c-network-guard.cjs`, permitting loopback and the disposable PostgreSQL socket while blocking the tested external socket/fetch/DNS paths. It is not an OS-level firewall or a proof about unrelated native subprocesses. PostgreSQL was an isolated UTF-8 18.4 cluster on loopback port 55432 using synthetic credentials. The repository harness creates run-namespaced temporary databases, applies the real migration chain, and drops only its own databases. There was no connection to a production database. No live SMS/email, external vendor activation, deployment or merge occurred.

## F. Remaining blockers and dependencies

1. **Product/security:** decide H-04's four generic deposit/withdrawal recipients, approved variables, channels, opt-out behavior, disclosure and requiredness. Do not infer policy from a fact or from ordinary Agent UAT.
2. **Product/security:** reconcile backend/UI transactional toggle rules and D-N8. Do not treat either stale UI text or a proposal as approval. Existing three SECURITY events remain locked and direct-only.
3. **Arena 2:** reconcile overlapping provider hunks and consume the contract, including actual `{items}` catalogue shape, `locator_clause`, redacted IDs, `503` unavailability, `UNKNOWN`/`DEAD`, simulated test sends and the credential `deliveryStatus`. No frontend changes are included.
4. **Arena 3/operations:** integrate against the actual current agent branches; review support legacy quarantines and migration/replay/idempotency before any owner-authorized recovery. Unmarked old support events remain quarantined; no automatic receipt reset or live replay has been performed. A historical delivery under an older noncanonical key needs explicit deduplication/reconciliation before replay.
5. **Owners:** resolve ordinary Agent D8/D9, C2C beneficiary/locator/release and other blocked product decisions separately; establish authoritative Agent contact model and PUSH design if required. Do not add financial settlement, physical handover, expiry refund/redistribution or fee policy here.
6. **Operations/security:** validate real vendor account, egress, sender identity, domain/DNS and delivery/bounce handling only under separately authorized, controlled readiness work. Provider enable/disable cannot recall an in-flight request. `SENT`, test-send success, and `PROVIDER_ACCEPTED` are not receipt verification.
7. **Arena 2/security:** resolve H-07 before relying on `ENV_SECRET` for live use. Maker/checker currently approves a proposal and a display-only four-character suffix, but does not cryptographically bind a mutable environment value at activation or on every send. This is independent of the fixed missing/disabled/read-failure bypass.

## G. Pushed SHA

Remote branch `arena/92fd33dd-monienaija` currently points to **`c6ff1f5cec15deb656f781aae36e5d3be937fb47`**, the prior documentation-only Mission 25A commit. **There is no pushed Mission 25C implementation SHA.** The local branch points to `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`, its restored index is stale, and the working tree is not clean. The 25C files are uncommitted. The reporting request expressly prohibits creating commits or merging; no push was performed.

## H. Verdict

**NOT READY FOR ARENA 3 INTEGRATION** — the implementation is uncommitted and unpushed; the restored local branch/index must be reconciled safely under appropriate authorization; the final Agent/auth rerun outcome is unknown; H-04, H-06/D-N8 and H-07 remain blocked; legacy support replay and cross-arena provider work require reconciliation. This is not a production-readiness, live-delivery or provider-activation claim.
