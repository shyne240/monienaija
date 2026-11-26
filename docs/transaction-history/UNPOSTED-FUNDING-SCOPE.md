# Request-time funding institution evidence — PR #23

## Source trace and decisions

| Product | Creation / governing request | Pending, rejected and posted historical scope |
| --- | --- | --- |
| Customer Funding | `CustomerFundingService.createRequest` inserts `customer_funding_requests` in its SERIALIZABLE transaction. Input names customer/currency, not an institution. A customer enrolment alone does **not** prove custody. Where the target wallet already has a governed custody receipt, its wallet, ledger account, institution and immutable attribution receipt are authoritative at that instant. | Migration **0807** captures those IDs in `customer_funding_scope_evidence` during the request INSERT. History uses that immutable evidence before a journal exists and retains the same request UUID after rejection or posting. No institution is inferred from current enrolment or a newly attributed wallet at read time. |
| Agent Funding | `AgentFundingService.requestFunding(..., FUND)` validates its platform funding pool and agent target, creates the governed approval and `agent_funding_requests` atomically, and binds its payload to the approval fingerprint. | The native rail is **platform**, not institutional. `validateFundingTarget` refuses institution-attributed wallets before creating either FUND or DEFUND requests. Agent affiliation and maker/checker institutions do not establish funding custody. No institutional snapshot is invented. A real platform auditor can investigate pending/rejected/executed requests; institution-scoped staff cannot. |
| Agent Defunding | Same governed request/approval path with `DEFUND`; execution debits the agent wallet and credits the platform pool. | Same platform-only decision. Pending/rejected/executed lifecycle stays on the request UUID. Institutional float defunding needs an independently authorized institutional source/destination/policy rail; no such path is introduced here. |
| Institutional bank-funded agent float | `AgentFloatFundingService`, separate verified-inbound receipt/policy path | No new pending native agent funding request is created. Existing durable bank/float identity work is preserved; see INBOUND-IDENTITY.md. Do not use that receipt as evidence to relabel an unrelated platform request. |

## What migration 0807 guarantees

`1785753600807-CaptureCustomerFundingScope.ts` creates an immutable linked record keyed by **customer funding request UUID**, with restrictive foreign keys to the request, wallet, ledger account, institution and governed attribution receipt.

- Capture is automatic in the same database transaction as a new PENDING request. Only an existing CUSTOMER wallet whose immutable governed receipt, owner reference, ledger and institution agree is eligible. Wallet/ledger rows are locked for share while capturing. This is request-time evidence, not a backfill from today's customer membership.
- The capture function is a fixed-search-path SECURITY DEFINER trigger, not a callable API. Runtime receives SELECT only on evidence: no INSERT/UPDATE/DELETE/TRUNCATE permission. Validation requires a PENDING, unposted request in the same transaction and agreement with the governed custody receipt. No historical rows are backfilled.
- Evidence cannot be updated/deleted. A request with captured evidence cannot change UUID, customer, currency, principal amount, request hash or reference. This immutable database binding prevents checker execution from switching custody without needing to rewrite an existing maker/checker protocol.
- Any subsequently attached journal must be POSTED under the captured institution and contain the credit to the captured ledger account for the request amount. An unrelated platform journal is refused. A new execution rail cannot silently change the request's historical scope.
- History projects **one request row** using captured institution first, then the original posted journal institution for older posted records. Posting is not a second UNION arm. Detail/reference/list use the same authorization predicate. Agent request history now includes all lifecycle states for explicit platform authority without granting institution staff access to platform records.

No customer/agent affiliation, journal, existing request, credential or role grant is rewritten by this migration. The normal migrations/readiness inventory advances to 171 identities, head `CaptureCustomerFundingScope1785753600807`.

## Legacy and unresolved paths

- A request created without a trustworthy target custody receipt remains unscoped even if the customer is enrolled or the wallet attributed later. Replaying request creation does not manufacture a new snapshot. Legacy pending/rejected requests without original evidence remain withheld from institution staff. An explicit platform attribution reader can investigate them.
- A pre-existing posted journal remains valid historical evidence, preserving existing posted links. There is no fallback to current customer/agent affiliation.
- Backfill would require original request-time custody/authorization evidence tied to the request, not a current wallet lookup. No approval for such a backfill is claimed. `attribution-gaps.sql` enumerates missing evidence, not inferred assignments.
- **Customer Funding posting boundary:** the shipped service debits `PAYMENT-SETTLEMENT_ASSET-NGN`, a platform account. The ledger correctly refuses to mix it with an institution-attributed customer wallet. Capturing pending custody does not authorize that money movement. Institutional customer funding needs an approved institution settlement/source policy and corresponding execution path. This turn does not introduce one.
- Therefore the evidence distinguishes (a) institution-scoped PENDING → REJECTED and a safely refused posting attempt from (b) a successful supported **platform** PENDING → APPROVED lifecycle. It does not claim that an institution-scoped request was successfully funded through an unsupported rail.
- Institutional Agent Funding/Defunding needs a product/Finance decision and a governed institutional rail before request creation can carry authoritative institutional funding context. A current affiliation or arbitrary institution input is insufficient.

## Real PostgreSQL / workforce verification

`v1-001-customer-funding.integration.spec.ts` uses the real AppModule, fully migrated disposable PostgreSQL, controlled KYC evidence, real persisted MFA workforce sessions and governed institution/enrolment/wallet-attribution workflows. It proves:

1. Owner OPERATIONS can find and open a newly captured PENDING request; a separate institution's OPERATIONS gets empty exact-reference results and detail 404.
2. An earlier request without custody evidence stays withheld after wallet attribution; direct retrospective evidence insertion is refused and runtime mutation privileges are absent.
3. Suspending the original governed enrolment and enrolling the customer with another institution changes neither historical access nor captured evidence.
4. Rejection retains the same UUID and one history row. Evidence/identity mutation and an unrelated posted journal are refused.
5. The actual institutional posting attempt rolls back with the ledger's mixed-scope refusal; request/history remain PENDING until explicit rejection.
6. A separate supported platform customer request is read pending by a real platform auditor, successfully approved through the real funding/ledger services, and still appears once with the same UUID. Institution staff cannot read it before or after posting.

`a19-agent-funding.integration.spec.ts` additionally proves real-session platform-auditor access to FUND and DEFUND pending/rejected/executed requests, institution OPERATIONS denial, no access gained from governed agent affiliation, and one request row after real governed approval/execution. No synthetic bearer adapter is used for these reads. Request execution helpers use the existing domain maker/checker test principals; this is not a claim that the remaining product browser matrix ran.

Artifacts: `evidence/unposted-funding-scope.json` and `evidence/platform-agent-funding-scope.json`; they contain saved hashes, pending/rejected/posted details, exact capture evidence and the actual posting refusal, never session tokens. Commands/counts are in `evidence/test-results.md`.

## Still draft

Remaining browser matrix, mixed-product performance plans, Finance #25 real round trip and unresolved inbound paths remain subsequent-turn gates. Institutional funding execution/backfill decisions above are explicit additional boundaries, not implied approvals.
