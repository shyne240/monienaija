# M7 Scale and Resilience Manual Verification

This guide verifies database-backed resilience primitives in a disposable local environment. It does not require Redis, Kafka, RabbitMQ, external integrations, or background workers.

## 1. Install and migrate

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run migration:run
npm run start:dev
```

M7 configuration defaults:

```text
APP_VERSION=0.1.0
IDEMPOTENCY_RETENTION_SECONDS=86400
OUTBOX_RETRY_DELAY_SECONDS=60
```

Invalid duration values must fail startup:

```bash
IDEMPOTENCY_RETENTION_SECONDS=30 npm run start
OUTBOX_RETRY_DELAY_SECONDS=0 npm run start
```

## 2. Health and diagnostics

Liveness remains process-only:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/health | jq .
```

Readiness includes database, migration, reconciliation, and outbox diagnostics when the full application module is running:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/health/ready | jq .

curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/diagnostics | jq .
```

Verify the diagnostics response includes:

- Application version
- Database status
- Applied migration count
- Reconciliation status
- Pending/failed outbox count
- Overall `ok` or `degraded` status

## 3. Metrics

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/metrics | jq .
```

Run the existing M3/M5 transfer and payment flows, then query metrics again. Counters should be present for applicable operations, including journals, transfers, deposits, withdrawals, failures, retries, idempotency hits, and reconciliation duration.

Metrics persistence failure must not make a financial transaction fail.

## 4. Audit trail

After a successful transfer, deposit, or withdrawal completion:

```bash
curl --fail-with-body -sS \
  'http://localhost:3000/api/v1/internal/audit?limit=100' | jq .
```

Verify events contain:

- Entity and entity ID
- Action
- Actor
- Correlation ID
- Request ID when available
- Previous/new values where supplied
- UTC timestamp

In a disposable database, direct `UPDATE` or `DELETE` attempts against `audit_events` must fail because audit events are immutable.

## 5. Outbox

```bash
curl --fail-with-body -sS \
  'http://localhost:3000/api/v1/internal/outbox?limit=100' | jq .
```

Successful transfer, deposit, and withdrawal completions should create `PENDING` outbox facts in the same transaction as the domain record and journal.

M7 does not publish externally. The service supports `PENDING`, `PUBLISHED`, and `FAILED` states, attempt counts, retry availability, and immutable event payloads.

Use the automated resilience tests to exercise failed-to-pending recovery and publication state transitions.

## 6. Distributed idempotency

Run:

```bash
npm test -- --runInBand test/m7.operational-resilience.spec.ts
```

Verify the test covers:

- First reservation returning `NEW`.
- Identical payload replay returning `REPLAY`.
- Changed payload hash rejection.
- Concurrent/in-progress duplicate rejection.
- Expiration and cleanup.

No worker is started by M7; cleanup is an explicitly callable operational service.

## 7. Concurrency and recovery tests

```bash
npm run build
npm run lint
npm run format:check
npm test -- --runInBand
```

The suite covers:

- Concurrent transfer attempts against one wallet.
- Concurrent payment service paths.
- Serializable transaction use.
- Simulated interrupted journal creation.
- Transaction rollback after partial mutation.
- Client timeout after commit followed by idempotent retry.
- Outbox retry recovery.
- Randomized financial invariants.

## 8. Process restart simulation

In a disposable local environment:

1. Submit a transfer, deposit, withdrawal, or other idempotent command.
2. Stop the API process immediately after submission.
3. Start the API again.
4. Retry the exact same request with the same idempotency key.
5. Verify that the durable result is replayed and no second journal exists.
6. Run reconciliation and inspect metrics, audit, and outbox records.

Do not perform this drill against production or real customer funds.

## 9. Acceptance checklist

M7 verification passes when:

- Liveness is process-only.
- Readiness and diagnostics expose dependency state.
- Idempotency records detect replay and changed payloads.
- Audit events cannot be edited or deleted.
- Outbox facts are durable and payloads are immutable.
- Metrics are available without blocking financial writes.
- Serialization/deadlock retries are bounded.
- Concurrent money movement does not duplicate or lose value.
- Existing reconciliation remains healthy.
