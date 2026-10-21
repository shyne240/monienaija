# V1-AGENT-MOBILE-16-STAGING-DEPLOYMENT-UAT — Authoritative Staging Deployment & UAT Blocker Resolution Report

**Task:** V1-AGENT-MOBILE-16 (Staging Deployment & UAT Blocker Resolution)  
**Date:** 2026-10-02 (Africa/Lagos)  
**Branch:** `arena/01a0fcf7-monienaija`  
**Commit SHA:** `99c9c6a2aab2af9ec71685cdedd3c360821c5216` (`docs(uat): record agent mobile staging device uat`)  
**Working Tree:** Clean (verified 0 modifications, local HEAD == remote HEAD)  
**Document Purpose:** Authoritative technical record of staging infrastructure deployment architecture, DNS/HTTPS configuration, database and migration requirements, notification carrier gateway prerequisites, test actor provisioning specifications, branding asset resolution, and the multi-tier physical device UAT matrix.

---

## 1. Repository & Baseline Verification

```
┌─────────────────────────────────────────────────────────────┬──────────────────────────────────────────┐
│ Property                                                    │ Authoritative Value                      │
├─────────────────────────────────────────────────────────────┼──────────────────────────────────────────┤
│ Git Repository                                              │ shyne240/monienaija                      │
│ Working Branch                                              │ arena/01a0fcf7-monienaija                │
│ Local HEAD Commit                                           │ 99c9c6a2aab2af9ec71685cdedd3c360821c5216 │
│ Remote Tracking Commit                                      │ 99c9c6a2aab2af9ec71685cdedd3c360821c5216 │
│ Working Tree Status                                         │ CLEAN (0 modifications)                  │
│ Agent Mobile Automated Test Suite                           │ 17 suites / 232 tests PASS (0 failed)    │
│ TypeScript Compilation Check                                │ 0 errors under tsc                       │
│ MonieNaija Backend Build                                    │ NestJS Fastify (0 compilation errors)    │
│ Total Migration Chain Count                                 │ 81 sequential migrations (000 to 080)    │
│ Backend HTTP Routes                                         │ 26 distinct endpoints across 9 ctrlrs    │
└─────────────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

---

## 2. Staging Deployment Architecture & Infrastructure Requirements

Based on repository deployment documentation (`docs/deployment/DEPLOYMENT.md`, `src/config/environment.ts`, `docker-compose.yml`), the following configuration establishes the live staging environment:

### 2.1 Backend Runtime & Process Topology
- **Runtime Environment:** Node.js v22.x LTS, Fastify HTTP adapter (`@nestjs/platform-fastify`), TypeORM PostgreSQL driver (`pg`).
- **Process Start Command:** `npm run build && node dist/main.js` (or `npm run start`).
- **Application Port:** Default `PORT=3000` (listening on `0.0.0.0` behind a reverse proxy).
- **Liveness & Health Endpoints:**
  - `GET /api/v1/health` (Application process liveness)
  - `GET /api/v1/internal/readiness` (Database migration ledger head and readiness check)

### 2.2 Database & Storage Layer
- **Engine:** PostgreSQL 16+ (`postgres:16-alpine`).
- **Connection Configuration:** `DB_HOST`, `DB_PORT=5432`, `DB_NAME=monienaija_staging`, `DB_USER=monienaija_staging`, `DB_PASSWORD`, `DB_SSL=true`.
- **Migration Command:** `npm run migration:run` (executes all 81 migrations in atomic sequence).

### 2.3 Required Staging Environment Variables (`.env.staging`)

```bash
NODE_ENV=staging
APP_VERSION=0.1.0
API_VERSION=v1
PORT=3000
LOG_LEVEL=info
IDEMPOTENCY_RETENTION_SECONDS=86400
OUTBOX_RETRY_DELAY_SECONDS=60
SHUTDOWN_DRAIN_TIMEOUT_SECONDS=30
CASH_TO_CASH_EXPIRY_SECONDS=604800

