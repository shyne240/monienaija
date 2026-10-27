# ARENA 3 — SMS & Email Notification Integration Report (Arenas 1+2+3+4)

- **Date:** 2026-10-27
- **Branch:** `arena/8e59e188-monienaija` (pinned mission branch)
- **Mission baseline:** `5206d8f52b0deccba31149c6e600d9e0d774a6cb`
- **Final integrated application commit:** `33122fc` (this report is added by the documentation commit immediately following it; see §10 for the verification record)
- **Source arenas integrated (all verified as ancestors of HEAD):**
  | Arena | Branch | Head SHA | Subject | Merge commit |
  |---|---|---|---|---|
  | A1 | `arena/92fd33dd-monienaija` | `a254ba0` | DB-backed notification template registry + event configuration | `8883fc7` |
  | A2 | `arena/ea070127-monienaija` | `3b2b88d` | Admin Web notification management console | `fe54486` |
  | A3 | (this branch's own prior work) | `775e29f` | Email delivery infrastructure (provider, resolver, worker, APIs, migration 097) | pre-existing HEAD lineage |
  | A4 | `arena/870f970d-monienaija` | `ee39766` | Cash-to-cash beneficiary SMS + public agent locator | `84d7177` |

Post-merge integration commits: `06c5f76` (Phase 3 registry-bound email seam), `e13e6b1`
(Phase 2 upgrade-from-baseline proof), `1ec4e82` (Phase 5 Admin Web contract
reconciliation), plus this report.

---

## 1. Executive summary

All four notification arenas are merged into one coherent candidate and — critically —
**unified into a single template system**: SMS and EMAIL both render from the Arena 1
persistent registry (`notification_event_configurations` + `notification_templates`), the
Arena 4 cash-to-cash non-disclosure contract is enforced inside that registry's rendering
path (all channels), and the Arena 2 Admin Web console now talks to the real merged API
surface (no invented endpoints, no simulated persistence, honest BLOCKED states only where
a route genuinely does not exist — manual delivery retry).

Production posture is unchanged and safe by default:

- EMAIL is **dark by default** (`NOTIFICATION_EMAIL_PROVIDER=none`; registry seeds EMAIL
  event configurations **disabled**; production rejects `console`).
- Cash-to-cash **beneficiary notifications are not activated in production**: the SMS
  intent path exists and is tested, the locator requires an explicitly configured
  https URL (`CASH_TO_CASH_LOCATOR_URL`), and notification workers remain off in
  production configuration (`NOTIFICATION_WORKER_ENABLED` unset/false).
- Migrations 097–099 are additive and **have not been applied to any production
  database**; they were renumbered pre-release to a single correct ordering.

## 2. Phase 1 — Merge ledger & conflict-resolution record

Ordinary git merges only (`git merge --no-ff --no-commit`, resolve, validate, commit).
No resets of remote state, no rebases, no force-pushes, no cherry-picks; branch audit
documentation preserved (A1/A2/A4 docs + `docs/audit/20261027/*` arrived with the merges;
A3 docs pre-existing).

### A1 merge (`8883fc7`) — conflicts: dispatcher, worker
- `notification-dispatcher.service.ts`: kept the unified render block (EMAIL → A3 seam,
  SMS → registry `renderActive`, disabled → fixed safe message, PUSH → `buildMessage`);
  extended the registry enabled-gate to EMAIL rows.
- `notification-worker.service.ts`: union — registry suppression classes
  (SECURITY_DIRECT_ONLY / EVENT_DISABLED / UNSAFE_MESSAGE) extended to EMAIL rows;
  EMAIL re-render from `payload._templateKey` preserved; A3 optional constructor
  bindings kept backward-compatible (defaulted to null).
- Migration collision (both A1 and A3 used `1785753600097`): A1's registry migration
  renumbered to `1785753600098-CreateNotificationTemplateRegistry`.

### A4 merge (`84d7177`) — conflicts: types, delivery entity, dispatcher, template service, locator-contract spec
- `notification.types.ts` / `notification-delivery.entity.ts`: UNION — EMAIL channel (A3)
  + PHONE recipient type and `recipient_id` widened to varchar(255) (A4), @Check widened.
- `notification-dispatcher.service.ts`: UNION — A4's eventType-aware redaction at the top
  of dispatch; A1 registry-gated rendering + A3 EMAIL routing preserved.
- `notification-template.service.ts`: A1's registry-driven rewrite taken as the SINGLE
  template system base; A4's C2C non-disclosure contract **ported into the registry**:
  `redactPayload(payload, eventType)` applies the safe subset (senderDisplayName /
  amountMinor digits / NGN / https-only locatorUrl) before variable resolution on every
  channel/path; new allowlisted variables `sender_name` (control-stripped, 80-char,
  assertSafe-guarded, generic fallback), `amount` (committed principal only),
  `locator_clause` (https-validated, ≤240 chars, omitted not truncated);
  `validateTemplate` worst-case maxima extended.
- `notification-defaults-v1.ts`: `cash_to_cash.created` seeded body unified to the A4
  beneficiary contract — registry and beneficiary messaging cannot disagree (the frozen
  seed was corrected pre-release; migration 098 had not been applied anywhere).
- `test/cash-to-cash-locator-contract.spec.ts`: A4 version taken after diffing A1's
  change to the same file — A4's assertions are a strict superset.
- Auto-merges verified by inspection: resolver (PHONE + EMAIL branches coexist), worker
  (PHONE opt-out re-check via verified contact lookup coexists with EMAIL opt-out),
  event-map (dedicated `cash_to_cash.created` PHONE-intent block + A1 canonical template
  keys + A3's CUSTOMER-only 12-event EMAIL augmentation intact — PHONE recipients never
  receive EMAIL intents).
- A4 migration renumbered `1785753600097` → `1785753600099-AllowPhoneNotificationRecipients`.
- `src/notification/notification-worker-phone-recipient.spec.ts`: construction adapted to
  the merged 7-arg worker signature with a registry stub (assertions untouched) — the
  merged worker consults the registry before retrying SMS rows.

### A2 merge (`fe54486`) — clean
Frontend-only surface (`apps/admin-web` + contract doc); no backend overlap. Reconciled
against the real backend in Phase 5 (§6).

## 3. Phase 2 — Migration reconciliation

Final head chain: `…096-CreateCashToCashLocators → 097-AddEmailNotificationChannel (A3)
→ 098-CreateNotificationTemplateRegistry (A1) → 099-AllowPhoneNotificationRecipients (A4)`.

- Unique, correctly ordered ids; the 097 collision (A1 vs A3) resolved by renumbering;
  all references, readiness markers, fixtures and stale-head allowlists synced to
  `AllowPhoneNotificationRecipients1785753600099` (production-readiness service + spec,
  a8/a19/a20, v1-003, v1-007, v1-limit-02).
- **Clean install on real PostgreSQL:** `migration-chain.integration.spec.ts` builds an
  empty database through the whole chain atomically — zero pending, exact ledger,
  registry seeded (incl. locked SECURITY rows), FKs validated, entity metadata
  consistent.
- **Upgrade-from-baseline on real PostgreSQL:** new
  `notification-migration-upgrade-01.integration.spec.ts` (commit `e13e6b1`) builds the
  exact baseline schema (head 096), seeds pre-upgrade SMS/PUSH delivery evidence, proves
  EMAIL/PHONE rejected pre-upgrade, then applies the normal chain: exactly 097/098/099
  execute, legacy rows survive byte-identical through the `recipient_id` uuid→varchar
  widening, registry seeds with the correct posture (46 configurations = 23 events × 2
  channels; SMS enabled incl. locked SECURITY trio; EMAIL disabled everywhere; 40 active
  v1 templates).
- **Rollback behaviour:** 097 `down()` refuses while EMAIL delivery rows exist; 099
  `down()` refuses while PHONE rows exist and round-trips cleanly (uuid↔varchar) when
  none exist; 098 `down()` refuses once governed change history exists. All proven on
  real PostgreSQL in the upgrade spec.
- No applied production history was altered (none of 097–099 has run in production);
  renumbering happened pre-release. No production migrations were executed by this
  mission.

## 4. Phase 3 — Unified notification backend

**One template system.** The A3 EMAIL seam (`NOTIFICATION_EMAIL_TEMPLATE_TOKEN`) was
rebound to the A1 registry (commit `06c5f76`):

- `NotificationEmailTemplateLookup.buildEmail(templateKey, payload, query?)` is async and
  query-aware. With a persistent query (dispatcher queryRunner / worker DataSource) the
  **ACTIVE approved EMAIL version** from `notification_templates` controls subject AND
  body — identical governance to SMS (maker-checker change requests, locked SECURITY
  class, guard triggers, partial unique index on active versions).
- **Fail-closed:** missing ACTIVE version, duplicate/absent configuration, or registry
  outage throws → delivery row FAILED → bounded worker retry. Code defaults are NEVER
  silently substituted in production dispatch (they remain only for no-DB unit contexts,
  byte-identical to the seeded registry defaults). Proven by email-01 test 23.
- Event/channel enablement gates dispatch for SMS **and EMAIL** (`EVENT_DISABLED` →
  SKIPPED with fixed safe message; proven by email-01 test 22).
- Code-defined variable allowlists + real `assertSafe` validation (A1 fixed the former
  no-op validator, **F-S1**); unknown events fall back to a generic message, never
  internal event names (**F-S3**); SECURITY-class events are locked at DB-trigger level
  and refused by the registry service.
- A4's C2C redaction is unified INTO registry rendering (`render()` →
  `redactPayload(payload, eventType)`) — raw cash-to-cash payloads (transfer number,
  sender phone, secret code, transaction refs, beneficiary phone) never reach variables,
  delivery rows, or providers on ANY channel.
