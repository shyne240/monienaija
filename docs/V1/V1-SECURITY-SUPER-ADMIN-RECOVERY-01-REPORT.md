# V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — Implementation Report

**Status:** Implemented, tested, documented, and committed in this delivery.
**Approved design basis:** `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md` §3
("Decision — SUPER_ADMIN recovery, revocation, and replacement").
**Branch:** `arena/01a10374-monienaija`.
**Final commit:** see the "Commit and push" section at the end of this report — filled in
after staging, which happens after this document is written (so the hash below is accurate
as of the actual commit, not predicted in advance).

---

## 1. What problem this solves

Before this task, the codebase had no administrative path to revoke or replace a compromised,
departing, or otherwise-needing-succession `SUPER_ADMIN` assignment. The ordinary role
administration surface (`A2FinanceRoleAdministrationService.assign()`/`revoke()`) unconditionally
and correctly refuses to ever touch `roleKey === 'SUPER_ADMIN'` — this is a deliberate, unchanged
invariant, not a gap being closed here. This task adds a **second, structurally separate,
offline-signed ceremony** for the one operation that invariant deliberately excludes.

## 2. Operation scope — what is, and is not, implemented

The approved design's heading groups three words — "recovery, revocation, and replacement" —
but its own body is explicit that these are **not three separate software operations**:

> "Replacement is simply 'revoke' (new) followed by the existing, unchanged bootstrap ceremony
> (already implemented) naming a new CEO identity." … "No new creation logic is needed."

This implementation therefore adds **exactly one** new server-side operation:

| Term in the design doc | What it means in this implementation |
|---|---|
| **Revocation** | The new `REVOKE_SUPER_ADMIN` statement type and `consumeRevocation()` consumption path — the only statement type the server accepts. This is the literal, newly-built capability. |
| **Replacement** | Revocation (above) **followed by** the pre-existing, unmodified bootstrap ceremony (`consumeBootstrap()`) naming a successor. No new "replace" statement type exists or was built — the design doc states none is needed, and building one would reunite two trust chains (recovery-key custody and bootstrap-key custody) the design deliberately keeps separate. |
| **Recovery** | The name of the overall capability/task — "being able to recover control of the platform when the current SUPER_ADMIN must be removed" — achieved by composing the two independent ceremonies above. It is not itself a third statement type. |

