# V1-AGENT-MOBILE-17: Agent Mobile Release Infrastructure Handoff & Build Verification

**Date:** 2026-10-02  
**Repository:** `shyne240/monienaija`  
**Branch:** `arena/01a0fcf7-monienaija`  
**Milestone:** V1-AGENT-MOBILE-17 — Release Infrastructure Handoff & Build Verification  
**Authoritative Scope:** Agent Mobile V1 Application, Staging Infrastructure, and Release Artifact Verification  

---

## 1. Baseline Repository State & Verification Summary

The MonieNaija codebase has been audited and verified at the release boundary. Application functionality is frozen for V1 release; this document provides an exact operational handoff for DevOps, Mobile Engineering, Design, Apple Administration, and Field Operations.

### 1.1 Git Metadata
* **Active Branch:** `arena/01a0fcf7-monienaija`
* **Baseline HEAD Commit:** `3d01b47c48ddc651e456b33a09f8f9f17d36d5af`
* **Remote Tracking:** `origin/arena/01a0fcf7-monienaija` (Synchronized)
* **Working Tree:** Clean (No uncommitted changes)

### 1.2 Automated Verification Results
* **Agent Mobile Automated Unit & Integration Tests:** **232 / 232 PASS** across 17 Jest test suites (`apps/agent-mobile/__tests__/`).
* **Root TypeScript Typecheck:** **PASS** (`npx tsc --noEmit` exits with status `0`).
* **Mobile TypeScript Typecheck:** **PASS** (`cd apps/agent-mobile && npx tsc --noEmit` exits with status `0`).
* **NestJS Backend Build:** **PASS** (`npx nest build` compiles cleanly to `dist/`).
* **Expo Configuration:** Validated against Expo SDK 52 and React Native 0.76 specifications in `apps/agent-mobile/app.json`.

---

## 2. Backend Deployment Specification

The MonieNaija backend is a containerized NestJS application running on Node.js 22 LTS with the Fastify HTTP platform.

### 2.1 Container & Runtime Configuration
* **Base Image:** `node:22-alpine` (Multi-stage build in `Dockerfile`).
* **HTTP Platform:** NestJS Fastify Adapter.
* **Default Listen Port:** `3000` (Configurable via `PORT` environment variable).
* **Process Start Command:** `node dist/main.js` (or `npm run start`).
* **Health Endpoint:** `GET /api/v1/health` (Returns `{"status":"ok"}`).
* **Readiness Endpoint:** `GET /api/v1/internal/readiness` (Checks database connectivity, migration head compatibility, and critical subsystem readiness).

### 2.2 Step-by-Step Backend Staging Deployment Runbook

```bash
# Step 1: Clone repository at the release commit
git clone https://github.com/shyne240/monienaija.git
cd monienaija
git checkout 3d01b47c48ddc651e456b33a09f8f9f17d36d5af

# Step 2: Install production dependencies
npm ci

# Step 3: Build application bundle
npm run build

# Step 4: Configure environment variables (e.g., .env.staging)
# Note: Ensure DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, and ROBASE_API_KEY are configured.

# Step 5: Execute database schema migrations
npm run migration:run

# Step 6: Start the backend server and in-process notification worker
NODE_ENV=staging NOTIFICATION_WORKER_ENABLED=true npm run start

# Step 7: Verify liveness and readiness
curl -f http://127.0.0.1:3000/api/v1/health
curl -f http://127.0.0.1:3000/api/v1/internal/readiness
```

---

## 3. Required Environment Variables

All runtime configuration is validated at application startup using Zod (`src/config/environment.ts`). Invalid or missing required variables will cause a fast, deterministic startup failure.

### 3.1 Environment Variable Reference

