# Monnify banking provider, settlement and reconciliation — handoff

**Status:** implemented at provider, persistence and service level. Not deployed, not configured with
real credentials, and not exercised against a live provider. Nothing in this repository can currently
move money, because no caller is wired to these services yet.

**Branch:** `arena/defdd0fd-monienaija`
**Migrations:** `1785753600600`, `1785753600601`, `1785753600602`
**Tests:** 65 banking unit + 104 banking PostgreSQL = **169 assertions**, all green against the real
migration chain.

---

## 1. What exists, and what it is for

| File                                                 | Responsibility                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/banking/banking-provider.types.ts`              | Provider-independent contracts. `NOT_SENT ≠ UNKNOWN` is a type, not a comment.                   |
| `src/banking/banking-provider.registry.ts`           | Honest registry. Refuses a provider advertising an unimplemented capability. No fallback lookup. |
| `src/banking/monnify/monnify.errors.ts`              | Envelope → normalized error mapping; credential scrubber.                                        |
| `src/banking/monnify/monnify-token.manager.ts`       | Coordinate token refresh: concurrent callers share one login.                                    |
| `src/banking/monnify/monnify.http.ts`                | Pinned transport, exact-segment path allowlist, bounded bodies.                                  |
| `src/banking/monnify/monnify-webhook.signature.ts`   | HMAC-SHA512 header verification + the separate `transactionHash` scheme.                         |
| `src/banking/monnify/monnify.provider.ts`            | The adapter. Every documented capability, refusing the undocumented ones.                        |
| `src/banking/banking-provider-governance.service.ts` | Propose / approve / publish provider configuration under protected authority.                    |
| `src/banking/banking-outbound.service.ts`            | Durable outbound dispatch. The money-moving core.                                                |
| `src/banking/banking-inbound.service.ts`             | Deposits: recorded, then provider-verified.                                                      |
| `src/banking/banking-virtual-account.service.ts`     | Reserved accounts that refuse to double-provision.                                               |
| `src/banking/banking-webhook.service.ts`             | Ingestion endpoint logic; verification-first, ledger-never.                                      |
| `src/banking/banking-reconciliation.service.ts`      | Observe, compare, raise. No ability to move money.                                               |

---

## 2. The four rules that shaped everything

These are not stylistic preferences; each one exists because the alternative loses money.

### 2.1 A provider is never auto-rerouted, and a reference is never regenerated

The registry has no `getAny()` and no fallback. A missing provider is an error, not an invitation to
try another one. `banking_outbound_operations.operation_reference` is immutable at the database level:
a retry that minted a new reference would be a second, real transfer, so the database refuses the
change rather than trusting every present and future code path to remember.

Operation references are **derived** from `(institution, wallet, idempotencyKey)`, so two concurrent
callers derive the same reference and the unique constraint turns the second into a no-op. A random
reference would make that collision undetectable — this is the difference between uniqueness and
safety.

### 2.2 A timeout is not a failure

`UNKNOWN` is a first-class state in the schema, the types, and the service logic. Timeouts, transport
faults, 5xx responses, adapter throws and unrecognised provider statuses all resolve to `UNKNOWN`.
Only an explicit `PROVIDER_REJECTED` becomes `FAILED`, because only then is nothing at risk.

`NOT_SENT` is the single retryable state, and it exists only when the adapter is certain nothing left
the building.

An uncertain transaction is never shown to a customer as failed. `dispatch()` refuses to run for any
record not in `CREATED`, which is the mechanism — not a note in a document.

### 2.3 Exactly-once internal effects; no exactly-once external claims

The provider may or may not have executed a request we sent. We cannot know. So the system guarantees
exactly-once _internal_ effects (one record, one reference, one dedupe key) and makes no claim about
the external world.

Inbound deduplication is on the provider's own transaction reference, enforced by a unique constraint.
A replayed webhook collides. It also cannot restate the amounts already recorded: a replay carrying a
different figure is evidence of a problem, not permission to edit history.

### 2.4 Reconciliation never adjusts a balance

`banking_reconciliation_runs` has no `adjust`, `journal` or `ledger` column. The resolution vocabulary
is `MATCHED | ACCEPTED_DIFFERENCE | ESCALATED` — there is no `ADJUSTED`. The only way to close an
exception is to record who decided what, with a reason.

Critically, **a check that cannot be performed becomes an exception, not a pass.** This is how the
missing Monnify settlement schema stays honest in the worklist instead of silently absent from it.

---

## 3. Capabilities, and what is deliberately missing

| Capability                     | Status                         | Note                                                                                            |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `BANK_DIRECTORY`               | Implemented                    | `GET /api/v1/sdk/transactions/banks`                                                            |
| `ACCOUNT_NAME_ENQUIRY`         | Implemented                    | Never claims ownership: `establishesAccountOwnership: false`                                    |
| `VIRTUAL_ACCOUNT_PROVISION`    | Implemented                    | Reserve-account V2                                                                              |
| `VIRTUAL_ACCOUNT_STATUS`       | Implemented                    | By our account reference                                                                        |
| `OUTBOUND_TRANSFER_SUBMIT`     | Implemented                    | Two-factor aware; OTP challenge ⇒ `PENDING`                                                     |
| `TRANSFER_STATUS_ENQUIRY`      | Implemented                    | Preserves the provider's raw status word                                                        |
| `INBOUND_PAYMENT_VERIFICATION` | Implemented                    | Gross, fee and credited kept separate                                                           |
| `WEBHOOK_INGESTION`            | Implemented                    | HMAC-SHA512 over raw bytes                                                                      |
| `SETTLEMENT_VERIFICATION`      | **Refused**                    | `MONNIFY_CAPABILITY_UNSUPPORTED` — no documented response schema exists, so one is not invented |
| `PROVIDER_BALANCE_ENQUIRY`     | **Refused, marked DEPRECATED** | Monnify documents the endpoint as deprecated; nothing financial may depend on it                |
| `RECONCILIATION_OBSERVATIONS`  | **Refused**                    | No documented paged observation feed                                                            |
| `REFUND_INITIATION`            | **Not implemented**            | Endpoints are documented but the request/response contract was not confirmed here               |

Refusing a capability is a deliberate outcome, not a gap. An adapter that guesses a response schema
produces a system that looks complete and behaves unpredictably.

### 3.1 The eight-way distinction

"Implemented" says only that code exists. These are the eight states a capability can actually be in,
and they are not interchangeable — conflating any two of them is how a system comes to look finished
while nothing can move:

| #   | State                                                    | Meaning                                                                            | Example here                                                                       |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **Implemented and invoked**                              | Code exists, a caller reaches it, and it is exercised end to end                   | `VIRTUAL_ACCOUNT_PROVISION` via `POST /customers/me/banking/virtual-account`       |
| 2   | **Implemented but never invoked**                        | Code exists and is tested, but no production path calls it yet                     | `BankingAgentFundingService.accountForWalletInTransaction` (inbound float binding) |
| 3   | **Implemented, invoked, unapproved**                     | Reachable, but refuses until an institution approves a provider configuration      | Every outbound transfer on a fresh installation                                    |
| 4   | **Implemented, approved, uncredentialed**                | Configured but cannot authenticate to the provider                                 | `APPROVED_NOT_CREDENTIALED` readiness state                                        |
| 5   | **Implemented and operational, entitlement unconfirmed** | Works mechanically; the commercial right to transact is not established            | `OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED`; `entitled` is always `'UNKNOWN'`        |
| 6   | **Deliberately unsupported**                             | The provider documents the endpoint but not a response schema, so none is invented | `SETTLEMENT_VERIFICATION`, `RECONCILIATION_OBSERVATIONS`, `REFUND_INITIATION`      |
| 7   | **Deliberately refused as deprecated**                   | The provider marks it deprecated; nothing financial may depend on it               | `PROVIDER_BALANCE_ENQUIRY`                                                         |
| 8   | **Deliberately policy-unavailable**                      | Refused by an explicit product decision, not by a technical gap                    | `INBOUND_SUSPENSE_POLICY` (`UnavailableInboundSuspensePolicy`)                     |

Rows 6–8 are outcomes, not backlog. A system that invents a schema for row 6, a balance parser for row
7, or a suspense policy for row 8 would be less trustworthy than one that refuses.

### 3.2 What is wired, and what that means

| Surface                    | Route(s)                                                                    | Reaches                                    |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| Customer receiving account | `GET/POST /customers/me/banking/virtual-account`                            | `BankingVirtualAccountService`             |
| Customer deposits          | `GET /customers/me/banking/deposits`                                        | `banking_inbound_payments` (verified only) |
| Customer transfer status   | `GET /customers/me/banking/transfers/:operationReference`                   | `banking_outbound_operations`              |
| Agent funding account      | `GET/POST /agents/me/banking/funding-account`                               | `BankingAgentFundingService`               |
| Agent deposits             | `GET /agents/me/banking/funding-account/:walletId/deposits`                 | verified inbound payments                  |
| Provider readiness         | `GET /internal/banking/providers`, `/capabilities`                          | `BankingReadinessService`                  |
| Provider governance        | `GET/POST /internal/banking/governance/:institutionId[/proposals…]`         | protected-authority proposal/decision      |
| Reconciliation             | `POST /internal/banking/reconciliation/:institutionId/runs`, `…/exceptions` | `BankingReconciliationService`             |
| Webhook ingress            | `POST /webhooks/monnify`                                                    | `BankingWebhookService` (raw-body HMAC)    |
| Outbound transfer          | **no direct route** — `POST /customers/me/withdrawal-commitments` only      | A6 commitment → bridge → dispatch worker   |

The absence of a direct transfer route is the design. A controller that could submit to Monnify would
bypass eligibility, limits, fee binding, authorization and reservation; there is no such controller, and
the A6 commitment is the only door.

---

## 4. Governance

Banking provider configuration is decision-bearing — it determines who moves customer money — so it
follows the same protected-authority shape as institutional KYC limits:

proposal → protected decision (owner `monienaija_authority_core`; the runtime role has no INSERT) →
append-only version with `CHECK(maker_id <> checker_id)` → decided proposals immutable.

Authority is split: `FINANCE_PREPARER` and `SUPER_ADMIN` propose, `FINANCE_CONTROLLER` alone approves,
and no role holds both. Credentials never enter these tables — only a `credential_bundle_fingerprint`.

The service refuses, before writing anything:

- a provider key the registry does not know, or an environment it is not bound to;
- a capability the adapter does not advertise;
- routing approval for a provider that is not operationally ready;
- self-approval, stale versions, and reuse of a request id for different content.

No configuration is seeded. Approving a configuration cannot manufacture commercial entitlement, an
institution arrangement, or credentials; the row records an operator's assertion, nothing more.

---

## 5. Verification evidence

```
Banking unit tests                       65/65   (registry 6, tokens 14, allowlist 9, webhook 12, adapter 24)
Banking PostgreSQL tests                104/104  (8 suites, real migration chain)
```

| Suite                                 | Count |
| ------------------------------------- | ----- |
| `banking-provider-governance-schema`  | 9     |
| `banking-provider-governance-service` | 15    |
| `banking-operation-records`           | 16    |
| `banking-outbound-service`            | 14    |
| `banking-inbound-service`             | 14    |
| `banking-virtual-account-service`     | 8     |
| `banking-reconciliation`              | 15    |
| `banking-webhook-ingestion`           | 13    |

Run them with the proven disposable-cluster configuration:

```
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
  DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.js --runInBand --runTestsByPath <file>
