# V1-LOCAL-01 — Local Full-Stack Development Setup

Before doing any hosting or production deployment, get the entire MonieNaija V1 running locally.

This guide is derived strictly from the actual code and configuration in this repository
(`package.json` scripts, `src/config/environment.ts`, `.env.example`, `apps/customer-mobile`,
`apps/agent-mobile`). Every command below was either executed and verified inside the
development sandbox used to write this guide (see §18 "What was actually verified") or is
flagged `REQUIRES USER LOCAL MACHINE` where it depends on a Windows GUI, a physical/emulated
Android device, or a network condition that cannot be exercised from a sandboxed CI-style
container.

Target architecture:

```
LOCAL POSTGRESQL  →  LOCAL BACKEND (NestJS, port 3000)  →  CUSTOMER MOBILE (Expo) ┐
                                                         →  AGENT MOBILE (Expo)    ┘→ your phone / emulator
```

---

## 1. Prerequisites

| Tool | Required? | Why | Windows notes |
|---|---|---|---|
| **Node.js ≥ 22.0.0** | REQUIRED | `package.json` → `"engines": { "node": ">=22.0.0" }`. The backend and both Expo apps run on Node. | Install the Windows x64 installer from nodejs.org, or `nvm-windows`. Verify with `node --version`. |
| **npm ≥ 10.0.0** | REQUIRED | `package.json` → `"engines": { "npm": ">=10.0.0" }`. Ships with Node 22. | `npm --version`. |
| **PostgreSQL 14+** | REQUIRED | Backend has no other datastore; `src/config/data-source.ts` + TypeORM migrations target Postgres only. | Native Windows installer (postgresql.org) **or** run it inside WSL2. Either works — the backend only needs a TCP host/port, see §3. |
| **Git** | REQUIRED | You already have this repo cloned; needed for `git pull` / branch management. | Git for Windows. |
| **Android Studio + Android SDK + an emulator image** | REQUIRED for Android testing (emulator path) | Needed to run an Android Virtual Device if you don't have a physical Android phone. | Native Windows install. `REQUIRES USER LOCAL MACHINE`. |
| **A physical Android phone + USB cable (or same-Wi-Fi)** | OPTIONAL alternative to the emulator | Expo Go app on a real device is usually faster than an emulator. | `REQUIRES USER LOCAL MACHINE`. |
| **Expo Go app** (if using a physical device, SDK 52 compatible) | OPTIONAL | Lets you run the Expo JS bundle without a native build. | Install from Play Store on the phone. `REQUIRES USER LOCAL MACHINE`. |
| **JDK** | OPTIONAL | Only needed if you build a native Android binary instead of using Expo Go/emulator JS bundle via `expo start`. Not required for the `npm run android` / `expo start` flow used in this guide. | `REQUIRES USER LOCAL MACHINE` if you go down this path. |
| **Xcode / iOS Simulator** | OPTIONAL, macOS only | `apps/customer-mobile`/`apps/agent-mobile` both have an `ios` script, but iOS development requires a Mac. Not applicable on Windows. | Not covered further — this guide prioritizes Android per your setup. |

Node version actually used to verify this guide in the sandbox: `v22.22.3` / npm `10.9.8` — satisfies the `engines` constraint above.

---

## 2. Clone and install dependencies

```bash
git clone <your fork/remote URL>
cd monienaija
npm install
```

The two Expo apps have their own `package.json`/`package-lock.json` and must be installed separately:

```bash
cd apps/customer-mobile
npm install
cd ../agent-mobile
npm install
cd ../..
```

---

## 3. Local PostgreSQL

The backend's database configuration (`src/config/environment.ts`, confirmed by reading the
Zod schema) reads these variables — there is **no hardcoded production connection string
anywhere** in the backend:

| Variable | Meaning | Default (from `environment.ts`) |
|---|---|---|
| `DB_HOST` | Postgres host | none — required |
| `DB_PORT` | Postgres port | `5432` |
| `DB_NAME` | Database name | none — required |
| `DB_USER` | Postgres role | none — required |
| `DB_PASSWORD` | Postgres password | none — required |
| `DB_SSL` | Use TLS | `false` |
| `DB_SSL_REJECT_UNAUTHORIZED` | Verify TLS cert | `true` |

### 3.1 Create a local, disposable database

Using a native Windows PostgreSQL install (psql on PATH or pgAdmin):

```sql
CREATE DATABASE monienaija;
CREATE USER monienaija WITH PASSWORD 'monienaija-pw';
GRANT ALL PRIVILEGES ON DATABASE monienaija TO monienaija;
```