| Variable Name | Type | Staging Recommended Value | Required / Default | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | Enum | `staging` | Required (`development`) | Runtime environment profile |
| `APP_VERSION` | String | `1.0.0` | Default: `0.1.0` | Immutable application release version |
| `API_VERSION` | Literal | `v1` | Required: `v1` | API version prefix |
| `PORT` | Integer | `3000` | Default: `3000` | HTTP listen port for Fastify server |
| `LOG_LEVEL` | Enum | `info` | Default: `info` | Pino log level (`info`, `debug`, `warn`, `error`) |
| `DB_HOST` | String | `<staging-postgres-host>` | **REQUIRED** | PostgreSQL server hostname or IP |
| `DB_PORT` | Integer | `5432` | Default: `5432` | PostgreSQL TCP port |
| `DB_NAME` | String | `monienaija_staging` | **REQUIRED** | PostgreSQL database name |
| `DB_USER` | String | `monienaija_staging_user` | **REQUIRED** | PostgreSQL database username |
| `DB_PASSWORD` | Secret | `<managed-secret>` | **REQUIRED** | PostgreSQL database user password |
| `DB_SSL` | Boolean | `true` | Default: `false` | Enable SSL for PostgreSQL connection |
| `DB_SSL_REJECT_UNAUTHORIZED` | Boolean | `true` | Default: `true` | Enforce valid TLS certificate on database host |
| `IDEMPOTENCY_RETENTION_SECONDS` | Integer | `86400` | Default: `86400` (24h) | Idempotency record retention window |
| `OUTBOX_RETRY_DELAY_SECONDS` | Integer | `60` | Default: `60` | Base retry delay for transactional outbox |
| `SHUTDOWN_DRAIN_TIMEOUT_SECONDS` | Integer | `30` | Default: `30` | Graceful SIGTERM/SIGINT shutdown timeout |
| `CASH_TO_CASH_EXPIRY_SECONDS` | Integer | `604800` | Default: `604800` (7 days) | Lifetime of unclaimed Cash-to-Cash transfers |
| `NOTIFICATION_SMS_PROVIDER` | Enum | `robase` | Default: `console` | SMS Provider adapter (`console` or `robase`) |
| `ROBASE_API_BASE_URL` | URL | `https://api.robase.dev` | Default: `https://api.robase.dev` | Robase API endpoint base URL |
| `ROBASE_API_KEY` | Secret | `robe_<64_hex_chars>` | **REQUIRED** when provider=`robase` | Live Robase bearer token (must start with `robe_`) |
| `ROBASE_REQUEST_TIMEOUT_MS` | Integer | `10000` | Default: `10000` (10s) | HTTP client timeout for SMS dispatch |
| `NOTIFICATION_WORKER_ENABLED` | Boolean | `true` | Default: `false` | Enable background outbox SMS delivery worker |
| `NOTIFICATION_WORKER_POLL_INTERVAL_MS`| Integer | `5000` | Default: `5000` (5s) | Polling interval for pending outbox events |
| `NOTIFICATION_WORKER_BATCH_SIZE` | Integer | `10` | Default: `10` | Batch size for outbox claiming |
| `SMS_RETRY_MAX_ATTEMPTS` | Integer | `3` | Default: `3` | Maximum retry attempts for failed SMS deliveries |
| `SMS_RETRY_BASE_DELAY_SECONDS` | Integer | `60` | Default: `60` | Exponential backoff base for SMS retry |
| `COMMERCIAL_ACCOUNTING_ENABLED` | Boolean | `false` | Default: `false` | Commercial accounting policy evaluation |
| `A2_WORKFORCE_ENABLED` | Boolean | `false` | Default: `false` | Workforce OIDC authentication guard |

*Security Rule:* **NEVER** commit secret values into git, shell history, Docker images, or build logs.

---

## 4. DNS Configuration Requirements

