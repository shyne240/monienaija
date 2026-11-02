# H-04/H-06 — implementation preservation and verification

**Status: READY for Arena 3 integration; not complete for product acceptance or production.** The Admin Web event-master toggle remains an explicit frontend completion item.

## Git provenance and preservation

- Assigned branch: `arena/92fd33dd-monienaija`.
- Tested implementation commit: `377b1207905909867dbce75cf78717fa5015b90a`; implementation tree `0cfadcf9bd256f4e4e6d1aee7d019c55ce372e12`.
- Its sole parent is the intended baseline, `8fa35c1d46c9afb7dbd6b3fb81049e0f4d18155d`. The implementation was non-force pushed and its remote SHA and parent were independently verified. A later documentation/evidence-only child contains this handover and does not change the tested implementation.
- Before Git reconciliation, the restored local HEAD was `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`. The remote baseline's complete, non-truncated tree was independently compared by blob hash and mode: **33 modified, 6 added, zero missing**, with no additional unrelated worktree differences relative to the baseline. The F-01 historical-delivery test contains a notification-registry reseed that overlaps Arena 2 integration work and must be coordinated.
- Before changing Git state, the complete source worktree and Git objects/index/refs were archived at `/home/user/h04-h06-final-preservation/workspace-before-finalization.tar.gz`, SHA-256 `6805fe235abb8009158da8558760212d84f6df54c56cb53d1030d04a2b6356a5`. GNU tar compared every archive entry with the source and `sha256sum -c` passed. Credential-specific local Git configuration paths were excluded, not feature files.
- A separate index contained only the 39 verified implementation paths; its blob hashes were checked. The stale local HEAD was confirmed as an ancestor of the intended parent. The assigned ref was updated with an expected-old-SHA check and the index was synchronized without changing worktree files. No reset, clean, force push or discarded work was used.

## Functional behavior and limitations

Thirteen financial-event definitions have independent, versioned `EVENT`, `SMS` and `EMAIL` rows. Their event and channel changes use the existing maker-checker, authorization, version and audit controls. The regression suite checks the independent rows, financial lock removal, channel combinations, cross-event isolation, delivery/retry fencing, preferences and idempotency. Other direct SECURITY notifications retain their existing locks.

The four `deposit.completed`, `deposit.failed`, `withdrawal.completed` and `withdrawal.failed` identifiers are existing internal payment-lifecycle events; no new customer-facing payment products, financial accounting or settlement logic were added. Recipients are derived from committed payments and wallets. Newly created payment event and channel controls start disabled. Migration 103 preserves existing choices and template history, audits legacy financial-lock normalization, and refuses an unsafe destructive rollback.

`transfer.unknown` is configured independently of `transfer.failed`; on upgrade its initial channel settings are copied once. The controls are not event producers: no production notification outbox producer was identified for `transfer.unknown`, `cash_to_cash.claimed`, or `cash_to_cash.expired`. Claim/expiry services currently write audit actions. Cash-to-cash creation is phone-only; email is not invented for a phone beneficiary. Customer email requires an eligible customer, verified email, preferences and provider readiness. Previously materialized disabled facts are not replayed automatically, and an already-started provider request cannot be recalled.

## Admin Web completion item

The table displays event-master state and warns when disabled, but the existing form can only submit channel changes. Add an event-master toggle that submits a separate `CONFIGURATION` proposal for `channel: "EVENT"` using the current event version and the existing maker-checker approval/execution workflow; do not change the SMS or email settings as a side effect. Test the UI and approval/version states, and coordinate overlapping F-01/F-05 work with Arena 2. Until then, the Admin Web does **not** fully meet the owner's event-level configuration requirement; the governed API is the available control path.

## Test evidence

All counts below refer to the preserved implementation commit, with synthetic fixtures, fake transports and disposable real PostgreSQL. Focused runs overlap the complete suites and are not additive. Machine-readable per-file summaries and sanitized logs are under [evidence/](evidence/README.md).