**This report does not claim "replacement" is implemented as a single operation** — it is not,
and the approved design explicitly does not call for it to be. What is implemented is the
revocation half, plus full compatibility with the pre-existing bootstrap ceremony for the
successor-naming half (verified by this task's own integration test — see §6).

One naming note, for transparency: the design doc's prose names the statement type
`SUPER_ADMIN_REVOCATION`; the code's `operation` field value is the string
`'REVOKE_SUPER_ADMIN'`. These refer to the identical, single concept — this is a label
difference, not a scope difference. The `operation` field is typed as a closed, versioned
union (today exactly one literal value) specifically so a *future, separately-approved*
additional operation could be added without a schema break — no such addition was authorized
or made in this task.

No further code change was made as a result of this scope review: the as-found implementation
already matched the approved design's actual (not headline) scope precisely.

## 3. Relevant files

| File | Role |
|---|---|
| `src/migrations/1785753600088-CreateSuperAdminRecoveryConsumptions.ts` | New migration: `a2_super_admin_recovery_consumptions` table (nonce-unique replay ledger), indexed on `target_principal_id`. |
| `src/authorization/workforce-authentication.entity.ts` | New entity `A2SuperAdminRecoveryConsumption` — structural twin of the existing `A2WorkforceBootstrapConsumption`. |
| `src/authorization/workforce-authentication.types.ts` | New types `A2RecoveryStatementV1` (signed statement schema) and `A2SuperAdminRecoveryViewV1` (API response shape); `A2WorkforceConfigurationV1` extended with `recoveryEnabled`/`recoveryAudience`/`recoveryKeys`. |
| `src/authorization/workforce-configuration.ts` | Parses/validates `A2_RECOVERY_ENABLED` / `A2_RECOVERY_AUDIENCE` / `A2_RECOVERY_JWKS_JSON`, structurally independent of the bootstrap block; fail-closed (duplicate `kid`, environment mismatch, enabled-but-keyless all throw at startup). |
| `src/authorization/super-admin-recovery.service.ts` | `SuperAdminRecoveryService.consumeRevocation()` — the entire verification + consumption logic (§4–§5 below). |
| `src/authorization/super-admin-recovery.controller.ts` | `SuperAdminRecoveryController` — `POST /internal/a2/workforce/super-admin/recovery`, a deliberately separate controller class from the ordinary workforce-administration controller. |
| `src/authorization/finance-role-administration.service.ts` | `financeRoleAssignmentReference()` extracted (unchanged formula) from the existing private `reference()` method so the recovery service can compute the identical assignment-reference hash without duplicating the formula. No behavioral change to the existing service. |
| `src/authorization/workforce-session.service.ts` | New `revokeAllForPrincipal(manager, principalId, reason, now?)` — `EntityManager`-scoped (unlike the pre-existing `revoke()`, which uses `this.dataSource` directly) so the recovery service can revoke every active session for the target principal inside its own `SERIALIZABLE` transaction. |
| `src/authorization-catalogue/authorization-catalogue.seed.ts` | New catalogue function `workforce.super_admin.recover`, granted to `ADMINISTRATOR` only (never `SUPER_ADMIN`, never any other role). |
| `src/authorization/authorization.module.ts` | Wires the new entity, service, and controller into the existing `AuthorizationModule`; adds the three new env var names to the module's config-token provider. |
| `scripts/generate-revocation-statement.ts` | Offline CLI generator (`npm run recovery:statement`) — produces the RS256-signed statement; `--generate-ephemeral` for drills only; never calls the network; self-verifies its own output before printing; never exposed via any HTTP endpoint. |
| `src/config/environment.ts` | Declares the three new optional env vars (`A2_RECOVERY_ENABLED`, `A2_RECOVERY_AUDIENCE`, `A2_RECOVERY_JWKS_JSON`), structurally separate from `A2_BOOTSTRAP_*`. |
| `src/production/production-readiness.service.ts` | Updated expected-migration-head constants to `1785753600088` / `CreateSuperAdminRecoveryConsumptions1785753600088`. |
| `test/v1-security-super-admin-recovery-01.integration.spec.ts` | 18-scenario end-to-end proof against real PostgreSQL (full list in §6). |
| ~27 other modified test files | Mechanical compatibility updates only (see §7) — no behavioral test changes beyond what the new migration/config fields require. |

## 4. Security boundaries — authorization (who may trigger consumption)

Two independent, both-mandatory layers, neither of which can authorize the underlying
revocation by itself:

1. **Catalogue-function gate** (`AuthorizationService.requireFunction(p, 'workforce.super_admin.recover', …)`)
   — this function is granted to `ADMINISTRATOR` only. It is never granted to `SUPER_ADMIN` or
   any other role. This is what prevents an ordinary `OPERATOR`/`PRIVILEGED` principal — or
   `SUPER_ADMIN` itself — from ever reaching the service.
2. **Service-level defense-in-depth re-check** inside `consumeRevocation()`:
   `principal.roles.includes('ADMINISTRATOR')` and `principal.assuranceLevel === 'MFA'`,
   independent of layer 1, so the service remains safe even if it were ever reachable through a
   different, future controller.

Holding the `workforce.super_admin.recover` function **never, by itself, authorizes revoking
anything** — see §5. It only ever gates who may *ask* the service to attempt consuming an
already-produced statement.

## 5. Security boundaries — signed-statement validation and replay protection

`consumeRevocation()` performs, in order, before any database write:

1. `recoveryEnabled` fail-closed check (`Recovery disabled` if false) — structurally independent
   of `A2_WORKFORCE_ENABLED`/`A2_BOOTSTRAP_ENABLED`.
2. Caller MFA + `ADMINISTRATOR`-role re-check (§4, layer 2).
3. Compact-JWS parsing (`parseCompactJws`) and `kid`-based key lookup against
   `config.recoveryKeys` **only** (never `bootstrapKeys` — the two trust chains are never
   conflated) — `environment` on the key must also match the server's `NODE_ENV`. Unknown/
   mismatched key → `Unknown recovery signing key` (401).
4. Real RS256 signature verification (`verifyRs256`, the identical shared crypto module the
   bootstrap ceremony uses — not reimplemented) → `Invalid RS256 signature` (401) on failure.
5. **Canonical re-encoding check:** the payload is re-canonicalized and re-base64url-encoded and
   compared byte-for-byte against the signed payload segment — rejects any non-canonical
   (e.g. re-ordered-key, whitespace-padded) encoding that could otherwise let a verified
   signature cover an ambiguous payload → `Recovery payload is not canonical` (401).
6. Field-level parsing/typing of every statement field via the shared `text()`/`instant()`
   helpers (malformed/missing field → `400 Invalid <field>`).
7. `schemaVersion === 1`, `operation === 'REVOKE_SUPER_ADMIN'`, `environment` matches server
   `NODE_ENV`, `audience` matches `config.recoveryAudience`, and `signingKeyReference` matches
   the JWS header's own `kid` — any mismatch → `Recovery statement identity, purpose, or
   environment mismatch` (401).
8. **Target binding:** `targetAssignmentReference` must equal
   `financeRoleAssignmentReference(targetPrincipalId, 'SUPER_ADMIN', environment)` — the
   identical hash formula the finance-role-administration service itself uses (extracted to a
   shared pure function, not duplicated) — so a statement cannot name an assignment reference
   that does not actually correspond to its own stated target principal → `Recovery statement
   target reference is inconsistent` (401).
9. Expiry/validity window (`issuedAt`/`expiresAt`) → `Recovery statement outside validity` (401).
10. **Replay protection, inside the transaction (see §6):** the `nonce` column on
    `a2_super_admin_recovery_consumptions` is database-`UNIQUE`. An existing row with the same
    nonce and the same `statementHash` → `Recovery replayed` (409); same nonce, different
    `statementHash` → `Recovery nonce conflict` (409). Neither case mutates anything.
11. **Target existence re-check inside the transaction:** the live `ACTIVE` `SUPER_ADMIN` row
    must still exist and its `assignmentReference`/`principalId` must still match the statement
    exactly → `No matching active SUPER_ADMIN assignment to revoke` (409) with zero mutation.

## 6. Database transaction and session-revocation behaviour

All of the following execute inside **one `SERIALIZABLE`** `DataSource.transaction()`:

1. The targeted `a2_finance_role_assignments` row: `status` → `REVOKED`,
   `revokedBy = 'recovery:<triggering ADMINISTRATOR principalId>'`, `revokedAt` set.
2. `A2WorkforceSessionService.revokeAllForPrincipal(manager, targetPrincipalId, reason, now)` —
   **every** currently-`ACTIVE` `a2_workforce_sessions` row for that principal is revoked, not
   only the session used for the original bootstrap. This method is new (`EntityManager`-scoped,
   unlike the pre-existing `dataSource`-scoped `revoke()`) specifically so it can participate in
   this transaction.
3. An audit event (`AuditService.record`, `entityType: A2_FINANCE_ROLE_ASSIGNMENT`,
   `action: SUPER_ADMIN_REVOKED`) recording the triggering actor, recovery reference, nonce,
   operation, target assignment reference, target principal id, reason, environment, audience,
   approval-change reference, signing-key reference, and revoked-session count. Never records
   the private key, signature bytes, or any session token.
4. A row inserted into `a2_super_admin_recovery_consumptions` (the one-time ledger) with the
   same evidence plus a SHA-256 `statementHash` and the audit-event id.

Either the whole set commits, or none of it does — proven directly by the integration test's
concurrency scenario (two simultaneous consumption attempts of the identical statement; exactly
one succeeds, the other observes either the ledger uniqueness constraint or serialization
failure, and the database is left in a fully consistent single-revocation state).

## 7. Tests executed

### 7a. Fresh, independently re-run in this finalization session

Re-provisioned `node_modules` (`npm ci`) and an ephemeral local PostgreSQL 16 instance
(`pgserver`'s bundled binaries, `initdb` + `postgres -D <scratch-dir> -p 5432 -k /tmp -h
127.0.0.1`, role/db `monienaija`/`monienaija-pw`/`monienaija` matching the harness defaults
in `test/support/pg-harness.ts`) from a clean state, then ran, with `DB_HOST=127.0.0.1
DB_PORT=5432 DB_USER=monienaija DB_PASSWORD=monienaija-pw`:

```
npx tsc --noEmit
npx jest --config jest.config.js test/a2-workforce-configuration.spec.ts --runInBand
npx jest --config jest.integration.config.js test/v1-security-super-admin-recovery-01.integration.spec.ts --runInBand
```

**Results, all freshly run this session:**
- `npx tsc --noEmit` — **clean, zero errors.**
- `test/a2-workforce-configuration.spec.ts` — **30/30 passed** (22 pre-existing cases + 8 new
  `SUPER_ADMIN recovery configuration` cases added by this task), including all 8 explicit
  fail-closed/validation cases for `A2_RECOVERY_*`.
- `test/v1-security-super-admin-recovery-01.integration.spec.ts` — **18/18 passed** against
  real PostgreSQL, covering: valid-statement consumption with atomic revoke+session-revoke+
  audit (#1), invalid signature/unknown key (#2, #2b), expired statement (#3), malformed
  statement (#4), wrong operation (#5), wrong target without mutation (#6), replay after
  success (#7), exactly-one-of-two-concurrent succeeds (#8), non-`ADMINISTRATOR` principal
  rejected (#9), the targeted `SUPER_ADMIN` cannot self-trigger (#10), a self-signed/
  unregistered-key forgery attempt is rejected (#11), recovery disabled fails closed (#12),
  MFA mandatory (#13), environment-bound statement (#14), generator output never carries
  private key material (#15), ordinary `assign()`/`revoke()` SUPER_ADMIN restrictions remain
  unchanged (#16), and the catalogue function is granted to `ADMINISTRATOR` only (#17).

Beyond the task's own minimum bar, the following were also freshly run this session, as a
broader regression check given the migration-head bump and the new `ADMINISTRATOR` grant
touch a shared catalogue/migration surface used by many other suites:

- **Full unit test suite** (`npx jest --config jest.config.js`, no database): **174/174 test
  suites, 1831/1831 tests passed.**
- **Full real-PostgreSQL integration suite** (`npm run test:pg`, all 104
  `*.integration.spec.ts` files, ~1690 tests, run in the repository's own batched-process
  harness): all 104 files passed once isolated from two session-specific artifacts (both
  diagnosed and corrected during this session, neither touching any file in this commit):
  1. `test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts` (9
     failures) — a `created_by varchar(100)` column overflowed because the placeholder OIDC
     issuer URL this session had put in its own untracked `.env`
     (`https://local-dev-identity.monienaija.invalid`, copied verbatim from `.env.example`'s
     commented local-dev block) is long enough that the resulting local-admin principal id
     exceeds 100 characters. Shortening the local `.env`'s placeholder issuer and re-running
     this file in isolation reproduced a clean **38/38 pass**. This file is untouched by this
     task's diff and the overflow is a pre-existing column-length characteristic of
     already-committed code, not a regression introduced here; it is noted for completeness
     only.
  2. `test/v1-commercial-03-fee-rule-schema.integration.spec.ts` (14 failures, all
     `Exceeded timeout of 180000 ms` in `beforeAll`) — caused by this session briefly running
     an extra, unnecessary ad-hoc `jest` invocation concurrently with the already-running
     batched suite, starving the sandbox's 2 vCPU / 3.8GB budget (the repository's own
     `scripts/run-pg-integration-tests.js` documents this exact class of resource-contention
     risk). Re-running this file in isolation, with no concurrent load, reproduced a clean
     **14/14 pass**.

  Re-running both previously-failed files together, with the environment corrected and no
  concurrent load, produced **44/44 passed, 2/2 suites**, and separately the full 15-file
  batch that file #1 belongs to was re-run end-to-end and produced **232/232 passed, 15/15
  suites**. No other batch among the 7 showed any failure in the original full run.