* **Intended Public Domain:** `https://staging-api.monienaija.ng`
* **Current Resolution State:** **BLOCKED** (`ENOTFOUND` verified via `dns.lookup`).
* **Required External Action:**
  1. DNS Administrator must create an authoritative **A-Record** in the `monienaija.ng` zone:
     * **Host:** `staging-api`
     * **Type:** `A`
     * **TTL:** `300` (5 minutes for staging flexibility)
     * **Points To:** Public IPv4 address of the staging reverse proxy host.
  2. Optional: Configure `AAAA` record if IPv6 is supported on the staging ingress.

---

## 5. SSL / Reverse Proxy Architecture

Direct HTTP access to port 3000 must not be exposed to the public internet. All traffic must pass through a TLS-terminating reverse proxy.

### 5.1 TLS & Reverse Proxy Specifications
* **TLS Termination:** Port `443` with automatic HTTP-to-HTTPS redirect on port `80`.
* **Certificate Authority:** Let's Encrypt (Automated ACME challenge via Certbot or Caddy).
* **TLS Protocols:** TLS 1.2 and TLS 1.3 only; modern cipher suites.
* **Upstream Forwarding:** Reverse proxy forwards requests to `http://127.0.0.1:3000`.

### 5.2 Recommended Nginx Reverse Proxy Configuration Template

```nginx
server {
    listen 80;
    server_name staging-api.monienaija.ng;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name staging-api.monienaija.ng;

    ssl_certificate /etc/letsencrypt/live/staging-api.monienaija.ng/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging-api.monienaija.ng/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
}
```

*Current SSL Status:* **BLOCKED** (Requires DNS resolution and reverse proxy provisioning).

---

## 6. Database and Migrations Specification

The database engine, schema versioning, and migration chain have been fully verified from the repository code.

### 6.1 Database Engine Requirements
* **Database Engine:** PostgreSQL 16+ (`postgres:16-alpine` or managed AWS RDS / GCP Cloud SQL).
* **Required Extensions:** `uuid-ossp` or `pgcrypto` (Required for automatic UUIDv4 generation).
* **Isolation Level:** `SERIALIZABLE` or `READ COMMITTED` with table-level pessimistic locking (`FOR UPDATE SKIP LOCKED` / `FOR UPDATE`).

### 6.2 Migration Framework & Execution
* **Framework:** TypeORM CLI (`typeorm-ts-node-commonjs`).
* **Migration Files Directory:** `src/migrations/`.
* **Migration Count:** Exactly **81 migration scripts** sequentially indexed from `1785753600000-CreateWalletAndLedger.ts` through `1785753600080-AddMfaChallengePurpose.ts`.
* **Staging Migration Command:** `npm run migration:run` (which executes `typeorm-ts-node-commonjs migration:run -d src/config/data-source.ts`).
* **Readiness Verification Endpoint:** `GET /api/v1/internal/readiness` confirms the database connection is healthy and the schema migration head is active.
* **Current Status:** **STAGING DATABASE = NOT DEPLOYED / EXTERNAL PREREQUISITE**.

---

## 7. Redis & Background Worker Architecture

### 7.1 Architectural Fact & Verification
* **Redis / BullMQ Status:** **NOT REQUIRED / NOT USED IN ARCHITECTURE**.
* **Worker Mechanism:** The codebase implements an in-process, transactional outbox worker (`NotificationWorkerService` in `src/notification/notification-worker.service.ts`).
* **Concurrency Control:** Utilizes PostgreSQL `notification_deliveries` outbox table with atomic row-level locking via `UPDATE ... FOR UPDATE SKIP LOCKED`.
* **Retry Semantics:** Exponential backoff bounded by `SMS_RETRY_MAX_ATTEMPTS` (default: 3) and `SMS_RETRY_BASE_DELAY_SECONDS` (default: 60s). Terminally failed records remain safely in `status='FAILED'` with `last_error` and never corrupt financial balances.
* **Current Status:** **READY IN CODEBASE / NOT DEPLOYED ON STAGING**.

---

## 8. SMS Gateway (Robase) Integration Prerequisites

