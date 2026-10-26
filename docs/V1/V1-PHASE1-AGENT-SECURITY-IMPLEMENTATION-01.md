# Phase 1 — Ordinary Agent security implementation

Date: 2026-10-25. Repository: shyne240/monienaija.
Baseline: 1d2a782668a2d2fadd818401670b017b0291c9ce.

Status: Final verification found an unresolved approval-integrity defect. Phase 1
security acceptance is blocked despite passing existing tests. Changes are
uncommitted for review. Phase 2 has not started.

## Scope and preservation

This change implements the approved Phase 1 security work only. Cash-to-Cash
redemption posting, schemas, screens and policies are unchanged. No application
database migration, push, merge or deployment is performed.

At entry, the only uncommitted files were two conflict backups and
monienaija-before-migrations.dump. They are preserved without reading or altering
their contents. No Aggregator domain implementation is added. Aggregator-attributed
funding retains its prior checks and is outside this phase's maker/checker guarantee.
Shared workforce-session invalidation applies to all workforce callers.

## Final verification review (2026-10-25)

This pass preserves all existing source/test changes and makes no production-code
changes. A SHA-256/size manifest for all 31 changed/untracked files was recorded at
before report edits in the local temporary directory. The content-hash comparison
confirms 30/31 files are byte-for-byte unchanged;
only this report changed. All 20 source files and seven test/helper files were
preserved, as were all three pre-existing backup/dump files. The three
non-Phase-1 files are the pre-existing conflict backups and database dump; the
28 files listed below belong to Phase 1. Diagnostic scripts and machine-readable
Jest results are stored outside the repository.

### Final test and teardown investigation

- Normal full root unit rerun: **190/190 suites, 1956/1956 tests passed**, exit 0;
  the parallel worker force-exit warning reproduced.
- Full serial --detectOpenHandles rerun: **190/190 suites, 1956/1956 tests passed**,
  exit 0, zero reported open handles and no forced teardown.
- Controlled full parallel diagnostic: **190/190 suites, 1956/1956 tests passed**,
  exit 0. An external preload changed only Jest worker shutdown's 500ms deadline to
  5000ms and measured natural exit at 393ms / 403ms. Dependencies were not edited;
  --forceExit was not used. This does not prove that increasing the deadline was
  necessary, because both measured exits were below 500ms.
- The installed worker deadline is visible in node_modules/jest-worker/build/index.js
  at line 456; the warning is emitted by jest-runner after a deadline-driven force
  exit, not by a resource-leak detector. The notification worker's timer is unref'd
  and cleared by module destruction, and the reviewed socket/server tests close
  their listeners. No persistent application resource leak was detected. The warning
  is best classified as a load-sensitive test-worker teardown issue, with exact
  cause unproven, rather than evidence of a verified production leak.
- Fresh combined PostgreSQL rerun: **10/10 suites, 154/154 tests passed**, exit 0,
  including all **17/17** Phase 1 security cases. The suites cover funding, workforce
  sessions, Agent authentication HTTP, PIN security, credential lifecycle, Admin
  authorization, funding snapshots, commercial-rule governance and ledger reversal.
  All suites use isolated databases. No application migration or production data
  change occurred; completed probe templates were also removed.
- Five additional adversarial probes outside the repository reproduced the findings
  below. Their successful reproduction is evidence of defects, not passing security
  acceptance tests. They do not change the existing 17-case suite or its result.

### Financial and authorization review conclusion

The existing regressions cover direct funding function/role checks, normal maker /
checker separation, fingerprint tampering, approval expiry, concurrent duplicate
funding, insufficient-funds rollback and post-journal failure rollback with retry.
Code inspection confirms that approval consumption, A5 journal posting, commercial
snapshot, funding audit and idempotency completion use the same SERIALIZABLE manager.
No second financial effect was observed in the replay or concurrency probes. This
is not a general proof against every rollback or authorization failure: the HTTP
principal-overwrite counterexample invalidates the independent-approval guarantee,
and Aggregator-attributed funding still intentionally skips direct governance at
src/agent/agent-funding.service.ts:169 / :362. Both require resolution before treating
Agent funding as comprehensively secured.

