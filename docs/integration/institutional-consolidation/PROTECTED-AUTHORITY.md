# Protected checker authority — implementation record (ARENA 3, institutional Phase 1)

Status: **implemented and accepted for the local/disposable-PostgreSQL target behind this branch.**
It is **not** deployment evidence and makes **no claim** about the actual production database:
production roles and grants remain **NOT VERIFIED** until an operator runs the provisioning below
and production readiness reports `verified` against that real database.

Companion documents: `PROTECTED-AUTHORITY-WIP.md` (reproduction history and the pre-implementation
findings), `ROLE-BOUNDARY-BLOCKER.md` (the earlier blocked state), `MIGRATION-ALLOCATION.md`.

## 1. The vulnerability being closed

The institutional maker-checker stack used ordinary application tables as its evidence:

- `a2_workforce_sessions.token_hash` and role sets;
- `a2_finance_role_assignments` and the authorization catalogue;
- `privileged_action_approvals` (checker identity, status, consumption);
- trigger-generated institutional execution evidence.

Anything holding ordinary runtime SQL could therefore rewrite a checker session hash and present
the token over HTTP, grant itself a checker role, update a REQUESTED approval to APPROVED, or mark
it CONSUMED and then drive the domain transition. The four retained reproductions in
`test/institution-foundation.integration.spec.ts` and
`test/wallet-ownership-resolution.integration.spec.ts` demonstrate exactly those paths.

## 2. The implemented boundary

Three PostgreSQL logins, provisioned by `scripts/provision-database-roles.js`:

| role | purpose | attributes |
| --- | --- | --- |
| `…_migrator` | owns the database, schema `public` and migrations | LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, membership in `monienaija_authority_core` only for object ownership |
| `…_runtime` | the Nest application's ordinary connection | LOGIN, no superuser/DDL attributes, member of `monienaija_runtime` only |
| `…_authority` | the protected authority component | LOGIN, no superuser/DDL attributes, member of `monienaija_authority_core` |

`monienaija_authority_core` (NOLOGIN, NOINHERIT) owns schema `protected_authority` and the
SECURITY DEFINER evidence/guard functions. `monienaija_runtime` (NOLOGIN, NOINHERIT) carries the
ordinary application grants.

Migration `1785753600501-ProtectedAuthorityBoundary` adds:

- `protected_authority.checker_decisions` — immutable, append-only record of the authenticated
  checker decision. It stores the approval id, action type, action fingerprint, a server-computed
  digest of the exact approval payload, the checker principal/session, MFA assurance, decision time
  and approval expiry. **Only the authority connection can insert it.**
- `protected_authority.approval_consumptions` — immutable record of consumption (approval digest,
  executor principal/session, time).
- `protected_authority.approval_payload_digest(uuid)` — computes the payload digest from the locked
  approval row in the database. The caller never supplies a digest, checker id, MFA flag or
  entitlement that is treated as authority.
- `protected_authority.approval_authority_guard()` — a BEFORE INSERT/UPDATE trigger on
  `privileged_action_approvals`. A protected approval may become `APPROVED` or `CONSUMED` only when
  a matching protected decision/consumption exists; checker identity is immutable once set.
- Row level security on `privileged_action_approvals`: runtime retains DML for **unprotected**
  action types (the rest of the maker-checker estate is unchanged) and is denied every protected
  row. `TRUNCATE`, `REFERENCES` and `TRIGGER` are revoked.
- Writes to session, role-assignment, catalogue and trigger-generated evidence tables are revoked
  from `monienaija_runtime`. The 0500 evidence trigger functions were moved into
  `protected_authority` and execute as the authority role, so a correctly provisioned deployment
  can still record execution evidence without giving runtime write access to it.

### Protected actions

`FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE`, `INSTITUTION_AGENT_AFFILIATION_CHANGE`,
`WALLET_OWNERSHIP_RESOLUTION`, `LEDGER_JOURNAL_REVERSAL`, and (ARENA 4 Phase 2)
`WALLET_INSTITUTION_ATTRIBUTION` and `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE`
(`src/authorization/protected-authority.actions.ts`). This is an explicit allow-list. The remaining
governed actions (notifications, agent funding, B2F policy, role-definition proposals, etc.) keep
their pre-existing behaviour and are **not** claimed as protected by this boundary.

Migration `1785753600502-ProtectedAuthorityInstitutionalOwnership` extends the 0501 guard and row
level security to the two Phase 2 actions and revokes runtime writes on
`governed_wallet_institution_attributions`. The Phase 2 execution transactions run on the authority
connection. Pre-0502 approvals for these two actions have no protected decision and are
conservatively non-executable.

