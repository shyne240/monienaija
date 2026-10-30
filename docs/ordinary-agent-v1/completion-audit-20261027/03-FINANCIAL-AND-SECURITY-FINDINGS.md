# 03 — Financial Correctness and Security Findings

**Audit SHA:** `b8a5b94ee55aad7407dd78068428b3e97236ce8e` · Evidence standard: executed real-PostgreSQL integration suites at this SHA (full run `intfull3`: 116 suites / 2237 tests, exit 0) plus targeted batches cited inline. Assertions quoted are persisted-state reads (journal lines, balances, status rows, audit rows), not mocks. No production financial operation was executed; all databases are disposable harness instances.

---

## 1. Approved financial effects — verification status per flow

| Flow | Approved effect (source) | Verified evidence | Status |
|---|---|---|---|
| Cash-in (C2W) | Debit agent float wallet, credit customer wallet; journal `agent → wallet` (A21 §2.3) | a13 persisted journal/balance assertions; a12 execution invariants | VERIFIED |
| Cash-out (W2C M1) | Debit customer wallet, credit agent float; agent PIN + customer PIN + purpose-bound OTP | a14 + v1-agent-mfa-api-01; denial paths assert zero mutation | VERIFIED |
| Funding / defunding | Platform pool (`AGENT_FUNDING_POOL-NGN`) ↔ agent wallet, maker-checker, MFA assurance | a19 (pool exists; balanced journals; governance denials); funding-inbox suites | VERIFIED |
| C2C initiation | Debit agent float → credit unclaimed-liability (hold); transfer row + code hash + expiresAt inside one SERIALIZABLE transaction with commercial snapshot and limit usage | a15; commercial-snapshot suites; snapshot immutable ("never re-evaluated" — in-code contract) | VERIFIED |
| C2C claim — CUSTOMER_WALLET | Debit unclaimed liability + credit verified beneficiary wallet | a16 exact-journal tests (independent line reads) | VERIFIED |
| C2C claim — AGENT_CASH | Debit unclaimed liability + credit Agent B float, **without** additionally crediting beneficiary wallet | a16 exact-journal tests | VERIFIED |
| C2C expiry (financial leg) | No posting after deadline; late expiry inside posting transaction aborts + rolls back | a17 `pg_sleep` late-deadline test; a16 test 39 deadline re-check under posting lock | VERIFIED |
| C2C expiry (status leg) | UNCLAIMED → EXPIRED transition + audit | Service verified by a17 **but has no production trigger** (matrix OA-40) | PARTIAL — operational gap, no financial exposure (claim paths fail closed regardless of status column) |
| Fee/VAT | Server-authoritative values; currently `feeMinor=0n`, `vatMinor=0n` hardcoded on C2C; no fee concept on cash-in/out | Source inspection (`agent-cash-to-cash.service.ts:140-142`); fee/VAT accounting machinery verified separately (scope-challenge §11-D) | CONSISTENT with "no invented rates" posture; values are policy (register D3) |
| Commission | ONE economic decision per C2C transfer at INITIATION; claim deliberately `commissionNone()`; agent's own allocation exposed read-only in history | In-code contract comments + v1-commission-01 test 02 + v1-commission-runtime-wiring test 22 (exactly one allocation) | VERIFIED |

## 2. Invariant-by-invariant findings

1. **Double-entry correctness:** every financial suite asserts debits = credits per journal/currency from persisted `ledger_lines`; trial balance and the 9-check reconciliation report pass (reconciliation suites). No floating single-sided posting was found in any executed path.
2. **Agent float is ledger-derived only:** the contractual prohibition on `agents.balance_minor` is enforced by a21's information-schema assertion (no such column) — the ledger remains the single balance truth.
3. **Unclaimed liability:** C2C holds land in the liability account at initiation and leave it exactly once — at claim (either method) or never (expiry retains the liability; automatic refund/forfeiture does NOT exist and must not be invented — register D2).
4. **Exactly-once settlement:** verified under (a) same-key replay → `REPLAYED` result, (b) conflicting-payload same-key rejection, (c) concurrent customer-wallet vs agent-cash race on one transfer, (d) number-route vs UUID-route race (same financial fingerprint converges), (e) injected limit-commit failure → full rollback (journal, transfer state, idempotency reservation) with fresh-OTP same-key retry posting exactly once.
5. **Concurrency controls:** SERIALIZABLE transactions + `FOR UPDATE` row locks (SHARE locks on lifecycle/class rows during cash payout), `SKIP LOCKED` batch sweep, atomic SQL bad-code counting (S2 hardening — concurrent brute-force cannot exceed the five-attempt lockout), DB-backed locator rate budgets charged before pair resolution and persisting outside settlement transactions.
6. **Limits:** enforced before ledger writes in the same SERIALIZABLE manager (V1-LIMIT-04); commit failure now fails the whole operation instead of silently succeeding (ARENA 1 Sprint fix, regression-tested); most-restrictive-wins assignment via maker-checker catalogue.
7. **Idempotency:** unique per-agent idempotency keys + `requestHash` canonical-JSON comparison on every financial write; mobile persists keys across app restarts (dedicated persistence suite) so retries cannot duplicate money.
8. **Reversals:** double-reversal is impossible (`reversal_of_journal_id` uniqueness); the operational reversal *workflow* (reason, maker-checker, notifications) does not exist — provisional V2 by record, decision V1-017 never formally closed (register D-extra).

