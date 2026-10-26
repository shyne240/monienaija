# V1-SUPER-ADMIN-RECOVERY-RUNBOOK-01 — Protected SUPER_ADMIN Recovery, Revocation, and Replacement

**Audience:** The organization's designated offline signing-key custodian(s) and the
platform operator who holds the `ADMINISTRATOR` workforce role.
**Status:** Authoritative operator procedure for `V1-SECURITY-SUPER-ADMIN-RECOVERY-01`.
**Approved design basis:** `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md` §3
("Decision — SUPER_ADMIN recovery, revocation, and replacement"). This runbook implements
that decision exactly; it does not introduce any new governance model.
**Companion files:**
- `docs/deployment/config/v1-super-admin-recovery.env.template` — configuration template
  (validated by the real config parser, `src/authorization/workforce-configuration.ts`)
- `scripts/generate-revocation-statement.ts` — offline statement generator
  (`npm run recovery:statement`)
- `src/authorization/super-admin-recovery.service.ts` / `.controller.ts` — consumption logic
- `src/migrations/1785753600088-CreateSuperAdminRecoveryConsumptions.ts` — replay ledger
- `test/v1-security-super-admin-recovery-01.integration.spec.ts` — 18-scenario proof, real
  PostgreSQL
- `docs/V1/V1-SECURITY-SUPER-ADMIN-RECOVERY-01-REPORT.md` — implementation report
- `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md` — the pre-existing, unchanged
  bootstrap ceremony this runbook composes with for "replacement" (§8 below)

> Security note: this runbook references secrets by location only. It never contains a
> secret value, and neither should any artifact you produce from it.

---

## 0. What this ceremony is, and is not

Per the approved decision, **recovery / revocation / replacement is not three separate
software operations.** There is exactly **one** new operation implemented by this task:

- **Revocation** (`operation: "REVOKE_SUPER_ADMIN"`) — ends the current ACTIVE `SUPER_ADMIN`
  assignment. This is the only statement type the server accepts; it is what the design
  document calls the `SUPER_ADMIN_REVOCATION` statement.

**"Replacement"** is this revocation ceremony followed by the pre-existing, already-tested,
**unchanged** bootstrap ceremony (`consumeBootstrap()`, `V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`)
naming a new CEO identity. There is no "replace" statement type and none is needed — the
design document is explicit: *"No new creation logic is needed"* (§3). **Recovery** is the
name of the overall capability (being able to recover control of the platform when the
current `SUPER_ADMIN` must be removed), achieved by composing these two independent,
separately-audited ceremonies. Do not expect, request, or build a combined "replace in one
call" statement — it does not exist and introducing one would reunite two trust chains the
approved design deliberately keeps apart.

What this ceremony is **not**:
- It is **not** a second way to assign/revoke any ordinary role. `assign()`/`revoke()` on
  `A2FinanceRoleAdministrationService` are untouched and still unconditionally reject
  `roleKey === 'SUPER_ADMIN'`.
- It is **not** satisfied by an authenticated session alone. The calling `ADMINISTRATOR`
  session's own authority only ever permits *triggering consumption* of an
  already-externally-signed statement — it can never produce one.
- It is **not** a way to create a new `SUPER_ADMIN`. A successful consumption only revokes
  the existing assignment; the system is then legitimately left with **zero** active
  `SUPER_ADMIN` until a fresh bootstrap ceremony is run.

---

## 1. Roles and responsibilities