```

---

## 6. Defects the tests caught

Recorded because each one would have shipped silently, and each shows what the test was actually good
for.

1. **Credential scrubber leaked.** `\S+` stopped at the first space, so `authorization: Bearer abc.def`
   became `[REDACTED] abc.def`. The credential survived _and_ the output looked sanitised.
2. **Path allowlist was both too permissive and too strict.** It accepted `/validateX` by prefix, then
   refused the legitimate reserved-account reference path.
3. **HTTP 5xx was classified as a business rejection.** An outage would have read as "this account does
   not exist" in enquiry, and as a refused transfer in disbursement while the money may have moved.
4. **`login()` cached an empty bearer** on a malformed response, turning one bad answer into a run of
   confusing 401s.
5. **The governance migration granted the protected role nothing to write to.** The schema was correct
   and completely unusable; every approval failed with `permission denied`.
6. **The decision guard was unsatisfiable.** It compared an application-computed sha256 against a
   database-recomputed digest, so no legitimate approval could ever be recorded. A control that refuses
   everything looks strict and is useless.
7. **Idempotent replay ignored the reason**, silently discarding decision evidence.
8. **The outbound DELETE trigger let deletes through.** The `TG_OP='DELETE'` check sat after two
   `OLD`/`NEW` comparisons; on DELETE, `NEW` is NULL, so those comparisons evaluate to NULL and the
   guard fell through — on the one trigger whose entire purpose was refusing deletion.
9. **The reconciliation run counter only incremented when an exception was raised,** so a run that
   checked a thousand clean records reported checking none.

Items 3, 6, 8 and 9 share a shape: the control existed, was reviewed, and did not do what it claimed.
They were caught by asserting _effects_, not existence.

### 6.1 Defects found during consolidated acceptance

These were found by the repository-wide matrix and the journey work, not by the banking suites. They
matter because each one was invisible to the tests that "owned" the area.

10. **TREASURY was widened to make banking reconciliation reachable.** The banking work granted the
    treasury role three banking functions on the plausible reasoning that treasury owns reconciliation.
    Decision 6 states TREASURY holds _exactly_ `reconciliation.view`, and two suites assert the exact
    grant set. This is the mission's stated failure mode — weakening a protected authority boundary to
    make new wiring work. The functions stayed with SUPER_ADMIN and FINANCE_CONTROLLER, which already
    hold financial-execution authority; nothing was added to compensate.
11. **Three banking functions were defined twice** and **`SUPER_ADMIN` was granted two of them twice.**
    The catalogue seeds by `function_code`, so the duplicate definitions were silently absorbed and
    `authorization_functions` ended up three rows short of the array declaring it. Every individual
    lookup still resolved, so only a count assertion could see it. Worse, the two `SUPER_ADMIN` blocks
    _contradicted_ each other: one assigns `banking.provider.approve`; the other's comment said
    SUPER_ADMIN "deliberately does not approve". The database would have held whichever row won.
12. **A suite that passed zero of six cases looked green in aggregate.** `financial-commitment-initiation`
    overrode `WITHDRAWAL_EXECUTION_AUTHORITY` with a stub returning the bare string `'AUTHORIZED'`, but
    the contract returns `{outcome, providerKey, environment}`. The service read `undefined`, took the
    "not authorized" branch every time, and the suite had been asserting the failure path throughout.
    Reproduced identically at `1b26e72a`, so it predates this work. Fixed rather than deleted: a suite
    that cannot pass a single case proves nothing about the boundary it guards.
13. **Five suites pinned a stale migration head.** `migration-chain`, `a8-agent-lifecycle`,
    `stage8-financial-engine-migration` (three sites), `stage10-recovery-migration` (three),
    `a20-outlets-terminals` (four) and `a19-agent-funding` (two) all asserted the pre-banking head
    `0505`. The banking chain is the head; an expectation describing a tree that no longer exists is
    not a passing test.

12 and 13 share a shape with items 3/6/8/9: the test existed and did not test what its name claimed.
That is why the acceptance was run as a matrix rather than by trusting the per-area suites.

---

## 5.1 The consolidated matrix, and the four files that needed individual re-runs

The repository-wide matrix ran sequentially through the documented harness:

```
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=g17qt \
  PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
  DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node scripts/run-pg-integration-tests.js