- Retries never repeat financial operations: the worker touches only
  `notification_deliveries` (FOR UPDATE SKIP LOCKED); financial idempotency proven
  separately (a15 replay/concurrency tests, now including a single-outbox-event
  assertion for cash-to-cash replays).
- Provider acceptance vs confirmed delivery: provider statuses record provider
  acceptance (`provider_ref`, SENT) only; no receipt/webhook tracking exists — surfaced
  honestly in the console as `ACCEPTED_BY_PROVIDER_ONLY`.
- EMAIL disabled by default at three layers: env provider `none` (zero EMAIL intents),
  registry EMAIL configurations seeded disabled, worker EMAIL binding fails closed.
- Provider credentials are inaccessible to ordinary Admin Web users: provider-status /
  test-send require catalogue function scopes (`notification.view_deliveries` /
  `notification.test_send` — SUPER_ADMIN/OPERATIONS); responses carry masked fingerprints
  only (email-01 tests 13–21 assert zero key material anywhere).

## 5. Phase 4 — Cash-to-cash beneficiary notifications

Verified (not invented) from the merged A4 implementation + tests:

- **Exactly one transactional event per initiation:** `enqueueOnce('cash_to_cash.created:'
  + transferId)` inside the SERIALIZABLE financial transaction; a15 replay test now also
  asserts exactly one outbox row after an idempotent replay (no duplicate transaction,
  journal, or event).