| Responsibility | Who | Notes |
|---|---|---|
| **Signing-key custody** | A **named, accountable individual or quorum outside the application** (e.g. a board-designated security officer, or a multi-party quorum procedure) — an organizational decision this runbook cannot make for you. | This is the "genuine, non-software blocker" the approved design calls out explicitly: software can only enforce that *whoever* holds this authority is the only party able to mint a valid statement; it cannot substitute for your organization naming that party and documenting the policy (single officer vs. board quorum vs. independent security function). **Decide and record this before relying on this capability.** |
| **Statement generation (offline)** | The signing-key custodian(s), on a controlled, ideally air-gapped host. | Uses `npm run recovery:statement`. Never run on a host that also runs the production application or holds ordinary administrator credentials. |
| **Statement consumption (in-app trigger)** | A workforce principal holding the `ADMINISTRATOR` role, with an MFA-asserted session. | Cannot act alone — see §0. The platform never trusts this principal's judgment about *whether* to revoke; it only trusts the externally-signed statement about *whether a revocation is authorized*. |
| **Trusted-key provisioning (`A2_RECOVERY_JWKS_JSON`)** | Whoever controls deployment configuration / secrets management (infrastructure team), under change control. | There is **no in-application API** for any workforce principal, including `ADMINISTRATOR`, to add or change a trusted recovery key. The only way to register one is to edit this environment variable and redeploy/restart — see §4. |
| **Post-revocation successor appointment** | Same custodian(s) that control the pre-existing bootstrap ceremony's key (`A2_BOOTSTRAP_JWKS_JSON`) — may be the same or a different custody chain, per your organization's policy. | See §8. |

---

## 2. Prerequisites

| Prerequisite | Detail |
|---|---|
| Deployment already running the workforce plane | `A2_WORKFORCE_ENABLED=true`, migrated through at least `1785753600088` (`npm run migration:run`). |
| `ADMINISTRATOR` role assigned to at least one real, MFA-enrolled workforce principal | Assigned via the normal role-administration surface, same as any other `ADMINISTRATOR` grant. This is the principal who will trigger consumption — see §1. |
| Recovery ceremony enabled in configuration | `A2_RECOVERY_ENABLED=true`, `A2_RECOVERY_AUDIENCE` set, and the custodian's **public** key registered in `A2_RECOVERY_JWKS_JSON` — see `docs/deployment/config/v1-super-admin-recovery.env.template` and §4 below. |
| The exact `targetPrincipalId` of the `SUPER_ADMIN` assignment to revoke | This is the `<issuer>:<subject>` value bound at that `SUPER_ADMIN`'s original bootstrap — recoverable from the `a2_finance_role_assignments` row's `principal_id` column (read-only query; see §6) or from your own identity records. |
| A controlled offline host for the signing step | Repository checkout + `npm ci` (dev dependencies — the generator runs under `ts-node`). The generator never makes a network call; it can and should be run fully offline. |
| A change-ticket / board-approval reference | Recorded as `--approval-change-reference`, and persisted verbatim in the immutable audit trail. |
| A fresh nonce per attempt | `openssl rand -hex 16`. Never reused — the server rejects any replay, successful or not. |

---

## 3. Offline key setup

This is a **separate key from the bootstrap ceremony's key.** Never reuse one for the other —
the approved design requires the two trust chains to be structurally independent.

On the custodian's offline host:

1. Decide the key id, e.g. `recovery-2026-10-01-prod` (pattern `[A-Za-z0-9][A-Za-z0-9_.:-]*`).
2. Choose ONE key source:
   - **Durable, custody-controlled key (required for a genuine ceremony):** generate or
     locate an RSA keypair under the organization's actual key-custody policy (e.g.
     `openssl genrsa -out recovery-key.pem 2048`, stored per that policy — HSM, offline
     vault, sealed envelope procedure, etc.). Pass `--private-key-pem recovery-key.pem`.
   - **Ephemeral (`--generate-ephemeral`):** for local drills/tests **only**. The keypair
     exists only in the generator's memory for the signing operation and is discarded
     immediately after; only the **public** key is ever printed. **Never use this for an
     actual production recovery** — a throwaway key cannot be re-verified or re-used for a
     subsequent legitimate action, and provides no accountable custody trail.
3. The private key is never put into env files, the database, the repository, a ticket, a
   chat message, or any artifact that leaves the custodian's control. Nothing in the running
   application ever needs it, before or after the single consumption. Shred a PEM file after
   the ceremony window closes (`shred -u recovery-key.pem`).

---

## 4. Register the trusted public key (deployment configuration)

The generator's output includes `envSnippet.A2_RECOVERY_JWKS_JSON` — the **public** key only,
already in the exact shape the server's configuration validator expects. Paste it into the
deployment's environment:

```
A2_RECOVERY_ENABLED=true
A2_RECOVERY_AUDIENCE=monienaija-v1-super-admin-recovery
A2_RECOVERY_JWKS_JSON=<paste envSnippet.A2_RECOVERY_JWKS_JSON here — PUBLIC key only>
```