The safest next step remains a bounded Phase 1 correction of the approval command
boundary, followed by HTTP spoofing/dual-role tests, locked cancellation/rotation
fixes and explicit replay-response policy. No Phase 2 work should begin on the basis
of the currently passing regression set alone.

### Unresolved security findings

1. **HIGH — authenticated approval identity and target can be overwritten by the
   request body.** `src/authorization/workforce-administration.controller.ts:214`
   calls `approve({ approvalId, principal, ...b })`. This shared controller is
   unchanged from HEAD; the new funding flow depends on its approval boundary.
   The body is an inline type,
   not a runtime DTO that rejects extra fields. An HTTP probe using the real guard,
   sessions and PostgreSQL confirmed that checker A can send checker B's principal
   in the body and cause `approvedBy` to be recorded as B. A separate probe confirmed
   a dual-role maker can approve their own request by forging B's principal, bypassing
   the self-approval check inside the service. Neither probe needed B's bearer token
   in the request. The controller's outer authorization still requires an entitled
   authenticated checker; anonymous access and arbitrary journal posting were not
   demonstrated. The defect breaks independent-approval and audit-identity guarantees.
   The spread also allows a body `approvalId` to replace the route target (verified
   code path; a separate target-redirection exploit was not executed). Required fix:
   construct a command from explicit allowed fields, retain the authenticated
   principal and route ID, validate the body, and add HTTP spoofing/maker regression
   cases. Phase 2 approval is blocked until this is resolved and retested.

2. **MEDIUM, reproduced at service/database level — cancellation uses a stale lifecycle snapshot.**
   `src/authorization/privileged-action-approval.service.ts:139` reads before the
   transaction and later saves `CANCELLED` without re-reading under the decision/
   consumption row lock. A deterministic row-lock probe confirmed that cancellation
   overwrites a concurrently committed CONSUMED state with CANCELLED. This shared
   method is currently called from role-definition proposal cleanup, rather than
   an exposed ordinary-Agent cancellation endpoint. No ordinary-Agent double-posting
   exploit is established. The method should use the same locked lifecycle pattern.

3. **MEDIUM, reproduced via HTTP/database locks — initial rotation clears a newer
   credential lock.** `src/agent-authentication/agent-authentication.controller.ts:132`
   verifies the temporary password before invoking rotation. The service at
   `src/agent-authentication/agent-authentication.service.ts:298` rechecks ACTIVE /
   rotation-required state but does not reject a now-locked credential. A probe held
   the Agent row to pause rotation after authentication, committed five failed
   attempts to lock the credential, released the row, and observed HTTP 200, a new
   session and accountLocked=false. This requires knowledge of the correct temporary
   password and the concurrent timing; it is not a password-free login exploit.
   Rotation must revalidate lock/revocation/expiry/current authentication evidence
   under the authoritative credential lock before clearing state or issuing a session.

4. **LOW — replay responses do not enforce the original approving-checker binding.**
   `src/agent/agent-funding.service.ts:331` returns a stored response before the
   approval check at line 363. A real HTTP probe confirmed that a different currently
   entitled MFA Finance Controller, with the completed instruction/key/approval ID,
   receives `REPLAYED` and the original journal ID. It did not create a second journal.
   Fresh execution by that checker is denied by the existing security test. This is
   a response-authorization/contract gap, not demonstrated duplicate spending. Decide
   whether replay is an entitled status read or must require the original checker;
   enforce and test the selected rule.

### API/client compatibility review