- **Unregistered beneficiaries** receive SMS via PHONE-recipient intents (canonical
  `0?[789]XXXXXXXXX` → stored canonical; invalid phone → intent skipped, never
  mis-delivered); registered beneficiaries' SMS opt-outs are re-checked at dispatch AND
  again at worker retry via the verified customer-contact lookup.
- **Verified sender names only when authoritative:** KYC-APPROVED verified legal name,
  else the generic 'A MonieNaija customer'; amount rendered from the committed transfer
  principal (`amountMinor`), currency NGN.
- **Non-disclosure:** message bodies and exposed payloads never contain transfer number,
  sender phone, secret transfer code, transaction reference, or recipient phone —
  enforced inside registry rendering (all channels), asserted by A4's specs and the
  locator-contract superset spec.
- **Public locator:** `GET /api/v1/public/agents/cash-to-cash-outlets` returns only
  ACTIVE Nigerian agent outlets (name/address/city/state/country; limit ≤ 100) — no
  private agent or financial fields; the locator URL comes only from
  `CASH_TO_CASH_LOCATOR_URL` (https-only zod validation; omitted, never invented, when
  unset/invalid/over-long); no distance claims anywhere.
- **Production hold:** beneficiary notifications are NOT activated in production —
  workers off, locator URL unconfigured, EMAIL dark. Activation requires deliberate
  configuration + product-owner sign-off (§9).