**Financial verdict:** the approved Ordinary Agent V1 accounting model is implemented and machine-verified. The only financial-adjacent deficiency is the untriggered expiry status sweep (OA-40), which has no fund-safety impact (claim-time enforcement is independent of the status column) but leaves expired transfers mis-stated as UNCLAIMED in monitoring and never emits the expired event.

## 3. Security findings

**Verified controls (evidence at this SHA):**
- Credentials: PBKDF2 password + PIN hashes; session tokenHash storage (never raw); 15-minute TTL; mandatory first-login rotation; reissue revokes credential AND sessions atomically.
- Authorization: fail-closed capability evaluation (ACTIVE + class + HMAC); route-policy registry with SELF binding and cross-agent 404; customers categorically denied on `/agents/*`; WORKFORCE_SESSION guard enforces only declared gates with full controller parity (no privilege drift); FINANCE_CONTROLLER holds no `agent.view`; SUPER_ADMIN excluded from funding by Decision 7; read-only principals rejected before declared gates.
- Maker-checker: funding and limit-assignment both require distinct initiator/approver identities with MFA session assurance on approval; same-actor attempts rejected in tests.
- Secrets hygiene: audit `previous/new_values` never contain password/pin/token/transferCode (asserted); pino redaction covers pin/token paths; workforce history masks phones (`803***6543`); locator share/receipt text structurally excludes the secret code (`SafeCashToCashResult`); mobile keeps transferCode in memory only, display-once, cleared on unmount, never in navigation params or Zustand.
- Anti-enumeration/anti-abuse: uniform 404 `C2C_CLAIM_NOT_AVAILABLE` across all locator failure causes; 429 budgets (20/agent, 100/sender-phone, 10/pair per 60s); 100ms timing floor + fast-path 404 mask on retry-required (documented as NOT a constant-time guarantee); five-attempt atomic lockouts on transfer code and PIN.
- Transaction-bound session revalidation: credential/session revocation during an in-flight claim aborts posting (a16).
- Migration safety: immutable locator pairs (trigger), FK RESTRICT, destructive `down()` refuses after issuance, production-readiness startup guard synced to chain head (`d23c51b`, v1-release-01 3/3).

**Findings requiring attention (none exploited; all recorded):**
1. **OA-40 expiry trigger absence** — operational-security hygiene: stale UNCLAIMED rows obscure monitoring and delay liability reporting. Fix is contained (see backlog B1).
2. **No privileged PIN-unlock path exists** (by design) — correct security posture, but operationally there is currently NO recovery route for an agent who locks or forgets a PIN beyond workforce credential reissue (which does not reset the PIN). Governance decision D6 must land before scaling real agents.
3. **Agent credential self-change absent** (OA-12): agents who rotated at first login cannot later change their own password; workaround is workforce reissue (audited, session-invalidating). Acceptable interim; decision recorded.
4. **Timing-floor limitation** on locator 503/404 masking is documented and must remain documented (not a defect; do not overstate).
5. **Dependency advisories** at this SHA: root 0, admin-web 2 (esbuild moderate dev-server CORS; vite high → breaking vite@8), agent-mobile 21 (1 critical transitive `tar`; highs expo/@expo/cli/xmldom/cacache/image-size/node-forge) — build/dev-toolchain exposure; security-owner reachability review required before native release (backlog B8).
6. **No penetration test or browser/device UAT** has ever been executed — automated evidence is strong but is not adversarial testing (explicit non-claim).

## 4. What was NOT done in this audit (bounds)

- No production or staging system was contacted; no migration was run outside disposable harness databases (and none at all during this read-only audit — the cited runs are from Sprint 3 Phase 6 at this exact SHA).
- No new tests were written; no application code was modified.
- Exhaustive interleaving certification (formal methods) was not attempted; concurrency claims rest on the executed race suites listed above.
