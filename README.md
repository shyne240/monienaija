# MonieNaija

Nigerian (NGN) mobile-money backend — a NestJS 11 (Fastify) + PostgreSQL (TypeORM) modular monolith
providing the V1 in-house wallet ecosystem: customer wallets, agent network cash services, and
workforce administration, all anchored in a double-entry ledger. Production-oriented, migration-driven,
verified by integration tests against real PostgreSQL (no mocks for financial lanes), and accepted
through a 191-item manual UAT catalogue.

> **V1 status: UAT CONDITIONALLY PASSED** — all 175 executable test cards passed with zero open
> defects; the remaining 16 catalogue items are environment/physical-lane verifications to complete
> on the production deployment (see [UAT](#uat-status) below). Basis: `docs/uat/V1-UAT-FINAL-01.md`.

## What V1 contains

Seven money-moving flows, all ledger-posted, idempotent, and limit-enforced:

- **Wallet→Wallet transfers** (customer-to-customer, transaction-PIN confirmed, beneficiary support)
- **Agent CASH_IN / CASH_OUT** (float-based, fail-closed capability gates, agent transaction PIN)
- **Cash→Cash** agent-assisted transfers (recipient claim by code + TTL expiry sweep, default 7 days)
- **Customer funding** (operator-initiated via workforce maker/checker)
- **Agent funding / defunding** (non-fee-bearing float management per V1 policy)

Supporting capabilities:

- **Customers:** OTP registration with phone verification (`+234` canonicalization), credential
  rotation gate, preferences, beneficiaries, receiving numbers, notification inbox, support tickets
- **Agents:** applications/lifecycle/classes, receiving numbers, outlets & terminals, transaction
  PINs, unified transaction history
- **Workforce admin:** OIDC authentication with enforced MFA, internal sessions, role-gated
  operations, maker/checker controls, investigation and diagnostics views, one-time bootstrap ceremony
- **Notifications:** outbox-driven SMS (Robase provider adapter; bounded retry background worker),
  delivery diagnostics, customer inbox
- **Commercial engine:** product catalogue, fee/commission/reward rule machinery with persisted
  commercial-decision snapshots — **V1 pilot policy is fee-free**; flows list fee amounts but the
  pilot snapshot deliberately defaults no charges (VAT is configuration, nothing is hard-coded)
- **Limits:** limit-catalogue (profiles → rules → assignments) enforced at command time; A5 pilot
  admission control with cohort restriction and an emergency-stop kill switch
- **Operations:** reconciliation, trial balance, diagnostics, health/readiness with migration-pin
  verification, capability registry

## Architecture at a glance

- **Double-entry ledger is the only balance truth** — wallet balances are derived from posted
  journal lines; nothing mutates a balance column directly. Corrections use compensating journals.
- **Integer minor units** (kobo) for all monetary values; API amounts are strings (no float rounding).
- **Idempotent commands + outbox** — every money-moving command requires an idempotency key;
  events emit through a transactional outbox.
- **Four independent authentication planes** — customers (OTP login + session + transaction PIN),
  agents (password/session + transaction PIN), workforce (OIDC + MFA → internal session), and
  internal service audience; a bearer token validates in exactly one plane.
- Modular monolith, `/api/v1` global prefix; schema changes only via TypeORM migrations
  (synchronization permanently disabled; 80-migration chain, head `1785753600079`).
- Decisions are recorded in [`docs/decisions/ADR/`](docs/decisions/ADR/) (73 ADRs).

## Develop & run

Prerequisites: Node.js 22+, npm 10+, Docker (local PostgreSQL) or the embedded-PG script.

```bash
npm ci
cp .env.example .env          # fill DB_* values; never commit .env
npm run migration:run
npm run start:dev
```

Quality gates: `npm run lint` · `npm run format:check` · `npm run build` · `npm test`
(financial integration suites run against real PostgreSQL; run ≤5 suites per jest process when
running the full battery).

## Deploy / bootstrap / pilot

- Deployment inputs & production gate: [`docs/deployment/DEPLOYMENT.md`](docs/deployment/DEPLOYMENT.md)
  + [`docs/deployment/PRODUCTION-CHECKLIST.md`](docs/deployment/PRODUCTION-CHECKLIST.md)
- **Workforce bootstrap** (OIDC + MFA + one-time anchor-admin ceremony):
  [`docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`](docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md)
  with [`docs/deployment/config/v1-workforce-bootstrap.env.template`](docs/deployment/config/v1-workforce-bootstrap.env.template)
- **Pilot readiness** (Robase SMS, notification worker, sender identity, OIDC lockdown, pilot limits):
  [`docs/deployment/V1-PILOT-READINESS-CHECKLIST-01.md`](docs/deployment/V1-PILOT-READINESS-CHECKLIST-01.md)
- Operational procedures: [`docs/operations/`](docs/operations/)

## UAT status

Manual UAT per the 191-item catalogue ([`docs/uat/V1-UAT-MASTER-01.md`](docs/uat/V1-UAT-MASTER-01.md)):
**175 PASS / 0 FAIL / 16 BLOCKED / 0 NA — CONDITIONALLY PASSED**
([`docs/uat/V1-UAT-FINAL-01.md`](docs/uat/V1-UAT-FINAL-01.md)). All seven software families
(Customer 40 · Agent 20 · Auth 12 · Security 12 · Financial 55 · Commercial 16 · Admin 12) reconcile
100% pass. One defect (UAT-DEFECT-001, SUPPORT-scoping) was found, fixed (`bae409f`), and verified by
48/48 post-fix retests. The 16 blocked items are environment-only verifications: 5 deployment
configuration checks + 5 real-SIM/physical lane cards + 6 human usability lanes.

## Explicitly out of V1 scope

Per the UAT catalogue §13/§19 exclusion register: push notifications; rewards crediting; external
bank/NIBSS settlement rails and bank integration surface (partner rail inert —
`A6_PARTNER_ENABLED=false`); external commission payout rails; QR/card/PoS/marketplace; multi-currency.
Decision-pending for V2 (explicitly *not* silent V1 defects): aggregator self-service login/portal,
reconciliation-break resolver workflow, reversal UI workflow, settle-later release rail, KYC
hard-gating beyond verified phone, DRAFT cleanup TTL (see
[`docs/V1/V1-SCOPE-CHALLENGE-01.md`](docs/V1/V1-SCOPE-CHALLENGE-01.md)).

## Documentation

**Start here: [`docs/README.md`](docs/README.md)** — the documentation index (scope, architecture,
flows, security, commercial, limits, deployment, bootstrap, pilot readiness, UAT, operations,
ADRs, and the historical archive).

Note: root `roadmap.md` is the **engineering task-governance register** (delivery sequencing rules),
not the product roadmap; platform sequencing lives in
[`docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`](docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md).

## License / contribution

See [`docs/foundation/CONTRIBUTING.md`](docs/foundation/CONTRIBUTING.md) and
[`docs/foundation/CODING_STANDARDS.md`](docs/foundation/CODING_STANDARDS.md).