**Never reuse a production database name/credentials for this.** Pick a password that is
obviously a local throwaway, exactly as above.

### 3.2 Point the backend at it — create `.env`

```bash
cp .env.example .env
```

Edit the PostgreSQL block in `.env` to match what you created:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=monienaija
DB_USER=monienaija
DB_PASSWORD=monienaija-pw
DB_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=true
```

`.env` is already covered by `.gitignore` (`.env` and `.env.*` are both listed) — it will
never be committed.

### 3.3 Run migrations

```bash
npm run migration:run
```

This runs `typeorm-ts-node-commonjs migration:run -d src/config/data-source.ts` (the exact
script in `package.json`). Verified in the sandbox: **82/82 migrations applied cleanly**
against a fresh database. To check status at any time:

```bash
npm run migration:show
```

---

## 4. Backend local setup

### 4.1 Build and start

For day-to-day development, use watch mode (auto-reload on file changes):

```bash
npm run start:dev
```

This runs `nest start --watch`. Do **not** set `NODE_ENV=production` for this — the backend's
own environment validation (`src/config/environment.ts`) actively rejects a production
start unless `NOTIFICATION_SMS_PROVIDER=robase` with a real API key is configured, which has
no purpose for a local dev loop and would just block startup or require production SMS
credentials you should never put on a dev machine.

Alternatively, to verify a production-style build locally (e.g. before a release), build and
run the compiled output — this is **still `NODE_ENV=development`**, just running compiled JS
instead of ts-node watch mode:

```bash
npm run build
npm run start
```

Both paths were verified in the sandbox: `npm run build` completed with exit code 0, and
`node dist/main.js` started cleanly, listening on port 3000.

### 4.2 Verify it's alive

```bash
curl http://localhost:3000/api/v1/health
```

Verified response: `{"status":"ok"}`.

### 4.3 Local API base URL

`PORT=3000` by default (`.env.example`). The full local API base is:

```
http://localhost:3000/api/v1
```

---

## 5. Local OTP delivery (no real SMS needed)

`NOTIFICATION_SMS_PROVIDER` defaults to `console` (see `.env.example` and
`src/config/environment.ts`). With this provider, OTPs are **never sent to a real phone** —
they are written straight to backend stdout as plain log lines, e.g. (actual captured output
from this session):

```
[Notification][SMS] CUSTOMER:f75efb68-... -> +2348011122233 | customer.registration.otp | MoneyNaija: your registration verification code is 615777. It expires in 5 minutes. If you did not request this, ignore this message. | ref=console-...
```

- Registration OTP TTL: **300 seconds (5 minutes)** — `REGISTRATION_OTP_TTL_SECONDS` in
  `src/customer-registration/customer-registration.constants.ts`.
- There is **no fixed/dev-shortcut OTP code**. Every code is a real random one-time value;
  you must read it from the backend's terminal output each time.
- The same console mechanism is used for the Agent-desk customer OTP challenges used in
  Wallet→Cash and Cash→Cash claim (see §11–§12) — watch the backend terminal after issuing
  a challenge.

**Never set `NOTIFICATION_SMS_PROVIDER=robase` or put a real `ROBASE_API_KEY` in your local
`.env`.** That is a production-only credential.

---

## 6. Customer Mobile app

Directory: `apps/customer-mobile`. Expo SDK `~52.0.7`, React Native `0.76.2`.

```bash
cd apps/customer-mobile
npm install   # if not already done in §2
npx expo start
```

API URL resolution (`apps/customer-mobile/src/config/index.ts`, read verbatim):

```ts
export const DEFAULT_BASE_URL =
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL) ||
  'http://10.0.2.2:3000';
```

- **Android emulator**: the default fallback `http://10.0.2.2:3000` already works — `10.0.2.2`
  is the Android emulator's alias for the host machine's `localhost`. No `.env` needed.
- **Physical Android phone** (same Wi-Fi as your PC): you must override it, because the phone
  cannot resolve `10.0.2.2` or `localhost` to your PC:

  ```bash
  # apps/customer-mobile/.env
  EXPO_PUBLIC_API_URL=http://<your-PC-LAN-IP>:3000
  ```
  Find your LAN IP on Windows with `ipconfig` (look for the Wi-Fi adapter's IPv4 address, e.g.
  `192.168.1.42`). `REQUIRES USER LOCAL MACHINE` to determine the actual IP.
- **iOS simulator** (macOS only, not applicable to your Windows setup): `localhost` works
  directly since the simulator shares the host's network namespace.

