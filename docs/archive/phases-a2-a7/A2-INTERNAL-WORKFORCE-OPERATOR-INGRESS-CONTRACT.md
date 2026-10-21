# A2T11 Internal Workforce Operator Ingress Contract

The `/api/v1/internal/a2/workforce` boundary is internal administration only. Session exchange accepts only an OIDC ID token and configured source address/issuer rate-limit dimensions. All other operations require an A2 workforce bearer session; customer sessions cannot authenticate this boundary.

The boundary supports session establishment/revocation, one-time bootstrap consumption, bounded Finance role assignment/revocation, and existing A2 approval request/decision orchestration. It never trusts principal, role, scope, or MFA request headers/body fields and remains transport only. A2 authenticates/authorizes/approves; role definitions/rules are configured; B2F06 remains Finance policy authority.

Protected categories use configuration-driven token buckets. PostgreSQL is shared multi-instance state; unavailable state fails closed. Keys derive from direct peer address+configured issuer before authentication, principal+session after authentication, and principal+action for sensitive actions. Proxy forwarding is not trusted unless deployment explicitly configures trusted proxies. Audit records category/outcome/correlation and hashed dimensions, never tokens/assertions.

Future gateways/C-platform controls are defense in depth and do not replace A2 limits. Production deployment must supply network restriction, TLS/proxy trust, rate values, monitoring, and emergency disable evidence; this runtime does not claim deployment.
