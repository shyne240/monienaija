# ARENA 4 — Sprint 3 Browser UAT and Release Evidence

**Assigned branch:** `arena/870f970d-monienaija`  
**Common Sprint 3 baseline:** `3428e37e02e7ea55b431f8d2d461fb2356a418de` from `arena/8e59e188-monienaija`  
**Assessment:** 2026-10-26  
**Scope:** Baseline-only API/database and frontend verification. No active ARENA 1/2/3 branch work was merged or assumed.

## 1. Branch alignment and preservation

- The local assigned-branch checkout initially pointed at `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`, with a large dirty workspace snapshot (441 changed/untracked paths). The remote assigned-branch tip fetched from origin was `72e39a0b22b2363e93ffe9ff5252bc9772a88c74`, containing the prior ARENA 4 UAT commits.
- Before updating, I preserved that complete dirty snapshot in local `stash@{0}` (`ARENA4 Sprint3 preserve pre-alignment workspace`). I verified the remote assigned-branch commit was a descendant of local HEAD and fast-forwarded local to `72e39a0b22b2363e93ffe9ff5252bc9772a88c74`; prior UAT work was preserved in committed ancestry.
- The source branch tip resolved to the supplied SHA `3428e37e02e7ea55b431f8d2d461fb2356a418de` exactly.
- The supplied common baseline is a descendant of the fetched ARENA 4 tip. I verified ancestry and fast-forwarded the assigned branch to the exact baseline. No reset, rebase, branch switch, force-push, or changes to other agents' branches occurred. The stash remains available as an additional safety copy.
- HEAD is now exactly `3428e37e02e7ea55b431f8d2d461fb2356a418de`; the integrated SHA is an ancestor of HEAD. This report and no implementation assumptions are based on active agent branches.

## 2. Executed backend/PostgreSQL regression

Environment: Node `v22.22.3`, npm `10.9.8`; isolated embedded PostgreSQL `18.4`; repository test-env generator; sequential PostgreSQL runner. Test databases were namespaced `s3uat26`, created and removed by the repository harness. No production service, account, or funds were used.

Exact command:

```bash
PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=7 PG_TEST_RUN_ID=s3uat26 \
  npm run test:pg -- \
  --testPathPatterns='test/(a[0-9]+-agent|v1-agent|agent-application-access|v1-funding-approvals-inbox).*integration.spec.ts'
```

**Result: 22 PostgreSQL integration suites passed; 427 tests passed; 0 failed.** Four sequential batches ran at concurrency 1. This extends the prior ARENA 4 evidence of 20 suites / 382 tests. Included the Cash-to-Cash claim/expiry tests, auth/session/credential, PIN, capability and authorization, application lifecycle, funding approval inbox, agent receiving-number authorization, agent history and cash operations.

Particularly relevant persisted PostgreSQL evidence in this run:

- A16 claim suite exercised customer-wallet and Agent B cash redemption, authenticated claim receipt recovery, cross-agent receipt denial, independent claim-journal/account-line assertions, concurrent claim races, duplicate/idempotent requests, OTP replay and expiry, transaction PIN/session evidence, KYC expiry, transfer expiry, and rollback/limit-failure paths.
- `v1-funding-approvals-inbox` exercised funding request/approval inbox and maker-checker authorization.
- `v1-agent-receiving-number-authorization` exercised role-authorized and denied HTTP paths.
- The exact broader file/test totals are the runner's observed aggregate; they are not inferred from the upstream full regression report.

Additional checks on this common baseline:

| Command | Result |
|---|---|
| Backend `npm run build` | PASS |
| Admin Web `npm test -- --runInBand` | PASS — 24 suites / 161 tests |
| Admin Web `npm run ts:check` | PASS |
| Admin Web `npm run build` | PASS (Vite emitted the existing CJS API deprecation and >500 kB chunk warnings) |
| Agent Mobile `npm test -- --runInBand` | PASS on isolated rerun — 19 suites / 284 tests |
| Agent Mobile `npm run ts:check` | PASS |

The first Agent Mobile run was executed concurrently with Admin Web tests and had one 5-second async UI-test timeout (18 suites / 284 tests passed, 1 failed). It passed on a serial rerun (19/19, 284/284); component animation/`act()` warnings remain. No React Native Jest result is represented as device UAT.

## 3. Admin Web browser feasibility — not executed

I installed the lockfile-declared dependencies with `npm ci --ignore-scripts` and checked both Playwright and the bundled Chromium option:

- No system Chromium/Chrome/Firefox executable or Playwright browser-cache executable was available.
- The root dependency `@sparticuz/chromium@153.0.0` was unpacked from the npm registry to `/tmp/chromium`. A real Playwright launch was attempted. It exited before browser startup with `libnspr4.so: cannot open shared object file`; `ldd` also reports missing `libnss3.so` and `libnssutil3.so`.
- Provisioning system packages would require host package repositories; network access in this environment is restricted to the specified GitHub/npm/PyPI hosts and no local apt package cache is available. I did not bypass that restriction or change host libraries.
- As a safe npm-only fallback check, `@achingbrain/nss@0.0.1` was inspected/extracted only under `/tmp`. Its NSS libraries are from 2016 and Chromium 153 requires symbol version `NSS_3.30`, so the old library is incompatible. It was not used to run the browser and no package or library was added to the repository.

Therefore **no browser launched and no browser journey ran**. The Admin Web component/integration-style Jest tests and build passed, but do not prove browser behavior.