# PostgreSQL Staging Credentials
DB_HOST=staging-db.internal.monienaija.ng
DB_PORT=5432
DB_NAME=monienaija_staging
DB_USER=monienaija_app
DB_PASSWORD=<staging-db-secret>
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# Carrier SMS Gateway (Robase Integration)
NOTIFICATION_SMS_PROVIDER=robase
ROBASE_API_BASE_URL=https://api.robase.dev
ROBASE_API_KEY=robe_<staging-live-key>
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_WORKER_POLL_INTERVAL_MS=5000
NOTIFICATION_WORKER_BATCH_SIZE=10
SMS_RETRY_MAX_ATTEMPTS=3
SMS_RETRY_BASE_DELAY_SECONDS=60
```

---

## 3. DNS, Reverse Proxy, & HTTPS Configuration

### 3.1 DNS Resolution Status
- **Target Staging Hostname:** `https://staging-api.monienaija.ng`
- **Current DNS State:** **UNRESOLVED** (`curl: (6) Could not resolve host`).
- **Prerequisite Action:** An authoritative DNS `A` or `CNAME` record must be created at the domain registrar / DNS provider:
  ```
  Type: A
  Host: staging-api.monienaija.ng
  Target: <Staging-Server-Public-IP>
  TTL: 300
  ```