## 6. Phase 5 — Admin Web contract reconciliation (commit `1ec4e82`)

Every endpoint/DTO/permission/workflow in the A2 console was inspected against the real
merged backend and reconciled in `apps/admin-web/src/services/notification-management-api.ts`
(+ permission derivation, workspace activation UX, tests).

### Capability matrix (post-reconciliation)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Event catalogue + channel configuration read | **COMPLETE** | LIVE `GET /internal/notifications/events` (registry shape merged with UI metadata); console test Cap 1/2 |
| 2 | Trigger enable/disable (governed) | **COMPLETE** | `POST /changes` CONFIGURATION per channel with `expectedVersion` optimistic concurrency; locked channels refused; console test Cap 2 |
| 3 | SMS template editing | **COMPLETE** | Allowlist/secret/non-disclosure client validation + server `validateTemplate`; proposal via `POST /changes` TEMPLATE; Cap 3 |
| 4 | Email subject/body editing | **COMPLETE** | Same governed flow; subject required ≤200, body ≤4000; Cap 4 |
| 5 | Variable selection | **COMPLETE** | Registry `variables` allowlist authoritative (c2c: sender_name/amount/locator_clause); insertion buttons; Cap 3/4 |
| 6 | Server-side preview | **COMPLETE** | `POST /templates/preview` (fixed safe samples server-side; client samples enrich display only); Cap 3 |
| 7 | Version history | **COMPLETE** | `GET /templates?eventType&channel` (+`beforeVersion` paging) mapped to history rows; Cap 4 |
| 8 | Maker-checker approval + approved activation | **COMPLETE** | Two-step real lifecycle: workforce `approve` + `POST /changes/:id/execute` (approval alone never mutates state); rollback = governed TEMPLATE_ROLLBACK proposal; Cap 4/8 |
| 9 | Provider readiness/status (non-secret) | **COMPLETE** | Real flat snapshot mapped; stray-secret defence; masked fingerprints only; Cap 9 |
| 10 | Delivery history + retry diagnostics | **COMPLETE** (manual retry **BLOCKED** — route genuinely absent; automatic bounded worker retry is live) | EMAIL filter LIVE (VALID_CHANNELS widened); inspector + retry counts; Cap 10 |
| 11 | Controlled test sending | **COMPLETE** | Real wire body `{channel, destination}`; rate-limit 429 fail-closed without retry; masked destination echo; Cap 11 |
| 12 | Permission-based visibility + audit history | **COMPLETE** | Interim policy mirrored (maker SUPER_ADMIN+MFA+view_deliveries; checker FINANCE_CONTROLLER+privileged:approve+MFA); audit lookups live; Cap 12 |

No available backend workflow is marked BLOCKED; the only BLOCKED states left are the
pre-widening deployment fallback (defensive) and the genuinely absent manual-retry route.

**Automation vs UAT:** all of the above is proven by automated component tests against
real-contract mocks plus backend integration suites against real PostgreSQL. No browser
UAT was performed (no browser automation in this environment) — see §9.

## 7. Phase 6 — Governance review

- **Interim policy (A1, retained):** maker = SUPER_ADMIN (+ `notification.view_deliveries`
  + MFA), checker/executor = FINANCE_CONTROLLER (+ `privileged:approve` + MFA), maker ≠
  checker enforced server-side, no delegation. This is an **interim** role-based policy —
  granular `notification.manage_templates` / `approve_templates` / `manage_configuration`
  / `approve_configuration` catalogue functions are **not** in the authorization
  catalogue yet. Adding them permanently is a product-owner decision; the frontend still
  honors those scope codes if they are ever catalogued (forward-compatible), but nothing
  was invented. **Flagged for product-owner ratification.**
