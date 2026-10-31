# Mission 15A — Ordinary Agent V1 backend handoff

**Date:** 2026-10-30 · **Owner:** Arena 1 backend · **Branch:** `arena/92fd33dd-monienaija` · **State:** implemented and targeted-tested; not merged, deployed or approved for production.

## 1. Baseline, scope and commits

- Exact integration baseline: `9588329d639ab45b76ffe648ba2ef00951384ca2`, safely incorporated by fast-forward on the fixed Arena branch. No other branch was created, switched, rewritten, merged or pushed.
- `f61adad` — lifecycle/session invalidation, administrative bulk session revocation and transaction-scoped claim authentication recheck.
- `9eb456e` — scoped route/controller authorization alignment, activation boundary, Outlet/Terminal metadata updates, expiry-status read and focused tests.
- API contract for Arena 2: [mission-15a-api-contract-20261030.md](mission-15a-api-contract-20261030.md). Later documentation/test-only polish is recorded in the branch log.
- No Admin Web or mobile files were modified. `apps` tree at both baseline and implementation is `f4adb121e3061a3f325f91334c90df73a481128a`. No authorization-catalogue, funding-controller or product-catalogue source file, provider adapter, financial posting implementation or migration was modified. No new schema migration is necessary.
- No deployment, merge, production migration, provider activation, real credentials, vendor call, real payment or production data operation was performed. PostgreSQL used for the tests was an isolated local test instance.

## 2. Delivered backend behavior

1. **Sessions:** SUSPENDED/TERMINATED lifecycle transitions take the Agent row lock and revoke every ACTIVE Agent session, with per-session audit, in the same transaction as the state change. Issuance takes the same Agent lock before the credential lock and rechecks ACTIVE/non-deleted status and credential evidence. Every validation rejects deleted or non-ACTIVE Agents. C2C claim also rechecks and locks active Agent evidence inside its existing transaction. Reactivation does not restore normally revoked sessions.
2. **Administrative session-only revocation:** `POST /internal/admin/agents/:id/sessions/revoke` requires `agent.manage_credentials`, works for any lifecycle state and soft deletion, records a zero-count attempt as well as per-session revocations, and leaves credentials unchanged. Fresh valid logins are still possible for an ACTIVE Agent. The precise contract and error codes are in the API document.
3. **Authorization:** internal Outlet/Terminal GET/HEAD now require `agent.view` in controller and route policy. Agent application review, activation, lifecycle, credentials, Agent reads and C2C oversight now declare their matching catalogue functions. Application activation uses `agent.activate`, not just `agent.review_application`; the compatibility aliases no longer mask application approval or other failures by blindly falling back to direct Agent activation. Existing claimant non-enumeration, type restrictions, MFA and maker/checker are not relaxed.
4. **Audit preservation under the guard:** for explicitly marked Mission 15A Agent policies only, the runtime guard records a denied single-function decision before returning its existing 403. Successful requests continue to obtain exactly one controller authorization decision. This scoped change in `runtime-access.guard.ts` overlaps Arena 3's guard ownership: **Arena 3 should review this flag and its denial-only test when integrating**, rather than generalizing it to unrelated routes or changing the authorization catalogue. Existing read-only-method gate precedence is unchanged.
5. **Metadata:** `PATCH /internal/outlets/:outletId` and `PATCH /internal/terminals/:terminalId` use required `expectedVersion`, real row locks, version increments (including accepted no-op PATCHes), transaction-scoped before/after audit and a 409 on stale input. Ownership, reference, code and lifecycle are not editable. Existing lifecycle writes take the same row lock, preventing status-versus-metadata lost updates. Outlet display/address fields feed the existing public locator without exposing Agent identities.
6. **Expiry visibility:** `GET /internal/admin/cash-to-cash/expiry-status` requires `transaction.view` and reports a one-statement database snapshot of due count, oldest due timestamp and EXPIRED count, with explicitly process-local worker configuration/timer/in-flight state. It never invokes the worker or performs money disposition. Existing expiry/claim behavior and worker opt-in default are unchanged. Status is not a fleet-wide worker-health or latest-success signal.
7. **Verified, not rewritten:** existing funding/defunding requests, independent MFA checker inbox/approval/execution, receiving-number SELF/workforce boundaries and Agent/workforce unified history remain covered by the focused PG run. The formerly stale history test that expected a SUSPENDED Agent token to remain valid was updated to require 401 and verify that authorized workforce oversight still works.

