# ARENA 1 — Sprint 2 Cash-to-Cash financial security

## Alignment and ownership

Fetched `arena/870f970d-monienaija` and verified exact baseline SHA `dc8c1098a0b9a660ac3b5a595149de6c8522aeda`. The restored checkout initially had HEAD `3d05aae` plus a large uncommitted workspace snapshot. The initial merge correctly refused to overwrite it. Preserved the entire snapshot in a named safety stash, fetched this session's previously pushed branch, fast-forwarded to `92ea4a5`, then ran `git merge --no-edit` with the verified baseline. That merge was also a fast-forward: the common baseline already contains the earlier work. Verified baseline ancestry before development. No reset, rebase, force push, branch switch or destructive cleanup was used. The safety stash remains available.

Development only changes the claim service, A16 tests, closely related Agent history test fixture and this report. Baseline integration brings existing other-agent changes into history; no new frontend, authorization catalogue, funding controller or product catalogue edits were made by this sprint. No production deployment or production migration execution. All PostgreSQL migrations were executed solely in isolated local test databases by the integration harness.

## Verified fixes

### Atomic transfer-code failures

Previously the precheck read `failed_attempts`, computed a value in application memory, then wrote an absolute count. Concurrent failures could overwrite each other. The rolled-back transaction fallback also attempted to persist a stale absolute count.

Now an atomic SQL UPDATE increments the current row value, caps at five, sets lock state/reason/time and never updates an already locked or terminal transfer. It is bound to the hash that was actually checked. Failure-count persistence errors propagate rather than being swallowed. Transactional code failures use the same helper after rollback. PostgreSQL tests cover 12 concurrent failures, capped count, preserved OTP, a subsequent valid-code denial, and a valid claim paused during OTP while parallel bad submissions lock its transfer.

### Transaction-bound Agent session and credential evidence

Authenticated claim principals must carry their server-issued session ID. The service checks database ownership, audience, ACTIVE status, revocation, session expiry, credential status/deletion/lock/rotation flag/password expiry and issuance relative to password change. This mirrors the existing Agent session validation requirements rather than inventing new session policy.

The posting transaction SHARE-locks the credential and session rows and rechecks wall-clock expiry after ledger/limit work. A logout or credential change already committed before evidence acquisition denies settlement; one arriving after the locks waits until this posting commits or rolls back. SERIALIZABLE contention retains existing bounded retries. A valid transaction already holding the locks is not retroactively cancelled by a later revocation request. This ordering is demonstrated with `pg_blocking_pids` on a separate connection, not inferred solely from timing.

The initial check also covers consumed-OTP replay requests before returning a previous receipt. Trusted direct wallet-service calls without any Agent principal remain supported for existing internal tests; they are not a public HTTP authentication mode. Public controllers still require authenticated Agent principals.

### Transaction PIN rotation/revocation

Cash mode captures PIN identity/hash/algorithm/version/exact change timestamp before the existing PIN authorization. Inside posting it SHARE-locks the current nondeleted PIN and requires matching evidence and an unlocked account. A rotation, deletion, replacement or lock committed during OTP processing invalidates the earlier proof. Exact SQL timestamp text avoids JavaScript millisecond truncation. No PIN material is placed in receipts, metadata or audit events by this change. The existing verifier remains responsible for hashing and failed-PIN accounting. Wallet mode's existing no-Agent-PIN contract is unchanged.

### Explicit KYC assessment expiry

Wallet mode still requires the authoritative Customer APPROVED status. If a current assessment exists, it must also be APPROVED and must not have passed its explicitly stored expiry. This closes acceptance of known-expired evidence without inventing a freshness duration. The check runs before OTP, in the posting transaction, and after ledger work. Cash mode retains its stricter requirement for a current approved assessment with provenance, and now rechecks its expiry after ledger work too.

Customer and current-assessment rows are SHARE-locked through posting. PostgreSQL tests demonstrate that concurrent evidence rejection waits on these locks, and that evidence expiry during posting rolls back either redemption method.

**Unresolved policy:** legacy APPROVED wallet customers with no current assessment, or assessments with NULL expiry, retain existing eligibility. Mandatory new assessments or a maximum age must be decided by product/compliance; this sprint does not manufacture either. Bare unreviewed documents remain insufficient identity evidence. SERVICE assessment provenance still does not imply human-supervisor verification.

### Accounting, rollback and recovery

Accounting is unchanged:

- CUSTOMER_WALLET: debit unclaimed liability, credit beneficiary Customer wallet.
- AGENT_CASH: debit unclaimed liability, credit authenticated Agent B float.

Existing tests for competing methods, SERIALIZABLE retry recovery, exact one journal, histories/receipts, claim expiry and rollback remain passing. Previous sprint's limit-commit failure fix remains active; both methods roll back failed limit usage and can retry the same financial key with a fresh purpose-bound OTP. New real HTTP tests log in, settle, replay the consumed-OTP request and recover the receipt; each asserts exactly one journal and exact destination/liability balance movement.

