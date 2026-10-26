# A6 Operational Recovery and Support Runbook

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Runbook prepared for Operations/Security/Privacy/Legal/Finance/Support review; not a production authorization
- **Classification:** Documentation-only operational recovery evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Operating principles

A6 recovery is evidence-preserving control and support work:

- A2 authorization, A4 policy, A3 binding, A6 partner capability, Ledger, Operations, and Reconciliation answer separate questions.
- A provider response, callback, statement, external reference, or outbox fact is not financial truth.
- An A4 allow or partner capability allow is not financial execution approval by itself.
- An unknown, timeout, or ambiguous outcome is not optimistic success and not permission for blind retry.
- Partner disable / circuit-breaker / rollback stop new external admission only and never rewrite completed internal financial history.
- Diagnostics, support, and reconciliation are observational/read-only and cannot repair or authorize.
- A6T10 data minimization, consent, retention, legal-hold, and secret-handling controls apply to every incident response surface.
- Restricted customer, account, funding, partner, credential, risk, and compliance evidence is minimized, access-controlled, and audited.

No scheduler, broker, external publisher, public route, automatic financial correction, or notification path is part of A6T11.

## 2. Evidence sources and access

Use only approved A2-authorized internal read paths and owner-controlled evidence:

1. A2 authorization / principal / session / privileged-action / security-event evidence.
2. A4 policy decision / profile / snapshot / version / expiry / obligation / limit references.
3. A3 binding / read / reconciliation / control evidence.
4. A6 partner capability / version / disabled-state / circuit-breaker / connection-disabled decision and audit evidence.
5. A6T05 external-operation identity, immutable command, request/correlation/trace/causation, provider reference, callback receipt, recovery references.
6. A6T06 callback authenticity / replay / freshness / dedupe / partner-scope evidence.
7. A6T07 lifecycle state, retry, timeout, circuit-breaker, status-verification, and unknown-outcome evidence.
8. A6T08 settlement, suspense, reversal, and compensating-entry evidence; Ledger journal, line, and account evidence through Ledger-owned reads.
9. A6T09 independent read-only reconciliation report and discrepancy classifications.
10. A6T10 consent assertion, retention classification, legal hold, secret classification, and disclosure audience-maximum evidence.
11. Operations idempotency, audit, outbox, metrics, diagnostics, and request context.
12. Application version, migration head, release/disable control, incident, and support references.

Do not copy credentials, certificates, signing keys, callback secrets, partner confidential material, raw funding data, raw risk/compliance notes, full ledger lines, mutable balances, device fingerprints, customer PINs/OTPs, or unrestricted customer records into broad support channels.

## 3. Incident classification and immediate action

