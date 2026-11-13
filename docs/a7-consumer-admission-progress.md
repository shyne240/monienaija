# A7 consumer and admission integration — partial progress

Admission is **not enabled** and this checkpoint does not satisfy the requested completion criteria. No provider calls, financial execution or posting are enabled by these changes. The outbound-withdrawal direction guard remains unchanged.

## Implemented

- The A7 command and lifecycle services, and reconciliation repository, expose reads of the existing authoritative command and lifecycle tables through the shared persistence read functions. The old reconciliation command/lifecycle lookups no longer use idempotency response bodies as authoritative state. Legacy view contracts that require unstored operation, amount, product state, outcome, map or consent fields still fail closed rather than inventing them. These new read methods do not make the legacy write/consumer contracts compatible.
- Notification and reconciliation legacy authorization and policy lookups no longer turn arbitrary strings into allowed decisions. Notification's legacy binding-map and command-reference checks also fail closed. A7 policy result summaries no longer add obligations absent from the A4 decision.
- Before a pending-to-admitted transition, the write transaction checks the original persisted A2 audit event and locks/revalidates the exact current A3 binding, customer, wallet ownership, wallet and ledger account. It also locks the A4 decision, snapshot and profile, checks the decision/customer/action/binding linkage, effective profile and decision state, rejects superseded decisions, and compares the issued obligation set and deadline fields against the registered A7 profile. These checks do **not** fulfill the outstanding A6 or execution-limit obligations. Admission continues to fail closed.
- Customer-supplied transitions into provider-derived unknown/manual-review states are disabled because no independent provider evidence exists for them. Pending cancellation remains supported.

## Concrete blocker

Both existing A7 A4 profiles (`src/policy/a7-product-policy.profiles.ts`) require `RECHECK_A6_PARTNER_REFERENCE` and `RECHECK_EXECUTION_LIMIT`. Their partner references are profile template labels, not operation-bound evidence. `external_operation_references` only attach to `external_operations`, whose entity and database constraints permit `WITHDRAWAL` / `OUTBOUND_BANK_SETTLEMENT` only. The existing A7 command does not record an independently authenticated inbound/assignment A6 partner-reference identity or the amount/usage and limit identity necessary for the execution-limit recheck. No legitimate source or transaction-bound contract in the current code establishes those facts for this nonfinancial A7 admission. Reinterpreting an outbound withdrawal, using a template string, or declaring required obligations satisfied would violate the direction and evidence requirements. A governed compatible policy/profile and authoritative obligation evidence contract are needed before admission can be enabled; the code must also revalidate the other A4 source evidence and adapt the remaining incompatible consumers.

## Verification

- Guarded disposable PostgreSQL run `a7i02`: 61 passed, 14 failed, 75 total, 6 suites (4 passed, 2 failed). The new authoritative persistence suite passed all 8 tests; A6 financial-commitment initiation, commitment schema and migration readiness passed. The financial-effect suite had 12 failures from fixtures that expect the prohibited outbound withdrawal path; the legacy lifecycle suite had 2 failures expecting response-body-based replay. The latter were already fail-closed at checkpoint `342489a` and the financial-effect guard is unchanged. No claim is made that these suites pass.
- Obligation identity and A7 policy unit run `a7i-unit`: 22 passed, 0 failed in 2 suites. The obligation tests validate the exact profile templates, missing/duplicate/altered obligations and deadlines; they do not demonstrate a successful A4-backed admission.
- Authenticated A6 HTTP behavior was exercised by the financial-commitment suite; there is no A7 HTTP endpoint in this checkpoint, so no authenticated A7 admission HTTP test is claimed.

## Inbound admission checkpoint (incomplete)

A separate draft inbound A4 profile and transaction-bound authority contract now exist. The profile is **not published by this change**. Admission requires its exact active, effective governed definition, a current immutable A4 decision and snapshot, the original authenticated session and authorization, current binding, virtual account and financial eligibility, a positive intended amount, and a trusted inbound authority recheck in the same serializable transaction. The default authority is unavailable. The authority must independently revalidate all relevant evidence, policy, consent, limits, compliance, route and institution, not accept the customer's amount or an A4 snapshot as proof. Evidence references are audited. The intended amount is not a receipt or permission to credit; the verified-receipt execution boundary remains separate and unimplemented here. Existing commands without an amount retain their original replay hash.

The PostgreSQL acceptance fixture publishes a **test-only** profile and uses isolated database-backed source and authority records, a test KYC reader, real customer session/A2/binding and real A4 decision/snapshot persistence. It proves a nonfinancial lifecycle admission, no A6 operation or ledger journal, same-key concurrent replay, admission/cancellation race, rollback on a denied authority, stale route/source/session/profile, missing authority, amount mismatch, compliance hold, limits and corrupt obligations. It is not a production evidence integration, policy approval, HTTP acceptance or a verified payment. No HTTP endpoint presently invokes this persistence admission method; authenticated HTTP acceptance remains outstanding.

The original 14 PostgreSQL failures were examined. The two response-only legacy lifecycle replays now explicitly fail closed, with real persisted concurrent replay tested separately. Twelve financial-effect tests remain failing; changing them into successful inbound settlement would violate scope and direction integrity:

| Legacy test                                       | Current blocker                                                 |
| ------------------------------------------------- | --------------------------------------------------------------- |
| temporary dependency outage and retry             | direction guard precedes the mocked outbound settlement call    |
| uncommitted operation eligibility                 | direct A6 settlement lacks an exact reserved commitment         |
| concurrent settlement                             | direct A6 settlement lacks an exact reserved commitment         |
| provider verification and retry                   | direct A6 settlement lacks an exact reserved commitment         |
| persisted operation version                       | inbound envelope is blocked from outbound withdrawal settlement |
| verified financial effect / balanced journal      | inbound envelope is blocked from outbound withdrawal settlement |
| compensating entries                              | prerequisite inbound-as-outbound settlement is blocked          |
| concurrent compensation                           | prerequisite inbound-as-outbound settlement is blocked          |
| uncertain exhausted outcome / confirmed rejection | prerequisite inbound-as-outbound settlement is blocked          |
| double reversal                                   | prerequisite inbound-as-outbound settlement is blocked          |
| financial-effect idempotent replay                | prerequisite inbound-as-outbound settlement is blocked          |
| injected outbox rollback and retry                | direction guard precedes the attempted outbound posting         |

These need properly authorized outbound A6 commitment fixtures or a separately governed inbound financial execution implementation, as applicable; no historical settlement or inbound credit may be fabricated. Three financial-effect unit tests likewise still expect the prohibited inbound-to-outbound path. The local authority fixture does not establish production institution, consent, regulatory limits or provider authority; those remain blocked until genuinely governed integrations exist.

Validation: guarded PostgreSQL `/home/user/a7in09.log` **67/67** across admission, legacy lifecycle, commitment initiation/schema and migration readiness; broader `/home/user/a7in08.log` **89 passed / 12 failed**, including passing A6 settlement suite. Relevant unit run `/home/user/a7in-units3.log` **236 passed / 3 failed**. TypeScript, changed-file ESLint and `git diff --check` pass. No deployment, main merge, real transactions or live provider calls were performed.
