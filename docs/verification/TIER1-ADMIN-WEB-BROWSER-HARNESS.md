# Tier 1 Admin Web Browser Harness (PR #24)

Chromium/Playwright browser download was unavailable in the Arena sandbox (`npx playwright install chromium` failed with `ECONNRESET`; no system browser present). This document provides a repeatable harness and fixture setup so the Admin Web UI step can be verified elsewhere against the same branch/head.

## Branch / head
- Branch: `arena/52ff58d1-monienaija`
- PR: https://github.com/shyne240/monienaija/pull/24 (draft)
- Head at time of writing: `ed62f417` (includes lint+format fixes and tier-default eligibility fix `0e5a2d3b`)

## Preconditions
- Node/npm as per repo.
- Disposable PostgreSQL reachable; migrations applied.
- Backend built: `npm run build`
- Admin Web deps installed: `cd apps/admin-web && npm ci`
- Local admin seeded (development only): `NODE_ENV=development node scripts/local-dev-seed-admin.js`
- KYC ownership key configured for synthetic claim (dev/test only):
  - `KYC_OWNERSHIP_KEY_BASE64=zZluamosntOpfdOxLDfiKEk+9Tj3+5N99Xk2mDPAy1s=`
  - `KYC_OWNERSHIP_KEY_VERSION=test-v1`
  - Matching `kyc_ownership_key_state` row with proof `71db50bad487883cb68392342f12f69bfd6b174f6c9e1a67c1a6db220b3d716d`.

## Start services
Backend (port 3000, binds 0.0.0.0 by default in dev config used here):
```bash
source /tmp/backend-env.sh  # or export equivalent envs
node dist/main.js
```
Admin Web (port 5173):
```bash
cd apps/admin-web
VITE_API_PROXY_TARGET=http://localhost:3000 npm run dev -- --host 0.0.0.0 --port 5173
```

## Fixture (disposable DB only)
Run the fixture scripts in `/tmp` created during this session on a fresh disposable migrated DB (do not run against production):
1. `seed-policy.cjs` - approves KYC tier policy v1.
2. `create-tier1b.cjs` - creates DRAFT customer `804207c1-75cc-4127-be1d-29b6c4fa4d69` (`t1-804207c1`, +2348012345001).
3. `seed-evidence2.cjs` + `fix-rev*.cjs` - seeds verified BVN evidence aligned to evidence reader identity revision.
4. `fix-config.cjs` - seeds STANDARD class, approved tier defaults L1-3, WALLET_TRANSFER configured, fee rule (10000 flat/0 bps/min 0/max NULL/VAT 0), `T1_STANDARD_PROFILE` limits.
5. `fix-ownership.cjs` - aligns ownership key state and claim MAC for synthetic BVN `22222222222`.
6. Activate via governed workforce API: `PATCH /api/v1/customers/:id {"status":"ACTIVE"}` with workforce bearer.
7. For claimable state: ensure no active passcode/pin credentials for the probe customer.

Expected probe customer (disposable DB):
- id: `804207c1-75cc-4127-be1d-29b6c4fa4d69`
- reference: `t1-804207c1`
- phone: `8012345001` / `+2348012345001`
- status: ACTIVE, kyc LEVEL_1/APPROVED, not synthetic
- verified trusted evidence: BVN
- assigned class: STANDARD (TIER_DEFAULT)
- effective WALLET_TRANSFER fee: RESOLVED flat 10000, 0bps, min0, maxFee null, vat0; quote 100000->10000/0/110000
- effective limits: MAX_AMOUNT_PER_TX 5,000,000 (default), DAILY 20,000,000, WEEKLY 50,000,000, MONTHLY 100,000,000, WALLET_BALANCE_MAX 200,000,000
- outstanding after activation: wallet (ready-to-claim before credentials set)

## Browser steps (manual or Playwright)
1. Open Admin Web `http://localhost:5173`.
2. Sign in with local workforce admin: `admin@monienaija.local` / `MonieNaijaAdmin123!`.
3. Navigate to Customer Directory -> open customer `t1-804207c1` / `804207c1-75cc-4127-be1d-29b6c4fa4d69`.
4. Open Registration Review / effective configuration view and capture:
   - Verified tier: LEVEL_1 APPROVED
   - Assigned default class: STANDARD, source TIER_DEFAULT, eligible for verified tier
   - Effective fees and limits: WALLET_TRANSFER RESOLVED fee rule + resolved limits
   - Ready-to-claim/onboarding state: activatable true, outstanding wallet (pre-claim), no wallet provisioned
5. For ceiling test, update MAX_AMOUNT_PER_TX commercial rule above 5,000,000 (e.g. 10,000,000) or set explicitly unlimited (not `maximumFeeMinor:null`) and capture Admin Web amount limit vs runtime behavior just above tier cap.

## Automated Playwright harness
See `scripts/tier1-admin-web-harness.spec.ts` (Playwright test skeleton) and `scripts/run-tier1-admin-web-harness.sh`.
Run after installing browsers on a machine with browser access:
```bash
cd apps/admin-web
npm i -D @playwright/test
npx playwright install chromium
npx playwright test ../../scripts/tier1-admin-web-harness.spec.ts --config=../../scripts/tier1-admin-web.playwright.config.ts
```

## HTTP evidence captured in sandbox (no browser)
- Registration review (workforce bearer) showed: `activatable=true`, `financialEligibility=ELIGIBLE`, `trustedEvidence=VERIFIED [BVN]`, assigned STANDARD/TIER_DEFAULT, effective WALLET_TRANSFER fee/limits RESOLVED, outstanding `[wallet]`.
- Pre-claim registration session cannot provision wallet: `POST /api/v1/customers/me/activation` with registration-session bearer + Idempotency-Key returned `401 Authentication required`.
- Claim with valid synthetic ownership evidence: `POST /customers/registration-sessions/claim-match` (BVN 22222222222, ownership key/mac aligned) returned `MATCH`; `claim-credentials` returned `SET_UP`.
- Post-claim access: onboarding-login returned customer-api session; `/customers/me`, `/customers/me/profile`, `/customers/me/wallets`, `/customers/me/activation` returned 200 with expected ACTIVE/LEVEL_1 profile and no provisioned wallet.
- Fee quote runtime comparison: effective-preview `amountMinor=100000` computed feeMinor 10000/vat 0/total 110000, matching displayed registration-review quote.
- Ceiling (commercial above tier): MAX_AMOUNT_PER_TX bumped to 10,000,000 in commercial profile; effective-preview reflected 10,000,000. In this disposable env tier-limit enforcement activation was false and no institution tier policy was supplied, so preview did not apply a separate tier ceiling.