| Change | Client impact |
| --- | --- |
| Direct `POST internal/agents/:id/fund` and `defund` | Existing one-step callers fail closed. Add request/reason, independent approval, and execution with approvalId, unchanged instruction/key, MFA and the approved role pair. |
| `agents/applications` create/read/update/submit aliases | Anonymous, Customer and Agent callers are denied. V1 callers must use entitled workforce sessions; actor headers/body values no longer establish identity. |
| Class mutations, outlet/terminal administration, receiving-number reads | Clients must have the relevant catalogue function; normal catalogue bootstrap must seed `agent.manage_classes`. |
| Workforce session establishment/validation | Roleless, unknown-role and disabled-role-only users are rejected; client login/error handling must not treat such sessions as usable. |
| Credential reissue/rotation | Existing Agent sessions become unusable; clients must handle reauthentication. |
| PIN creation/change | Routes/body shapes are unchanged in Phase 1; create-only and atomic change semantics are enforced transactionally. The checked-in Agent mobile already calls create and change separately using the current shapes. No Phase-1-required mobile code change was identified by source inspection. |
| Funding DTO metadata | Structured object metadata is accepted; string metadata is rejected. |

The checked-in Admin AgentNetworkScreen provides list/detail/lifecycle actions,
not a direct funding workflow. Searches did not find existing Admin/mobile calls to
the direct funding or application-alias endpoints. The funding integration change
therefore requires a new/updated consuming workflow, not a demonstrated broken
checked-in mobile call. No client end-to-end execution is claimed.

## Behavior changes

### Direct Agent funding and defunding

- AGENT_NETWORK_MANAGER requests an instruction with MFA and agent.fund or
  agent.defund. The approved cross-functional role pair is Decision 7 in
  V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md.
- A distinct FINANCE_CONTROLLER approves through the existing A2 approval endpoint.
- Only that approving controller, still function-entitled and using MFA, executes.
- Approval binds Agent, direction, amount, currency, idempotency key, reference,
  correlation, description and metadata. Server-derived, redacted instruction
  details are stored in the existing approval JSON for independent review.
- Approval consumption and posting share the existing SERIALIZABLE transaction.
  Failed postings roll consumption back. Replays do not consume a second approval.
- The Agent's active status is rechecked inside that transaction.
- A5 accounts, journal lines, commercial policies and amounts are preserved.
- Approval decisions lock and re-read the approval in the same transaction as the decision, audit and security event, preventing stale decisions from restoring consumed approvals.

API sequence:

1. POST /api/v1/internal/agents/:agentId/fund-request or defund-request, with the
   intended funding body and a reason.
2. Independent checker: POST /api/v1/internal/a2/workforce/approvals/:approvalId/approve.
3. Same checker: POST /api/v1/internal/agents/:agentId/fund or defund, with the
   unchanged instruction plus approvalId.

Existing direct funding callers must adopt this sequence. A roleless privileged
fixture or a one-step request is deliberately no longer accepted.

### Applications and function permissions

The existing /agents/applications aliases now require workforce authentication and
agent.review_application, matching the workforce-led V1 onboarding boundary. They
are no longer anonymous applicant APIs. x-actor, x-applicant-id and body actor do
not establish ownership or override the authenticated audit actor.

Internal application review/approval/rejection uses the same catalogue function.
Class mutations require the new agent.manage_classes function, granted to the
existing Agent Network Manager and Super Admin owners by the bootstrap catalogue
seeder. Class reads and ordinary outlet/terminal reads require agent.view; mutations
require agent.manage_outlets_terminals. Internal receiving-number reads require
agent.view. No new applicant identity or compliance rules are introduced.

### Sessions, PINs and credentials

- Workforce establishment and validation reject empty/unknown role sets. Disabled
  catalogue roles cannot regain access through the legacy configuration fallback.
- Workforce and Agent last-seen updates cannot overwrite a concurrent revocation
  with a stale ACTIVE session snapshot.
- Credential failures and PIN verification lock the authoritative credential/PIN
  row. Failed PIN attempts commit before the HTTP layer returns the rejection.
- First PIN creation serializes on the Agent and enforces create-only semantics
  inside the transaction. Known-PIN changes verify and replace under one PIN lock.
- Credential reissue/rotation revokes existing sessions in the same transaction,
  with audit evidence. Session issuance rechecks the credential and password
  version under lock; validation checks current credential availability.

## Test strategy