None of the above required, or resulted in, any source or test file change — both
discrepancies were purely artifacts of this session's own temporary local test-environment
setup and process scheduling, not of the code being delivered.

### 7b. Historical (prior session, NOT re-verified independently in this finalization run)

An earlier session reported, for the same integration spec and the same config unit spec,
the same headline numbers (18/18 integration, 30/30 unit) and a clean `tsc`. Those earlier
results are superseded by — and consistent with — the independently fresh results in §7a
above; §7a alone is this session's evidence.

### 7c. Compatibility changes, verified by content review and exercised in the runs above

~27 other test files received exclusively mechanical compatibility edits required by this
change:
- Adding `recoveryEnabled: false, recoveryAudience: '', recoveryKeys: []` to hand-built
  `A2WorkforceConfigurationV1` test fixtures (the interface gained three new required fields).
- Extending migration-count/migration-head allow-lists from 87/88 to 88/89 and from
  `…1785753600087` to also accept `…1785753600088`, and updating the two hard-coded
  single-expected-value assertions (`v1-capability-registry`, `v1-limit-03`) to the new head.
- Updating `test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts`'s
  exact-grant-set assertion for `ADMINISTRATOR` from 11 to 12 functions, adding
  `workforce.super_admin.recover`.
- `test/production-readiness.spec.ts` updated to the new expected migration head.