Restart the application. `src/authorization/workforce-configuration.ts` validates this at
startup and **fails closed**: if `A2_RECOVERY_ENABLED=true` with no keys, or a duplicate
`kid`, or a key whose `environment` field does not equal this deployment's `NODE_ENV`, the
application refuses to start rather than booting into an inconsistent trust state.

This is the **only** mechanism to add a trusted recovery key. There is no HTTP endpoint,
Admin Web screen, or in-app action that lets any workforce principal — including
`ADMINISTRATOR` — register, modify, or disable a trusted key. Only whoever controls this
environment variable and the deployment's restart/redeploy pipeline can do so.

**Key rotation:** to retire a key, remove its entry from `A2_RECOVERY_JWKS_JSON` and
redeploy; to add a new one without retiring the old one, append it to the array (`kid`
values must stay unique). A statement signed by a retired key is rejected with `Unknown
recovery signing key` the moment it is removed from the array — there is no grace period
unless you intentionally keep both entries present during a transition.

---

## 5. Generate the signed revocation statement (offline)

```
npm run recovery:statement -- \
  --private-key-pem recovery-key.pem \
  --kid recovery-2026-10-01-prod \
  --environment production \
  --target-principal-id 'https://idp.example.com:9f3d...-oidc-sub' \
  --audience monienaija-v1-super-admin-recovery \
  --reason 'Departing CEO; board-approved successor ceremony pending (CHG-000456)' \
  --nonce "$(openssl rand -hex 16)" \
  --approval-change-reference CHG-000456
```

Binding rules the server enforces (see `SuperAdminRecoveryService.consumeRevocation`):
- `--target-principal-id` must be the **exact** `principalId` of the currently ACTIVE
  `SUPER_ADMIN` assignment (the same `<issuer>:<subject>` value bound at that principal's
  original bootstrap). The tool derives `targetAssignmentReference` from it automatically
  using the identical formula the server uses
  (`financeRoleAssignmentReference(principalId, 'SUPER_ADMIN', environment)`) — you never
  compute or copy a hash by hand, and cannot accidentally mismatch it.
- `--environment` must equal the server's `NODE_ENV`.
- `--audience` must equal `A2_RECOVERY_AUDIENCE`.
- `--kid` must match a `kid` present in `A2_RECOVERY_JWKS_JSON` at consumption time.
- The statement's default validity window is 15 minutes from generation (`--issued-at` /
  `--expires-at` are overridable but the tool itself refuses to emit an already-expired
  statement) — **consume promptly.**

Output is JSON with `statement` (the compact JWS to submit), `publicJwk`, `envSnippet`
(for §4), and `selfCheck: 'OK'` — the tool verifies its own output with the real production
verifier before printing anything, so a malformed statement is caught at generation time,
not at consumption time. **No private key material is ever included in this output.**

---

## 6. (Recommended) Confirm the target before consuming

Read-only, no mutation — confirms you are about to revoke the intended assignment:

```sql
SELECT id, principal_id, assignment_reference, status, assigned_at
FROM a2_finance_role_assignments
WHERE role_key = 'SUPER_ADMIN' AND status = 'ACTIVE';
```

There must be exactly one row, and its `principal_id` must equal the `--target-principal-id`
you used in §5. If zero rows exist, there is nothing to revoke (consumption will fail with
`No matching active SUPER_ADMIN assignment to revoke`); if the `principal_id` differs,
regenerate the statement with the correct value — do **not** attempt to edit this table
directly.

---

## 7. Invoke consumption (in-app, by the `ADMINISTRATOR` operator)

1. The `ADMINISTRATOR` operator obtains a normal, MFA-asserted workforce session exactly as
   for any other workforce action:
   `POST /api/v1/internal/a2/workforce/sessions` with the OIDC idToken — see
   `V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md` §6 for the identical session-exchange mechanics.
2. Submit the statement produced in §5:
   ```
   POST /api/v1/internal/a2/workforce/super-admin/recovery
   Authorization: Bearer <accessToken>
   Content-Type: application/json

   {"statement": "<compact JWS from §5>"}
   ```