Prerequisites for a real Admin Web journey:

1. A supported browser/runtime image with compatible modern `libnspr4`, `libnss3` (at least the required NSS symbol set), `libnssutil3`, and remaining Chromium shared libraries; or an approved Playwright browser install/cache.
2. An isolated PostgreSQL-backed API running alongside Vite, with synthetic workforce principals/roles, maker/checker identities and agent fixtures seeded.
3. Playwright or equivalent configured to exercise login, permitted/forbidden navigation, Agent Network review/activation, funding approval separation, Cash-to-Cash monitoring, and error/recovery screens. Capture browser console/network errors and persisted state.

## 4. Agent Mobile device/emulator feasibility — not executed

- `adb`, `emulator`, `xcodebuild`, `/dev/kvm`, and an attached Android/iOS device are unavailable in the sandbox.
- Agent Mobile React Native Jest suites passed as listed above; they are component/service tests, not a simulated device or installed native application.

Prerequisites for device UAT: Android SDK platform tools plus an Android emulator and working KVM (or an authorized attached Android device), native Expo build/runtime, isolated API/database and agent test accounts. For iOS, macOS/Xcode and an iOS simulator or test device are required. Run login/rotation, MFA, set/verify PIN, cash-to-cash initiation/recovery, customer/Agent B redemption and receipt navigation on the actual target OS versions.

## 5. Independent financial evidence

The executed A16 tests read persisted PostgreSQL ledger state independently of command results. Covered cash payout assertions include the unclaimed-liability debit, Agent B float credit, exactly one settlement journal per transfer/idempotency scope, line totals, and the expected balance changes. Customer-wallet mode has the corresponding wallet-credit path and competing customer-wallet/Agent-cash concurrency test. Failure/expiry/invalid evidence and limit-commit failure tests assert rollback/no partial settlement. Agent history and recovered receipt are compared to the committed claim identifiers. These findings apply to the tested fixtures and paths; they are not a proof of every possible schedule or an independent external audit.

## 6. Release readiness matrix and blocker classification

| Classification | Sprint 3 assessment |
|---|---|
| **1. Proven security/financial defects** | No new defect was reproduced in the 22-suite targeted PG run. This is not penetration-test clearance or full-system proof. The integrated A16 tests cover the targeted rejection, race, invalidation, expiry and rollback cases. |
| **2. Missing functional workflows** | No API/database functional gap was found in the tested Ordinary Agent operations. Real Admin Web browser journey remains unverified, not an asserted product defect. Real mobile native journey also remains unverified. |
| **3. Unapproved product/compliance policies** | ARENA 1 Sprint 2 report still lists open decisions on legacy wallet customers/current KYC assessment expiry/freshness, expired-fund disposition/refund, manual cash handover, and related credential/session revocation policy boundaries. Product/compliance/operations owners must approve before those behaviours can be released; tests do not supply policy approval. See `docs/ARENA1-SPRINT2-FINANCIAL-SECURITY-20261026.md`. |
| **4. Dependency vulnerabilities** | Current lockfile audits: root workspace **2 findings** (1 moderate `esbuild`, 1 high direct `vite`); Agent Mobile **30** (18 moderate, 11 high, 1 critical; includes direct Expo/React Native/navigation packages and transitive `tar` critical); Admin Web **0**. These are npm audit advisories, not independently confirmed exploitable runtime defects. The Mobile critical/high findings need security-owner reachability/remediation review before native app release; root Vite advisory needs a dev-tooling exposure review. No dependency upgrades were made. |
| **5. Browser/device environment limitations** | Browser launch blocked by missing NSPR/NSS shared libraries and no approved safe modern library provisioning path in this sandbox. Android/iOS device runtime and KVM absent. No actual browser/device journey claimed. |
| **6. Nonblocking improvements** | Add supported browser dependencies to a maintained runner image, real browser scripts with isolated workforce seed, native emulator/device CI, persist screenshots/traces and DB reconciliation extracts, and add response-socket fault injection for true post-commit network disconnect testing. |

## 7. Changes and test ownership

No new test implementation was necessary for this Sprint 3 baseline: the common Sprint 3 integration includes the expanded A16 auth/session/PIN/KYC/recovery coverage and new funding-approval and receiving-number authorization suites. Rather than duplicating those tests, ARENA 4 independently ran the 22-suite database selection and all Admin Web/Agent Mobile automated suites, checked browser/device prerequisites, and recorded a current release matrix.

Files added by ARENA 4 Sprint 3:

- `docs/A4-SPRINT3-BROWSER-UAT-AND-RELEASE-EVIDENCE-20261026.md` — this report.

No backend services, operational controllers, frontend features, schema, migration, or existing tests were changed in this Sprint 3 turn. No deployment or merge to main was performed.

## 8. Recommended next testing priorities

1. Resolve the mobile critical/high dependency advisories with the mobile owner and obtain a signed-off audit disposition.
2. Run the full PostgreSQL battery sequentially on a memory-appropriate runner after this common baseline; the focused 22-suite run is not a full regression.
3. Provision supported Chromium host libraries in an approved test image, then run the Admin Web workforce/funding/Agent Network/Cash-to-Cash monitoring journeys against an isolated API.
4. Run native Android/iOS journeys on supported devices/emulators and capture secure-storage, background/resume, session-revocation and lost-response recovery behaviour.
5. Obtain explicit product/compliance/operations disposition for the unresolved financial policy items before release sign-off.