Every one of these ~27 diffs was individually read in full during this finalization session
and confirmed to contain **only** this kind of mechanical, additive change — no unrelated
edits, no test-expectation weakening, no deleted assertions. Per §7a, the full 104-file
real-PostgreSQL integration suite and the full 174-suite unit suite were in fact run this
session and passed in full, so this is no longer a gap to flag — it is recorded here as the
content-level explanation for *why* each of these ~27 files changed, not as an excuse for
unverified behaviour.

## 8. Deployment prerequisites, limitations, and outstanding risk

- **Organizational key custody is not a software deliverable.** The approved design itself
  flags this as a "genuine, non-software blocker": who custodies the recovery private key(s),
  under what real-world policy, is an organizational decision this implementation cannot make.
  See the runbook §1 and §13.
- **No drill has been performed against a real deployment** — only against the automated test
  suite's ephemeral, in-process keys. The runbook (§13) recommends a rehearsed, non-production
  drill using `--generate-ephemeral` before relying on this in a genuine incident.
- **`A2_RECOVERY_ENABLED` has no automatic time-boxing** (unlike `A2_BOOTSTRAP_ENABLED`, which
  the existing runbook treats as a one-shot window) — every individual statement is still
  independently signed, scoped, and single-use, so leaving the flag on does not by itself widen
  the attack surface beyond "an attacker who also possesses a valid signed statement," but
  organizations with stricter change-control expectations may choose to gate it as a window
  anyway (documented as a recommendation, not a requirement, in the runbook §7).
