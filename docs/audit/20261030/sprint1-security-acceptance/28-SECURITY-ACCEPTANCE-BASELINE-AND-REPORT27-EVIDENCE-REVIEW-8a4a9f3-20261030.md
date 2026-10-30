# 28 — Security Acceptance Baseline and Report 27 Evidence Review — application SHA `8a4a9f3`

- **Role:** Arena 4 — Independent Security Auditor (evidence review and acceptance-framework exercise).
- **Application SHA under review:** `8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4` (report-26 remediation on top of baseline `2e364cd`).
- **Implementation report reviewed:** `docs/audit/20261029/sprint1-security-acceptance/27-REPORT26-NOTFOUND-AND-BUSINESS-CORRELATION-REMEDIATION-2e364cd-20261029.md`.
- **Previous independent audit:** Report 26, commit `b7fdc9a70b374d572d01caee7c61c4f6f9b4182e`, branch `arena/870f970d-monienaija`.
- **Date:** 2026-10-30.
- **Branch routing note (recorded, not silently resolved):** the assignment names `arena/870f970d-monienaija` as the pinned documentation branch, but this session is platform-routed to `arena/8e59e188-monienaija` and is prohibited from pushing to sibling branches. Following the precedent explicitly recorded in document 17 (which documented the identical inverse discrepancy rather than claiming a cross-branch push), this documentation-only report is committed to the active session branch. No application code or test was modified in this review.
- **Safety boundaries honored:** no application/test modification, no merge, no deployment, no production credentials, no provider activation, no financial transaction, no production migration. All credential values referenced anywhere in this record are synthetic sentinels. PostgreSQL evidence uses disposable `mn_it_*` databases against embedded PostgreSQL 18.4.

**Purpose:** end the repetitive patch-and-audit loop by (a) consolidating the historical finding chain into one register with evidence-based dispositions, (b) independently verifying the Report 27 remediation record, and (c) fixing a stable, risk-ranked acceptance baseline with finite milestone gates. Passing the tests cited here does **not** prove the entire platform secure; §5 separates assessed domains from domains requiring future dedicated review.

---

## 1. Consolidated historical finding register (Phase 1)

Classification: **ORIG** = original finding; **REGR** = regression/residual of a prior finding discovered on retest; **NEW** = newly discovered path; **THEO** = theoretical risk without demonstrated exploit. Statuses are as of this review at `8a4a9f3`. "Evidence" cites permanent executed suites; suites marked ↻ were independently re-executed in this review (§10).

### 1.1 The credential/diagnostic-disclosure chain (this milestone's governing findings)