## Tests and results

Local prerequisites: `npm ci --ignore-scripts`, existing `scripts/prepare-pg-test-env.js`, local embedded PostgreSQL. Embedded native library links were prepared only under ignored `node_modules`; no dependency or harness changes were committed.

- `npm run build`: PASS.
- `npm test`: PASS — 191 suites / 1,959 tests.
- Atomic-lockout milestone A16: PASS — 51 tests.
- Session/PIN/KYC milestone A16: PASS — 66 tests at that intermediate point.
- Six-suite targeted regression: PASS — 157 tests, including A16 with 69 tests at that point, A17 expiry, Agent history, Agent PIN security, Agent credentials and Cash-to-Cash commercial snapshots.
- Final A16 after positive authenticated HTTP tests: PASS — 71 tests (21 more than baseline A16).
- `git diff --check`: PASS before each implementation commit.
- The first combined session/history attempt caught a TypeScript test indexing error; fixed the non-null lookup and reran. No unresolved test failures in the verification above.
- The entire PostgreSQL suite was not rerun in this focused ownership sprint. Targeted results are not a full platform regression or a blanket UAT approval.

Reproduce the targeted regression:

```sh
PG_TEST_RUN_ID=s2verify npx jest --config jest.integration.config.js --runInBand --runTestsByPath \
  test/a16-agent-cash-to-cash-claim.integration.spec.ts \
  test/a17-agent-cash-to-cash-expiry.integration.spec.ts \
  test/v1-agent-history-01.integration.spec.ts \
  test/v1-agent-05-transaction-pin-security.integration.spec.ts \
  test/v1-agent-credentials-01.integration.spec.ts \
  test/v1-commercial-decision-03c-cash-to-cash-snapshot.integration.spec.ts
```

## Files changed from common baseline

- `src/agent/agent-cash-to-cash-claim.service.ts`
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`
- `test/v1-agent-history-01.integration.spec.ts` — retain real login session ID in service-call principal fixtures.
- `docs/ARENA1-SPRINT2-FINANCIAL-SECURITY-20261026.md`

## Handoff to ARENA 2 / API compatibility

No endpoint, request DTO, response shape, accounting amount or fee/commission changes.

- An expired/nonapproved current wallet KYC assessment now returns 403 instead of permitting payout. Do not offer a bypass based on a submitted document row.
- An Agent session becoming invalid during claim returns 401; the same applies to stale cash-PIN evidence. Resolve authentication/PIN state before retrying. A rotated credential must not silently reuse the old session.
- Session IDs come from runtime server authentication, **not from a new client-supplied field**. Internal callers constructing Agent principals must now include the actual current session ID. Existing runtime guard already supplies it; positive HTTP tests verify this wiring.
- Consumed OTP does not prove settlement. On uncertain response use the same-Agent recovery endpoint first. After a definite rollback, obtain a fresh claim-purpose OTP and retry unchanged financial parameters with the same idempotency key. Existing recovery response contract is unchanged.

## Remaining blockers and cross-cutting findings

1. Product/compliance must specify treatment of legacy APPROVED wallet customers without assessments, NULL assessment expiry and any mandatory evidence freshness period.
2. Human handover approval, expired-fund disposition/refunds, fees and commissions remain unresolved; no rules or implied verification were introduced. UAT authorization for physical payout must resolve mandatory operational controls separately.
3. SHARE-lock ordering can contend with cross-cutting credential/class/customer workflows. Existing bounded SERIALIZABLE retries handle retryable errors, but production load/latency and broader deadlock-order review remain useful. Claims are ordered before or after revocation, not guaranteed to abort for every revocation request merely started concurrently.
4. Wall-clock checks are made after ledger work inside the posting transaction; they are not a promise that time cannot cross an expiry boundary in the remaining interval before commit.
5. Full-platform PostgreSQL regression and combined Mobile/Admin UAT remain release gates. Do not change ARENA 3's policies/catalogue to satisfy unrelated fixtures.
6. Consider a follow-up shared transaction-bound authentication evidence abstraction for other financial services; this sprint intentionally keeps the security change within Cash-to-Cash ownership. Keep it consistent with future changes to the central session validator.

## Pushed implementation milestones

- `ef85b6bf7317860e3fb5d2a45eb106d23805f6c0` — atomic transfer-code failure counting; includes aligned common baseline in ancestry.
- `119bd8cf967d923797de692bdfe06ed9a7dfda09` — locked session/PIN/KYC evidence and race regressions.
- Subsequent delivery commit contains the two positive authenticated HTTP tests and this report; obtain its SHA with `git log`.

Branch: https://github.com/shyne240/monienaija/tree/arena/92fd33dd-monienaija
