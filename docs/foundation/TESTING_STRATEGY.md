# Testing Strategy

## Testing philosophy
Testing establishes evidence, not confidence by assertion. Financial correctness and customer safety require layered automated tests, independent controls, production-like exercises, and operational verification. Test failure and recovery paths as deliberately as success paths.

## Test layers
- **Unit:** pure domain rules, validation, authorization decisions, calculations, state transitions and edge cases.
- **Property/invariant:** generated scenarios proving balanced journals, conservation rules, idempotency, compensating entries, limits, and replay safety.
- **Component:** persistence, queues/outbox, adapters, serialization, migrations and error mapping in isolated real dependencies where feasible.
- **Contract:** versioned API/event compatibility with channels and partners; provider simulators never replace certification.
- **Integration/end-to-end:** realistic transaction lifecycles across domains, including duplicate submissions, delays, timeouts, callbacks, reversals and partial outages.
- **Security:** SAST, dependency/SBOM and secret scans, authorization tests, threat-model-driven abuse tests, DAST and independent penetration tests before material launch.
- **Performance/resilience:** capacity, soak, concurrency, rate-limit, chaos, failover, backup/restore and disaster-recovery exercises.
- **Operational:** reconciliation, reporting, alert routing, incident runbooks, access reviews, deployment and rollback drills.

## Financial test requirements
Use fixed fixtures and an independent reconciliation oracle where possible. Assert that every completed scenario produces balanced, immutable, traceable entries and expected customer communication. Test at-least-once delivery, reordering, duplicate callbacks, retries, expired requests, provider ambiguity, and manual operational intervention. Never use real customer data or credentials in non-production tests.

## Environments and data
Environment promotion must be controlled and traceable. Production-like environments use synthetic or irreversibly masked data; access is least-privilege and audited. Test data has an owner, classification, retention limit, and deletion process. Production testing is limited to approved, reversible, monitored techniques and never compromises customer funds or data.

## Release gates and defects
Critical-path tests run on every relevant change; slower suites run before promotion and on a schedule. Severity-one defects, ledger invariant violations, unresolved reconciliation breaks, exploitable security findings, or failed recovery objectives block release. Flaky tests are defects: quarantine only with an owner, ticket, expiry, and plan to restore coverage.