| ID | Original report | Boundary | Demonstrated failure (synthetic) | Impact | Severity × likelihood | Status | Regression evidence | Remaining verification |
|---|---|---|---|---|---|---|---|---|
| F-01 (provider identifiers) | 20261028 combined review doc 10; fresh acceptance doc 11 (`fe06ea8f`) | Provider error/success identifiers → HTTP, delivery status, audit, DB, logs | Raw provider identifiers and JWT-shaped suffixes leaked through diagnostics/history surfaces | Credential-material disclosure into durable diagnostics | HIGH × demonstrated (pre-fix) | **CLOSED** (Report 19: "PASS for tested paths"; held in Reports 21/23/25/26 retests) | `f01-historical-provider-ref-security.unit`, `v1-sprint1-f01-historical-delivery-disclosure.integration` ↻ | None for tested paths; live-provider behavior remains Gate C |
| Redaction hardening set (bounded parser/scanner, duplicate JSON keys, provider-ref suffixes, resource exhaustion, direct-object traversal) | Report 16-era findings; implementation records docs 17/18 at `f00e0c9` | Shared error/log redaction boundary | Unbounded parsing, duplicate-key evasion, oversized/deep inputs | Disclosure + availability (scanner exhaustion) | HIGH × demonstrated (pre-fix) | **CLOSED** (Report 19: availability PASS within tested bounds; held since) | `report16-redaction-hardening` ↻, `sensitive-data-redaction-adversarial` ↻, `sensitive-data-protection` ↻ | Bounds are tested, not proven; keep budget regression suite permanent |
| R-03 (suffix scanner stops early) | Report 19 (`b303a49`) | Provider-reference region scanning | Attached ordinary fragment then JWT: `pvr1:ref fragment <JWT>` leaked the JWT through redaction, 4xx message, 5xx log | Credential disclosure via error/log surfaces | HIGH × demonstrated | **CLOSED** (Report 21: PASS for tested variants; held in 23/25/26) | `report19-final-error-boundary` ↻, `report21-*` ↻ | None |
| R-04a (`details.error` field; raw query in `request.url` → response/logs) | Report 19 | Exception-filter 4xx body; request logging | Custom `details.error` unredacted; `?access_token=…` reached error response and log fields | Credential disclosure | HIGH × demonstrated | **CLOSED** (Report 21 confirms; log side re-confirmed by Report 26's real-lifecycle pino probe) | `report19-*` ↻, `report25-cross-boundary-e2e` ↻ | None |
| R-04b (full-length `Basic` exposure; filter crash on hostile stringification) | Report 21 (`4ea7f1b`) | Sanitizer scheme rule; filter availability | Valid `Basic <b64>` survived; hostile exception stringification crashed the filter before responding | Disclosure + availability (no response) | HIGH × demonstrated | **CLOSED** (Report 23 confirms) | `report21-basic-scheme-and-proxy-safety` ↻, `http-exception-filter` ↻ | None |
| R-04c (short/lowercase `Basic`/`Bearer`; revoked-Proxy message array) | Report 23 (`683fd40`) | Sanitizer scheme rule; filter availability | `Basic dTpw`-class short credentials and revoked-Proxy `message` arrays evaded/crashed | Disclosure + availability | HIGH × demonstrated | **CLOSED** (Report 25 confirms exact cases; revoked-Proxy fix passed adversarial probes) | `report23-scheme-and-revoked-proxy` ↻ | None |
| R-04d (case-insensitive schemes; sub-4-char Bearer; `main.ts` context echo/log wiring — 12-path inventory incomplete) | Report 25 (`af486bc`) | Request-context IDs at every HTTP boundary (headers, 503 body, onResponse log, pino customProps, echo) | `bearer abcdefgh`, `Bearer abc` survived; raw context IDs copied to response headers/logs outside the sanitized path | Credential disclosure at application boundary | HIGH × demonstrated | **CLOSED** (Report 26: "materially closes the reported short/case-varied gaps"; sanitize-at-creation choke point; production Pino config verified in real lifecycle) | `report25-scheme-case-gaps` ↻, `report25-cross-boundary-e2e` ↻ | None for demonstrated vectors |
| **N-01** (unmatched-route 404 reflects query string into response body) | Report 26 (`2e364cd`) | Nest/Fastify default 404 `message` → HTTP JSON body | `?x=QSECRET_SENTINEL`, `?foo=opaque-secret-987654321`, `?e=bearer%20abcdefgh` echoed verbatim; encoded space defeated the literal-whitespace scheme rule | Conditional reflection of caller query into server-generated error bodies (telemetry/proxy/response-log persistence risk). Caller supplied the value; **not** cross-user disclosure | LOW–MEDIUM × demonstrated reflection, conditional impact | **CLOSED** (§2.2; independently re-run at `8a4a9f3`) | `report26-notfound-query-reflection` ↻ (real NestJS+Fastify lifecycle, body **and** pino-log assertions) | None for the demonstrated vector; OBS-02 below is a theoretical residual |
| **N-02** (body-supplied business `correlationId` outside request-context control) | Report 26 | DTO → service → financial execution → audit/outbox → notification intents → delivery rows → response echo | `CashInDto` accepted `Bearer abcdefgh` with zero validation errors; audit/outbox/event-map probes persisted/propagated it unchanged | Durable credential-shaped metadata in audit/outbox/delivery stores; exposure to privileged consumers and future diagnostics | MEDIUM × demonstrated persistence route (DB read-back was NOT VERIFIED in Report 26; now verified) | **CLOSED** (§2.3; real-PostgreSQL read-back independently re-run) | `report26-business-correlation-ids` ↻, `report26-correlation-persistence.integration` ↻ (16 tests) | None for demonstrated paths; OBS-01/OBS-03 below are low/informational |
| Row 10 (request-context IDs → POA/audit persistence) | Report 26, inventory row 10 | `createRequestContext` → POA audit-context → `audit_events` | No demonstrated failure — evidence gap: "no dedicated assertion writes a credential-shaped request-context ID through the real sink and reads it back" | Unverified persistence of the report-25 choke point | MEDIUM × unverified (not demonstrated) | **CLOSED** (dedicated real-DB read-back tests exist and were independently re-run: credential header → `[REDACTED]` at creation and at rest; legitimate header byte-for-byte) | `report26-correlation-persistence.integration` (row-10 tests) ↻ | None |
| Row 15 (pre-remediation persisted diagnostic IDs → later consumers) | Report 26, inventory row 15 | Legacy `audit_events`/`outbox_events`/`notification_deliveries` rows → audit lists, outbox views, delivery listings, provider-send commands | Not a demonstrated live exploit; conditional legacy-data risk (no production DB was examined) | Legacy raw values could reach consumer projections | MEDIUM × conditional (only if legacy rows exist) | **CLOSED WITH DOCUMENTED RESIDUAL** — read-boundary masking at all four identified consumer projections, each with a dedicated PG test (legacy raw row inserted via SQL; consumer view masked; stored row untouched). No backfill performed (production-data modification prohibited). Residual: raw values remain at rest and are visible to direct unmediated SQL access | 4 legacy-masking tests in `report26-correlation-persistence.integration` ↻ | Optional future controlled cleanup job (§8, priority 3) |

### 1.2 Findings governed by other records (referenced, not reassessed here)

Reports 19–26 consistently held these separate from the technical NO-GO/PASS decisions; this review does the same. Statuses must be taken from their own governing records.

| ID | Governing record | Nature | Disposition in this review |
|---|---|---|---|
| R-01, R-02 | Earlier sprint-1 records (referenced as "separate, not the basis for NO-GO" in Reports 19–26; definitions not present in the 20261028/20261029 audit trees on either branch) | Prior-round findings | **NOT REASSESSED** — no contradictory reproduction encountered; no status change |
| D-01 (compliance access grants: global vs assignment scope; VIEW vs EXECUTE) | 20261028 final acceptance doc 08 | Open product/security **decision** | **OPEN DECISION** — blocks unconditional P0-01 acceptance; assignee: Product + Security (§8) |
| D-04 (fraud taxonomy ratification) | 20261028 doc 08 | Open product **decision**; current allowlists fail closed | **OPEN DECISION** — safe-by-default implementation confirmed; ratification outstanding |
| P0-01 (compliance authorization) | 20261028 doc 08 | CONDITIONAL PASS pending D-01/D-04 | Unchanged; `customer-compliance-authorization` PG suite re-run green ↻ (behavioral, not policy-decision, evidence) |
| P0-02 (projection defect) | 20261028 doc 08 | Confirmed defect, remediated in the 20261028 cycle | Not re-audited here; no contradictory evidence |
| F-02…F-10 (20261028 static findings: delivery-list scope, limit-diagnostics policy mismatch, frontend-only filters, registry-view overstatement, expiry-worker activation, approvals queue shape, historical-evidence currency, JSON configuration surfaces) | 20261028 doc 04 + acceptance docs 08–11 | Mostly authorization-policy/evidence-currency items, several dependent on product decisions | **NOT REASSESSED individually.** Implementation evidence has since accrued (e.g., F-07 expiry worker: `a17-agent-cash-to-cash-expiry` suite exists and passes in the standing battery; F-02: `v1-sprint1-notification-delivery-authorization` ↻ green). Formal disposition remains with the governing records and Gate B (§7) |

### 1.3 New observations from this review (none reopens a closed finding; no demonstrated exploit)

| ID | Class | Observation | Severity | Disposition |
|---|---|---|---|---|
| OBS-01 | THEO | `AuditService.list()`: a truthy but invalid `correlationId` filter (whitespace-only, >255 chars, non-string) sanitizes to `undefined` and the filter is silently dropped, returning an unfiltered list (still bounded by the caller's other query parameters and authorization) instead of an empty result. Not a cross-customer disclosure: audit listing is a privileged workforce surface and authorization scoping is untouched. | LOW | Tracked follow-up (§8, priority 3): return an empty page when a supplied filter fails sanitization |
| OBS-02 | THEO | `stripDiagnosticUrlQueries` requires a start/whitespace/quote/backtick/paren delimiter before a URL-shaped token. A URL embedded directly after another character (e.g. `redirect:/x?secret`) would keep its query. The demonstrated untrusted vector (Nest's `Cannot <METHOD> <raw-url>`) always has the URL after a space, and literal quotes cannot appear in a raw request target (they arrive percent-encoded and are consumed by the strip), so no reachable reflection was demonstrated. | LOW | Tracked follow-up (§8, priority 3): optionally extend the delimiter class; add a regression if ever done |
| OBS-03 | Accepted design | Credential-shaped identifiers collapse onto `[REDACTED]` (distinct hostile values become indistinguishable), and `fundingFingerprint` over a credential-shaped correlation id differs from any pre-fix fingerprint of the same hostile input. Legitimate identifiers are byte-for-byte preserved, so equality, retry, idempotency and lookup semantics for legitimate callers are unchanged (verified: idempotency is keyed by `idempotencyKey`/`eventKey`/request hash — never by `correlationId`; the only correlation-id lookup applies the same deterministic function symmetrically). | INFO | Accepted fail-closed trade-off; see §2.4 assessment |

---

## 2. Independent Report 27 remediation review (Phase 2)

Method: full source review of the diff `2e364cd..8a4a9f3` (18 source files, +169/−37; no migration, entity, contract, fee, ledger-posting or reconciliation change; no admin-web change), plus independent execution of the claimed suites at `8a4a9f3` with fresh run identifiers (§10). The worktree was verified clean at the exact SHA before execution.

### 2.1 Source review conclusions

- **N-01:** `stripDiagnosticUrlQueries` is a pure-string, single-pass, linear, no-throw function; non-strings fail closed to `[REDACTED]`. It is applied **before** `redactSensitiveText` in both the message sanitizer (scalar and array forms) and the `error`-field sanitizer of `GlobalExceptionFilter` — the single centralized HTTP error boundary. Query-free `Cannot GET /path` diagnostics, status codes, keyed redaction and the never-throw-before-responding property are structurally preserved (the strip runs inside the existing try/catch).
- **N-02:** `sanitizeDiagnosticIdentifier` is deterministic, bounded (trim, ≤255), fail-closed (`undefined` for empty/oversized/non-string; never invokes `toString` on hostile objects) and idempotent (`[REDACTED]` and legitimate ids are fixed points, so the double coverage — service ingestion **and** persistence choke point — cannot corrupt values). Verified ingestion points: agent cash-in/out/cash-to-cash/claim/expiry, funding, funding governance (incl. `fundingFingerprint`), financial-execution entry (whole-command normalization, covering every downstream sink: journal, limits, commercial accounting, policy decisions, metadata), desk OTP, customer funding ×3 (create/approve/reject), ledger ×2 (create + post-journal compose). Verified choke points: `AuditService.record` (INSERT), `AuditService.list` (symmetric query side), `OutboxService.record/enqueue`, `enqueueOnce` (normalized command used for **both** the dedupe comparison and the stored row — retry equality holds), `mapEventToIntents` entry, dispatcher INSERT parameter, processor provider-send read boundary.
- **Row 15:** read-boundary masking confirmed at all four consumer projections (audit list, outbox view, `listDeliveriesForEventKey`, processor→provider command). Stored legacy rows are never rewritten — consistent with the prohibition on production-data modification.
- The DTO contract is deliberately unchanged (`CashInDto` still accepts a ≤255-char `correlationId`; sanitization happens downstream) — legitimate business semantics, idempotency and traceability are preserved, as the mission required.

### 2.2 N-01 independent verification — **CLOSED**

The real-lifecycle suite (production `GlobalExceptionFilter`, production pino configuration, real NestJS/Fastify `inject`) was independently re-executed: all three exact Report 26 reproductions (`?x=QSECRET_SENTINEL`, `?foo=opaque-secret-987654321`, `?e=bearer%20abcdefgh`) assert the 404 JSON body excludes the query and that decoding cannot recover the credential shape; the keyed `access_token` regression, query-free pino logs, matched-route behavior and query-free legitimate 404 diagnostics all pass. Pre-fix behavior was additionally re-confirmed by executing the stripped reproduction spec against a pristine `2e364cd` worktree during the implementation cycle (9 failed / 9 passed), matching the record.

### 2.3 N-02 independent verification — **CLOSED**

Independently re-executed at `8a4a9f3`: unit choke-point probes (audit/outbox fake-manager capture, event-map propagation, DTO-contract assertion, sanitizer property suite) **and** the 16-test real-PostgreSQL persistence spec: audit/outbox/dispatcher writes persist `[REDACTED]` for credential shapes and byte-identical legitimate ids (SELECT read-back); symmetric audit `list()` lookup; `enqueueOnce` ×2 credential retry → one row, same id, sanitized; legacy raw rows masked at all four read boundaries with stored rows untouched; real `NotificationDeliveryProcessor` hands only `[REDACTED]` to a capturing mock provider; `AgentCashInService` boundary → execution command, service result, persisted `audit_events.correlation_id` and `new_values` JSON all clean, with a legitimate id preserved end-to-end. No live financial operation and no provider activation occurred (execution/authorization mocked; disposable DBs).

### 2.4 Assessment: credential-shaped identifiers collapsing onto `[REDACTED]`

The collapse affects **only** values that match credential syntax — precisely the values whose persistence is the defect. Consequences: (a) a hostile or mistaken caller using credentials as correlation values loses per-request distinguishability in diagnostics — an acceptable, intended fail-closed cost, and **not** an unauthorized-disclosure concern (the caller sees its own submitted data collapsed, never another principal's); (b) lookup/dedupe remain internally consistent because the same deterministic function is applied on write, query and retry-comparison sides; (c) legitimate identifiers (UUIDs, `corr-…`, namespaced references, W3C hex) contain no credential shape and are provably unaffected — asserted byte-for-byte in unit **and** real-DB tests; (d) the conservative over-redaction caveat already documented in Reports 23/25 (e.g. `Basic auth`-style prose) is unchanged in character. No financial-equality, idempotency or accounting semantics depend on `correlationId` anywhere in the reviewed paths. **Assessment: acceptable design; no downgrade of any actual exposure was performed to reach it.**

### 2.5 Report 26 finding dispositions

| Report 26 item | Disposition |
|---|---|
| N-01 (row 13) | **CLOSED** — independently re-verified (§2.2) |
| N-02 (row 14) | **CLOSED** — independently re-verified incl. real-DB persistence (§2.3) |
| Row 10 (context → POA/audit persistence) | **CLOSED** — dedicated read-back evidence now exists and was independently re-run |
| Row 15 (legacy persisted ids) | **CLOSED WITH DOCUMENTED RESIDUAL** — read-boundary protection verified; raw values remain at rest (direct-SQL visibility only); optional controlled cleanup tracked (§8) |
| R-04 (parent finding, complete HTTP + diagnostic-identifier boundary) | **CLOSED** — every demonstrated vector across Reports 19/21/23/25/26 is closed with permanent regressions; the full 11-suite focused battery (198 tests) re-executed green at `8a4a9f3` |
| Inventory completeness objection (Report 26 §2: paths absent from the 12-path inventory) | **CLOSED** — the unmatched-route body path (N-01) and the body-supplied correlation path (N-02) are now both covered by permanent real-lifecycle/real-DB tests; the Report 27 §1 inventory additionally traces B1 policy engines, external settlement, registration, provider-config and governance sources to sanitized origins |
| Overall technical acceptance for the R-04/historical-disclosure milestone | **GO — see Gate A (§7).** This is scoped strictly to Gate A; Gates B, C and D are separate and are **not** passed by this verdict |

Report 27's claimed counts were independently reproduced exactly: focused battery 11/11 suites · 198/198; full backend unit 217/217 · 2281/2281; PG 12/12 · 165/165 (92 + 73); repro specs 27/27. No discrepancy between the implementation record and independent execution was found.

---

## 3. Evidence-backed risk and severity matrix (current state at `8a4a9f3`)

| Risk | Domain | Demonstrated? | Current control | Residual severity | Residual likelihood |
|---|---|---|---|---|---|
| Credential disclosure via error/response/log/diagnostic surfaces (F-01, R-03, R-04a–f, N-01, N-02) | Credential & sensitive-data protection; HTTP boundary | Yes (pre-fix, synthetic) | Layered: bounded redaction boundary + creation-time context sanitization + identifier sanitization at ingestion/choke/read points + centralized filter strip; permanent regression suites | LOW | LOW (all demonstrated vectors closed; only THEO residuals OBS-01/02) |
| Legacy credential-shaped values at rest | Database/persistence | Conditional (no production DB examined) | Read-boundary masking on every identified consumer projection | LOW–MEDIUM | LOW (requires pre-existing legacy rows **and** direct unmediated SQL access) |
| Redaction scanner resource exhaustion | Availability | Yes (pre-fix, bounded tests) | Hard budgets (256 KiB text, 32/12 depth, 12k nodes, 1M scanner ops), fail-closed | LOW | LOW within tested bounds |
| Exception-filter unavailability (hostile objects/revoked proxies) | Availability | Yes (pre-fix) | typeof-guarded traversal, never-throw-before-responding, permanent hostile-object matrix | LOW | LOW |
| Compliance authorization scope (D-01-dependent) | Authorization | Policy gap, not demonstrated exploit | Function guards + category separation in place; scope decision open | MEDIUM (policy-dependent) | Unknown until D-01 decided |
| Provider live-integration behavior (webhooks, real delivery, secrets handling under live traffic) | Provider integration | Not exercised (prohibited) | Synthetic-provider suites only | UNKNOWN | UNKNOWN — requires Gate C |
| Untested domains (§5 gap list: e.g. abuse/rate-limit depth, secrets lifecycle, production migration/config) | Multiple | Not assessed | Existing suites cover slices only | UNKNOWN | UNKNOWN — requires Gate B/C review |

---

## 4. Fixed security acceptance criteria (Phase 3)

For each domain: required property → threat controlled → acceptance method → existing evidence → remaining evidence → failure severity → owner. "Owner" denotes the responsible implementation/decision function, not a person.

1. **Authentication & authorization.** Property: every route enforces principal type + function scope + resource binding server-side; no UI-only enforcement. Threat: privilege escalation, cross-customer access. Method: endpoint-authorization map + negative PG tests (403 no-scope, wrong-resource, cross-customer). Existing: `v1-admin-authorization-*`, `v1-admin-p1-authorization-hardening`, `customer-compliance-authorization` ↻, `a11/a21/a23` suites. Remaining: D-01 decision + assignment-scope enforcement if decided; F-02/F-03 policy alignment (governing records). Severity: CRITICAL. Owner: Backend + Product/Security (decisions).
2. **Credential & sensitive-data protection.** Property: no credential-shaped value (Authorization/Proxy schemes of any case/length, provider references with attached secrets, API keys, PINs, transfer secrets) reaches responses, logs, persisted diagnostics or provider commands; legitimate diagnostics preserved; redaction bounded and fail-closed. Threat: credential harvesting via diagnostics. Method: the permanent report16/19/21/23/25/26 + adversarial + focused battery (198 tests) ↻. Existing: **complete for demonstrated vectors** (§1.1). Remaining: OBS-01/OBS-02 follow-ups (LOW). Severity: CRITICAL. Owner: Backend (Arena 3 lineage).
3. **HTTP request/response & logging boundary.** Property: request bodies never serialized to logs; query strings excluded from logs and error bodies; context IDs sanitized at creation; response headers/503 bodies carry only sanitized IDs; unmatched routes reflect only query-free paths. Threat: reflection/persistence of untrusted input in server-generated surfaces. Method: real NestJS/Fastify lifecycle E2E specs with production pino config ↻. Existing: report25-e2e, report26-notfound, http-exception-filter suites. Remaining: none demonstrated. Severity: HIGH. Owner: Backend.
4. **Financial transaction integrity.** Property: double-entry invariants (equal debit/credit totals, BIGINT bounds), no alteration of amounts/fees/posting by security fixes, journal immutability, reversal governance. Threat: silent accounting corruption. Method: A5/A12–A19 + ledger/commercial PG suites (standing battery). Existing: `a5-*`, `a12–a19`, `v1-commercial-decision-*` snapshots; report-26 diff verified to touch no accounting logic. Remaining: none from this milestone; production reconciliation evidence is Gate C. Severity: CRITICAL. Owner: Backend + Finance ops.
5. **Idempotency, replay & unknown outcomes.** Property: `idempotencyKey`/`eventKey`/request-hash semantics unaffected by diagnostic sanitization; retries dedupe; ambiguous provider outcomes quarantine (UNKNOWN) rather than blind-resend. Threat: duplicate financial/notification effects. Method: `enqueueOnce` retry-equality PG test ↻; `notification-reliability` quarantine/claim/fencing tests ↻; `v1-mobile-idempotency-*`, `v1-agent-mobile-idempotency-persistence-01`. Existing: complete for reviewed paths. Remaining: none. Severity: CRITICAL. Owner: Backend.
6. **Provider integration security.** Property: synthetic-only in test; secrets confined to config/provider service; provider responses normalized to safe error codes; destinations re-verified immediately before send. Threat: provider-secret leakage, unverified-destination sends. Method: `v1-notification-provider-configuration-01` ↻, reliability suite's pre-send recheck tests ↻. Existing: strong synthetic coverage. Remaining: **live provider behavior untested by prohibition — Gate C item** (provider approvals, webhook/polling evidence). Severity: HIGH. Owner: Backend + Operations.
7. **Audit & outbox integrity.** Property: audit/outbox rows persist only sanitized diagnostic IDs; payload redaction preserved; append-only semantics; symmetric lookup. Threat: durable credential metadata; broken traceability. Method: 16-test PG persistence spec ↻ + operations suites. Existing: complete. Remaining: OBS-01 (LOW). Severity: HIGH. Owner: Backend.
8. **Database & persistence protection.** Property: disposable `mn_it_*` test DBs only; no production migration in security work; legacy data protected at read boundaries when backfill is prohibited; FK/CHECK invariants hold. Threat: test/production data contamination; legacy exposure. Method: pg-harness pattern; legacy-masking tests ↻. Existing: complete for this milestone. Remaining: optional controlled legacy-cleanup job (tracked, not blocking). Severity: MEDIUM. Owner: Backend + DBA/Operations.
9. **Resource exhaustion & availability.** Property: redaction/parsing budgets bounded; filter never throws before responding; workers bounded-batch/single-flight. Threat: DoS via hostile payloads/exceptions. Method: adversarial + report16 budget suites ↻; hostile-object matrix ↻. Existing: complete within tested bounds. Remaining: platform-level rate-limit/abuse depth is a Gate B dedicated-review item. Severity: HIGH. Owner: Backend.
10. **Administrative privileges & governance.** Property: super-admin recovery controlled; role-definition/commercial-rule governance audited and approval-gated; read-only principals cannot mutate. Threat: governance bypass, silent rule changes. Method: `v1-security-super-admin-recovery-01`, `v1-admin-role-definition-governance-*`, `v1-commercial-rule-governance` suites. Existing: suites green in standing batteries. Remaining: D-01/D-04 decisions; VIEW-vs-EXECUTE modeling. Severity: HIGH. Owner: Backend + Product/Security.

---

## 5. Security-domain coverage and gap matrix

**Already assessed with executed evidence (do not re-litigate without a concrete contradictory reproduction):** the credential/diagnostic-disclosure chain end-to-end (§1.1); HTTP error/logging boundary; audit/outbox/delivery persistence of diagnostic IDs; notification reliability state machine (synthetic providers); agent cash lanes A10–A19 authorization + execution; customer-funding flow; migration chain; redaction availability budgets.

**Requiring future dedicated security review (Gate B scope — explicitly NOT proven by anything above):**

| Gap | Why unproven | Priority |
|---|---|---|
| Authorization depth under D-01 outcomes (assignment-scoped access, VIEW-only grants) | Policy decision open; current behavior is global-within-category for valid function holders | 1 (decision-gated) |
| Rate-limiting/abuse economics (OTP issuance, funding requests, login) beyond existing serialization suites | Only slices tested (`v1-harden-01-a2-rate-limit-serialization`) | 2 |
| Secrets lifecycle (rotation, env hygiene, config encryption at rest) | Never in scope of the disclosure chain | 2 |
| Webhook/inbound-partner surfaces (settlement callbacks, partner auth) | Synthetic-only coverage | 2 (pairs with Gate C provider approvals) |
| Production migration/config parity (the 20261028 F-09 currency caveat) | Historic suites prove their own environment only | 3 (Gate C) |
| Admin-web browser-level UAT currency | Mocked ApiClient tests are not browser proof (20261028 guardrail) | 3 (Gate C) |

Passing R-04-era suites does **not** imply any row of this second table is secure.

---

## 6. Severity-based release criteria (Phase 4)

A finding qualifies only with a defensible threat model, reachability assessment and impact statement. A caller seeing its own submitted data is **not** unauthorized disclosure of another principal's data. An untested possibility is **not** a demonstrated exploit — but "not demonstrated" never downgrades an actual exposure.

- **CRITICAL — release blocker:** demonstrated (or trivially reachable) cross-principal data disclosure, authorization bypass, financial-integrity defect (double-entry violation, amount/fee mutation, duplicate posting), credential disclosure into durable/server-generated surfaces, or availability loss of the error boundary itself. Blocks any GO until closed with permanent regression evidence. Examples in this project's history: F-01, R-04a–d, N-02 at demonstration time.
- **HIGH — release blocker:** demonstrated disclosure of sensitive material to non-entitled consumers within one principal's blast radius (e.g. privileged-consumer exposure of persisted credentials), provider-secret leakage paths, idempotency/replay defects with financial effect, unverified-destination sends. Blocks GO; may be converted to CRITICAL if reachability widens. Example: N-02's durable-persistence impact class before the read/write controls existed.
- **MEDIUM — remediate or explicit risk acceptance:** conditional reflections of caller-supplied data (N-01 class), evidence gaps on real sinks (row-10 class), legacy-data residuals with mediated reads (row-15 class), policy-dependent authorization scope pending a decision (D-01 class). Requires either a fix with regression evidence or a recorded, owner-signed risk acceptance with a review date.
- **LOW — tracked follow-up:** theoretical residuals without demonstrated reachability (OBS-01, OBS-02), diagnostic-fidelity caveats, conservative over-redaction trade-offs. Tracked in the backlog; never a NO-GO basis alone.
- **Operational-readiness requirement (not an application-security defect):** live provider activation/approvals, deployment/rollback runbooks, monitoring/alerting, incident response, production reconciliation evidence, migration/config parity, browser UAT currency. These gate release through Gate C and are never "fixed" by application patches.

---

## 7. Milestone gates and verdicts (Phase 5)

### Gate A — R-04 and historical disclosure remediation: **PASS (CLOSED)**

Scope: the credential/diagnostic-disclosure chain (§1.1) — F-01 provider identifiers, redaction hardening set, R-03, R-04a–f including N-01 and N-02, inventory rows 10/15.
Evidence: every demonstrated vector closed with permanent regressions; independent re-execution at `8a4a9f3` of the focused battery (11 suites · 198/198), full unit suite (217 · 2281), PG batteries (12 suites · 165/165 including the 16-test persistence read-back spec), all matching the implementation record exactly; full source diff review found no weakened assertion, no accounting/contract change, and no admin-web change. Residuals: OBS-01/OBS-02 (LOW, tracked), row-15 at-rest residual (documented, mediated reads masked).
**This PASS is scoped strictly to Gate A.** It does not imply Gate B, C or D.

### Gate B — Broader application security: **PARTIAL — NOT PASSED**

Assessed and green: domains 2, 3, 5, 7, 8, 9 of §4 for the reviewed paths; domain 4 (integrity) unaffected by security work and suite-green. Open: §5 gap table (D-01-gated authorization depth, rate-limit/abuse depth, secrets lifecycle, webhook surfaces). Each gap requires a dedicated review with its own acceptance evidence before Gate B can pass.

### Gate C — Operational readiness: **NOT ESTABLISHED**

Not assessed in this review (consistent with every prior round). Requirements: deployment/rollback runbooks; monitoring/alerting on delivery, ledger and auth anomalies; provider approvals and live-delivery evidence; incident-response runbook; production reconciliation evidence; migration/config parity check; browser UAT currency; expiry-worker activation decision + DB evidence (20261028 F-07). Owner: Operations with Backend support.

### Gate D — Production authorization: **NOT AUTHORIZED**

Remains NOT AUTHORIZED unless and until independently and explicitly approved through the appropriate process, with Gates A–C satisfied or their deficits explicitly risk-accepted by the accountable owner. Nothing in this document authorizes deployment, provider activation, production migration or any financial operation.

---

## 8. Remaining implementation assignments (grouped by priority and owner)

**Priority 1 (decision-gated; blocks Gate B):**
1. D-01 — signed Product+Security decision on compliance access scope (global vs assignment; VIEW vs EXECUTE). Owner: Product + Security. If assignment-scoped: implement guard-level enforcement + negative tests. Owner: Backend.
2. D-04 — ratify fraud taxonomy and future-change path. Owner: Product.

**Priority 2 (Gate B dedicated reviews):**
3. Rate-limit/abuse-depth review of OTP, funding and login surfaces. Owner: Backend + Arena 4 follow-up audit.
4. Secrets-lifecycle review (rotation, env hygiene, at-rest). Owner: Operations + Backend.
5. Webhook/inbound-partner surface review. Owner: Backend.

**Priority 3 (tracked LOW follow-ups — never NO-GO bases alone):**
6. OBS-01 — `AuditService.list()`: return an empty page when a supplied `correlationId` filter fails sanitization, with a regression test. Owner: Backend (Arena 3 lineage).
7. OBS-02 — optionally extend the URL-token delimiter class in `stripDiagnosticUrlQueries`; add a regression if changed. Owner: Backend.
8. Row-15 optional controlled cleanup job: a bounded, reviewed migration that rewrites legacy `correlation_id` values through `sanitizeDiagnosticIdentifier` — only if/when production-data modification is authorized by the accountable owner. Owner: Backend + DBA.
9. F-02/F-03 policy-alignment confirmations per their governing record. Owner: Backend + Product.

**Gate C assignments (operational, tracked separately):** §7 Gate C list. Owner: Operations.

---

## 9. Definition of completion for the current R-04 security milestone

The R-04/historical-disclosure milestone is **COMPLETE** when all of the following hold — as of this review, items 1–4 hold and item 5 is the standing obligation:

1. Every demonstrated vector in §1.1 is CLOSED with permanent regression tests committed to the application branch. ✔ (`8a4a9f3`)
2. The independent auditor re-executes the regression, full-unit and relevant PostgreSQL suites at the exact SHA with matching results. ✔ (§10)
3. The source-to-sink inventory for the credential/diagnostic boundary is complete against independent reconstruction. ✔ (Report 26 inventory objection closed; §2.5)
4. Residuals are classified, severity-ranked and tracked — not silently dropped. ✔ (OBS-01/02/03, row-15 residual, §8)
5. No new CRITICAL/HIGH finding in this domain is open. Any future finding with a concrete reproduction reopens **only that finding** under the §6 criteria — it does not automatically reopen the closed chain. ✔ (none open)

The repetitive full-chain re-audit loop is hereby terminated for this domain: closed findings stay closed absent a concrete contradictory reproduction. Future acceptance work proceeds through Gates B, C and D.

---

## 10. Independent execution record (this review)

Environment: worktree verified clean at `8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4`; `npm ci` (root + `apps/admin-web`) restored; embedded PostgreSQL 18.4; `.env` generated by the repository's own `scripts/prepare-pg-test-env.js` (git-ignored, never committed); disposable `mn_it_*` databases only.

| Run | Command / identifier | Result |
|---|---|---|
| Focused security battery (11 suites incl. both report-26 repro specs) | `jest test/http-exception-filter.spec.ts test/report16-redaction-hardening.spec.ts test/report19-final-error-boundary.spec.ts test/report21-basic-scheme-and-proxy-safety.spec.ts test/report23-scheme-and-revoked-proxy.spec.ts test/report25-cross-boundary-e2e.spec.ts test/report25-scheme-case-gaps.spec.ts test/report26-business-correlation-ids.spec.ts test/report26-notfound-query-reflection.spec.ts test/sensitive-data-protection.spec.ts test/sensitive-data-redaction-adversarial.spec.ts` | **11/11 suites · 198/198 tests** |
| PG battery 1 (6 prior relevant suites + new persistence spec) | `NODE_ENV=test PG_TEST_RUN_ID=a4r27b1 jest --config jest.integration.config.js --runInBand …` | **7/7 suites · 92/92 tests** |
| PG battery 2 (5 prior relevant suites) | `NODE_ENV=test PG_TEST_RUN_ID=a4r27b2 jest --config jest.integration.config.js --runInBand …` | **5/5 suites · 73/73 tests** |
| PostgreSQL total | — | **12/12 suites · 165/165 tests** |
| Full backend unit suite | `npm run test` | **217/217 suites · 2281/2281 tests** |
| Source diff review | `git diff 2e364cd..8a4a9f3` (18 source files) | No accounting/contract/migration/admin-web change; no weakened assertion found |

All counts are from this review's own execution and match the Report 27 record exactly. Suites not executed here (e.g. admin-web) are not claimed. This document is documentation-only; it modifies no application code or test.

**Verdict summary:** Gate A **PASS** · Gate B **PARTIAL/NOT PASSED** · Gate C **NOT ESTABLISHED** · Gate D **NOT AUTHORIZED**. Report 26 findings: N-01 **CLOSED**, N-02 **CLOSED**, row 10 **CLOSED**, row 15 **CLOSED WITH DOCUMENTED RESIDUAL**. This Gate A pass is a scoped milestone closure, not platform-wide security acceptance and not production authorization.