- `notification.test_send` IS catalogued (A3: SUPER_ADMIN + OPERATIONS, EXECUTE) —
  controlled, rate-limited (5/hr durable), audited with masked destinations.
- The Admin Web permission derivation **mirrors** server enforcement; it never weakens
  it (server-side checks are independent of UI state). FINANCE_CONTROLLER gained console
  visibility because the registry's read contract admits FC checkers (MFA per request) —
  required so checkers can inspect frozen proposals before deciding.
- Audit integrity: change requests are frozen proposals (`notification_change_requests`
  → `privileged_action_approvals`); history tables are trigger-protected (immutable
  history, activation flips only through governed execution); every stage writes
  `audit_events` rows (REQUESTED / approval decision / CONFIGURATION_CHANGED /
  VERSION_ACTIVATED / TEST_SEND).
- MFA: minimum assurance MFA on maker submission, checker approval and execution; the
  console blocks checker actions on PASSWORD-assurance sessions.

## 8. Phase 7 — Test results (all executed in this environment)

| Battery | Result |
|---|---|
| Backend build (`nest build` incl. tsc) | PASS (clean) |
| Backend unit suite (`npm run test`) | **201/201 suites, 2018/2018 tests** |
| Targeted PG notification cluster (post-merge, post-seam) | email-01 23/23 (incl. new registry-governance tests 22/23); v1-005 + hardening-09 + sms-v1-01: 3/3 (56); v1-006-inbox + notification-registry + migration-chain: 3/3 (49); C2C financial a15/a17/v1-agent-cash-to-cash-operations: 3/3 (56); a16 + v1-release-01 + hardening-09 batch: 3/3 (111) |
| Migration upgrade-from-baseline spec (real PG) | 2/2 |
| **FULL sequential PG integration suite** (real embedded PostgreSQL, `PG_TEST_CONCURRENCY=1`, run id `arena3full`, log `full-pg-arena3.log`) | 119 files in 8 sequential batches: **117 PASS, 2 FAIL (4 tests)** — both failures shared one root cause: pre-existing `throwingOutbox` test stubs (v1-commercial-accounting-01, v1-fee-runtime-wiring) lacked Arena 4's `enqueueOnce` (test-side stub incompatibility, NOT a product regression). Stubs fixed in `33122fc`; **targeted re-run 3/3 suites, 70/70 tests** (incl. a15 with the new single-outbox-event replay assertion). Post-fix state: all 119 integration files green. Full-run test totals: 2272 passed / 4 failed (the 4 = the two stub-affected suites) |
| Admin Web unit/component tests | **26/26 suites, 179/179 tests** |
| Admin Web `tsc` | PASS (clean) |
| Admin Web production build (`vite build`) | PASS (pre-existing chunk-size warning only) |
| Cross-surface API contract coverage | Two-sided: backend integration suites pin the real route/response contracts on live PostgreSQL; the Admin Web suite pins the client mapping against mocks of those exact contract shapes. No live browser-to-backend UAT (environment limitation, §9). |

No live SMS or email was delivered to real providers in this mission: SMS/EMAIL provider
tests use in-process test providers against real PostgreSQL; `robase`/`resend` HTTP
adapters are unit-tested against mocked HTTP. Real-provider delivery remains unproven by
design (§9).

## 9. Remaining decisions, limitations, and outstanding items

**Product-owner / governance decisions (explicitly flagged, not invented):**
1. Ratify the interim maker/checker role policy OR catalogue granular `notification.*`
   management functions (with role assignments) as permanent policy.
2. Activation of cash-to-cash beneficiary notifications in production (currently dark:
   workers off, locator URL unconfigured). Requires `CASH_TO_CASH_LOCATOR_URL` (https,
   ≤240 chars to render), worker enablement, and sign-off.