### 8.1 Provider Specifications
* **SMS Provider:** Robase (`RobaseNotificationProvider` in `src/notification/robase-notification-provider.ts`).
* **Base URL:** `https://api.robase.dev` (Configurable via `ROBASE_API_BASE_URL`).
* **Authentication:** HTTP Header `Authorization: Bearer <ROBASE_API_KEY>`. The key must be an official live key beginning with `robe_` (enforced by startup validation in `src/config/environment.ts`).
* **Sender ID:** Workspace-level configuration within the Robase dashboard (`MonieNaija`). Robase's `/v1/sms/send` REST API does not take a per-request sender parameter.
* **Deduplication / Idempotency:** Managed via deterministic `Idempotency-Key: ${eventKey}:${recipientId}:${channel}` header.
* **Current SMS Status:** **ENVIRONMENT-BLOCKED** (Missing `ROBASE_API_KEY` credential provisioning).

---

## 9. Android EAS Build Specification

### 9.1 Mobile Application Metadata
* **Framework:** Expo SDK 52 / React Native 0.76.
* **Application Package Name:** `ng.monienaija.agent` (Defined in `apps/agent-mobile/app.json`).
* **Target Platforms:** Android 12 (API 31), Android 13 (API 33), Android 14 (API 34).
* **API URL Binding:** Driven at build time via `EXPO_PUBLIC_API_URL=https://staging-api.monienaija.ng` (Consumed in `apps/agent-mobile/src/services/api-client.ts`).

### 9.2 EAS Build Execution Steps
```bash
# In apps/agent-mobile:
cd apps/agent-mobile

# 1. Install dependencies
npm ci

# 2. Configure EAS project
npx eas login
npx eas project:init

# 3. Create eas.json with staging build profile
cat <<EOF > eas.json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "staging": {
      "developmentClient": false,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://staging-api.monienaija.ng"
      },
      "android": {
        "buildType": "apk"
      }
    }
  }
}
EOF

# 4. Trigger cloud build
npx eas build --platform android --profile staging
```

*Current Android Build Status:* **ANDROID BUILD = BLOCKED** (EAS credentials/CLI not configured; missing branding assets; staging API endpoint not reachable).

---

## 10. iOS EAS Build & Signing Specification

### 10.1 iOS App Metadata
* **Bundle Identifier:** `ng.monienaija.agent` (Defined in `apps/agent-mobile/app.json`).
* **Target OS:** iOS 16.0, iOS 17.0, iOS 18.0+.
* **Distribution Channel:** Apple TestFlight (Internal & External Beta Groups).

### 10.2 Apple Developer & Signing Prerequisites
1. **Apple Developer Account:** Active Apple Developer Organization membership.
2. **App ID Registration:** `ng.monienaija.agent` registered with App Store Connect.
3. **Certificates & Profiles:**
   * Apple Distribution Certificate (`.p12`).
   * iOS App Store / TestFlight Provisioning Profile.
4. **App Store Connect API Key:** Key ID, Issuer ID, and private key (`.p8`) for automated EAS submission.

*Current iOS Build Status:* **IOS BUILD = BLOCKED** (Apple Developer credentials and EAS signing not configured; missing branding assets; staging API endpoint not reachable).

*Scope Enforcement Notice:* Biometric authentication (FaceID/TouchID) and push notifications are **OUTSIDE V1 ACCEPTANCE CRITERIA**.

---

## 11. Branding & Visual Assets Specification

### 11.1 Asset Audit
* **Expected Directory:** `apps/agent-mobile/assets/`
* **Current State:** **DIRECTORY DOES NOT EXIST** in repository.
* **Status:** **BRANDING = EXTERNAL DESIGN PREREQUISITE**.

### 11.2 Required Production Asset Deliverables

