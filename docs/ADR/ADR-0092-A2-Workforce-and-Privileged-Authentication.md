# ADR-0092 — A2 Bounded Workforce and Privileged Authentication

- **Task:** A2T11 — A2 Bounded Workforce and Privileged Authentication Extension
- **Owner:** A2 Runtime Identity & Access
- **Permanent administration owner:** B9 Identity & Access Administration
- **Status:** Accepted; bounded runtime implemented, production provider not configured
- **Migration:** `1785753600052-CreateA2WorkforceAuthenticationTables.ts`

## Context

A2 supports authorization and privileged approvals but previously authenticated only customer sessions. B2F06 requires real workforce maker/checker principals. Historical A2T01–A2T10 remain unchanged.

## Decision

1. Validate provider-agnostic OIDC ID tokens as compact RS256 JWS using configured issuer, audience/client, and JWKS URI; require `kid`, `iss`, `sub`, `aud`, `iat`, `exp`, and `auth_time`.
2. Enforce 60-second clock skew, five-minute assertion age, `azp` for multiple audiences, and `amr` containing `mfa` with five-minute `auth_time` freshness for privileged sessions.
3. Derive stable principal identity as `<issuer>:<subject>`; never use email/profile claims or OIDC roles/scopes.
4. Issue separate short-lived, hashed, audience-bound, revocable A2 workforce sessions; customer sessions cannot cross this boundary.
5. Consume configuration-driven Finance role definitions and maker/checker rules. Persist bounded interim assignments under A2; B9 remains permanent administrator.
6. Bootstrap only the first `FINANCE_ADMIN` through externally signed, compact RS256 JWS using a dedicated environment-bound key set, canonical JSON, exact scope allowlist, explicit window, nonce, one-time consumption, and audit.
7. Permit the bootstrap administrator to assign only the first non-admin Finance roles to distinct principals without a second checker. Later assignments and revocations consume existing A2 actions `FINANCE_ROLE_ASSIGN` and `FINANCE_ROLE_REVOKE` with deterministic assignment fingerprints.
8. Protect internal workforce ingress through A2 sessions, dynamic role/rule authorization, token-bucket security limits, and shared audit. PostgreSQL supplies shared multi-instance limiter state.
9. Bound OIDC JWKS behavior: 15-minute refresh, one per-issuer single flight, 30-second issuer+unknown-kid suppression, 32 keys and 256 suppression entries per issuer, and one-hour maximum staleness.
10. Export deterministic interim assignment/history evidence for B9 migration. No B9 behavior is implemented.

## Consequences

- Production remains fail closed until trusted OIDC/bootstrap/role/rate configuration is supplied.
- No production identities, assignments, sessions, bootstrap statements, approvals, or Finance policies are seeded.
- Existing A2 authorization and privileged approval remain authoritative.
- B2F06, A5T11, B2F03, B1T12, and B2F07–B2F09 remain unchanged.

## Alternatives rejected

- Customer-to-workforce escalation; caller role/scope/MFA claims; OIDC role claims; unsigned bootstrap; shared OIDC/bootstrap keys; non-RS256 algorithms; in-memory-only production rate limiting; B2F06 role ownership; early B9 implementation; public Finance administration APIs.