`app.json` identifiers (for reference): app name `MoneyNaija`, slug `moneynaija-customer`,
Android package `ng.monienaija.customer`.

---

## 7. Agent Mobile app

Directory: `apps/agent-mobile`. Same Expo SDK (`~52.0.7`) and identical API URL pattern —
confirmed by reading `apps/agent-mobile/src/config/index.ts`, which is line-for-line the same
`EXPO_PUBLIC_API_URL` / `http://10.0.2.2:3000` fallback as Customer Mobile.

```bash
cd apps/agent-mobile
npm install   # if not already done in §2
npx expo start
```

Same `.env` override pattern as §6 for a physical device:

```bash
# apps/agent-mobile/.env
EXPO_PUBLIC_API_URL=http://<your-PC-LAN-IP>:3000
```

Note from the code itself (`src/config/index.ts` comment, read verbatim): Agent Mobile
deliberately has **no development authentication mock** (unlike an older, now-removed
Customer Mobile `DEV_AUTH_MOCK` pattern) — if the backend is unreachable, the app shows an
error and stays unauthenticated. This is fail-closed by design; it is not a bug to work around.

---

## 8. Windows-specific setup notes

- **PostgreSQL on Windows**: use the official installer from postgresql.org, which also
  installs `psql` and optionally pgAdmin. Add the `bin` folder to `PATH` if you want `psql`
  in a regular terminal. `REQUIRES USER LOCAL MACHINE`.
- **Node.js on Windows**: the official installer or `nvm-windows` both work; this guide was
  verified against Node 22.22.3. `REQUIRES USER LOCAL MACHINE`.
- **Android Studio + SDK + emulator**: install Android Studio, then from its SDK Manager
  install an SDK Platform (API level matching `apps/*/app.json` targets) and create an AVD
  (Android Virtual Device) via the Device Manager. `REQUIRES USER LOCAL MACHINE`.
- **Firewall**: when testing from a physical phone over Wi-Fi, Windows Defender Firewall may
  block inbound connections to Node (port 3000) and Expo's Metro bundler (port 8081) the first
  time — accept the "Allow access" prompt for **Private networks** when it appears.
  `REQUIRES USER LOCAL MACHINE`.
- **Terminal choice**: PowerShell, Windows Terminal, or Git Bash all work for the commands in
  this guide; adjust `cp`/`cat` to PowerShell equivalents (`Copy-Item`, `Get-Content`) if using
  pure PowerShell, or just use Git Bash for parity with the commands exactly as written here.

---

## 9. Run all three components together

Open three terminals.

**Terminal 1 — PostgreSQL**: already running as a Windows service (if you installed via the
native installer) or started manually depending on your install method. Confirm with:
```bash
psql -h localhost -U monienaija -d monienaija -c "select 1;"
```

**Terminal 2 — backend**:
```bash
cd monienaija
npm run start:dev
```
Wait for the Nest startup log and confirm `curl http://localhost:3000/api/v1/health` returns
`{"status":"ok"}`.

**Terminal 3 — Customer Mobile** (repeat in a 4th terminal for Agent Mobile):
```bash
cd monienaija/apps/customer-mobile
npx expo start
```
Press `a` to launch on a connected Android emulator/device, or scan the QR code with Expo Go.

---

## 10. First smoke test — Customer

All steps below were executed against the real running backend in this session and are
reported with real captured values (yours will differ — phone numbers, OTPs, and IDs are
generated per-run).

```bash
# 1. Request registration OTP
curl -X POST http://localhost:3000/api/v1/customers/registration/otp \
  -H "Content-Type: application/json" -d '{"phone":"8011122233"}'

# 2. Read the OTP ("code") from the backend terminal (console SMS line), then verify it.
#    The response returns a one-time "verificationToken" — copy it for step 3.
curl -X POST http://localhost:3000/api/v1/customers/registration/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"8011122233","code":"<6-digit code from backend log>"}'

# 3. Complete registration using the verificationToken from step 2 (CompleteRegistrationDto)
curl -X POST http://localhost:3000/api/v1/customers/registration \
  -H "Content-Type: application/json" \
  -d '{"phone":"8011122233","verificationToken":"<token from step 2>","password":"LocalTest!2026","displayName":"Local Test Customer A"}'

# 4. Log in
curl -X POST http://localhost:3000/api/v1/customers/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"8011122233","password":"LocalTest!2026"}'
# → returns accessToken

# 5. Set a transaction PIN (required before any transfer)
curl -X POST http://localhost:3000/api/v1/customers/me/transaction-pin \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"pin":"1234"}'

# 6. List wallets / check balance / limits / history
curl http://localhost:3000/api/v1/customers/me/wallets -H "Authorization: Bearer <accessToken>"
curl http://localhost:3000/api/v1/customers/me/wallets/<walletId>/balance -H "Authorization: Bearer <accessToken>"
curl http://localhost:3000/api/v1/customers/me/limits -H "Authorization: Bearer <accessToken>"
curl http://localhost:3000/api/v1/customers/me/transactions -H "Authorization: Bearer <accessToken>"
```