### Application wiring

`ProtectedAuthorityModule` (global) opens a second TypeORM connection from
`PROTECTED_AUTHORITY_DB_*`. When those variables are absent it resolves to the ordinary connection
(dev/test convenience only); production readiness then fails closed.

The authority connection performs:

- workforce session issuance, validation refresh, revocation and role/assignment resolution
  (`A2WorkforceSessionService`, `A2FinanceRoleAdministrationService`, `SuperAdminRecoveryService`);
- local-admin credential reads/writes (development/test-only service);
- authorization catalogue seeding and role-definition governance writes;
- privileged approval request/decision/cancellation and consumption, including the protected
  decision/consumption evidence (`PrivilegedActionApprovalService`);
- the complete institutional lifecycle execution transaction, affiliation execution transaction
  and wallet-ownership execution transaction, so checker evidence, approval consumption, domain
  mutation, trigger evidence and rollback remain one atomic unit.

Ledger reversal uses the existing `PrivilegedActionApprovalService.consume()` path, which now runs
on the authority connection; its pre-existing ordering (consumption commits before
`LedgerService.reverseJournal`) was deliberately not redesigned. See §6.

## 3. What this specifically prevents

Using only the ordinary runtime credential, a compromised application database account cannot:

- read or rewrite a workforce session token hash, mint a session, or alter the session's MFA/roles;
- write `a2_finance_role_assignments` or the authorization catalogue to grant itself a checker role;
- insert a protected approval in `APPROVED` state, update a protected approval, consume it, or
  truncate/redirect approvals;
- write a protected checker decision or consumption (no schema USAGE, no EXECUTE);
- insert institutional execution evidence directly;
- change an institution, affiliation or wallet ownership without a consumed approval whose
  protected decision matches its exact payload;
- invoke the protected guard/digest/evidence functions directly.

Legitimate MFA checker operations through the application continue to work; the protected decision
and consumption rows are recorded and the institution transition replays idempotently.

## 4. Provisioning (executable, no hardcoded secrets)

Prerequisites: a PostgreSQL database, an administrative connection able to create roles (or the
equivalent operator-provisioned roles), and the three login names/passwords in environment
variables — never in the repository.

```bash
export DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=<admin> DB_PASSWORD=<admin secret>
export RUNTIME_DB_USER=monienaija_runtime_app   RUNTIME_DB_PASSWORD=<secret>
export AUTHORITY_DB_USER=monienaija_authority_app AUTHORITY_DB_PASSWORD=<secret>
export MIGRATOR_DB_USER=monienaija_migrator     MIGRATOR_DB_PASSWORD=<secret>

# 1. cluster roles (idempotent)
node scripts/provision-database-roles.js --phase=cluster
# 2. make the migration role own the database/schema, before migrations
node scripts/provision-database-roles.js --phase=before-migrations
# 3. run migrations with MIGRATOR_DB_USER (not the runtime login)
npm run migration:run
# 4. grants after migrations
node scripts/provision-database-roles.js --phase=after-migrations
```

The SQL executed is `scripts/sql/provision-database-roles-{cluster,before-migrations,after-migrations}.sql`;
the integration suites execute the identical files, so the tested configuration and the operator
configuration cannot silently diverge.

Application environment for the provisioned deployment:

```
DB_USER=<runtime login>            DB_PASSWORD=<runtime secret>
PROTECTED_AUTHORITY_DB_USER=<authority login>
PROTECTED_AUTHORITY_DB_PASSWORD=<authority secret>
```

## 5. Readiness

`ProductionReadinessService` no longer assumes an unavailable authority. In production it calls
`ProtectedAuthorityService.inspect()`, which uses the real connections to verify:

- a distinct authority login (not the runtime login);
- authority and runtime roles have no superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS
  attributes and do not own the database or `public` schema;
- the authority login is a member of `monienaija_authority_core` and can write protected evidence;
- the protected schema/tables/guard trigger exist;
- runtime has no session, approval-guard, role-assignment, catalogue or execution-evidence write
  capability, no protected-schema USAGE, no protected-function EXECUTE, and cannot TRUNCATE
  approvals;
- row level security is enabled **and forced** on approvals and the five policies are present.

Only `verified` allows production startup. `not_configured`, `unsafe` and `unavailable` all fail
closed with distinct reasons. There is no environment override.

Readiness also verifies the **complete migration inventory**, not just the head: every migration
class the application ships must be recorded as applied, and no unknown migration may be applied.
A skipped earlier id (for example 0400 missing while 0401 is present) fails closed as
`schema_incompatible`. The intentionally absent 0117 and 0120–0132 ids are simply not part of the
shipped inventory; `test/migration-inventory.spec.ts` pins that, so they are neither fabricated nor
renumbered. See §7 for the real-PostgreSQL missing-earlier-migration test.