### Important boundaries

- Lifecycle *service transitions* persist revocation. An out-of-band status or soft-delete write is also rejected during validation, but there is no new database trigger that records revocation for arbitrary raw writes or prevents a token from becoming valid again if such a write is reversed without any normal transition. Use the authorized lifecycle/revoke endpoints. Already executing requests are not universally canceled; the claim flow has its own transaction recheck.
- Session revocation alone is not credential disablement and does not stop new logins on an ACTIVE Agent. Any stronger identity/credential control needs a separate approved workflow.
- Read-only expiry metrics do not decide D2, reflect monetary balances, or authorize a refund, forfeiture, release, redistribution or manual sweep. Existing expiry marks status/audits only, and retained liabilities stay governed by existing accounting controls.
- PUBLIC locator and C2C audit/status do not prove a physical handover, human supervision, identity verification, or the validity of unreviewed documents. No sensitive transfer secret, password, PIN or OTP was added to these responses/logs.

## 3. Verification and known test limits

Node 22 / npm 10; real PostgreSQL 18.4 in an isolated test cluster with per-run test databases/migration templates. The harness exercised the existing clean migration chain; this mission adds no migration. No separate upgrade migration was required or executed.

| Check | Result |
| --- | --- |
| `npm run build`; `npx tsc --noEmit`; `git diff --check` | PASS |
| Full backend unit run `NODE_ENV=test LOG_LEVEL=silent npx jest --runInBand` | **224 suites / 2,603 tests PASS** |
| Focused Agent PostgreSQL batch run `m15final1` (serial, 17 files) | **17 suites / 359 tests PASS** |
| After adding explicit version consumption for identical metadata, `m15noop1`: management + A20 outlets/terminals | **2 suites / 33 tests PASS**, including two new identical-PATCH concurrency tests |
| Final session/authentication check `m15authfin`: A7 Agent-authentication HTTP, phase-1 Agent security and both new mission suites | **4 suites / 75 tests PASS** (overlaps the preceding PG runs) |
| Post-change targeted units: route policy, expiry status, runtime guard, locator | **4 suites / 45 tests PASS** |
| Scoped ESLint on 17 mission controller/guard/DTO/test/fixture files | PASS (integration-test `any` rule exceptions are explicitly marked, consistent with the repository's PG tests) |
| Whole-file ESLint on the three older lifecycle/outlet/terminal services plus older Agent-history integration test | **FAIL: 53 existing errors**. A baseline/current rule-and-message comparison found no new error categories/counts: baseline 61, current 53. The existing C2C claim service separately retains one baseline error and one warning. No repository-wide lint pass is claimed. |

The 17-suite PostgreSQL run covered: `mission-15a-agent-sessions`, `mission-15a-management`, `a20-outlets-terminals`, `a17-agent-cash-to-cash-expiry`, `a16-agent-cash-to-cash-claim`, `a15-agent-cash-to-cash`, `a19-agent-funding`, `v1-funding-approvals-inbox`, `v1-agent-receiving-number-authorization`, `a9-agent-receiving-number`, `v1-agent-history-01`, `v1-sprint3-agent-history-workforce`, `v1-agent-cash-to-cash-operations`, `a8-agent-lifecycle`, `v1-admin-authorization-hardening-01`, `v1-agent-credentials-01`, and `v1-harden-01-support-adversarial`. Before the final clean run, one existing history test failed because it asserted suspended-session access; it was corrected to the requested invalidation policy and reran successfully. Expected simulated expiry/audit-failure and statement-timeout logs occur within passing tests.

A prior session-specific run also passed 6 related PG suites / 178 tests including Agent authentication HTTP and phase-1 security. These are targeted results, **not** a full repository PG-suite pass, production-like load/chaos test, frontend acceptance, or Arena 4 integration acceptance.

## 4. Arena 2 integration instructions

- Consume the [exact API contract](mission-15a-api-contract-20261030.md) and branch commits, not mock/placeholder endpoints. Apply `agent.view`, `agent.manage_outlets_terminals`, `agent.manage_credentials`, `agent.activate`, and `transaction.view` independently; genuine SUPPORT has no seeded `agent.view` or `transaction.view` and is denied these newly gated reads. Do not grant functions in client code.
- Fetch current versions for metadata forms, send the required `expectedVersion`, show a 409 reconciliation state, and never silently overwrite. Use `displayName`/`addressLine` for the existing public locator. Do not provide controls for unimplemented ownership/status changes within the PATCH.
- Show session-only revocation as revoking **current sessions**, not disabling credentials or preventing a new login; explain the count and reauthentication impact. Activation requires an approved application and a separately authorized `agent.activate` principal.
- Render expiry backlog as a timestamped database aggregate and worker fields as **this instance only**, not a system-wide healthy/broken conclusion. Continue external log/monitoring procedures. No sweep/refund/forfeiture button or invented balance belongs in this feature.
- Keep funding maker/checker identities, MFA and exact persisted idempotency/fingerprint behavior. Receive Agent history and receiving numbers only under their current SELF/workforce scopes; do not send sensitive transfer credentials to beneficiaries or log them.
- Arena 2 remains the owner of notification provider-reference sanitization F-01 and missing DNS-boolean F-05; this mission did not change those provider files or validate their closure. Refer to the existing notification handoff and coordinate rather than assuming production safety.

## 5. Remaining blockers and decisions — no policy inferred

The Ordinary Agent audit decision register [05-POLICY-DECISION-REGISTER.md](completion-audit-20261027/05-POLICY-DECISION-REGISTER.md) was reviewed before coding. No document explicitly titled “Mission 14” was found in the checkout; that absence is not approval of any policy. The following remain as stated there or require owner resolution:

| Decision / gap | Remaining action or limit |
| --- | --- |
| D1 physical cash handover | Owner-approved real-cash handover controls/attestation are needed before physical-cash UAT/production; electronic settlement is not proof of handover. |
| D2 expired-funds disposition | Decide authorized refund/retention/forfeiture/manual process. Existing liability remains; the new read endpoint decides nothing. |
| D3 fees/VAT/commissions | Commercial owner must approve launch values/zero posture; no rates invented here. |
| D4 wallet-mode KYC freshness | Owner must decide whether assessment expiry applies and the window; no compliance rule changed. |
| D5 class reassignment; D6 PIN recovery | Reclassification remains future unless brought into V1; administrative PIN recovery/unlock requires explicit governance before operational scale. |
| D8 beneficiary SMS; D9 lifecycle notifications | Decide whether either is required and approve ownership/mapping. Do not send transfer secrets, OTPs or PINs to beneficiaries; no lifecycle producer work was duplicated here. |
| D10 public application UI; D11 normal credential self-change | Decide V1 requirements/workaround; this is backend-only and does not add those surfaces. |
| D12 reversal/break-resolution governance | Formal scope and controls remain undecided; no reversal or reconciliation-disposition workflow was added. |
| D13/D14 | Agent limits/commission aggregates and device-release assets/screenshot/export decisions remain as classified in the register. |
| C2C capability metadata | The existing `CASH_TO_CASH_EXPIRY` seed still says `apiStatus: NOT_EXPOSED` and does not cite the new **status-only** read. Registry owner should review/update governed evidence without implying a sweep endpoint or enabling the worker; existing seeded production rows are not overwritten automatically. |
| Operational readiness | Worker enablement/monitoring, final security and policy review, complete PG/CI coverage, cross-agent integration and Arena 4 acceptance remain outstanding. Nothing here asserts production readiness. |

## 6. Test-process hygiene

The PG cluster and `.env` used here are local, ignored and test-only. Stop the isolated PostgreSQL process after verification. No test-only credentials, logs, node_modules, databases, build output or environment file should be committed. Do not reset, rebase, force-push, deploy, merge or alter another Arena branch as part of this handoff.