```

| Measure                     | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| Files discovered            | 166                                                     |
| Batches                     | 28 (6 files each, `--runInBand`, one process per batch) |
| Suites passed               | **162**                                                 |
| Suites failed in the matrix | 4                                                       |
| Total duration              | ~108 minutes                                            |

The four failures were re-run individually on an otherwise idle machine and **all four passed**:

| Suite                                                   | Matrix result             | Individual result |
| ------------------------------------------------------- | ------------------------- | ----------------- |
| `v1-commercial-accounting-01`                           | TIMEOUT (hook)            | **33/33 pass**    |
| `a17-agent-cash-to-cash-expiry`                         | TIMEOUT (test)            | **30/30 pass**    |
| `local-dev-11-roles`                                    | `null` CLI exit status ×5 | **5/5 pass**      |
| `v1-admin-customer-pii-authorization-implementation-01` | no result                 | **48/48 pass**    |

**What these four actually were.** Every one is a resource failure, not an assertion failure: three are
120-second Jest timeouts on hooks or tests, and one is a child CLI process returning `null` status
(killed by the OS) rather than a non-zero exit. None of them produced a failed expectation, a wrong
value, or a permission error. The matrix ran for 108 minutes under a 2.5 GB per-process cap while other
work was in flight in the same sandbox, and these are the four longest suites in the repository.

**What is and is not claimed.** The matrix result stands as recorded — 162 suites passed in the
sequential run, and 4 did not complete. Those 4 were then run separately and passed. This is reported as
it happened rather than by re-running the whole matrix and quietly presenting a single green number,
because "the suite passed when given its own machine" is a different fact from "the suite passed inside
the matrix", and a reader deciding whether to trust this system needs the distinction.

No assertion was weakened, no timeout was raised, and no retry budget was increased to produce these
results. If a future run shows one of these four failing deterministically, that is a real defect and
this note should not be used to excuse it.

---

## 7. What is genuinely not done

Everything in this table is outstanding for a stated reason. None of it is presented as accepted.

| Outstanding                              | Why, and what unblocks it                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settlement verification                  | Blocked on a documented response schema. Inventing a parser would produce a system that looks complete and behaves unpredictably. Not fabricated.                                               |
| Refund initiation                        | Endpoints documented; request/response contract not confirmed here. Not implemented.                                                                                                            |
| Provider balance                         | Documented as deprecated by Monnify. Nothing financial depends on it, deliberately.                                                                                                             |
| Provider reconciliation observation feed | No documented paged observation source, so reconciliation runs against records the platform already holds. Observations from the provider are not invented.                                     |
| Inbound suspense policy                  | `INBOUND_SUSPENSE_POLICY` remains `UnavailableInboundSuspensePolicy`. A verified obligation that cannot be credited is preserved, not discarded and not parked in an invented suspense account. |
| Live provider acceptance                 | No credentials and no entitlement. Out of scope by standing instruction. Capability 5 (`OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED`) is the honest ceiling here.                                   |
| Browser / visual acceptance              | The browser harness cannot launch here: `libnspr4`, `libnss3` and `libnssutil3` are not installable. The three clients are covered by their real test suites, not by screenshots.               |
| Physical-device acceptance               | No handset was used. Not claimed.                                                                                                                                                               |
| Exactly-once _external_ submission       | Not claimed. The Monnify contract does not guarantee it. Exactly-once _internal_ effects are enforced and proven.                                                                               |

Invalidation note for whoever continues: editing application source invalidates the acceptance matrix in
§5. Re-establish it rather than citing it.

Nothing above is presented as accepted. Where acceptance required execution this environment cannot
provide — a real provider, a browser, a physical device — it is listed as outstanding rather than
claimed.