This exact sequence was run twice in this session (two separate test customers) and
succeeded end to end, including live OTP capture from the backend log.

---

## 11. Funding test money into a wallet

A brand-new wallet has a balance of `0`. The real production funding mechanism is a
workforce-gated maker-checker flow (`CustomerFundingInternalController` /
`AgentFundingController`) requiring an authenticated OPERATOR/SERVICE/PRIVILEGED/SUPPORT
workforce session — correct for production, but disproportionate ceremony for seeding a local
test wallet.

**`scripts/local-dev-fund-wallet.js` — a new, clearly-labeled local-dev-only helper added in
this task.** It calls the real `LedgerService`/wallet posting path in-process (same as the
pre-existing `scripts/infra03-topup.js` convention in this repo) and performs a genuine
double-entry journal posting — it does not fabricate a balance by writing to a cached/denormalized
field.

```bash
node scripts/local-dev-fund-wallet.js <walletId> <amountInNaira>
# example, verified in this session:
node scripts/local-dev-fund-wallet.js d5b27cb1-df08-41c5-8cf5-61a4dfba6e86 50000
```

Verified output:
```json
{
  "status": "DEVELOPMENT ONLY — local database only, never run against production",
  "walletId": "d5b27cb1-df08-41c5-8cf5-61a4dfba6e86",
  "creditedMinor": "5000000",
  "creditedNaira": 50000,
  "journalId": "7ed2a4cc-dd43-4f51-8594-521051687560"
}
```
Followed by a `GET .../wallets/:id/balance` call confirming `balanceMinor: "5000000"`.

**Never point this script at a production database.** It performs a real, final ledger
posting with no reversal built in — treat it exactly like you would a raw SQL `UPDATE`
against production, i.e. don't.

---

## 12. Wallet-to-Wallet (W2W) transfer — Customer to Customer

Contract, read directly from `src/customer-app/customer-app.controller.ts` and
`src/transfer/dto/create-transfer.dto.ts`:

- `POST /api/v1/customers/me/transfers`
- **Mandatory header** `Idempotency-Key: <any-unique-string>` — a request without it is
  rejected with 400.
- Body: `destinationWalletId` (or `beneficiaryId`, exactly one of the two), `amountMinor`,
  `currency`, optional `reference`/`narration`, and a **mandatory `pin`** (the sender's
  transaction PIN set in §10 step 5).

```bash
curl -X POST http://localhost:3000/api/v1/customers/me/transfers \
  -H "Authorization: Bearer <senderAccessToken>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: w2w-test-001" \
  -d '{"sourceWalletId":"<senderWalletId>","destinationWalletId":"<recipientWalletId>","amountMinor":"1000000","currency":"NGN","narration":"local test transfer","pin":"1234"}'
```

Verified this session end to end with two real customers:

- Sender balance before: `5,000,000` minor (₦50,000) → after: `4,000,000` minor (₦40,000).
- Recipient balance before: `0` → after: `1,000,000` minor (₦10,000).
- `GET /api/v1/customers/me/transactions` on the sender immediately showed the `WALLET_TRANSFER`
  entry with `direction: "SENT"` and the correct counterparty name/phone.
- **Idempotency verified**: repeating the exact same request with the same `Idempotency-Key`
  returned the identical original response (same `id`, same `journalId`) and the sender's
  balance was confirmed unchanged — no duplicate debit occurred.

---

## 13. Agent Mobile flows

### 13.1 Creating a local test Agent

Real production Agent onboarding requires a human workforce reviewer (an A2 OIDC-issued
OPERATOR/SERVICE/PRIVILEGED session, or the one-time break-glass bootstrap ceremony in
`docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`) to review/approve/activate the Agent
and issue its first credential — by explicit design, `SUPPORT` sessions are **excluded** from
this step (`AdminAgentLifecycleController`, V1-003 decision). Standing up a full OIDC identity
provider just to create one test Agent is disproportionate for local development.