phase1-agent-security.integration.spec.ts uses real PostgreSQL, real HTTP, real A2
sessions and real approval/ledger services. Its 17 cases cover unknown/disabled/
revoked roles, independent checker review, dual-role self-approval rejection,
instruction tampering, expiry, concurrent funding, approval rollback, replay,
anonymous and authenticated cross-Agent application denial, actor spoofing,
function permissions, concurrent credential/PIN failures, PIN creation/change
and credential/session invalidation. A deterministic database-lock regression also verifies that a waiting checker cannot overwrite a concurrently consumed approval.

approved-agent-funding.ts obtains real approvals for existing financial-service
fixtures. It does not mock approval consumption or posting and leaves negative
principals and Aggregator-attributed calls on their existing paths. These synthetic
service fixtures are not authentication evidence; the dedicated HTTP suite supplies
that evidence. Existing workforce lifecycle fixtures now assign a real role before
requesting a successful session.

PostgreSQL suites use fresh run-scoped test databases through the existing harness;
they do not migrate the application database. The first sandboxed PostgreSQL attempt
was blocked by EACCES; subsequent Full Access runs exercise the real database.

### Verification results

| Check | Final result |
| --- | --- |
| Combined selected PostgreSQL run | 10/10 suites, 154/154 tests passed |
| New Phase 1 security PostgreSQL/HTTP suite | 17/17 passed |
| Existing Agent authentication HTTP, transaction PIN security, credentials, Admin authorization (four suites) | 68/68 passed |
| Workforce session PostgreSQL suite | 15/15 passed |
| Agent funding PostgreSQL suite, fresh corrected run | 21/21 passed |
| Funding commercial snapshot PostgreSQL suite | 13/13 passed |
| Commercial-rule governance PostgreSQL suite | 12/12 passed |
| Ledger-reversal governance PostgreSQL suite | 8/8 passed |
| Workforce principal-type unit suite | 4/4 passed, also passed in full unit run |
| Full root unit run after registry corrections | 190/190 suites, 1956/1956 tests passed |
| Full root unit run, serial --detectOpenHandles | 190/190 suites, 1956/1956 tests passed; zero open handles reported |
| Updated governed-action registry suite, focused run with --detectOpenHandles | 8/8 passed |
| TypeScript noEmit | Passed, including final rerun after registry-test update |
| ESLint on all changed TypeScript files | Passed, including final checks of updated tests |
| git diff --check | Passed |

The corrected full root unit suite passed without failures. A second full serial
run with --detectOpenHandles also passed and reported zero open handles, exiting
normally. The ordinary parallel run still emitted the worker force-exit warning.
The installed jest-worker uses a fixed 500ms shutdown deadline. A controlled
extended-grace diagnostic also passed all 190 suites / 1956 tests and both workers
exited naturally in 393ms and 403ms. No persistent application resource leak has
been detected. This evidence supports load-sensitive test infrastructure teardown;
the diagnostic did not exceed the original 500ms deadline and therefore does not
prove the exact cause of the earlier overrun. The earlier failed registry assertions are superseded by these full
successful runs.

The fresh final combined PostgreSQL run passed all ten selected suites and all
154 tests in one run. It supersedes the earlier partial-run/focused-rerun results.
This is the selected regression set, not the entire repository's PostgreSQL suite.

Intermediate failures fixed during validation included outdated funding-denial
message assertions, migration-head assertions that stopped before the existing
repository head, and TypeScript typing in new test fixtures. No historical migration
was changed. Passing checks exercise the conditions covered by those tests; they
do not establish untested end-to-end production behavior.

Commands use the existing local dependencies: node node_modules/jest/bin/jest.js
with --config jest.integration.config.js --runInBand --runTestsByPath for the
PostgreSQL suites; --maxWorkers=2 --silent for the full root unit run; and
--runInBand --runTestsByPath test/governed-action.registry.spec.ts --detectOpenHandles
for the corrected registry. Type checking uses node node_modules/typescript/bin/tsc
--noEmit --incremental false --pretty false. ESLint uses node
node_modules/eslint/bin/eslint.js with the explicit changed-file list.

### Adoption and remaining limitations

- Existing Admin/API funding clients require the new request/approve/execute
  sequence. No Admin funding workflow UI or mobile UI was added in this backend
  security phase. Review this compatibility change before release.