| Asset File Name | Dimensions | Format | Usage / Location |
|---|---|---|---|
| `icon.png` | 1024 × 1024 px | PNG (No alpha) | App Store & Google Play app icon |
| `adaptive-icon.png` | 1024 × 1024 px | PNG (Transparent background) | Android foreground adaptive launcher icon |
| `splash-icon.png` | 1024 × 1024 px | PNG (Centered artwork) | Native splash screen launch branding |
| `favicon.png` | 48 × 48 px | PNG | Web preview favicon |

*Constraint:* Do not invent or check in arbitrary placeholder images. Official vector/high-resolution PNG assets must be delivered by the Design Team.

---

## 12. Physical Device Requirements & Staging Test Setup

### 12.1 Hardware Requirements
* **Android Test Matrix:**
  * Low-tier device: Android 12, 3GB RAM (e.g., Tecno Spark / Samsung Galaxy A13).
  * Standard device: Android 13/14, 6GB+ RAM (e.g., Samsung Galaxy S21 / Google Pixel 7).
* **iOS Test Matrix:**
  * iPhone running iOS 16.x (e.g., iPhone 11 / 12).
  * iPhone running iOS 17.x / 18.x (e.g., iPhone 14 / 15).

### 12.2 Network Test Conditions
* **Wi-Fi:** High-speed broadband.
* **Cellular Data:** 4G/LTE and throttled 3G (simulating degraded rural/suburban coverage).
* **Offline / Flight Mode:** Verification of offline warning banners and graceful retry handling.

---

## 13. Operational Cash & Float Requirements

### 13.1 Staging Agent Float Seeding
* Staging agent accounts must be provisioned with initial float balance (e.g., ₦500,000.00 test float) in `agent_funding_pool` / ledger to permit continuous C2W and C2C testing.
* Customer test accounts must be seeded with test wallet balances for W2C testing.

### 13.2 Physical Cash Handling Protocol
* Field operations testers must verify cashier cash-collection procedures matching digital receipts generated on device screens.
* **Status:** **NOT EXECUTED / EXTERNAL PREREQUISITE**.

---

## 14. Financial Model Verification & Correction

### 14.1 Correction of Unsupported Regulatory Claims
* **Previous Claim:** "Fee calculation and operational deduction adheres strictly to Tier 1 CBN regulatory schedules."
* **Repository Reality & Correction:** The repository contains no CBN regulatory schedule definitions. The code adheres strictly to the **configured V1 commercial and fee rules** defined in `src/fee-rules/` and `src/commercial-decision/`. Fee calculations execute pure BigInt minor-unit arithmetic with FLOOR rounding.

### 14.2 Double-Entry Accounting Invariants
* **Cash-to-Wallet (C2W / CASH_IN):** Agent funding pool is DEBITED; Customer wallet is CREDITED. Ledger journal recorded atomically under `canonicalService='CASH_IN'`.
* **Wallet-to-Cash (W2C / CASH_OUT):** Customer wallet is DEBITED; Agent funding pool is CREDITED. Customer authorizes via PIN. Ledger journal recorded atomically under `canonicalService='CASH_OUT'`.
* **Cash-to-Cash (C2C):** Agent funding pool is DEBITED; MonieNaija Transit ledger account is CREDITED. A randomized 8-digit claim code is hashed and stored in `cash_to_cash_transfers`.
* **Cash-to-Cash Claim (CLM):** MonieNaija Transit ledger account is DEBITED; Agent funding pool (for cash payout) or Customer wallet (for wallet deposit) is CREDITED. Transition is strictly atomic with single-redemption enforcement.

---

## 15. Comprehensive Multi-Tier UAT Matrix (32 V1 Lanes)

