# Mission 25O — H-07 implementation handover

**Status: READY for Arena 3 integration review; NOT production-ready.** This is an Arena 1 handover, not approval to deploy, provision production keys, activate providers or send live notifications.

## Preservation, provenance and scope

- Assigned branch: `arena/92fd33dd-monienaija`. The implementation was preserved as commit `3a0f87eafe86b455e1906d7779f83ca3152b9d00` (tree `9f048856dd72617a17e013a893e03ffc9a6462b1`), whose **sole parent** is the exact authorized 25K candidate `587c3763944368b9260c9299d18bce1189ca5919`. The implementation commit was non-force pushed to the assigned branch.
- The restored checkout had stale Git metadata; an independent byte comparison with the complete, non-truncated 25K tree reproduced exactly 19 modified and 8 added files, with zero missing files and no unrelated nonignored differences. A temporary index captured only those 27 files and their blobs were checked against the working files. No working files were reset, cleaned, discarded or blindly staged.
- The 27-file external backup is `/home/user/m25o-preservation-vR0AmWPr/mission25o-worktree.tar`, SHA-256 `90626889190fbc4565b84787f779273017b96a22382a6317b99fa392b89498af`; all members were extracted and verified against `SHA256SUMS`. The same external directory preserves the prior index/status, manifest and independent comparison. This local backup is supplementary and is not a production database or key backup.
- Final test evidence and this handover are recorded in a subsequent documentation/evidence-only child of `3a0f87e…`, so that the implementation tested is identifiable without a self-referential commit hash. The final branch tip, remote tip and both parent relationships must be verified and supplied in the direct handoff.
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
- `docs/integration/mission-25o/PHASE-A-CREDENTIAL-LIFECYCLE-AUDIT.md`, `ROLLOUT-AND-COMPATIBILITY.md`, `HANDOVER.md`: audit, release fence and handover (the latter is updated in the documentation/evidence-only child).

The documentation/evidence-only child separately adds [`evidence/`](evidence/README.md), including `test-summary.json` and the sanitized per-run logs and summaries; it does not change the 27-file implementation.

## Compatibility, rollout and limitations

Migration 102 leaves legacy metadata null and preserves active rows, historical proposals, approvals and audit evidence. Legacy external configurations/proposals fail closed until separately reapproved. API shape and the masked suffix remain compatible, with a safe new integrity error. An old binary ignores the new fields; **mixed old/new senders and unguarded rollback are unsafe**. Migration `down` refuses while governance rows exist. The required quarantine/drain, fleet-version/key propagation, reapproval, revocation and rollback fencing are in [the rollout guide](ROLLOUT-AND-COMPATIBILITY.md).

An environment variable cannot report upstream vendor revocation or prove a change-and-revert that occurred between observations. A request already past its local pre-send check may finish while a disable or key retirement propagates. Existing authorized verification of a disabled but bound Brevo configuration can make read-only account/sender HTTP calls; it does not enable delivery. To guarantee no further outbound traffic, operations must use `CLEAR`, stop/drain every sender and enforce an egress fence. Tests use synthetic credentials, fake transport and isolated local PostgreSQL; they are not evidence of real vendor delivery or production key custody.

No unresolved implementation defect was found in the verified scope; the pre-existing lint diagnostics and operational limits above remain. Production requires separately authorized security/infrastructure custody and propagation of independent HMAC keys, coordinated migration 102, a complete fleet/worker and rollback-image upgrade, egress fencing, and fresh independent approvals before any provider reactivation. No deployment, production key provisioning, vendor activation, live send, unauthorized policy change or merge to `main` was performed.

## Test evidence

The original Mission 25O raw logs did not survive workspace restoration. Previously reported runs are historical observations, not the final evidence below; in particular, the earlier full PostgreSQL matrix preceded the last TTL/cancellation test. A new complete matrix, TypeScript, build, full unit suite and focused regressions were executed against implementation commit `3a0f87e…`; their sanitized logs and machine-readable summaries are under [`evidence/`](evidence/README.md). A bad-config unit preflight ran no suites, and a PostgreSQL preflight was intentionally interrupted to complete its synthetic fixture; neither is counted as passing evidence.

| New verification against `3a0f87e…` | Result | Exit |
| --- | --- | ---: |
| `npx tsc --noEmit -p tsconfig.json` | PASS | 0 |
| `npm run build` | PASS | 0 |
| Complete backend unit suite | 230 suites, 2,728 tests passed; 0 failed/skipped | 0 |
| Complete PostgreSQL integration matrix | 134 suites, 2,475 tests passed; 0 failed/skipped; all 134 discovered files accounted for in 23 resource-safe batches | 0 |
| Focused H-07, maker/checker, provider, readiness/race and upgrade regressions | 5 suites, 42 tests passed; 0 failed/skipped | 0 |
| Focused preference security, workforce/revocation, Ordinary Agent V1, financial and notification-reliability regressions | 12 suites, 182 tests passed; 0 failed/skipped | 0 |

The focused provider group includes H-07 binding/rotation/race **21/21**, provider governance and maker/checker **14/14**, migration 102 upgrade **2/2**, historical notification upgrade **2/2**, and migration-head readiness **3/3**. The HMAC unit suite separately accounts for **15/15** within the full unit run. The 182-test group includes customer-preference authorization **19/19**, Mission 19A workforce logout **8/8**, workforce sessions **18/18**, Ordinary Agent session/read/PIN coverage **36/36**, financial execution/cash-to-cash/ledger/settlement coverage **84/84**, and notification reliability **17/17**. These focused tests are reruns of suites already included in the full matrix, not additional unique coverage to be added to its total.

Focused ESLint on the other **19 changed TypeScript files passed** (exit 0). Changed-file ESLint including all modified legacy tests found **37 errors and 3 warnings** in four of them (exit 1); an isolated export of their 25K versions had the same per-file, rule and severity counts (also exit 1). All newly added TypeScript files had zero lint diagnostics. This is a count-profile comparison, not a claim that every diagnostic has identical text/line identity or that repository-wide lint is clean; see [`eslint-comparison.txt`](evidence/eslint-comparison.txt).

The PostgreSQL run used a disposable loopback-only cluster, a Node test network guard, synthetic credentials and fake provider transports. No non-template test databases remained after the matrix and focused runs. These tests do not establish live delivery, production key custody or permission to deploy. See the evidence README for commands, collection policy and preflight history.