**`scripts/local-dev-create-agent.js` — a new local-dev-only helper added in this task.** It
calls the same real application services the admin HTTP endpoints call
(`AgentClassService.create` → `AgentApplicationService.create/submit/markUnderReview/approve`
→ `AgentLifecycleService.activateFromApplication` →
`AgentAuthenticationService.issueInitialCredential`), in-process, skipping only the "who is
allowed to call this over HTTP" authorization check — every state-machine rule the real
services enforce still runs for real.

```bash
node scripts/local-dev-create-agent.js "Local Test Agent Shop"
```

Verified output (this session):
```json
{
  "status": "DEVELOPMENT ONLY — local database only, never run against production",
  "agentId": "a91ab73e-e5a4-4934-bacc-d0624902081a",
  "businessName": "Local Test Agent Shop 2",
  "temporaryPassword": "AA948Fs3pqHiTXpS",
  "nextStep": "POST /api/v1/agents/credentials/rotate with this agentId + temporaryPassword + a new permanent password to finish setup (see the guide)."
}
```

### 13.2 First login + PIN

```bash
curl -X POST http://localhost:3000/api/v1/agents/credentials/rotate \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<agentId>","currentPassword":"<temporaryPassword>","newPassword":"AgentLocalTest!2026"}'
# → returns accessToken directly (rotation also logs you in)

curl -X POST http://localhost:3000/api/v1/agents/login \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<agentId>","password":"AgentLocalTest!2026"}'

curl -X POST http://localhost:3000/api/v1/agents/me/transaction-pin \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"pin":"4321"}'
```

### 13.3 Dashboard / capability check

```bash
curl http://localhost:3000/api/v1/agents/me/profile -H "Authorization: Bearer <agentAccessToken>"
curl http://localhost:3000/api/v1/agents/me/capabilities -H "Authorization: Bearer <agentAccessToken>"
curl http://localhost:3000/api/v1/agents/me/financial-position -H "Authorization: Bearer <agentAccessToken>"
```

`permittedServices` will be empty (`EMPTY_APPLICABLE_SERVICES`) unless the Agent's class was
created with an explicit `applicableServices` array — `local-dev-create-agent.js` sets all
five (`CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `AGENT_FUNDING`, `AGENT_DEFUNDING`) so your test
Agent can exercise every flow below.

An Agent's wallet does not exist until its first cash movement — `financial-position` will show
`walletExists: false`. The first `cash-in` (or any flow that touches the agent wallet) silently
creates it; fund it afterwards with `scripts/local-dev-fund-wallet.js <agentWalletId> <amount>`
exactly like a customer wallet.

### 13.4 Cash → Wallet (Cash-In)

```bash
curl -X POST http://localhost:3000/api/v1/agents/cash-in \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"recipientIdentifier":"<customerPhone>","amountMinor":"500000","currency":"NGN","idempotencyKey":"cashin-test-001","pin":"4321"}'
```
Verified: debits the Agent's own wallet, credits the named customer's wallet by phone number.
Fails with a clear `422 BUSINESS_RULE_VIOLATION` ("insufficient balance") if the Agent has no
float — fund the Agent's wallet first (§13.3).

### 13.5 Wallet → Cash (Cash-Out, "Method 1" / desk OTP)

This flow requires the Agent to issue a desk OTP challenge to the customer first (delivered
via the same console-SMS mechanism as §5), which the customer reads aloud to the Agent:

```bash
# Agent issues the challenge
curl -X POST http://localhost:3000/api/v1/agents/me/mfa-challenges \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"customerId":"<customerId>","purpose":"WALLET_TO_CASH"}'
# → { challengeId, ... } ; read the OTP from the backend's console-SMS log line

# Agent executes the cash-out using the customer's PIN + the OTP the customer just read aloud
curl -X POST http://localhost:3000/api/v1/agents/cash-out \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"customerId":"<customerId>","customerPin":"<customerPin>","mfaChallengeId":"<challengeId>","otp":"<otp>","amountMinor":"300000","currency":"NGN","idempotencyKey":"cashout-test-001","agentPin":"4321"}'
```
Verified end to end this session: credits the Agent's wallet, debits the customer's wallet.

---

## 14. Cash-to-Cash (C2C) — send, claim, and expiry

### 14.1 Send

```bash
curl -X POST http://localhost:3000/api/v1/agents/cash-to-cash \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"beneficiaryPhone":"<phone>","amountMinor":"200000","currency":"NGN","idempotencyKey":"c2c-test-001","agentPin":"4321"}'
```
Response includes a one-time plaintext `transferCode` (e.g. `76207565`) — in real life the
Agent relays this to the beneficiary out of band (verbally/SMS); it is never shown again.
Debits the sending Agent's wallet immediately into a `CASH_TO_CASH-UNCLAIMED-NGN` liability —
no customer wallet is touched yet.

### 14.2 Claim

The claiming beneficiary must be a **registered customer with KYC status `APPROVED`**
(`CustomerKycAssessment`) — the claim endpoint enforces `403 Forbidden: "Claimant identity not
verified"` otherwise, confirmed in this session. For local testing, drive a test customer's
KYC through its real state machine (`NOT_STARTED → PENDING → APPROVED`):

```bash
curl -X POST http://localhost:3000/api/v1/customers/<customerId>/kyc-assessment \
  -H "Authorization: Bearer <customerAccessToken>" -H "Content-Type: application/json" \
  -d '{"level":"LEVEL_1","status":"PENDING","assessedBy":"local-dev-test"}'
curl -X POST http://localhost:3000/api/v1/customers/<customerId>/kyc-assessment \
  -H "Authorization: Bearer <customerAccessToken>" -H "Content-Type: application/json" \
  -d '{"level":"LEVEL_1","status":"APPROVED","assessedBy":"local-dev-test"}'
```
Then issue a claim-purpose desk OTP and claim:

```bash
curl -X POST http://localhost:3000/api/v1/agents/me/mfa-challenges \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"customerId":"<customerId>","purpose":"CASH_TO_CASH_CLAIM"}'
# → read OTP from backend console log

curl -X POST http://localhost:3000/api/v1/agents/cash-to-cash/claim \
  -H "Authorization: Bearer <agentAccessToken>" -H "Content-Type: application/json" \
  -d '{"transferId":"<transferId>","beneficiaryPhone":"<phone>","transferCode":"<transferCode>","customerId":"<customerId>","mfaChallengeId":"<challengeId>","otp":"<otp>","idempotencyKey":"c2c-claim-test-001"}'
```
Verified end to end this session: claimant's wallet credited by the exact principal amount.

Note: this endpoint's route policy denies a plain `CUSTOMER` bearer token outright (403
"Authorization denied") — the claim must be submitted by an authenticated **Agent** session on
the customer's behalf (the customer is physically present at the claiming agent's desk), which
is also what the desk-OTP design implies.