| Incident                                              | Immediate safe state                                | First owner                  | Preserve                                                                                                          | Prohibited response                                                  |
| ----------------------------------------------------- | --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Environment emergency stop / partner capability disabled | External admission denied                          | Operations / Release         | Control version, request/correlation/trace IDs, audit fact                                                        | Clearing the stop in a customer or partner command                    |
| A2 authorization failure                              | Protected path denied                               | A2 / Security                 | Principal, resource/action, denial, security event                                                                 | Treating as policy allow or bypassing A2                              |
| A4 deny / pending / expired / currentness failure      | No execution                                        | A4 / Risk / Compliance       | Decision / profile / snapshot / expiry / reason / evidence references                                              | Editing policy or source evidence                                     |
| A3 binding / account discrepancy                      | No account selection / posting                       | A3 / Wallet / Ledger         | Binding IDs / versions, account dimensions, reconciliation report                                                    | Repairing or reassigning in the external command path                  |
| Ledger rejection / imbalance                          | Journal-free failed outcome                         | Ledger / Finance             | External operation, settlement attempt, journal attempt, account/currency/unit, error code                          | Editing a journal or balance                                          |
| Provider authentication / signature / version failure  | External admission denied; circuit-breaker records  | Partner / Security / Operations | Capability / version, credential configuration, signature envelope                                                  | Bypassing A2 or partner auth                                          |
| Partner payload rejection (raw secret / identity / risk / compliance / device / callback material) | A6T10 partner payload validation rejects the payload; no partner transmission | Privacy / Security / Compliance | `A6_EXTERNAL_DATA_CONTROL` audit evidence, rejected field list, reason code                                        | Sending the payload with raw fields to the partner                    |
| Consent missing / expired / revoked / purpose / jurisdiction mismatch | A6T10 consent validation rejects; no partner transmission | Privacy / Legal / Compliance | Consent assertion, expiry, jurisdiction, purpose references, A6_EXTERNAL_DATA_CONTROL audit                       | Defaulting to transmission or impersonating the grantor                |
| Serialization / deadlock / timeout exhaustion          | Bounded retry conflict; no optimistic success        | Operations / Ledger          | Attempt count, SQLSTATE, same command/key, trace                                                                   | Unbounded retry or new financial identity                             |
| Provider-accepted but unresolved                       | Verify durable external-operation evidence          | Partner / Operations / Reconciliation | External-operation, callback, provider reference, settlement, journal, outbox, idempotency, audit references        | Blind retry or optimistic success                                     |
| Callback authenticity / replay / freshness / partner-scope failure | Callback rejected; A2 protected-internal ingress quarantines receipt | Security / Partner / Operations | Signature/MAC, freshness, schema, partner scope, replay/dedupe state, audit                                        | Advancing lifecycle or financial state from the invalid callback      |
| Missing / duplicate / mismatched outbox / audit / idempotency | Stop new external admission if threshold applies   | Operations                   | Event key, payload hash/content, aggregate, transaction references, A6_EXTERNAL_DATA_CONTROL audit                  | Treating outbox as financial truth or editing payload                  |
| Reconciliation `ERROR` discrepancy                    | Stop new external progression                        | Reconciliation / Finance     | Read-only discrepancy report and source refs                                                                       | Repairing source rows from the report                                  |
| Audit / idempotency / Operations evidence unavailable  | Fail closed; no untraceable execution                | Operations                   | Safe failure, request/correlation, attempted action                                                                | Returning success without evidence                                    |

## 4. Standard recovery procedure

1. **Open an incident.** Record release/application version, partner capability version, capability/action, safe request/correlation/trace IDs, incident ID, and owner.
2. **Authorize access.** Verify the operator/support principal through A2 and apply least-privilege/audience controls.
3. **Stop new external admission.** Activate the environment emergency stop, durable partner capability disable, or circuit-breaker if financial truth, reconciliation, authorization, callback authenticity, outbox, audit, or unknown-outcome safety is uncertain.
4. **Preserve evidence.** Retain external-operation, provider reference, callback receipt, settlement, suspense, journal, outbox, audit, idempotency, partner capability, and reconciliation records under applicable legal-hold/retention controls.
5. **Trace the operation.** Start with `externalOperationId`, idempotency scope/key/request hash, correlation/causation/request/trace IDs, then follow customer/account/binding, A4 policy reference, partner capability, provider reference, callback receipt, settlement, journal, outbox, audit, and A6T09 reconciliation references.
6. **Verify financial truth from Ledger.** Confirm journal identity, immutable lines, debit/credit totals, currency, accounting unit, account IDs, and Ledger-derived balances through Ledger-owned reads.
7. **Verify lifecycle truth.** Confirm external-operation state, journal reference, failure/recovery fields, optimistic version, and whether the result is `SETTLED`, `REJECTED`, `CANCELLED`, `PENDING_VERIFICATION`, `MANUAL_REVIEW`, or `UNKNOWN`.
8. **Verify callback truth.** Confirm callback authenticity/replay/freshness, partner scope, dedupe state, and provider reference mapping without trusting the callback as financial evidence.
9. **Verify Operations evidence.** Check the relevant idempotency record, `A6_EXTERNAL_OPERATION` / `A6_EXTERNAL_SETTLEMENT` / `A6_EXTERNAL_DATA_CONTROL` audit facts, outbox event key/payload/status, and metrics/diagnostics.
10. **Verify A6T10 minimization/consent/secret state.** Confirm the partner payload was validated, consent assertion is current/purpose/jurisdiction-valid, secrets are not exposed, retention/legal hold are applied, and audience maximums are enforced.
11. **Use bounded recovery only.** A6T07 performs bounded serialization/deadlock retry and timeout verification. Do not invent a new external-operation identity, account, journal, key, or outbox event to resolve ambiguity.
12. **Reconcile independently.** Run the read-only A6T09 reconciliation report and classify discrepancies. Reconciliation does not repair.
13. **Escalate to the owner.** Assign A2 / A3 / A4 / Partner / Security / Privacy / Legal / Ledger / Finance / Operations / Reconciliation / Support ownership based on the discrepancy classification.
14. **Close only with evidence.** Record decision, mitigation, stop/disable state, recovery reference, remaining discrepancy, follow-up owner, and approval. Do not claim financial resolution solely from an application response.