| Check | Result | Exit |
| --- | --- | ---: |
| Backend TypeScript and build | Passed | 0 each |
| Full backend unit suite | 231 suites / 2,757 tests passed; 0 failed/skipped | 0 |
| Admin Web TypeScript | Passed | 0 |
| Admin notification management | 1 suite / 19 tests passed; 0 failed/skipped | 0 |
| H-04/H-06 notification, governance and migration | 6 suites / 52 tests passed; 0 failed/skipped | 0 |
| H-07, provider and notification authorization | 6 suites / 81 tests passed; 0 failed/skipped | 0 |
| Customer-preference security, workforce and Agent V1 | 6 suites / 81 tests passed; 0 failed/skipped | 0 |
| Financial, ledger, transfer and settlement | 7 suites / 208 tests passed; 0 failed/skipped | 0 |
| Complete PostgreSQL matrix | 136 suites / 2,482 tests passed; 0 failed/skipped; all 23 batches and all discovered files accounted for | 0 |

The focused backend lint of 24 changed files with no inherited diagnostics passed with **0 errors, 0 warnings**, including the migration and both new integration tests. Full changed-backend-file lint reported **132 errors / 8 warnings**, exit 1; the parent versions had the same per-file/rule/severity count profile. Admin Web has no native lint script; an explicit frontend project overlay of the backend rules reported **112 errors / 0 warnings**, exit 1, identical by count profile to the parent. These profiles do not assert identical diagnostic locations or a clean repository-wide lint result. No unrelated cleanup was performed.

Migration verification includes the real full-chain fresh install and readiness-head checks, plus a real 102-to-103 upgrade covering preserved choices/template history, audited repair of a legacy financial lock, unchanged SECURITY rows, independent controls and the rollback guard. The notification upgrade tests verify 81 configuration rows and 50 templates after the full migration.

## Implementation inventory (39 files)

```text
apps/admin-web/__tests__/notification-management.test.tsx
apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx
apps/admin-web/src/services/notification-domain.ts
apps/admin-web/src/services/notification-management-api.ts
docs/integration/h04-h06-transaction-notification-controls.md
src/migrations/1785753600103-ConfigureTransactionNotificationEvents.ts
src/notification/notification-defaults-v2.ts
src/notification/notification-delivery-processor.ts
src/notification/notification-dispatcher.service.ts
src/notification/notification-event-map.ts
src/notification/notification-inbox.service.ts
src/notification/notification-registry.service.ts
src/notification/notification-security.constants.ts
src/notification/notification-template.service.ts
src/notification/notification.types.ts
src/production/production-readiness.service.ts
test/a19-agent-funding.integration.spec.ts
test/a20-outlets-terminals.integration.spec.ts
test/a8-agent-lifecycle.integration.spec.ts
test/h04-h06-cash-to-cash-channels.integration.spec.ts
test/h04-h06-event-map.spec.ts
test/h04-h06-notification-upgrade.integration.spec.ts
test/migration-chain.integration.spec.ts
test/mission-25o-credential-binding-upgrade.integration.spec.ts
test/notification-migration-upgrade-01.integration.spec.ts
test/notification-registry.integration.spec.ts
test/notification-reliability.integration.spec.ts
test/notification-template-engine.spec.ts
test/sms-v1-01.integration.spec.ts
test/support/pg-harness.ts
test/transfer-notification-producer-01.integration.spec.ts
test/v1-003-admin-operational-writes.integration.spec.ts
test/v1-005-notification-delivery.integration.spec.ts
test/v1-006-customer-notification-inbox.integration.spec.ts
test/v1-007-support-ticket.integration.spec.ts
test/v1-email-notification-01.integration.spec.ts
test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts
test/v1-limit-02-limit-assignment.integration.spec.ts
test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts
```

## Production-only prerequisites and restrictions

A separately authorized rollout must address independent versioned HMAC key custody/propagation, migration 103, complete worker/fleet and rollback-image compatibility, stop/drain and outbound egress fencing, and provider reapproval/activation. Old senders cannot enforce the event master. The accepted H-07 binding, revoked/missing-key fail-closed behavior, maker-checker and preference authorization remain in force.

No production deployment, production key provisioning, production DB operation, live provider activation, real vendor call, live SMS/email or merge into `main` was performed. This handover grants no authorization for those actions.
