# A6 Exit Checklist

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Integration matrix:** [`A6-INTEGRATION-MATRIX.md`](A6-INTEGRATION-MATRIX.md)
- **Route/rollback evidence:** [`A6-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A6-ROUTE-EXPOSURE-AND-ROLLBACK.md)
- **ADR review:** [`A6-ADR-REVIEW-STATUS.md`](A6-ADR-REVIEW-STATUS.md)
- **Recovery runbook:** [`A6-OPERATIONAL-RECOVERY-RUNBOOK.md`](A6-OPERATIONAL-RECOVERY-RUNBOOK.md)
- **Approval package:** [`A6-APPROVAL-PACKAGE.md`](A6-APPROVAL-PACKAGE.md)
- **A7 handoff:** [`A6-A7-HANDOFF-PACKAGE.md`](A6-A7-HANDOFF-PACKAGE.md)

## 1. Task evidence

| Task  | Required evidence                                                                                                | Repository evidence                                                                                                                              | Status                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| A6T01 | External partner baseline, capability selection, prohibited edges, gap register                                    | [`A6-EXTERNAL-PARTNER-BASELINE.md`](A6-EXTERNAL-PARTNER-BASELINE.md)                                                                                | Implemented/documented                              |
| A6T02 | Partner adapter boundary and normalized provider contract                                                          | [ADR-0047](ADR/ADR-0047-External-Partner-Adapter-Boundary.md), [`A6-PARTNER-ADAPTER-CONTRACT.md`](A6-PARTNER-ADAPTER-CONTRACT.md), adapter services | Implemented/documented                              |
| A6T03 | Bank/NIBSS integration isolation, credential boundary, environment separation, partner configuration validation | (Documentation only; **ADR-0048 not yet authored**); connection/credentials/signing services                                                     | Contract-aligned; ADR-0048 authoring pending        |
| A6T04 | Verified funding-instrument use, internal account mapping, target mapping                                         | [ADR-0051](ADR/ADR-0051-External-Funding-Instrument-Use.md), [`A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md`](A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md), `external-funding-target.service.ts` | Implemented/tested; live partner target validation pending |
| A6T05 | External operation identity, provider references, request hashing, internal/provider idempotency, persistence     | [ADR-0049](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md), [`A6-EXTERNAL-OPERATION-CONTRACT.md`](A6-EXTERNAL-OPERATION-CONTRACT.md), `external-operation.service.ts`, migration `1785753600026` | Implemented/tested; live partner transport unavailable |
| A6T06 | Callback authenticity, replay protection, freshness, partner scope, idempotent processing                       | [ADR-0049](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md), [`A6-CALLBACK-INGRESS-CONTRACT.md`](A6-CALLBACK-INGRESS-CONTRACT.md), `partner-callback-authentication.service.ts`, `partner-callback-ingestion.service.ts`, `partner-callback.controller.ts` | Implemented/tested; A2 route/data-exposure approval pending |
| A6T07 | Lifecycle states, bounded retry, circuit-breaker, status verification, unknown recovery, manual review          | `external-operation-lifecycle.service.ts`, `partner-circuit-breaker.service.ts`, migration `1785753600028`                                     | Implemented/tested; live partner traffic pending      |
| A6T08 | Settlement and suspense boundary, compensating entries, exception ownership, immutable Ledger history             | [ADR-0050](ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md), [`A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md`](A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md), `external-settlement.service.ts`, migration `1785753600029` | Implemented/tested; Finance/Ledger approval pending   |
| A6T09 | Independent read-only reconciliation, discrepancy classification, certification fingerprint, support trace     | [ADR-0053](ADR/ADR-0053-Independent-External-Reconciliation.md), [`A6-EXTERNAL-RECONCILIATION-CONTRACT.md`](A6-EXTERNAL-RECONCILIATION-CONTRACT.md), `external-reconciliation.service.ts` | Implemented/tested; live reconciliation drill pending |
| A6T10 | Data minimization, consent, classification, retention, secret, disclosure controls, partner payload validation  | [ADR-0052](ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md), [`A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md`](A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md), [`A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md`](A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md), `external-data-minimization.service.ts`, migration `1785753600030` | Implemented/tested; Privacy/Security approval pending |
| A6T11 | Complete evidence, release/rollback, approvals, exit, and A7 handoff                                                | This documentation package                                                                                                                       | Prepared; approval pending                          |

## 2. A6 acceptance checklist

### End-to-end authority and trace

- [x] A2 authorization is required before external admission and financial execution.
- [x] A6 partner capability is disabled by default and rejects missing/disabled/emergency-stopped/circuit-open/unapproved-partner/capability/version commands.
- [x] A4 policy is current, same-subject, same-capability/action, evidence-bound, expiry-bound, and obligation-bound.
- [x] A3 source/target binding and account dimensions are independently rechecked; A6 never repairs, reassigns, or infers a binding.
- [x] A6T05 external operation metadata preserves Customer, account, command, partner, capability, request, correlation, causation, provider reference, and recovery references distinct from any internal identity.
- [x] Ledger remains the sole authority for accounts, journals, lines, balances, and posted value.
- [x] A successful verified external outcome maps to at most one balanced customer debit / settlement-asset credit journal.
- [x] Settlement, journal, and outbox references are persisted within the settlement/compensation transaction; an outbox fact is not financial truth.
- [x] A6T07 retains logical identity across retries, verifies timeout outcomes, and persists unknown/manual-review states deterministically.
- [x] A6T06 callback authenticity / replay / freshness / partner-scope / dedupe behavior is verified before any lifecycle or financial effect.
- [x] A6T08 routes unmatched / delayed / disputed / partially verified / ambiguous value to an explicit suspense or manual-review state with a named exception owner.
- [x] A6T09 independently verifies external-operation / reference / callback / settlement / suspense / journal / audit / outbox / idempotency evidence read-only.
- [x] A6T10 partner payload validation fails closed for raw secret, customer/wallet/ledger/journal identity, raw risk/compliance, raw device fingerprint, and consent failure; records `A6_EXTERNAL_DATA_CONTROL` audit events through the shared Operations service.
- [x] Disable / circuit-breaker / environment emergency-stop behavior stops new admission without editing completed financial history.

### Failure, recovery, and stop conditions

- [x] Provider serialization / deadlock / timeout / rate-limit retries are bounded.
- [x] Retry exhaustion is non-success and support-traceable.
- [x] Known partner / A2 / A4 / A3 / Ledger / capability / consent / payload failures have deterministic non-success outcomes.
- [x] Commit-timeout and provider-accepted-unresolved evidence is verified before success/retry decisions.
- [x] Unknown / manual-review / pending-recovery outcomes retain a deterministic recovery reference and cannot be retried blindly.
- [x] Outbox / audit / idempotency failure cannot silently report a verified external effect.
- [x] Reconciliation discrepancy classes include missing / duplicate / orphan / mismatched / aged / unsupported / unauthorized / out-of-scope cases.
- [x] Partner stop conditions include reconciliation, journal, outbox, authorization, callback, A6T10 rejection, circuit-breaker, and safety-threshold failures.
- [x] Rollback / disable does not modify external-operation, reference, callback, settlement, suspense, journal, outbox, audit, or reconciliation source history.

### Scope and production edges

- [x] No public API, route, controller, scheduler, broker, external provider, settlement, callback, notification, A7, A8, or product-roadmap expansion is included.
- [x] External banks, NIBSS, settlement, deposits, withdrawals, payments, fees, FX, cards, QR, payroll, credit, savings, and product expansion remain excluded.
- [x] Reconciliation remains read-only.
- [x] No source repair or automatic financial correction is introduced.
- [x] A6T10 partner payload validation fails closed; secrets, identity, risk, compliance, and device material are not transmitted.
- [x] The `partner-callback.controller` route is an A2-protected internal surface, not a public customer or partner endpoint.

## 3. Validation record

```text
npm test                54 test suites passed, 414 tests passed
npm run lint            PASS
npm run build           PASS
npm run format:check    PASS
```

The validation is local repository evidence. It does not claim live PostgreSQL migration execution, production deployment, route exposure, partner certification, capability activation, financial owner approval, or A6 approval.

## 4. Unresolved exit blockers

| Blocker                                                | Severity     | Owner                                                                 | Required evidence                                                                  | Status      |
| ------------------------------------------------------ | ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| A2 phase / route / data-exposure approval              | Blocker      | Security / Architecture / Operations                                  | Approved protected-internal caller and exposure boundary for any A6 surface      | Pending     |
| A3 binding / read / reconciliation approval            | Blocker      | Wallet / Ledger / Finance / Reconciliation                            | Approved handoff and account-control evidence for the external command path        | Pending     |
| A4 ADR / persistence / retention / external-capability policy approval | Blocker | Architecture / A4 / Product / Risk / Compliance / Security / Finance    | ADR review, live migration/rollback, retention/hold decision, external-capability mapping | Pending     |
| A6 ADR-0047, ADR-0049, ADR-0050, ADR-0051, ADR-0052 review | Blocker    | Architecture and accountable owners                                   | Recorded decisions / conditions                                                    | Pending     |
| **ADR-0048 — NIBSS and Bank Integration Isolation**    | **Blocker**  | A6T03 follow-on / Architecture / Security / Operations                | ADR authored and approved before any partner-specific transport/credential evidence | **Not authored** |
| Finance / Ledger settlement / suspense / compensating-entry approval | Blocker | Finance / Ledger                                                        | Approved chart, accounts, posting/recovery controls, audit evidence              | Pending     |
| Partner capability / configuration approval (NIBSS_NIP, `external.wallet.withdrawal.settlement`) | Blocker | Partner / Architecture / Security / Operations / Legal | Capability/version enablement decision, audit evidence                            | Pending     |
| Partner certification (NIBSS or approved sandbox)      | Blocker      | Partner / Security / Architecture / Operations / Legal / Privacy      | Deterministic fixture or approved sandbox certification with expected/observed checks | Pending     |
| Live migration / deployment / rollback evidence (migrations `1785753600026`–`1785753600030`) | Blocker | Database / Operations / Release                                          | Controlled apply, rollback, readiness, and drill evidence                            | Pending     |
| Operations / Reconciliation / Support on-call and recovery approval | High         | Operations / Reconciliation / Support                                   | Runbook approval and operational drill                                              | Pending     |
| A6 callback ingress A2 route/data-exposure decision     | Blocker      | Security / Architecture / Operations                                  | Approved protected-internal route/audience for `partner-callback.controller`        | Pending     |
| A6T10 partner sharing / consent / retention / legal hold decision | Blocker | Privacy / Security / Legal / Compliance                                 | Approved sharing matrix, consent/mandate evidence, retention, legal hold              | Pending     |
| A7 entry approval                                       | Out of scope | Future A7 owners                                                       | Separate A7 plan and governance                                                     | Not started |

## 5. Exit result

**Implementation result:** A6T01-A6T10 implementation/documentation evidence is committed and local automated validation passes.

**Phase result:** `NOT APPROVED / CONDITIONAL — DO NOT ACTIVATE THE PARTNER OR BEGIN A7.`

A6T11 records the evidence and blockers. It does not claim that the selected partner (`NIBSS_NIP`) is connected, certified, or operationally available; that money has moved in production; that the callback route is exposed to the public; that accountable owners have approved the release; or that A7 may begin.