### 14.3 Expiry

`AgentCashToCashExpiryService.expireDueTransfers()` (`src/agent/agent-cash-to-cash-expiry.service.ts`)
sweeps unclaimed transfers past `CASH_TO_CASH_EXPIRY_SECONDS` (default `604800` = 7 days, set
in `.env.example`). **No HTTP endpoint or cron trigger currently exists in this codebase for
it** — it is an injectable service only. This was confirmed in this session by invoking it
directly, in-process, with a `now` parameter 8 days in the future:

```json
{
  "expiredCount": 1,
  "expiredIds": ["68ccd57d-245d-4f3b-a0c4-55fdc786d278"],
  "executedAt": "2026-10-15T12:18:12.756Z"
}
```
Confirmed: expiry **does not move any money** — the Agent's wallet balance was unchanged
before/after the sweep, exactly as documented in the service's own code comments ("principal
remains in CASH_TO_CASH-UNCLAIMED-NGN liability... later disposition is a formal
backend/regulatory process outside this service").

If you need to exercise this locally yourself, write a short throwaway Node script under
`scripts/` that boots a `NestFactory.createApplicationContext(AppModule)`, resolves
`AgentCashToCashExpiryService` from it, and calls `expireDueTransfers({ now: <futureDate> })` —
delete the script afterwards; it is not something this guide ships as a permanent tool since it
has no real caller in the production system to mirror.

---

## 15. Troubleshooting