`test/protected-authority-boundary.integration.spec.ts` boots the real `AppModule` with the runtime
and authority logins and observes `status: 'ok'` / `authority: 'verified'`.

## 6. Known limits and remaining infrastructure assumptions

- **Application-process compromise.** The authority credential is available inside the same Node
  process (the approval service must use it synchronously). The boundary is against an attacker
  holding only ordinary database credentials or ordinary runtime SQL; it is not a defense against
  arbitrary code execution in the application process.
- **Database owner/superuser.** A superuser or the database owner can disable triggers, rewrite
  `protected_authority`, take over the authority role or alter the provisioning. That is an
  infrastructure compromise, not the runtime-credential boundary. Readiness refuses to run
  production on such a runtime role, but cannot make a superuser safe. The owner-level direct-SQL
  reproduction still fails because the approval guard is a trigger; it is evidence of defense in
  depth, not of a boundary against a determined owner.
- **Session theft.** A stolen, still-ACTIVE bearer token is a live credential; this work prevents
  forging/rewriting sessions, not replay of a stolen one. Revocation and expiry remain enforced.
- **Historical approvals.** Protected approvals created before 0501 have no trustworthy protected
  decision. They are reserved by 0500/0501 and cannot be replayed or executed; a fresh request must
  be made. No historical checker evidence is fabricated.
- **Ledger reversal atomicity.** `LedgerReversalGovernanceService` consumes the approval in one
  transaction and posts the reversal ledger entry afterwards (pre-existing design). If posting
  fails, the approval is already consumed. The protected boundary prevents forgery and reuse, but
  does not convert that existing two-step lifecycle into one transaction.
- **Upstream OIDC.** The boundary starts at the workforce session/role records. Upstream identity
  provider compromise is unchanged and out of scope.
- **Unprotected actions.** Notifications, agent funding, B2F policy, role-definition approvals and
  other governed actions still use the previous approval-write behaviour. They are not claimed as
  protected here; a follow-up may migrate them without changing this contract.
- **Local-admin credentials** are a development/test-only authentication store; production routes
  are 404-gated. They are protected against runtime writes but are not part of the production
  checker authority.

## 7. Test evidence (local, disposable PostgreSQL)

Commands (sequential; disposable cluster):

```bash
PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
  npx jest --config jest.integration.config.js <suite> --runInBand
npx jest --config jest.config.js --runInBand
```

Observed on this implementation:

- `test/institution-financial-ownership.integration.spec.ts` (ARENA 4 Phase 2) — **16/16** with the
  protected contract applied to wallet attribution and enrolment; runtime denial of attribution
  approval/evidence writes is asserted in the boundary suite.
- `test/protected-authority-boundary.integration.spec.ts` — **7/7** under migrated-by-migrator,
  app-as-runtime, authority-as-authority provisioning, including the legitimate checker flow,
  immutable decision/consumption evidence, replay, changed-payload rejection, consumed-approval
  reuse rejection, a newly approved transition and production readiness `verified`.
- `test/institution-foundation.integration.spec.ts` — **32/32**, including the retained direct-SQL,
  non-owner-role, session-hash-impersonation and lifecycle-forgery negatives.
- `test/wallet-ownership-resolution.integration.spec.ts` — **21/21**, including the retained
  wallet-approval forgery negative and legitimate checker execution.
- `test/migration-chain.integration.spec.ts` — **20/20** (fresh chain, historical
  0400→0401→0500→0501→0502 upgrade, historical reservations).
- Workforce session, bootstrap, super-admin recovery, role-definition governance, notification
  provider governance, agent funding, A5/A19/A8/A20 and B2F targeted suites passed. Those interim
  runs were **superseded** by the consolidated Phase 5 regression, whose committed summaries live
  in [`phase5-evidence/`](phase5-evidence/) and are reported in
  [INSTITUTIONAL-CONSOLIDATION-STATUS.md](INSTITUTIONAL-CONSOLIDATION-STATUS.md) §4: full
  PostgreSQL suite 144/144 files and 2,604/2,604 tests, backend units 241 suites / 2,869 tests,
  isolated KYC 9 suites / 98 tests.
- Backend unit suite: **240 suites / 2,863 tests** passed.
- `tsc --noEmit` passed; targeted Prettier/ESLint passed on the changed files.

No provider call, real financial transaction, deployment or production-role verification was
performed. Production readiness against the actual deployment remains **NOT VERIFIED**.
