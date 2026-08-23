# A2T11 Workforce Authentication and Privileged Session Contract

A2 validates OIDC ID tokens only: compact JWS, RS256, required `kid`, exact configured issuer/audience, `azp` for multiple audiences, required `iss/sub/aud/iat/exp/auth_time`, optional `nbf`, 60-second skew, five-minute assertion age, and provider `amr` marker `mfa`. `acr` is evidence only. Stable identity is `<issuer>:<sub>`; email/profile/role/scope claims never define identity or entitlement.

Configured JWKS URI keys are locally cached for 15 minutes, remain usable for at most one hour after currentness confirmation, and support one per-issuer single-flight refresh. Unknown `kid` refreshes once, then fails and is suppressed for 30 seconds by issuer+key. Caches retain at most 32 compatible keys and 256 deterministic unknown-key entries per issuer.

After current MFA-qualified validation, A2 issues an opaque random workforce token, stores only SHA-256 token hash, and persists issuer/subject, authentication time, assurance, audience, role-resolution evidence, issue/expiry/currentness, and revocation. Sessions are distinct from customer sessions, audience-bound, short-lived through required deployment configuration, revocable, and narrowed when assignments expire/revoke. Missing/stale evidence fails closed.

Production configuration must supply issuer, JWKS URI, audience/client, internal audience, session TTL, role/rule definitions, rate rules, and environment. No provider or identity is seeded.
