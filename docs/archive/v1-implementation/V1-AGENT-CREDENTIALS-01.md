# V1-AGENT-CREDENTIALS-01 — Agent Credential Lifecycle

**Scope:** closes the verified V1 gap from `docs/V1-BOOTSTRAP-AUDIT-01.md` §6.2:
application → approval → activation existed, but no production path created
`agent_authentication_credentials`, so an activated Agent could never log in without
manual SQL. This change adds the smallest possible credential-provisioning flow **on top
of the existing Agent authentication architecture** — no new auth model, no financial
side effects, no customer/aggregator changes.

## 1. The V1 Agent credential lifecycle (complete flow)

```
Agent application (public)                POST /api/v1/agents/applications
  → workforce review/approval (internal)  existing approval surfaces
  → activation (workforce)                POST /api/v1/internal/admin/agents[/applications]/:id/activate
  → CREDENTIAL ISSUANCE (workforce)       POST /api/v1/internal/admin/agents/:id/credentials
        ↳ one-time response: temporaryPassword (72 h expiry, rotationRequired=true)
        ↳ operator delivers it to the Agent OUT-OF-BAND (see §5)
  → first login attempt (Agent)           POST /api/v1/agents/sessions
        ↳ password verifies, but NO session is issued: { rotationRequired: true }
  → MANDATORY ROTATION (Agent)            POST /api/v1/agents/credentials/rotate
        ↳ verifies temporary password, sets new PBKDF2 hash v2, clears flag+expiry,
          revokes credential's sessions, issues the Agent's FIRST real session
  → normal Agent access                   login → session → Agent App, PIN, history, flows
```

## 2. Who issues the credential (actor & authorization)

| Surface | Actor | Enforcement |
|---|---|---|
| `POST /internal/admin/agents/:id/credentials` | workforce session, **OPERATOR / SERVICE / PRIVILEGED only** (`SUPPORT`, CUSTOMER, AGENT, AGGREGATOR denied — same actor vocabulary as `AdminAgentLifecycleController`, V1-003 decision) | `RuntimeAccessGuard` WORKFORCE_SESSION mode (route registry branch `agent-credential-issuance`) + `requireOperational` in controller |
| `POST /internal/admin/agents/:id/credentials/reissue` | idem | idem |
| `POST /agents/credentials/rotate` | the Agent itself, proving the temporary password — unauthenticated like login (registry branch `agent-credential-rotation`, mode `AGENT_LOGIN`) | verification via the real `AgentAuthenticationExecutionService` (lockout, failed-attempt accounting) |

Identity is never trusted from a caller-supplied body: issuance binds to the **path**
agent id; rotation binds to the **authenticated** credential (`credentialId` comes from
successful verification, not from the request).

## 3. The initial credential (how it is protected)

- Plaintext temporary password: 16 base64url chars from `crypto.randomBytes(12)`
  (≈96 bits, CSPRNG — no fixed/predictable/hard-coded value; no `agent/agent`-style
  defaults anywhere).
- Storage: PBKDF2-SHA256, 10 000 iterations, per-credential salt
  (`PBKDF2$sha256$10000$<salt>$<digest>`) — the module's established format, verified by
  `AgentPasswordHashVerificationService` (`timingSafeEqual`).
- Plaintext appears **exactly once**: in the authorized issuance HTTP response. It is
  never persisted, never audited (audit projection `credentialValues` contains no
  password/hash), never logged, never e-mailed/SMSed/pushed.
- The temporary credential expires (72 h; existing `password_expires_at` column) and
  carries the new `rotation_required` flag (migration `1785753600077`, default FALSE —
  pre-existing credentials unaffected).
- One non-deleted credential per Agent (existing partial unique index enforced);
  duplicate issuance → 409.

## 4. First-login rotation (how it works)

1. `POST /agents/sessions` with the temporary password: verification succeeds, the
   response is `{ rotationRequired: true, agentId }` — **no access token, no session row**.
2. `POST /agents/credentials/rotate {agentId, currentPassword, newPassword}`:
   - `currentPassword` is verified through the real execution service (failures feed the
     existing counter; 5 failures lock the account — same as login);
   - the credential must be ACTIVE with `rotation_required=true` — otherwise 403;
   - `newPassword` rules: 8–128 chars, must differ from the current one;
   - server hashes it (PBKDF2, same convention), stores `password_version+1`, clears the
     flag and the expiry, resets lockout counters, audits `PASSWORD_ROTATED`;
   - all sessions of the credential are revoked (`revokeAllForCredential` convention);
   - the Agent's first real session is issued in the same response.
3. Afterwards the Agent logs in normally; the old temporary password is permanently dead.

**Login password ≠ transaction PIN ≠ OTP/MFA** — unchanged. The PIN lives in
`agent_transaction_pins` and is untouched by every credential operation (proven);
MFA/OTP challenge machinery is exercised by financial transactions only and is not
involved in credential provisioning (proven: zero `mfa_challenges` rows).

## 5. How the Agent obtains the credential (delivery boundary)

There is deliberately **no** credential delivery over SMS/e-mail/push: the platform has
no secure, verified recipient-binding channel for secrets in V1, and none was invented.
The authorized workforce operator reads the one-time `temporaryPassword` from the
issuance response and delivers it to the (approved, activated) Agent through an
out-of-band operational channel under their own controls. The credential is short-lived
and rotation-forced, so interception windows are bounded and a leaked-but-unrotated
temporary credential cannot produce a session once rotation (or reissuance) has occurred.

## 6. Suspension / termination

- Issuance and reissuance require `AgentStatus.ACTIVE` (409 otherwise — PENDING /
  SUSPENDED / TERMINATED are all denied, mirroring the established
  `AgentReceivingNumberService` gate vocabulary).
- Suspension/termination already blocks login at the execution layer (agent status
  check) — credential operations do not change that, and neither operation revives an
  Agent or touches financial state.
- Locked credentials follow the existing 5-failure lockout; rotation resets the counters
  only after a *successful* rotation.

## 7. Reissuance (lost/forgotten temporary credential)

`POST /internal/admin/agents/:id/credentials/reissue` (same workforce actor rule):
within one transaction the previous credential is marked `REVOKED` + soft-deleted
(freeing the single-slot index), a new temporary rotation-required credential is
inserted, and the caller-side orchestration revokes every session of the previous
credential. The old password (temporary or rotated) is permanently dead. Audits:
`REVOKED` for the old row, `CREDENTIALS_REISSUED` for the new one (none containing
secrets).

## 8. Atomicity decision (activation vs. issuance)

Issuance is a **separate authorized step** after activation, not folded into the
activation transaction. Rationale (task-sanctioned documented boundary): activation is
idempotent and shared by two legacy surfaces; folding secret generation into it would
change lifecycle signatures and responses used by existing flows/tests. The resulting
state machine is explicit and enforced:

`PENDING (no credential possible) → ACTIVE (issuance possible, idempotently once)
 → ISSUED (temporary, rotation-required, 72 h) → ROTATED (normal access)`

An Agent momentarily visible as ACTIVE without a credential simply cannot authenticate
(no session possible) — the invariant that matters (no illegitimate access) holds at all
times, and the 16-case real-PostgreSQL suite (`test/v1-agent-credentials-01.integration.spec.ts`)
proves every transition of this machine.

## 9. Financial isolation

Credential issuance/rotation touches **only** `agent_authentication_credentials`,
`agent_authentication_sessions`, and `audit_events`. Proven: ledger lines, journals,
wallet accounts, transfers, and idempotency records are byte-identical before/after a
full issue→rotate cycle.