- The new class-management function is inserted by the existing catalogue seeder;
  environments must complete normal catalogue bootstrap before using it.
- Application services remain trusted internal services. HTTP access is restricted
  to entitled workforce reviewers; this phase does not add applicant self-service.
- Other privileged-approval lifecycle methods, including cancellation and emergency
  access, were not comprehensively redesigned or concurrency-certified here.
- No external provider, deployed identity provider, production load, browser/mobile
  end-to-end or whole-platform PostgreSQL suite certification is claimed.

## Boundaries before further work

- This is not a production-readiness certification. In particular, the audited
  Cash-to-Cash wallet-credit/physical-handover mismatch remains until Phase 2.
- Aggregator-attributed funding is unchanged and must not be assumed to have the
  new direct-funding approval control. Extending that boundary needs separate scope.
- Funding backing, unregistered-beneficiary identity, mandatory limits, cash
  handover and expiry/refund/disposition policy are not invented here.
- Phase 2 financial posting requires review of Phase 1 and approval of the
  outstanding policies. No new redemption method has been enabled.

### Remaining defects and blockers, in release order

1. **Critical, existing Phase 2 defect:** the audited Cash-to-Cash wallet-credit /
   physical-handover mismatch is unchanged. The approved CASH/WALLET contract must
   be implemented and financially tested before that redemption flow is released.
2. **High, excluded security boundary:** Aggregator-attributed Agent funding keeps
   its existing authorization path and lacks this phase's direct-funding approval
   guarantee. This is not a claim that all routes capable of funding an Agent now
   enforce maker/checker. Resolving that route requires scope approval; it must not
   be treated as secured merely because direct funding is secured.
3. **Release integration dependency:** funding callers must adopt the documented
   approval sequence. Existing one-step clients now fail closed. Review real Admin
   workflow adoption and operator role/MFA provisioning before release.
4. **Policy approval blockers for Phase 2:** verified beneficiary identity, applicable
   limits, physical cash handover, funding backing and unresolved-funds disposition
   require approved decisions. This implementation introduces no assumed compliance
   threshold, fee rate, expiry refund or disposition rule.
5. **Verification limitation:** the default parallel unit run emits a worker teardown
   warning, while the full serial diagnostic exits normally with zero open handles.
   A timing diagnostic also exited naturally without forced termination; the exact
   cause of the earlier overrun remains unproven. Broader provider/deployed/mobile/load
   validation and non-targeted PostgreSQL suites remain outside this completion claim.

The original selected assertions passed after focused reruns, but final adversarial
verification below found gaps those assertions do not cover. Passing tests do not
remove these release blockers.

## Changed-file inventory

- docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md
- src/agent-authentication/agent-authentication-session.service.ts
- src/agent-authentication/agent-authentication.controller.ts
- src/agent-authentication/agent-authentication.service.ts
- src/agent/agent-application-admin.controller.ts
- src/agent/agent-application-public.controller.ts
- src/agent/agent-application.service.ts
- src/agent/agent-class.controller.ts
- src/agent/agent-funding-governance.service.ts
- src/agent/agent-funding.controller.ts
- src/agent/agent-funding.service.ts
- src/agent/agent.module.ts
- src/agent/dto/fund-agent.dto.ts
- src/authorization-catalogue/authorization-catalogue-runtime.service.ts
- src/authorization-catalogue/authorization-catalogue.seed.ts
- src/authorization/governed-action.registry.ts
- src/authorization/privileged-action-approval.service.ts
- src/authorization/privileged-action-approval.types.ts
- src/authorization/route-policy-registry.ts
- src/authorization/runtime-access.guard.ts
- src/authorization/workforce-session.service.ts
- test/a19-agent-funding.integration.spec.ts
- test/a2-workforce-session.integration.spec.ts
- test/governed-action.registry.spec.ts
- test/phase1-agent-security.integration.spec.ts
- test/support/approved-agent-funding.ts
- test/v1-commercial-decision-03e-agent-funding-snapshot.integration.spec.ts
- test/workforce-session-principal-type.spec.ts