3. The operator's own authority (the `workforce.super_admin.recover` catalogue function,
   granted to `ADMINISTRATOR` only, plus the service's own independent `ADMINISTRATOR` + MFA
   check) is what lets them make this *request* — it is never what authorizes the *outcome*.
   The outcome is authorized exclusively by the signature verified in step 2.

**Organizational decision point:** this runbook does not mandate a separate change-controlled
"recovery window" the way the bootstrap ceremony mandates opening/closing
`A2_BOOTSTRAP_ENABLED`, because `A2_RECOVERY_ENABLED` gates nothing about *authority* (every
statement is still independently signed and verified) — only about whether the endpoint exists
at all. If your organization's control framework requires an explicit window regardless, treat
`A2_RECOVERY_ENABLED` the same way the bootstrap runbook treats `A2_BOOTSTRAP_ENABLED`: `false`
outside of a declared, ticketed window.

---

## 8. Expected response, database effects, and audit evidence

**Success — HTTP 201** with a `A2SuperAdminRecoveryViewV1` body, e.g.:

```json
{
  "recoveryReference": "a2-recovery-…",
  "operation": "REVOKE_SUPER_ADMIN",
  "targetAssignmentReference": "a2-fin-role-…",
  "targetPrincipalId": "https://idp.example.com:9f3d...-oidc-sub",
  "reason": "Departing CEO; board-approved successor ceremony pending (CHG-000456)",
  "revokedSessionCount": 1,
  "consumedBy": "<principalId of the ADMINISTRATOR who triggered this>",
  "consumedAt": "2026-10-01T00:00:00.000Z",
  "auditReference": "<audit event id>"
}
```

All of the following happen inside **one `SERIALIZABLE` database transaction** — either all
of it commits, or none of it does:
1. The targeted `a2_finance_role_assignments` row: `status` → `REVOKED`, `revoked_by` set to
   `recovery:<triggering ADMINISTRATOR principalId>`, `revoked_at` set.
2. **Every** currently-`ACTIVE` `a2_workforce_sessions` row for the revoked `SUPER_ADMIN`
   principal is immediately set to `REVOKED` (not just the session that happened to be used
   to bootstrap it — every concurrently live session for that identity). Any bearer token
   for that principal stops working on its very next request.
3. An audit event (`entityType: A2_FINANCE_ROLE_ASSIGNMENT`, `action: SUPER_ADMIN_REVOKED`)
   is recorded with: the triggering `ADMINISTRATOR` principal as actor, the recovery
   reference, nonce, operation, target assignment reference, target principal id, reason,
   environment, audience, approval-change reference, signing-key reference (`kid`), and the
   revoked-session count. It never contains the private key, the signature bytes, or any
   session token.
4. A row is inserted into `a2_super_admin_recovery_consumptions` (the one-time ledger) with
   the same evidence plus `statement_hash` (a SHA-256 of the canonical statement — never the
   raw signature) and a reference to the audit event.

**No manual SQL is ever required or sanctioned** for any part of this.

**To inspect audit evidence after the fact:**
```sql
SELECT id, action, actor, entity_id, new_values, created_at
FROM audit_events
WHERE action = 'SUPER_ADMIN_REVOKED'
ORDER BY created_at DESC;

SELECT recovery_reference, nonce, target_principal_id, consumed_by, consumed_at, audit_reference
FROM a2_super_admin_recovery_consumptions
ORDER BY created_at DESC;
```

---

## 9. Step 2 of "replacement" — appoint a successor (existing, unchanged ceremony)

Revocation alone leaves the deployment with **zero** active `SUPER_ADMIN` — this is expected
and audited, not a bug. To appoint a successor, run the **pre-existing, unmodified** bootstrap
ceremony exactly as documented in `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`,
naming the new CEO's OIDC identity. That ceremony's own completion guard (`Finance bootstrap
already completed`) will no longer block it, because the prior `SUPER_ADMIN` assignment's
`status` is now `REVOKED`, not `ACTIVE`. No code or configuration from this runbook changes
how that ceremony works.

---

## 10. Replay protection and concurrency behaviour