## 5. Recovery decision matrix

| Observed state/evidence                                                                                  | Safe interpretation                                  | Action                                                                  |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Verified external operation, valid matching Ledger journal, valid outbox/audit/reconciliation evidence     | One verified external financial effect               | Keep history immutable; reconcile/support trace                          |
| Verified external operation without journal or with invalid journal                                          | Controlled discrepancy; do not downgrade/edit row    | Stop partner progression, escalate Ledger/Reconciliation                |
| External operation after unexpected failure, no verified journal                                             | Unknown outcome                                       | Preserve recovery reference; hold new retry until controlled recovery     |
| Unknown / Pending Verification / Manual Review with valid recovery reference                                | Financial outcome unresolved                          | Operations/Ledger verification; no blind retry                            |
| Rejected / Cancelled / Failed with no journal                                                                | Verified non-success metadata outcome                 | Preserve record; no compensating financial mutation                       |
| Outbox missing / duplicate / payload mismatch                                                                | Operations evidence discrepancy                        | Stop threshold if required; do not alter financial truth                  |
| A2 / A4 / A3 / partner capability denial                                                                      | Command did not enter external execution             | Preserve audit; do not create external operation to simulate execution   |
| Retryable serialization / deadlock                                                                            | Transaction was boundedly rejected                    | Retry same logical identity only within bound                             |
| Retry exhaustion                                                                                             | No optimistic success                                  | Return controlled conflict and escalate/support trace                    |
| A6T10 partner payload rejection with raw secret / identity / risk / compliance / device material              | Privacy / Security incident; no partner transmission  | Preserve `A6_EXTERNAL_DATA_CONTROL` audit; escalate to Privacy/Security    |
| A6T10 consent rejection                                                                                       | Privacy / Legal incident; no partner transmission    | Preserve consent assertion evidence; escalate to Privacy/Legal             |
| A6T09 reconciliation `ERROR` discrepancy                                                                      | Independent control evidence failed                    | Stop new partner progression; escalate Reconciliation/Finance              |

## 6. Disable and rollback-safe procedure

1. Set `A6_PARTNER_CONNECTION_DISABLED=true` and call the authorized durable partner capability disable.
2. Verify new external operations return the expected denial code and do not reach the partner adapter, callback, or Ledger.
3. Preserve all completed external-operation, provider reference, callback receipt, settlement, suspense, journal, outbox, audit, idempotency, partner capability, A4 policy, A3 binding, and reconciliation records.
4. Do not delete, reverse, edit, or backfill completed external operations, settlements, journals, lines, balances, or outbox facts.
5. Investigate in-flight `SUBMITTING`, `PENDING_VERIFICATION`, `MANUAL_REVIEW`, and `UNKNOWN` states through A6T07 status verification and Ledger/Operations evidence.
6. Run the A6T09 independent reconciliation report and record discrepancies.
7. Roll back code/config only after compatibility with the applied schema and immutable historical records is assessed.
8. Keep the partner disabled until the cause, owner, mitigation, stop condition, and approval are recorded.
9. Re-enable only with a new A2-authorized control mutation and a reviewed go/no-go decision.
10. Treat any approved financial correction as a Ledger/Finance compensating-entry decision outside A6T11.