| Lane ID | Test Domain | Scenario Description | Automated Contract Status | Device Execution Status | External / Human Dependency |
|---|---|---|---|---|---|
| `AUTH-001` | Auth | Agent Login with Valid Phone & Password | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `AUTH-002` | Auth | Agent Login with Invalid Password (Rejection & Lock) | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `AUTH-003` | Auth | Agent MFA Challenge Delivery & Verification | **PASS** (Jest) | **NOT EXECUTED** | Robase SMS gateway pending |
| `AUTH-004` | Auth | Agent Session Refresh & Bearer Token Rotation | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `AUTH-005` | Auth | Agent Logout & Session Invalidation | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `PIN-001` | PIN | Set Transaction PIN (Initial Setup) | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `PIN-002` | PIN | Verify Transaction PIN (Correct PIN Entry) | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `PIN-003` | PIN | Change Transaction PIN (Current + New PIN) | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `HOM-001` | Home | Dashboard Balance & Float Visibility | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `HOM-002` | Home | Service Navigation & Quick Action Routing | **PASS** (Jest) | **NOT EXECUTED** | Device artifact pending |
| `HOM-003` | Home | Pull-to-Refresh & State Synchronization | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2W-001` | Cash→Wallet | Recipient Phone Lookup & Name Resolution | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2W-002` | Cash→Wallet | Fee Calculation & Confirmation Breakdown | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2W-003` | Cash→Wallet | Transaction Execution & Receipt Generation | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2W-004` | Cash→Wallet | Insufficient Agent Float Handling | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `W2C-001` | Wallet→Cash | Customer Phone Lookup & Balance Verification | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `W2C-002` | Wallet→Cash | Cash-out Quote & Fee Breakdown | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `W2C-003` | Wallet→Cash | Customer PIN Authorization & Settlement | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `W2C-004` | Wallet→Cash | Invalid PIN & Rejection Handling | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2C-001` | Cash→Cash | Sender & Recipient Details Capture | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2C-002` | Cash→Cash | Fee Calculation & Breakdown | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `C2C-003` | Cash→Cash | Transfer Creation & 8-Digit Claim Code Gen | **PASS** (Jest) | **NOT EXECUTED** | Robase SMS gateway pending |
| `C2C-004` | Cash→Cash | Idempotency Replay on Retried Submission | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `CLM-001` | Claim | Claim Code & Recipient Phone Verification | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `CLM-002` | Claim | Cash Payout Execution (Agent Float Credit) | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `CLM-003` | Claim | Direct-to-Wallet Deposit Execution | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `CLM-004` | Claim | Expired / Already-Claimed Code Rejection | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `HIS-001` | History | Unified Transaction History List & Status Badges | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `HIS-002` | History | Transaction Details Modal & Receipt Sharing | **PASS** (Jest) | **NOT EXECUTED** | Device artifact pending |
| `HIS-003` | History | Transaction History Filter by Service & Date | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `SUP-001` | Support | Create Support Ticket with Category & Details | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `SUP-002` | Support | List Active Support Tickets & Ticket Status | **PASS** (Jest) | **NOT EXECUTED** | Staging API unreachable |
| `SUP-003` | Support | Support Escalation Contact Information View | **PASS** (Jest) | **NOT EXECUTED** | Device artifact pending |
| `OPS-001` | Operations | Physical Cash Note Counting & Cashier Vaulting | **PASS** (Contract) | **NOT EXECUTED** | Human / Operational action |
| `OPS-002` | Operations | Agent Float Bank Transfer & Rebalancing | **PASS** (Contract) | **NOT EXECUTED** | Human / Operational action |
| `NET-001` | Network | Offline Detection & Banner Display | **PASS** (Jest) | **NOT EXECUTED** | Physical device connectivity |
| `NET-002` | Network | Automatic Retry on Network Re-establishment | **PASS** (Jest) | **NOT EXECUTED** | Physical device connectivity |

---

## 16. Release Artifact Checklist