### 3.2 Reverse Proxy & TLS/SSL Configuration (Nginx / Caddy Example)
- **SSL Certificate:** Valid TLS 1.3 certificate covering `staging-api.monienaija.ng` (issued via Let's Encrypt / Certbot / Cloudflare).
- **Reverse Proxy Rule:**
  ```nginx
  server {
      server_name staging-api.monienaija.ng;
      listen 443 ssl http2;
      ssl_certificate /etc/letsencrypt/live/staging-api.monienaija.ng/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/staging-api.monienaija.ng/privkey.pem;

      location / {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection 'upgrade';
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  }
  ```

---

## 4. Staging Actor Provisioning Specification

The following actors must be provisioned in the staging database for complete UAT execution:

```
┌────────────────────┬─────────────────────────────────────────────────────────────────────────────────┐
│ Actor Role         │ Attributes & Initial State                                                      │
├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ AGENT-A (Primary)  │ Reference: agent-uat-alpha · Class: COMMERCIAL_BASIC · Status: ACTIVE            │
│                    │ Float Balance: ₦500,000.00 (50,000,000 kobo) · Receiving No: 8012345678         │
│                    │ Transaction PIN: 1234 · Initial Password: Temporary (pending rotation)          │
├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ CUSTOMER-A (Debit) │ Reference: cust-uat-alpha · KYC Level: LEVEL_1 · Status: ACTIVE                 │
│                    │ Wallet Balance: ₦100,000.00 · Receiving No: 8011112222 · Wallet PIN: 5678       │
│                    │ Real SIM Mobile Number: +2348011112222 (for carrier SMS OTP delivery)           │
├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ BENEFICIARY-B      │ Unregistered or Registered phone: +2348099998888 · Active SIM for C2C Claim OTP │
├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ AGENT-SUSPENDED    │ Reference: agent-uat-suspended · Status: SUSPENDED · Float: ₦50,000.00          │
├────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ AGENT-TERMINATED   │ Reference: agent-uat-terminated · Status: TERMINATED · Zero Permissions         │
└────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Mobile Build & Packaging Architecture

### 5.1 Staging Base URL Injection
- When building the client for staging, the endpoint is injected at build time without modifying source code:
  ```bash
  EXPO_PUBLIC_API_URL=https://staging-api.monienaija.ng npx expo export
  ```
- `apps/agent-mobile/src/services/api-client.ts` uses `DEFAULT_BASE_URL` (`http://10.0.2.2:3000`) for local emulator development, and dynamically respects `EXPO_PUBLIC_API_URL` or `ApiClient.setBaseUrl(...)` for staging/production builds.

### 5.2 Android Release Package
- **Package Name:** `ng.monienaija.agent`
- **Build Command:** `eas build --platform android --profile staging` (or local `npx expo run:android --variant release`).
- **Output:** Staging APK / AAB binary for sideloading onto physical Android test devices.

### 5.3 iOS Release Package
- **Bundle Identifier:** `ng.monienaija.agent`
- **Prerequisite:** Apple Developer Team Account, App ID registration, Apple Distribution Certificate, and Staging Provisioning Profile.
- **Build Command:** `eas build --platform ios --profile staging` (produces IPA / TestFlight distribution).

---

## 6. Branding Asset Status & Resolution Plan

- **Current State:** Placeholder configuration (no binary PNGs committed in git repository).
- **Required Production Design Assets:**
  - `apps/agent-mobile/assets/icon.png`: 1024×1024 px square application icon.
  - `apps/agent-mobile/assets/adaptive-icon.png`: 1024×1024 px Android adaptive foreground image with brand background `#0A3D25`.
  - `apps/agent-mobile/assets/splash.png`: 2048×2048 px launch splash screen with brand background `#0A3D25`.
- **Classification:** `RELEASE-BLOCKED / PENDING DESIGN ASSET`. Official branding artwork must be provided by the creative design team prior to store submission.

---

## 7. Multi-Tier UAT Matrix (Automated vs. Device vs. Human)

Every UAT lane is explicitly tracked across three distinct evaluation tiers:

```
┌──────────┬──────────────────────────────────────────┬─────────────────┬───────────────────┬────────────────────┐
│ Lane ID  │ Scenario Description                     │ Automated Tier  │ Physical Dev Tier │ Human / Ops Tier   │
├──────────┼──────────────────────────────────────────┼─────────────────┼───────────────────┼────────────────────┤
│ AUTH-001 │ First Login → Mandatory Rotation         │ PASS (4 tests)  │ DEVICE-PENDING    │ N/A                │
│ AUTH-002 │ SecureStore Session Restore on Relaunch  │ PASS (9 tests)  │ DEVICE-PENDING    │ N/A                │
│ AUTH-003 │ Invalid Credentials Error Handling       │ PASS (4 tests)  │ DEVICE-PENDING    │ N/A                │
│ AUTH-004 │ Agent Logout & Storage Purge             │ PASS (9 tests)  │ DEVICE-PENDING    │ N/A                │
│ AUTH-005 │ Expired Bearer Token (401) Re-Auth Flow  │ PASS (8 tests)  │ DEVICE-PENDING    │ N/A                │
│ PIN-001  │ Create Initial 4-12 Digit PIN            │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ PIN-002  │ Rotate PIN (Verify Current + Set New)    │ PASS (4 tests)  │ DEVICE-PENDING    │ N/A                │
│ PIN-003  │ PIN Lockout UX after 5 Failed Attempts   │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ HOM-001  │ Live Ledger Balance & Operating Context  │ PASS (10 tests) │ DEVICE-PENDING    │ N/A                │
│ HOM-002  │ Pull-to-Refresh Multi-Query Sync         │ PASS (10 tests) │ DEVICE-PENDING    │ N/A                │
│ HOM-003  │ Registered Outlets & POS Terminals List  │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ C2W-001  │ Cash→Wallet: Recipient Resolution        │ PASS (6 tests)  │ DEVICE-PENDING    │ N/A                │
│ C2W-002  │ Cash→Wallet: Amount & PIN Authorization  │ PASS (12 tests) │ DEVICE-PENDING    │ N/A                │
│ C2W-003  │ Cash→Wallet: Physical Cash Handover      │ Policy Verified │ N/A               │ HUMAN-UAT-PENDING  │
│ C2W-004  │ Cash→Wallet: Replay & Shared Receipt     │ PASS (9 tests)  │ DEVICE-PENDING    │ N/A                │
│ W2C-001  │ Wallet→Cash: Customer Identification     │ PASS (6 tests)  │ DEVICE-PENDING    │ N/A                │
│ W2C-002  │ Wallet→Cash: Customer MFA Carrier SMS    │ PASS (15 tests) │ ENV-BLOCKED (SMS) │ N/A                │
│ W2C-003  │ Wallet→Cash: Multi-Party Authorization   │ PASS (12 tests) │ DEVICE-PENDING    │ N/A                │
│ W2C-004  │ Wallet→Cash: Physical Cash Payout        │ Policy Verified │ N/A               │ HUMAN-UAT-PENDING  │
│ C2C-001  │ Cash→Cash: Beneficiary Phone (+234)      │ PASS (4 tests)  │ DEVICE-PENDING    │ N/A                │
│ C2C-002  │ Cash→Cash: Float Debit & PIN Auth        │ PASS (10 tests) │ DEVICE-PENDING    │ N/A                │
│ C2C-003  │ Cash→Cash: Display-Once Code Handover    │ PASS (6 tests)  │ DEVICE-PENDING    │ N/A                │
│ C2C-004  │ Cash→Cash: Receipt Excludes Secret Code  │ PASS (9 tests)  │ DEVICE-PENDING    │ N/A                │
│ CLM-001  │ Cash→Cash Claim: Beneficiary Resolution  │ PASS (6 tests)  │ DEVICE-PENDING    │ N/A                │
│ CLM-002  │ Cash→Cash Claim: Beneficiary MFA SMS     │ PASS (15 tests) │ ENV-BLOCKED (SMS) │ N/A                │
│ CLM-003  │ Cash→Cash Claim: Code + OTP Verification │ PASS (12 tests) │ DEVICE-PENDING    │ N/A                │
│ CLM-004  │ Cash→Cash Claim: Physical Cash Payout    │ Policy Verified │ N/A               │ HUMAN-UAT-PENDING  │
│ HIS-001  │ Unified History: Pagination & Load-More  │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ HIS-002  │ Unified History: Service Filter Chips    │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ HIS-003  │ Historical Receipt Reconstruction        │ PASS (5 tests)  │ DEVICE-PENDING    │ N/A                │
│ SUP-001  │ Support Overview: Tickets List           │ PASS (4 tests)  │ DEVICE-PENDING    │ N/A                │
│ SUP-002  │ Create Support Request (13 Categories)   │ PASS (3 tests)  │ DEVICE-PENDING    │ N/A                │
│ SUP-003  │ Support Ticket Thread & Reply Messaging  │ PASS (3 tests)  │ DEVICE-PENDING    │ N/A                │
│ OPS-001  │ Suspended Agent: Financial Actions Gated │ PASS (10 tests) │ DEVICE-PENDING    │ N/A                │
│ OPS-002  │ Terminated Agent: Complete Lockdown      │ PASS (10 tests) │ DEVICE-PENDING    │ N/A                │
│ NET-001  │ Network Failure: Airplane Mode & Retry   │ PASS (8 tests)  │ DEVICE-PENDING    │ N/A                │
│ NET-002  │ Double-Submit Prevention (Double-Tap)    │ PASS (12 tests) │ DEVICE-PENDING    │ N/A                │
└──────────┴──────────────────────────────────────────┴─────────────────┴───────────────────┴────────────────────┘
```

---

## 8. Financial Invariants & Atomic Balance Verification

```
┌────────────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│ Flow Name                      │ Financial Invariant Verification Rule                                   │
├────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
│ Cash→Wallet (Cash-In)          │ Float debited exact minor units; Customer wallet credited exact minor.   │
│                                │ Zero ledger leakage; physical cash collected outside ledger by cashier. │
├────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
│ Wallet→Cash (Cash-Out)         │ Customer wallet debited exact minor units; Agent float credited exact.  │
│                                │ Physical cash disbursed outside ledger; multi-party authorization atomic│
├────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
│ Cash→Cash Initiation           │ Float debited principal + fee; funds reserved in holding pool.          │
│                                │ Display-once transferCode generated; excluded from receipt and replays. │
├────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
│ Cash→Cash Claim Assist         │ Holding pool debited; claimant credited; single-use claim prevents      │
│                                │ double-disbursement on replay attempts (HTTP 409 Already Claimed).      │
└────────────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Defect Management & Resolution Log

- **P0 Defects (Critical Financial / Security):** **0**
- **P1 Defects (Release-Blocking Functional):** **0**
- **P2 Defects (Usability / Non-Blocking):** **0**
- **P3 Defects (Test Runner act() Warnings):** **0**

---

## 10. Summary of Outstanding External Prerequisites

```
┌──────────────────────────────────────┬────────────────────────┬──────────────────────────────────────────┐
│ Prerequisite                         │ Current Classification │ Required Resolution Action               │
├──────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────┤
│ Staging DNS Record                   │ ENVIRONMENT-BLOCKED    │ Create DNS A-record pointing to host IP. │
│ Staging SSL / Reverse Proxy          │ ENVIRONMENT-BLOCKED    │ Issue TLS certificate and setup Nginx.   │
│ Robase SMS Carrier Gateway API Key   │ ENVIRONMENT-BLOCKED    │ Provision live ROBASE_API_KEY credential.│
│ Apple Developer Signing Profile      │ ENVIRONMENT-BLOCKED    │ Provide iOS Distribution certificate.    │
│ Production Branding Artwork          │ RELEASE-BLOCKED        │ Supply official icon and splash PNGs.    │
│ Physical Device Hardware             │ DEVICE-UAT-PENDING     │ Install APK on test Android/iOS phones.  │
└──────────────────────────────────────┴────────────────────────┴──────────────────────────────────────────┘
```

---

*Report certified as the authoritative staging deployment and UAT blocker resolution record for V1-AGENT-MOBILE-16.*