Disabling the partner is not a financial rollback. It changes admission, not history.

## 7. Support trace contract

An approved support trace may include, subject to A2 audience authorization and A6T10 disclosure audience maximums:

```text
externalOperationId
externalOperationReference
partnerKey
capabilityKey
capabilityVersion
source customer UUID (when the audience is FINANCE / RECONCILIATION / SECURITY)
internal command ID
A2 authorization reference (subject, scope, audience)
A4 decision / profile / policy / snapshot / evidence references
partner capability / version / circuit-breaker / disable decision
idempotency scope / key / request hash
request / correlation / trace / causation IDs
provider reference type / namespace / SHA-256 hash (never the raw reference value)
callback event ID, status, rejection code, signature hash (never the signature itself)
settlement ID, decision, status, journal ID (not the lines or balances)
suspense entry ID, reason, owner (when present and the audience allows)
A6T10 consent assertion ID, classification, retention, legal hold
A6T09 reconciliation discrepancy codes
A6_EXTERNAL_DATA_CONTROL audit IDs (not the full newValues payload)
recovery reference
```

The trace must not expose credentials, signing keys, callback secrets, raw callback signatures, raw provider references, mutable balance snapshots, full journal-line payloads, full outbox payloads, raw risk/compliance content, raw device fingerprints, customer PINs/OTPs, or any field above the audience's A6T10 maximum. Support reads are audited by Operations through `A6_EXTERNAL_DATA_CONTROL` and `A6_EXTERNAL_OPERATION` audit events.

## 8. Operational ownership and stop conditions

- **A2 / Security:** principal, authorization, route/data exposure, partner authentication, callback secret, security incident.
- **Privacy / Legal / Compliance:** consent, retention, legal hold, secret handling, partner payload sharing, restricted data exposure.
- **A4 / Product / Risk:** policy decision / currentness / source evidence / obligations / limits / recovery.
- **A3 / Wallet:** customer / account / funding-instrument binding, ownership, lifecycle, and binding control evidence.
- **Partner owner:** partner capability / version, signing, callback authentication, environment, sandbox/certification.
- **Ledger / Finance:** accounts, journals, lines, balances, posting, financial discrepancies, settlement, suspense, compensating entries.
- **Operations:** idempotency, audit, outbox, metrics, diagnostics, readiness, retention, incident evidence, control mutation history.
- **Reconciliation:** independent read-only discrepancy reports.
- **Support:** approved trace access and customer/internal communication under owner controls.

Stop new partner activity for journal imbalance, unexplained balance drift, missing or corrupt outbox, audit/idempotency failure, A2 authorization failure, repeated unknown outcomes, reconciliation `ERROR`, A6T10 partner payload rejection rate above threshold, or any unexplained identity/account mismatch.

## 9. Runbook readiness evidence

- [x] A6T06 callback authenticity / replay / freshness / partner-scope behavior is linked.
- [x] A6T07 lifecycle / retry / timeout / circuit-breaker / unknown-outcome behavior is linked.
- [x] A6T08 settlement, suspense, reversal, compensating-entry behavior is linked.
- [x] A6T09 independent read-only reconciliation and discrepancy classifications are linked.
- [x] A6T10 data minimization, consent, retention, legal hold, secret, and disclosure controls are linked.
- [x] A2 / A3 / A4 / Partner / Security / Privacy / Legal / Ledger / Finance / Operations / Reconciliation / Support ownership is explicit.
- [x] No repair writer, public exposure, scheduler, broker, external integration, or financial correction is introduced.
- [ ] Operations / Security / Privacy / Legal / Finance / Reconciliation / Support approve the runbook.
- [ ] On-call / recovery drill and live deployment evidence are recorded.
- [ ] Partner certification and A6 phase approval are recorded.

This runbook is an operational decision input. It does not authorize production recovery, partner activation, route exposure, or A7 work.