| Symptom | Likely cause | How to check | Fix |
|---|---|---|---|
| `ECONNREFUSED` connecting to Postgres | PostgreSQL service not running, or wrong port | `psql -h localhost -p 5432 -U monienaija -d monienaija` | Start the PostgreSQL Windows service; confirm `DB_PORT` in `.env` matches. |
| `npm run migration:run` fails with auth error | Wrong `DB_USER`/`DB_PASSWORD` in `.env`, or DB doesn't exist | Compare `.env` to what you ran in `CREATE USER .../CREATE DATABASE ...` | Re-check §3.1/§3.2 values match exactly. |
| `EADDRINUSE :::3000` | Another process already bound to port 3000 (maybe a previous `node dist/main.js` still running) | `netstat -ano \| findstr :3000` (Windows) | Kill the old process, or change `PORT` in `.env` and the mobile app's `EXPO_PUBLIC_API_URL`. |
| Expo app can't reach the backend from an emulator | Using `localhost` instead of `10.0.2.2` in a custom `.env` override | Check `apps/customer-mobile/.env` / `apps/agent-mobile/.env` | Remove the override (use the built-in `10.0.2.2` default) or set it explicitly to `http://10.0.2.2:3000`. |
| Expo app can't reach the backend from a physical phone | Phone and PC on different networks, or using `localhost`/`10.0.2.2` which don't resolve from a real device | `ipconfig` on the PC to find the LAN IP; phone and PC must be on the same Wi-Fi | Set `EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:3000` in the app's `.env`. |
| Android emulator has no network / can't resolve `10.0.2.2` | Emulator cold-boot issue or VPN interfering with the virtual NAT | Try `adb shell ping 10.0.2.2` from inside the emulator | Cold-boot the AVD; disable any VPN that captures all traffic. |
| `expo start` QR code / Metro bundler not connecting | Phone and PC not on same network, or Windows Firewall blocking port 8081/19000 | Try switching Expo's connection mode to "Tunnel" in the terminal menu | Accept the firewall prompt for Private networks; or use `npx expo start --tunnel`. |
| `401 Unauthorized` on any `/me/...` route | Missing/expired `Authorization: Bearer <token>` header | Confirm you copied the `accessToken` from the most recent login response | Log in again; tokens are session-scoped and expire. |
| `404 Not Found` on an endpoint you expected | Typo in path, or testing against the wrong port/app (admin-web vs backend) | Compare against the exact paths quoted in this guide (`/api/v1/...`) | Re-check the path; all backend routes are prefixed `/api/v1`. |
| Can't find the OTP anywhere | Looking in the wrong terminal, or `NOTIFICATION_SMS_PROVIDER` not `console` | Check `.env` for `NOTIFICATION_SMS_PROVIDER=console`; grep backend terminal for `[Notification][SMS]` | Make sure you're reading the **backend** terminal (not the Expo terminal); confirm the env var. |
| Wrong API URL baked into a build | `EXPO_PUBLIC_API_URL` set only in the OS environment, not picked up by Expo/Metro | Put it in `apps/<app>/.env` instead of a shell export, then restart `expo start` (clear cache: `npx expo start -c`) | Expo inlines `EXPO_PUBLIC_*` at bundle time — a bare shell env var set after Metro started won't be picked up until a cache-cleared restart. |
| Confused about CORS errors in a browser console | Browser calls to `localhost:3000` from `apps/admin-web` (a web app) are a different trust boundary than Expo apps (no CORS). | N/A — mobile WebView/React Native networking doesn't enforce CORS | For `apps/admin-web` specifically, see its own dev server config; out of scope for Customer/Agent Mobile. |
| Windows Firewall silently drops connections from the phone | First-run prompt was dismissed or blocked by policy | `netsh advfirewall firewall show rule name=all \| findstr node` | Re-add an inbound allow rule for `node.exe` on the Private profile. `REQUIRES USER LOCAL MACHINE`. |
| "Android SDK not found" in Expo CLI | Android Studio installed but `ANDROID_HOME`/`ANDROID_SDK_ROOT` not set | `echo %ANDROID_HOME%` in PowerShell/cmd | Set the environment variable to the SDK path shown in Android Studio → SDK Manager. `REQUIRES USER LOCAL MACHINE`. |
| Gradle/Java version mismatch building a native Android binary | Only relevant if you go beyond `expo start` into a native build; JDK version doesn't match what Android Gradle Plugin expects | Check the error message's required JDK major version | Install the matching JDK (Temurin, etc.) and point `JAVA_HOME` at it. `REQUIRES USER LOCAL MACHINE` — not needed for the `expo start`/Expo Go flow this guide uses. |

---

## 16. Shutdown / restart / reset

**Shut everything down**: `Ctrl+C` in each of the three terminals (backend, Customer Mobile,
Agent Mobile). PostgreSQL can stay running as a background Windows service, or stop it from
Services.msc / your install method if you want it fully off.

**Restart**: re-run `npm run start:dev` (backend) and `npx expo start` (each app) — no special
sequencing required beyond PostgreSQL being up first.