- **Replay:** the `nonce` column on `a2_super_admin_recovery_consumptions` is `UNIQUE` at the
  database level. Submitting the identical statement twice returns `409 Recovery replayed`
  on the second attempt; submitting a *different* statement that happens to reuse a
  previously-consumed nonce returns `409 Recovery nonce conflict`. Neither case mutates
  anything on the second attempt.
- **Concurrency:** if two consumption requests for the same statement race each other, the
  `SERIALIZABLE` transaction isolation plus the nonce's uniqueness constraint guarantee
  **exactly one** succeeds; the other fails closed (observed directly in testing as a
  real PostgreSQL `could not serialize access due to concurrent update` / unique-violation
  error surfaced as the same `409` outcome) — there is no window in which both could apply,
  partially apply, or double-revoke/double-audit.
- A statement for a now-already-revoked target, or for a target that no longer matches the
  live `ACTIVE` `SUPER_ADMIN` row's reference/principal, is rejected with `409 No matching
  active SUPER_ADMIN assignment to revoke` **without mutating anything** — confirmed by the
  test suite's explicit "zero mutation" assertion for this case.

---

## 11. Failure / error behaviour (fail-closed)

| Condition | Server outcome |
|---|---|
| `A2_RECOVERY_ENABLED` not `true` | 403 "Recovery disabled" |
| Calling session lacks MFA assurance | 403 "Recovery consumption requires MFA" |
| Calling principal does not hold `ADMINISTRATOR` (includes `SUPER_ADMIN` itself attempting self-trigger) | 403 "Recovery consumption requires the ADMINISTRATOR role" (defense-in-depth; the controller's own catalogue-function gate — granted to `ADMINISTRATOR` only — rejects earlier with a 403 from `AuthorizationService.requireFunction`) |
| Unknown `kid`, or a key present but minted for a different `environment` | 401 "Unknown recovery signing key" |
| Bad/tampered signature, including a self-signed statement using an unregistered key | 401 "Invalid RS256 signature" |
| Non-canonical JSON payload encoding | 401 "Recovery payload is not canonical" |
| Malformed/empty/missing-field statement | 400 "Invalid `<field>`" |
| Wrong `operation`, `environment`, `audience`, or `signingKeyReference` ≠ header `kid` | 401 "Recovery statement identity, purpose, or environment mismatch" |
| `targetAssignmentReference` does not match the value derived from `targetPrincipalId` | 401 "Recovery statement target reference is inconsistent" |
| Statement not yet valid (`issuedAt > now`) or expired (`expiresAt ≤ now`) | 401 "Recovery statement outside validity" |
| Nonce replay (identical statement) | 409 "Recovery replayed" |
| Nonce conflict (different statement, reused nonce) | 409 "Recovery nonce conflict" |
| No ACTIVE `SUPER_ADMIN` assignment matches the statement's target | 409 "No matching active SUPER_ADMIN assignment to revoke" |
| No authenticated workforce principal on the request at all | 403 "Workforce principal missing" |
| Rate-limit category misconfigured (`finance-role-administration` missing from `A2_WORKFORCE_RATE_LIMITS_JSON`) | 403 "Rate-limit policy missing: finance-role-administration" |

A statement's own validity window is short by design (15-minute default) — an expired
statement is simply discarded; regenerate with a fresh nonce rather than attempting to
extend or reuse it.

---

## 12. Incident escalation and safe retry

- **Statement rejected for a reason you did not expect:** do not retry blindly. Re-read §11,
  confirm the target assignment with §6's read-only query, and confirm `NODE_ENV`/
  `A2_RECOVERY_AUDIENCE`/the registered `kid` all match what you used in §5. Every rejection
  in §11 is a no-op — nothing partially applied.
- **Suspected compromised private key (before any consumption attempt):** remove the
  corresponding `kid` from `A2_RECOVERY_JWKS_JSON` immediately (§4) and redeploy. A key no
  longer present in that array cannot verify any future statement, regardless of how many
  valid-looking statements exist signed with it.
- **Suspected compromised or leaked (but not yet consumed) statement:** a leaked statement is
  not, by itself, sufficient to cause harm — consumption still requires (a) a genuine
  `ADMINISTRATOR` MFA session, and (b) the target assignment still being the live `ACTIVE`
  `SUPER_ADMIN`. If you are concerned, the only certain mitigation is key rotation (above),
  since the statement cannot be "un-signed," but it can be made unverifiable.
- **Operator (`ADMINISTRATOR`) account suspected compromised:** this ceremony cannot be
  misused by that account alone (see §0) — a compromised `ADMINISTRATOR` session can at most
  *attempt* to submit a statement it does not possess, which the signature check rejects. The
  immediate remediation is the same as for any compromised workforce account: suspend it
  through the normal workforce-user administration surface.
- **Ceremony partially executed / unexpected state:** this cannot happen for a single
  consumption attempt — the whole outcome (assignment revocation, session revocation, audit
  record, replay-ledger row) is one `SERIALIZABLE` transaction; it is always all-or-nothing.
  If the HTTP response was lost (e.g. network timeout) but you are unsure whether consumption
  succeeded, re-run §6's query: if the assignment shows `REVOKED`, it succeeded; if it is
  still `ACTIVE`, it did not, and the nonce is still available for exactly one legitimate
  retry attempt (or regenerate with a fresh nonce — either is safe).
- **Never do:** manually `UPDATE`/`INSERT` into `a2_finance_role_assignments`,
  `a2_workforce_sessions`, or `a2_super_admin_recovery_consumptions`; disable MFA at the IdP
  for the `ADMINISTRATOR` account; share the recovery private key via chat/email/ticket;
  reuse the bootstrap private key as the recovery key or vice versa; enable
  `--generate-ephemeral` for a real production ceremony.

---

## 13. Deployment prerequisites and outstanding organizational work

Before this capability can be relied upon in a real incident, your organization must have
**separately and explicitly decided and documented** (this runbook cannot do this for you):

1. Who custodies the recovery private key, under what policy (single officer / board quorum /
   independent security function / HSM-backed, etc.) — see §1.
2. Whether `A2_RECOVERY_ENABLED` is left permanently `true` or is itself gated behind a
   change-controlled window — see the note at the end of §7.
3. Who is authorized to hold the `ADMINISTRATOR` role in production, since that is the sole
   in-app trigger surface — this is governed by your existing role-assignment process
   (`V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01`), not by anything new here.
4. A tested, rehearsed drill of this exact runbook (using `--generate-ephemeral` in a
   non-production environment) before depending on it in a genuine incident.

Until (1)–(4) are genuinely decided and exercised by your organization, this capability is
**implemented and tested in software** but **not yet operationally ready** — software alone
cannot establish real-world key custody or a trained operator.

---

## Appendix A — What the statement contains (schema of `A2RecoveryStatementV1`)

`schemaVersion=1, operation="REVOKE_SUPER_ADMIN" (closed vocabulary; only one value exists
today), environment, audience, targetAssignmentReference, targetPrincipalId, reason,
approvalChangeReference, nonce, issuedAt, expiresAt, signingKeyReference (= JWS kid)` —
canonical (recursively key-sorted, whitespace-free) JSON, RS256-signed compact JWS with
header `{alg:"RS256", typ:"JWT", kid}`. Timestamps are millisecond UTC ISO-8601. This is
structurally the same wire format as `A2BootstrapStatementV1` (same crypto/canonicalization
code), with a payload shape specific to naming an existing assignment for revocation rather
than granting a new one.

## Appendix B — Traceability

- Endpoint & principal requirements: `src/authorization/super-admin-recovery.controller.ts`
  (`POST /internal/a2/workforce/super-admin/recovery`, rate-limited, session-bound,
  catalogue-function-gated).
- Verification/consumption logic: `src/authorization/super-admin-recovery.service.ts` →
  `consumeRevocation`.
- Crypto/canonicalization: `src/authorization/workforce-crypto.ts` (reused, unchanged, from
  the bootstrap ceremony).
- Configuration validation: `src/authorization/workforce-configuration.ts`.
- Replay ledger: `src/migrations/1785753600088-CreateSuperAdminRecoveryConsumptions.ts`.
- Offline generator: `scripts/generate-revocation-statement.ts` (`npm run recovery:statement`).
- End-to-end proof: `test/v1-security-super-admin-recovery-01.integration.spec.ts` (18 cases,
  real PostgreSQL — see the implementation report for the exact command and result).
