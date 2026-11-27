# PR #45 Tier 1 acceptance review — final report

## Final answer

**Use PR #45 as the single successor to PR #38. Do not merge #38 first.** Retarget/rebase #45 (or create one integration PR carrying its reconciled tree) onto the current integration tip `cca65c164f33a1989316b691165608c69ea51bd1`, resolve the ten known migration/readiness conflicts to the 175-migration chain, rerun CI on that new head, and then merge it once. Close #38 as superseded because its head `e46aeffbdfb77fba76077aaa9a230d4e8fe65763` is already #45's parent. Keep #39 unmerged for now: its head is not an ancestor and conflicts with the combined branch, but the Core Customer App claim changes it introduced are already ancestors of #45. Rebase #39's remaining unique history/Finance work separately after #45 if that work is still wanted.

This is a **conditional merge recommendation, not a merge action**: all PRs remain open drafts; no PR was merged, closed, or pushed. The exact locally tested combined revision is **not** the PR head that GitHub CI checked, so CI must rerun after the retarget/rebase.

## Exact tested revision

- Combined/reconciled revision: `0786f2e9c7e0959d3217ab38af9e23aad6d7cff5`
- Tree: `288ae32ead1646d7a438d44a4eeec3df25f4fa04`
- Parents: `cca65c164f33a1989316b691165608c69ea51bd1` (current integration tip, Merge PR #43) and `d206fec4d24ffbe5315f45e1191d15b32fae7d9c` (PR #45 head)
- Earlier local candidates `9bc21f4f1a2cfd915a188150134febd67d856d19` and `bff021109bbdac5dd1040f5276612b7d16753789` are superseded. The older `bff02110` report's no-merge recommendation is historical and does not answer #45.
- The revision includes integration PRs #46 and #43, PR #38 via #45's parent, and PR #45. PR #39 head `6cb2507a66e1ce99a3068a489a9cb7f4a3a735ba` is not an ancestor.
- Migration chain reconciled to 175 identities, head `1785753600813`, preceding `1785753600807`, `1785753600810`, `1785753600811`, `1785753600812` in timestamp order. `customer_tier_default_classes` has no `id` column; `production-readiness.service.ts` expects head `0813`.

Raw merge of the current integration tip with #45 has ten conflicts:

- `src/production/production-readiness.service.ts`
- `test/migration-inventory.spec.ts`
- `test/migration-chain.integration.spec.ts`
- `test/migration-0804-owner-authority.integration.spec.ts`
- `test/arena5-consolidation-migration-upgrade.integration.spec.ts`
- `test/stage8-financial-engine-migration.integration.spec.ts`
- `test/stage10-recovery-migration.integration.spec.ts`
- `test/a8-agent-lifecycle.integration.spec.ts`
- `test/a19-agent-funding.integration.spec.ts`
- `test/a20-outlets-terminals.integration.spec.ts`

They were reconciled to the 175-identity combined chain, not left as `--ours` pins. No conflict markers or residual 172-migration pins remain in those edited files.

## GitHub state and merge order

Current GitHub state at review time:

| PR | State | Head | Base | REST mergeability |
| --- | --- | --- | --- | --- |
| #38 | OPEN draft | `e46aeffbdfb77fba76077aaa9a230d4e8fe65763` | `arena/5-main-web-integration` | `mergeable=false`, `mergeable_state=dirty` |
| #39 | OPEN draft | `6cb2507a66e1ce99a3068a489a9cb7f4a3a735ba` | `arena/5-main-web-integration` | `mergeable=false`, `mergeable_state=dirty` |
| #45 | OPEN draft | `d206fec4d24ffbe5315f45e1191d15b32fae7d9c` | `arena/0f3ce003-monienaija` (#38 branch) | `mergeable=true`, `mergeable_state=clean` |
| #46 | MERGED | `fd6e4d0e497622b10aee1abe0d9619ed6d91871a` | `arena/5-main-web-integration` | n/a |

GitHub's `clean` state for #45 means clean **against #38's branch**, not against the current integration tip. Raw `git merge-tree` of `cca65c16` with #38, #39, or #45 each produces the same ten conflict files, caused by the newer integration branch's 175-migration readiness chain.

### Why #45 first

1. #45 is a one-commit follow-up whose parent is #38's head. Merging it carries #38's full tree and #45's governance hardening in one branch.
2. #38 alone is dirty against `cca65c16`. Merging it first would require the same reconciled 175-migration work and then leave #45 to be rebased on top; that is duplicate integration work and risks two divergent migration-pin resolutions.
3. The Core Customer App claim work `2547e291` and `fd2ec83b` are ancestors of #45. `git diff d206fec4 6cb2507a -- apps/customer-mobile` is empty, so #39's mobile claim proposition is not a missing prerequisite for the #45 journey.
4. #39's head also contains non-ancestral transaction-history/Finance commits and raw-merges with the #45 combined branch into `ComplianceScreen.tsx`, `customer.service.ts`, `customer.module.ts`, and KYC tier wiring. Do not blindly merge it. Rebase those unique commits separately after #45 if still required.

If strict PR-boundary preservation is required, first merge #45 into the #38 branch (that merge is clean), then retarget/merge that combined branch once into integration after the ten conflict reconciliations and a fresh CI run. Do **not** separately merge #38 into integration first.

## Local verification at `0786f2e9...`

| Area | Command / harness | Result |
| --- | --- | --- |
| Backend build | `npm run build` | PASS |
| Admin Web production bundle | `ADMIN_WEB_API_BASE_URL=/api/v1 npm --prefix apps/admin-web run build -- --outDir /tmp/tier1-admin-dist-45 --emptyOutDir` | PASS; bundle contains one `/api/v1` base URL. Without this environment variable the production bundle fails closed with `Admin API base URL is not configured`. |
| Customer Mobile types | `npm --prefix apps/customer-mobile run ts:check` | PASS |
| Unit suites | `npx jest --runInBand --config jest.config.js test/migration-inventory.spec.ts test/authorization.service.spec.ts test/customer-class-route-policy.spec.ts test/governed-action.registry.spec.ts test/commercial-decision-snapshot.service.spec.ts` | PASS 5 suites / 46 tests |
| Real-PG migration-pin suites | `npx jest --runInBand --config jest.integration.config.js --runTestsByPath test/migration-chain.integration.spec.ts test/migration-0804-owner-authority.integration.spec.ts test/arena5-consolidation-migration-upgrade.integration.spec.ts test/stage8-financial-engine-migration.integration.spec.ts test/stage10-recovery-migration.integration.spec.ts test/a8-agent-lifecycle.integration.spec.ts test/a19-agent-funding.integration.spec.ts test/a20-outlets-terminals.integration.spec.ts` | PASS 8 suites / 128 tests |
| Real-PG governance + claim suites | `npx jest --runInBand --config jest.integration.config.js --runTestsByPath test/customer-tier-default-approval.integration.spec.ts test/v1-staff-account-claim-journey.integration.spec.ts` | PASS 2 suites / 10 tests |

`test-summary.json` records the structured local verification. The generated tracked file `docs/transaction-history/evidence/platform-agent-funding-scope.json` was restored after real-PG suites; the working tree has no tracked modifications from those runs.

## Disposable PostgreSQL evidence

All database artifacts below were regenerated at `0786f2e9...` with `ARENA2_EVIDENCE_DIR=/home/user/monienaija/docs/integration/evidence/arena2-review-45`. The upgrade DB was recreated from `mn_old0810` only after stopping any connected server.

- `db/prepare.json` — **PASS**. `mn_upgrade45` started as a clone of `mn_old0810`: 172 migrations, original `0810/0811/0812` rows, no `0806/0807/0813`, no `customer_tier_default_classes.id`, three `PENDING_APPROVAL` tier rows. Forward `migration:run` applied exactly three migrations: `0806`, `0807`, `0813`. `mn_fresh45` applied all 175 migrations. Both DBs then had 175 migrations, 11 local-admin credentials, 11 active seeded roles, and no `id` column.
- `db/upgrade-path.json` — **PASS**, 6 steps / 9 calls. Original-`0810` upgrade DB retained its schema-free state; single-role SUPER_ADMIN maker and independent CUSTOMER_SERVICE checker were distinct and MFA; OPERATIONS proposal denied 403; maker proposal 201 `approvalId=829fcc85-4fde-4c19-b457-94b306d1f7af`; self-approval denied `SELF_APPROVAL_FORBIDDEN`; independent checker approved and executed; LEVEL_1 became APPROVED version 2 with checker attribution and deterministic UUID audit entity `7394d412-36a4-5faf-9162-cbdf1979f584`.
- Harness correction: after governed execution the approval is normally `CONSUMED` with `consumed_at` set, not `APPROVED`. `scripts/arena2-review/upgrade-path.cjs` now accepts `APPROVED` or `CONSUMED` after execution and still verifies independent `approved_by`. The earlier FAIL evidence was a harness assertion defect, not an application failure.
- `db/workforce-accounts-mn_upgrade45.json` — **PASS**, 11/11 accounts/calls.
- `db/workforce-accounts-mn_fresh45.json` — **PASS**, 11/11 accounts/calls. The 11 seeded workforce accounts and passwords were preserved and proved through the normal login endpoint; raw request bodies are kept only in local evidence artifacts.

## HTTP and governed-configuration evidence

- `http/governed-config.json` — **PASS**, 6 steps / 38 calls. Governed KYC Tier 1 policy, CONFIGURED `WALLET_TRANSFER`, STANDARD zero-fee NGN rule, `ARENA2_TIER1_LIMITS` profile and STANDARD assignment, and five activation limit dimensions were all present through governed maker/checker APIs; no direct row seeding was used.
- `http/http-acceptance.json` — **PASS**, 7 steps / 25 calls. Six distinct workforce sessions; unrelated KYC provider routing and A2 finance role-assignment gates remained enforced; OPERATIONS tier-default proposal denied 403; SUPER_ADMIN proposal 201 `approvalId=3421121d-edc9-43e6-bd2a-2fefd99d5738`; self-approval, unapproved execution, and wrong-role checker denied; independent CUSTOMER_SERVICE checker approved; governed execute applied APPROVED STANDARD LEVEL_1 default.

## Browser, mobile-service, HTTP, and handset evidence — reported separately

### Browser (real Admin Web UI, headless Chromium)

- `browser/journey-result.json` and `browser/journey-partial.json`; 11 screenshots under `browser/screens/`.
- **PASS for its scoped phase**: 14 steps, 58 captured API calls, 0 console errors. The harness prints `JOURNEY_PARTIAL_OK` because staff onboarding/activation is a phase that intentionally leaves the customer unclaimed; it is not a failure.
- Same synthetic Tier 1 customer: `8c92f02c-4a58-4ccc-bf05-c476c8f52ed0`, BVN `22998877664`, phone `+2348099110004`.
- Real SUPER_ADMIN and COMPLIANCE workforce logins through the Admin Web form; registration wizard, phone OTP through the test-only RecordingSmsProvider, BVN identity document, consent notice, governed `verify-identity` with `customerConsentConfirmed=true`, linked consent/attempt/claim, LEVEL_1 approval, tier-default STANDARD class re-assignment, verified-unclaimed state, and governed ACTIVE transition via the browser's real SUPER_ADMIN token. No SQL inserted the customer, consent, verified claim, or wallet.
- Test-only SMS seam: `JOURNEY_RECORD_SMS` / `/tmp/journey-sms-45.log` exposes only the delivered OTP boundary, as a handset would receive it. The server still stores a salted OTP hash.

### Mobile services and HTTP (real customer-mobile service code)

- `device/device-acceptance.json` — **PASS**, 6 steps / 16 calls, bound to the **same** browser-created customer `8c92f02c-4a58-4ccc-bf05-c476c8f52ed0`.
- Real customer-mobile `ApiClient`, onboarding-state projection, claim-match, interruption/resume, distinct passcode/PIN enforcement, customer-api login, activation view, and activation writes were exercised against the live Nest API.
- First activation returned wallet `9b6a8fa2-0f85-4687-9d47-42698b7630e4`, provisioning wallet `cfbda697-04a5-47cc-b461-38ef0b63fc12`, currency NGN. Same-key replay returned `replayed=true` with identical IDs; different-key retry converged. `/customers/me/wallets` and direct row counts show exactly one ACTIVE NGN wallet.
- This is **mobile-service and HTTP evidence**, not a rendered device UI run. Mobile services require `Module._load` stubs for `react-native`/`expo-secure-store`; Android SecureStorage returns null and web persists token.

### Physical handset / emulator

- **Not run.** No physical handset or emulator UI evidence exists. Report the headless Admin Web browser, mobile-service/HTTP harness, and handset/emulator coverage as three separate channels; do not present the mobile-service run as handset UI proof.

## CI link summary

The following GitHub Actions checks are all **pass** for their original PR heads. They do **not** attest the locally reconciled merge SHA `0786f2e9...`; rerun CI after retargeting/rebasing #45 to the integration tip.

### PR #45 — all eight checks pass

- Classify: https://github.com/shyne240/monienaija/actions/runs/45905118383/job/140199922123
- Backend lint/format/build/unit: https://github.com/shyne240/monienaija/actions/runs/45905118383/job/140199986296
- Admin Web types/tests/build: https://github.com/shyne240/monienaija/actions/runs/45905118383/job/140199986265
- Agent Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45905118383/job/140199986222
- Customer Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45905118383/job/140199986270
- Backend real PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45905101535/job/140201605230
- Backend isolated PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45905101535/job/140201605148
- Backend container image: https://github.com/shyne240/monienaija/actions/runs/45905101535/job/140201605183

### PR #38 — all eight checks pass

- Classify: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140178110407
- Backend lint/format/build/unit: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140178177139
- Admin Web types/tests/build: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140178177103
- Agent Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140178177118
- Customer Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140178177167
- Backend real PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140179133276
- Backend isolated PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140179133275
- Backend container image: https://github.com/shyne240/monienaija/actions/runs/45898427129/job/140179133311

### PR #39 — all eight checks pass

- Classify: https://github.com/shyne240/monienaija/actions/runs/45866240054/job/140069693581
- Backend lint/format/build/unit: https://github.com/shyne240/monienaija/actions/runs/45866240054/job/140069814340
- Admin Web types/tests/build: https://github.com/shyne240/monienaija/actions/runs/45866240054/job/140069814315
- Agent Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45866240054/job/140069814334
- Customer Mobile types/tests: https://github.com/shyne240/monienaija/actions/runs/45866240054/job/140069814426
- Backend real PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45866230466/job/140071981518
- Backend isolated PostgreSQL: https://github.com/shyne240/monienaija/actions/runs/45866230466/job/140071981577
- Backend container image: https://github.com/shyne240/monienaija/actions/runs/45866230466/job/140071981457

## Evidence artifacts

All paths are relative to `/home/user/monienaija/docs/integration/evidence/arena2-review-45/`:

- `db/prepare.json`, `db/upgrade-path.json`, `db/workforce-accounts-mn_upgrade45.json`, `db/workforce-accounts-mn_fresh45.json`
- `http/governed-config.json`, `http/http-acceptance.json`
- `browser/journey-result.json`, `browser/journey-partial.json`, `browser/screens/*.png`
- `device/device-acceptance.json`
- `test-summary.json`, `REPORT.md`

Harness scripts are local under `/home/user/monienaija/scripts/arena2-review/`. Raw evidence JSON contains synthetic local-workforce request bodies and is left untracked; this report and the structured test summary are the tracked review deliverables. No physical handset/emulator artifacts exist.