| Requirement | Repository Ready | External Action Required | Actual Verified Status |
|---|---|---|---|
| **DNS** | **READY** | Configure A-record for `staging-api.monienaija.ng` | **BLOCKED** (`ENOTFOUND`) |
| **HTTPS/TLS** | **READY** | Provision Let's Encrypt TLS certificate on reverse proxy | **BLOCKED** (Pending DNS resolution) |
| **Backend Deployment** | **READY** | Deploy container/process to staging server | **NOT DEPLOYED / EXTERNAL PREREQUISITE** |
| **Database** | **READY** (81 migrations) | Provision PostgreSQL 16+ instance and run migrations | **NOT DEPLOYED / EXTERNAL PREREQUISITE** |
| **Redis / Worker** | **READY** (In-process Postgres) | Enable `NOTIFICATION_WORKER_ENABLED=true` | **NOT DEPLOYED / EXTERNAL PREREQUISITE** |
| **SMS / Robase** | **READY** | Provision `ROBASE_API_KEY` (live Bearer token) | **ENVIRONMENT-BLOCKED** |
| **Branding** | **NOT AVAILABLE** | Deliver `icon.png`, `adaptive-icon.png`, `splash-icon.png` | **EXTERNAL DESIGN PREREQUISITE** |
| **Android EAS** | **READY** | Provide EAS CLI access and `eas.json` configuration | **BLOCKED** |
| **iOS / EAS** | **READY** | Configure EAS project and iOS build credentials | **BLOCKED** |
| **Apple Signing** | **NOT AVAILABLE** | Provide Apple Developer Distribution Certs & Profiles | **BLOCKED / EXTERNAL PREREQUISITE** |
| **Physical Android Device** | **READY** | Provide physical Android hardware for testing | **NOT EXECUTED** (Pending APK artifact) |
| **Physical iOS Device** | **READY** | Provide physical iPhones and TestFlight testers | **NOT EXECUTED** (Pending IPA artifact) |
| **Operational Cash** | **READY** | Cashier cash handling execution during pilot | **NOT EXECUTED / EXTERNAL PREREQUISITE** |
| **Operational Float** | **READY** | Bank transfer / float seeding for test agents | **NOT EXECUTED / EXTERNAL PREREQUISITE** |

---

## 17. Release Blockers & Owner Action Assignment

| Blocker Item | Category | Required Deliverable | Assigned Owner | Exact Action Required |
|---|---|---|---|---|
| **1. DNS Resolution** | Infrastructure | A-record for `staging-api.monienaija.ng` | **DevOps Team** | Map `staging-api.monienaija.ng` to staging host IP in authoritative DNS zone. |
| **2. SSL / Reverse Proxy** | Infrastructure | TLS reverse proxy configuration | **DevOps Team** | Configure Nginx/Caddy with Let's Encrypt certificate terminating HTTPS on port 443. |
| **3. Staging DB & Backend** | Infrastructure | Deployed PostgreSQL 16+ and NestJS API | **DevOps Team** | Deploy PostgreSQL 16+, run `npm run migration:run`, and start backend process. |
| **4. Robase SMS Credentials** | Integrations | `ROBASE_API_KEY` live bearer token | **Product / DevOps** | Obtain API key from Robase dashboard, verify sender ID, and set in staging environment. |
| **5. Mobile Branding Assets** | Design | 1024x1024 PNG icons and splash screen | **Design Team** | Export official `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png` to `apps/agent-mobile/assets/`. |
| **6. EAS Build Environment** | Mobile CI/CD | `eas.json` and Expo account auth | **Mobile Lead** | Authenticate EAS CLI (`npx eas login`), configure `eas.json`, and trigger staging builds. |
| **7. Apple Developer Signing** | Mobile Signing | Apple Distribution Certs & Profiles | **Mobile Lead / Apple Admin** | Configure Apple Developer Team ID, distribution certificate, and App Store Connect credentials in EAS. |
| **8. Physical Device UAT** | Quality Assurance | Execution of 32 UAT test lanes | **QA Lead / Field Ops** | Install staging APK on Android and TestFlight on iOS; execute UAT scenarios and record results. |
| **9. Operational Cash/Float** | Field Operations | Staging bank account and float funding | **Finance / Operations** | Seed agent test accounts with operational float balances and verify cash collection procedures. |
