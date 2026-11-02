# Mission 25O — H-07 implementation handover

**Status: NOT YET DETERMINED — regression run in progress.** This is an Arena 1 handover for Arena 3 integration review, not approval to deploy, provision production keys, activate providers or send live notifications.

## Provenance and scope

- Assigned branch: `arena/92fd33dd-monienaija`. Exact authorized application candidate and intended parent: `587c3763944368b9260c9299d18bce1189ca5919`. The final pushed SHA and its parent must be verified at handoff (`git rev-parse HEAD`, `git rev-parse HEAD^`, and `git ls-remote`); a commit cannot contain its own resulting hash.
- Before edits, a read-only review independently examined the credential lifecycle and the Mission 25G design, archived 25F assessment (SHA-256 `86f3e0bc17fc226ee2d669f6942ab529a25feac322bf1b257c6ed38980992ed1`), 25H and 25K evidence. See [Phase A audit](PHASE-A-CREDENTIAL-LIFECYCLE-AUDIT.md).
- The full Mission 25N report was not located and was **not reviewed**. The owner authorized proceeding on the supplied 25N conclusions: assessed security/integration scope passed, preference/frontend corrections were resolved, and H-07 remained high severity with external activation prohibited.
- Mission 25O changes no H-04 recipient/channel mappings, H-06 event-lock policy, preference authorization, workforce roles, financial logic, Ordinary Agent authorization or unrelated frontend. Arena 2 owns F-01/F-05; Arena 3 must integrate overlapping work without replacing it. No integration branch or `main` was modified.

## Root cause and remediation

At the candidate, a `USE_ENV_SECRET` proposal and readiness carried only a four-character suffix. Approval and activation did not verify the exact environment value; runtime resolved it again without comparing it to an approved identity. A different secret with the same suffix could be substituted without a new approval. `KEEP_EXISTING` could also transfer a credential source across provider changes, and readiness preservation used the non-unique hint. Verification/test-send results were not fenced to the configuration version that was tested.

The new independent, versioned HMAC-SHA-256 keyring binds the entire validated effective secret to its channel, provider and source using domain-separated, length-prefixed inputs and constant-time MAC comparison. It has no built-in production key or unkeyed low-entropy secret digest. Literal reuse of a configured AES encryption key is rejected; independent generation, custody and dissemination remain operational controls. The v2 action fingerprint reconstructs all governed proposal settings, maker, reason, expected version, keyed commitment and encrypted-envelope digest. The checker locks and compares the independent approval record and verifies the current resolved credential in the same transaction as approval; activation repeats both checks before consuming the scoped, expiring approval. Channel locks and versions fence concurrent first activation. Every real send/verification checks the selected active credential and passes the same checked in-memory value to the adapter. Readiness and test-send writes are version-fenced.

Missing, malformed, revoked, mismatching or legacy-unbound credentials cannot authorize external delivery; there is no alternate-source fallback. `KEEP_EXISTING` requires the same provider and a valid existing binding. Rotation requires a fresh proposal and independent checker approval. A governed disabled/`CLEAR` proposal can still fail closed without an available key. Maker/checker separation, role/function gates, MFA and approval TTL/consumption remain in force. The existing AES-GCM encrypted-DB workflow and its encrypted proposal/configuration rows are explicitly excepted by the mission owner; no plaintext provider secret or extra reversible copy is introduced by the binding design. Display hints remain non-security indicators.

## Complete implementation inventory

- `.env.example`, `src/config/environment.ts`: optional independent keyring settings and safe defaults.
- `src/notification/notification-credential-binding.service.ts`: versioned HMAC creation/verification and AES-key-reuse check.
- `src/migrations/1785753600102-AddNotificationCredentialBinding.ts`: additive nullable metadata and guarded rollback; migration 100 unchanged.
- `src/notification/notification-provider-config.service.ts`: v2 proposals, independent approval linkage, credential/source checks at checker/activation/runtime, governance locks, readiness identity and verification/test outcome fences.
- `src/authorization/privileged-action-approval.service.ts`: transaction-aware approval entry point that preserves the existing decision policy.
- `src/admin/admin-notification-provider.controller.ts`, `src/notification/notification.types.ts`: internal configuration-version fence for test sends; existing normalizing wrapper forwards it.
- `src/common/sensitive-data-redaction.ts`, `src/notification/provider-security.ts`: internal binding metadata redaction and safe diagnostic-code handling.
- `src/production/production-readiness.service.ts`: required migration-head marker advanced to 102.
- `test/mission-25o-credential-binding.spec.ts`, `test/mission-25o-credential-binding.integration.spec.ts`, `test/mission-25o-credential-binding-upgrade.integration.spec.ts`: new synthetic cryptographic, real-PostgreSQL governance/race/queue, and 101-to-102 upgrade evidence.
- `test/mission-25c-provider-routing.spec.ts`, `test/notification-provider-config.unit.spec.ts`, `test/v1-notification-provider-configuration-01.integration.spec.ts`: synthetic binding fixtures for existing provider tests.
- `test/notification-migration-upgrade-01.integration.spec.ts`, `test/v1-limit-02-limit-assignment.integration.spec.ts`, `test/v1-007-support-ticket.integration.spec.ts`, `test/v1-003-admin-operational-writes.integration.spec.ts`, `test/a8-agent-lifecycle.integration.spec.ts`, `test/a20-outlets-terminals.integration.spec.ts`, `test/a19-agent-funding.integration.spec.ts`: explicit expected migration-head lists/chain updated additively; financial implementation was not altered.
- `docs/integration/mission-25o/PHASE-A-CREDENTIAL-LIFECYCLE-AUDIT.md`, `ROLLOUT-AND-COMPATIBILITY.md`, `HANDOVER.md`, and `evidence/test-summary.json`: audit, release fence, handover and sanitized results.

## Compatibility, rollout and limitations

Migration 102 leaves legacy metadata null and preserves active rows, historical proposals, approvals and audit evidence. Legacy external configurations/proposals fail closed until separately reapproved. API shape and the masked suffix remain compatible, with a safe new integrity error. An old binary ignores the new fields; **mixed old/new senders and unguarded rollback are unsafe**. Migration `down` refuses while governance rows exist. The required quarantine/drain, fleet-version/key propagation, reapproval, revocation and rollback fencing are in [the rollout guide](ROLLOUT-AND-COMPATIBILITY.md).

An environment variable cannot report upstream vendor revocation or prove a change-and-revert that occurred between observations. A request already past its local pre-send check may finish while a disable or key retirement propagates. Existing authorized verification of a disabled but bound Brevo configuration can make read-only account/sender HTTP calls; it does not enable delivery. To guarantee no further outbound traffic, operations must use `CLEAR`, stop/drain every sender and enforce an egress fence. Tests use synthetic credentials, fake transport and isolated local PostgreSQL; they are not evidence of real vendor delivery or production key custody.

## Test evidence

Final results and exit codes: pending full PostgreSQL and final post-review reruns. See `evidence/test-summary.json` when generated. Historical/intermediate failures and interrupted runs will be identified separately; they must not be counted as passing evidence.