3. EMAIL channel launch: flip registry EMAIL configurations on (governed change
   requests) + configure `NOTIFICATION_EMAIL_PROVIDER=resend` with credentials +
   `NOTIFICATION_EMAIL_FROM`.
4. Aggregator-read gating and supporter reclassification/PIN-unlock policy blockers from
   prior audits remain open (out of this mission's scope).

**Limitations (honest boundaries):**
- No browser UAT was performed (no browser automation available); Admin Web proof is
  automated component tests against real-contract mocks + backend integration suites.
- No real-provider (Robase/Resend) live delivery was attempted; production cutover needs
  a staging smoke test with real credentials.
- Delivery status reflects **provider acceptance**, not confirmed handset/inbox delivery
  (no receipt webhooks/polling integrated).
- `environment` field in the console provider panel shows `unknown` unless runtime
  configuration is separately readable (scope discipline — no cross-scope calls).
- A2's static catalogue metadata still labels `cash_to_cash.created` as
  `UNWIRED_OUTBOX` (display-only); the outbox wiring is live since the A4 merge.
- Cosmetic C2C body edge: an empty amount renders 'sent you .' (documented during the
  A4 merge; amount is always present in real payloads).

**Outstanding defects:** none known at report time. All previously identified findings
(F-S1 no-op validator, F-S3 event-name leakage, email dark-launch gaps, migration 097
collision) are fixed/merged; regression suites green.

## 10. Staging-deployment readiness verdict

**READY FOR STAGING DEPLOYMENT — with the notification dark-launch posture intact:**
migrations 097–099 apply cleanly (install and upgrade proven on real PostgreSQL with
refuse-when-unsafe rollbacks); EMAIL stays dark until deliberately configured; SMS/PUSH
behaviour is byte-compatible with the pre-mission baseline; cash-to-cash financial
semantics are regression-proven and beneficiary messaging stays non-disclosing;
Admin Web operates against the real governed API with maker-checker + MFA + audit.
Staging entry checklist: run the full migration chain, seed verification
(`seedNotificationDefaultsV1` is migration-owned), configure test providers, execute the
staging smoke suite (email-01/sms-v1-01/notification-registry/a15-a17), and obtain the
product-owner decisions in §9 before enabling any customer-facing channel.

### Verification record (executed 2026-10-27)

```
$ git rev-parse HEAD                       -> 33122fc (fixes) ; report added by the next commit
$ git rev-parse origin/arena/8e59e188-monienaija  -> identical to local HEAD after push (verified below in §10 push record)
$ git merge-base --is-ancestor <sha> HEAD
  a254ba077021b003c1b03dea5692e30c92c126eb (Arena 1)  -> ANCESTOR_OK
  3b2b88d10286d52d2fcd003ac6b4ee036e18acef (Arena 2)  -> ANCESTOR_OK
  775e29fcfa0c9603c4eb0a5b03b5499baaca3509 (Arena 3)  -> ANCESTOR_OK
  ee397662cb60b92fbd1aff6fce7b475e8329d3e3 (Arena 4)  -> ANCESTOR_OK
  5206d8f52b0deccba31149c6e600d9e0d774a6cb (baseline) -> ANCESTOR_OK
$ git status --short                       -> clean (no uncommitted/untracked files)
```

Integration commits in order: `8883fc7` (A1 merge) → `84d7177` (A4 merge) → `fe54486`
(A2 merge) → `06c5f76` (Phase 3 registry-bound email seam) → `e13e6b1` (Phase 2
upgrade-from-baseline proof) → `1ec4e82` (Phase 5 Admin Web reconciliation) → `33122fc`
(outbox stub fixes + C2C single-event replay assertion) → this report.

All test numbers in §8 were produced by executions in THIS mission environment (embedded
PostgreSQL on 127.0.0.1:5432, fresh initdb; logs `full-pg-arena3.log` for the full
sequential run). The prior-branch evidence (A3 full run 117/117 suites, 2262/2262 tests,
`email-full-pg-2.log`) is inherited context and is explicitly distinguished from the
post-integration runs above.
