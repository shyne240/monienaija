# Sandbox integration readiness

Group 31. Scope: whether the application actually starts and serves, and what the sandbox honestly cannot certify.

## The finding that matters

Booting the compiled application against a fully migrated database:

```
$ node dist/main.js
Application startup failed: Production readiness failed: financial_dependencies_not_ready
```

**The application refuses to start.** Not because the database is missing, not because a migration failed — the
schema is current, reconciliation reports healthy, the runtime role is safe — but because eight financial
dependencies have never been independently verified:

| Blocker                                             | What it means                                            |
| --------------------------------------------------- | -------------------------------------------------------- |
| `trusted_kyc_provider_activation_unverified`        | no evidence a real KYC provider is activated and trusted |
| `customer_kyc_consent_notice_and_policy_unverified` | no verified consent notice text or policy version        |
| `identity_key_versions_unverified`                  | key versions not verified against a real key store       |
| `effective_kyc_policy_unverified`                   | the effective KYC policy has not been verified           |
| `provider_governance_and_routing_unverified`        | routing rules unverified                                 |
| `wallet_ownership_governance_unverified`            | wallet ownership governance unverified                   |
| `institution_kyc_tier_limit_governance_unverified`  | institution tier limits unverified                       |
| `financial_authorization_dependencies_unverified`   | the authorization dependency chain unverified            |

This is **the gate working correctly**, and it is asserted rather than worked around. The obvious "fix" — a flag
that skips readiness in development — would be a flag that skips it in production too. A sandbox booting
successfully is not evidence of any of those eight.

The acceptance suite also asserts the distinction: `database.status === 'ok'` and `migrations.compatible === true`
at the same moment the verdict is `error`. The refusal is about **unverified dependencies**, not broken
infrastructure.

## What the suite does prove

`test/sandbox-integration-readiness.integration.spec.ts` boots the **entire `AppModule`** — not the handful of
services a focused suite instantiates — with the real Fastify adapter, the real `api/v1` global prefix and the real
validation pipe, mirroring `src/main.ts` line for line. That is what a container runs.

Eleven assertions, all passing:

| Assertion                                           | Why it is not covered elsewhere                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `AppModule` assembles with every provider resolved  | a missing provider or dependency cycle fails here and nowhere else       |
| a substantial route surface is registered           | a half-registered graph is a deployment waiting to fail                  |
| routes mount under `api/v1` **and not at the root** | a route that answers 404 in the container can pass every in-process test |
| liveness answers unauthenticated                    | an orchestrator cannot hold a credential                                 |
| readiness answers                                   | reachable and structured                                                 |
| a protected route refuses an unauthenticated caller | a route returning 200 without a token is an incident                     |
| a 404 is structured, with no stack trace            | a trace in a body is an information-disclosure bug                       |
| the startup gate refuses                            | see above                                                                |
| every blocker is named individually                 | "not ready" alone is not actionable                                      |
| the database is simultaneously healthy              | the refusal is dependency policy, not infrastructure                     |
| no live provider credential is exported             | a real provider key must never be present during acceptance              |

The suite also caught a real error in itself: the first run asserted `/api/v1/health/live`, which returned 404 —
there is no `live` sub-route, liveness is `/api/v1/health`. Asserting a path from memory rather than from the
router is how a smoke test becomes fiction; the comment recording that is left in place.

## How to run the safe local stack

```
LOCAL_DB_CONFIRMED_ISOLATED=yes \
A5_PILOT_EMERGENCY_STOP=true \
NOTIFICATION_SMS_PROVIDER=console NOTIFICATION_EMAIL_PROVIDER=none \
npm run local:preflight     # read-only; refuses non-loopback hosts and live credentials
npm run local:start:safe
```

`local:preflight` validates the app's own `environmentSchema`, refuses any non-loopback `DB_HOST`, refuses
non-`console`/`none` providers, requires `A5_PILOT_EMERGENCY_STOP=true` and never prints a value or a database
error message. Note that it will pass while startup still refuses — the blockers are not configuration.

## What this does NOT certify

- **Not a deployment.** Nothing was deployed and no orchestrator scheduled anything.
- **Not `docker compose`.** No container runtime exists here. The compose file is not exercised.
- **Not production configuration.** A `.env` suitable for production has never been produced, and the blockers
  mean it could not be.
- **Not live provider connectivity.** No provider was contacted. `NOTIFICATION_EMAIL_PROVIDER=none` is asserted
  during acceptance.
- **Not browser acceptance.** That is Group 33; this suite drives HTTP in-process.
- **Not a load or soak test.** One process, sequential requests.
- **Not the mobile apps.** Group 32.
- **Not eight of the eight financial dependencies.** None has been verified; that is the point.

## Honest summary

The application **does** assemble, mount its routes, answer liveness and readiness, and refuse unauthenticated
access — verified by booting the real module graph. It **does not** start as a deployable service, and it is right
not to. The difference between those two sentences is the entire content of this group.