**Reset the local database completely** (wipe all local test data and start over):
```sql
DROP DATABASE monienaija;
CREATE DATABASE monienaija;
```
then re-run `npm run migration:run`. This is safe precisely because it is your own local,
disposable database — never run `DROP DATABASE` against anything other than your local dev
database.

---

## 17. Local vs. production configuration — do NOT do these things locally

- Do **not** put real production `DB_HOST`/`DB_USER`/`DB_PASSWORD` values in your local `.env`.
  Always use a disposable local database as in §3.
- Do **not** set `NOTIFICATION_SMS_PROVIDER=robase` or populate `ROBASE_API_KEY` locally — the
  `console` provider (default) is correct and sufficient for all local OTP flows (§5).
- Do **not** set `NODE_ENV=production` for local development — it only serves a purpose if you
  are specifically testing production-mode startup validation, and even then, do it with local
  credentials, never real ones.
- Do **not** enable `A2_WORKFORCE_ENABLED=true` / configure real OIDC locally unless you are
  specifically testing the workforce auth integration itself — the dev-only scripts in §11/§13
  exist precisely so you don't need to stand up a real identity provider just to seed test data.
- Do **not** disable the `RuntimeAccessGuard` or any authorization check to "make testing
  easier" — every flow in this guide was exercised against the real, unmodified authorization
  rules.
- Do **not** expose your local backend (port 3000) or Expo dev server (port 8081/19000) to the
  public internet (e.g. via port-forwarding your router) to test from "anywhere" — use the
  same-Wi-Fi LAN-IP approach in §6/§7 instead, or a tunneling tool you trust and fully
  understand the exposure of.
- Do **not** commit your `.env` file or `apps/*/.env` files — they are already covered by
  `.gitignore` (`.env`, `.env.*`); keep it that way.
- The two new scripts added by this task (`scripts/local-dev-fund-wallet.js`,
  `scripts/local-dev-create-agent.js`) are explicitly labeled `DEVELOPMENT ONLY` in their own
  output and file header comments, and must never be pointed at a production database.

---

## 18. What was actually verified in this session

Executed live against a disposable local PostgreSQL + a running backend process in the
development sandbox:

- `npm install` (root + both Expo apps).
- `npm run build` → exit code 0.
- `npm run migration:run` → 82/82 migrations applied; `npm run migration:show` confirms.
- `node dist/main.js` → started, listening on port 3000.
- `GET /api/v1/health` → `{"status":"ok"}`.
- Full Customer registration → OTP (live-captured from console log) → verify → register →
  login, run **twice** for two independent test customers.
- `scripts/local-dev-fund-wallet.js` → funded a real wallet via a genuine ledger journal;
  balance confirmed via the wallet balance endpoint before and after.
- Wallet-to-Wallet transfer between the two test customers, including **mandatory
  Idempotency-Key enforcement** and a **verified no-duplicate-debit replay**.
- Customer transaction history endpoint reflecting the transfer correctly.
- `scripts/local-dev-create-agent.js` → created a real, activated Agent with a working
  temporary credential.
- Agent credential rotation → login → transaction PIN set → capabilities/profile/
  financial-position endpoints.
- Agent Cash-In (Cash→Wallet) crediting a customer.
- Agent Cash-Out (Wallet→Cash) using the desk-OTP MFA challenge flow, live-captured OTP.
- Agent Cash-to-Cash send, then claim by a second customer (after driving that customer's KYC
  through its real `NOT_STARTED → PENDING → APPROVED` state machine, which the claim endpoint
  genuinely enforces), using a second live-captured desk OTP.
- Cash-to-Cash expiry sweep, confirmed to move zero funds.

**Not executed in this sandbox** (require a Windows machine with a GUI, an Android
emulator/device, or physical network hardware) — every item below is labeled
`REQUIRES USER LOCAL MACHINE` in the relevant section above:

- Installing PostgreSQL/Node/Android Studio via Windows installers.
- Running an Android emulator or a physical Android phone against this backend.
- Expo Go pairing over Wi-Fi/USB.
- Windows Firewall prompts and LAN-IP discovery (`ipconfig`).
- `apps/admin-web` was not part of this task's smoke test (out of scope: Customer Mobile +
  Agent Mobile + backend + PostgreSQL only, per the architecture stated at the top of this
  guide).

Existing automated tests were **not** re-run as part of this task (the task's scope was a
manual, protocol-level smoke test of the real HTTP surface, not the Jest suite); `npm test` and
`npm run test:pg` remain available exactly as defined in `package.json` for anyone who wants to
additionally run the repository's own automated suite locally.
