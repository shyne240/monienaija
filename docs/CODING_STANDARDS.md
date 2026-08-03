# Coding Standards

## Principles
Write software that is readable, deterministic, secure, observable, and easy to safely change. Prefer boring, well-supported tools. Follow the conventions chosen in approved ADRs and domain-specific standards; this document is language-agnostic until a technology stack is selected.

## Required practices
- Use clear, domain-oriented names; distinguish amounts, currencies, identifiers, timestamps, states, commands, and events.
- Keep functions and modules cohesive. Make side effects, transactions, retries, time, randomness, and external I/O explicit and injectable where practical.
- Validate input at trust boundaries; enforce authorization in the domain, not only in UI or gateways.
- Model money with the approved representation (ADR-0002); never use binary floating point for money.
- Use UTC, unambiguous ISO-8601 timestamps, and explicit time zones for customer presentation.
- Require idempotency keys and correlation IDs for externally retried operations.
- Return safe, stable error contracts; never leak stack traces, credentials, personal data, or internal topology.
- Use structured logs and approved telemetry. Do not log secrets, authentication material, full PAN/CVV, PIN, OTP, or unnecessary PII.
- Pin and review dependencies; do not add a dependency for trivial functionality without justification.
- Keep configuration externalized, typed/validated where supported, and separate by environment. Secrets come only from approved secret management.

## Code quality
Formatters, linters, static analysis, dependency and secret scanning, tests, and build checks must run in CI. Warnings affecting correctness, security, or maintainability are treated as failures unless explicitly waived with an expiry and owner. Comments explain intent, constraints, or non-obvious trade-offs—not what self-evident code says.

## Financial changes
Any change touching financial state, payment lifecycle, limits, fees, settlement, reconciliation, or reporting requires named domain review, invariant tests, replay/idempotency analysis, migration/rollback plan, audit impact assessment, and operational runbook updates.

## Documentation standards
Docs live with the decision and are updated in the same change. Use descriptive Markdown headings, concise prose, stable relative links, dates in ISO-8601, and inclusive Nigerian-English terminology where appropriate. Document assumptions, owners, inputs/outputs, failure modes, privacy classification, and operational consequences. Avoid vendor-specific claims unless verified and dated.

## Definition of Done
A change is done only when: requirements and acceptance criteria are met; design and ADR implications are addressed; tests and quality gates pass; security/privacy review is completed proportionate to risk; observability, alerts, dashboards, support and rollback needs are covered; documentation is current; approvals are recorded; and deployment/recovery are safe. For money movement, successful independent reconciliation and control evidence are additionally required.