- **"Replacement" requires two separate ceremonies run by (potentially) two separate custody
  chains** (recovery key, then bootstrap key) — this is the approved design's intent, not a
  limitation introduced here, but it does mean a successor cannot be named in the same API call
  that performs the revocation; operationally there will always be a window with zero active
  `SUPER_ADMIN` between the two steps.
- **No in-app UI** was built or requested for this ceremony (consistent with the offline,
  CLI-only nature of the equivalent bootstrap ceremony) — this is a deliberate scope boundary of
  the approved design, not an oversight.

## 9. Final commit

- **Branch:** `arena/01a10374-monienaija`
- **Commit hash:** `7d7487fd136bcc1a518fd49fa16220f97ee6551f` (the commit that introduced this
  implementation and these three docs). Note: because this report is itself part of that
  commit's tree, and amending a commit's content changes its own hash, this value necessarily
  reflects the commit as it was constituted immediately before this line was filled in; see the
  session's final chat response, and `git log -1` / `git log origin/arena/01a10374-monienaija`,
  for the actual hash the branch tip carries after this edit was folded in.
- **Files committed:** the complete recovery implementation (migration, entity, types,
  config, service, controller, catalogue grant, module wiring, CLI generator), its two
  mechanical compatibility-supporting source edits (`finance-role-administration.service.ts`'s
  extracted pure function, `workforce-session.service.ts`'s new manager-scoped method,
  `production-readiness.service.ts`'s updated migration-head constants), the integration and
  unit tests (new + ~27 mechanically-updated), and this report plus the runbook and env
  template documents. No dashboard-platform or other unrelated workspace changes are included.
