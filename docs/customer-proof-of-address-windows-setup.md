# Secure Proof of Address uploads — Windows setup and manual test

This guide covers local development on Windows for the secure Proof of Address (PoA) upload
backend and Customer 360° screen. The local filesystem adapter is restricted to `development` and
`test`; it is not a production storage configuration. Use only synthetic documents and a dedicated
local database. **Never use production customer documents, a shared database, or production secrets
for this test.**

> The PowerShell/WSL commands below are code-derived setup instructions. They were not executed on a
> physical Windows host in this development environment; validate them on a disposable local setup
> before using them operationally.

The feature remains disabled by default. Uploads must not be enabled until migration 0094, the
private local paths/ACLs, the persistent encryption key file, and the ClamAV daemon are ready.

## 1. Prerequisites

- Windows 10/11, PowerShell 7+, Git, Node.js 22 or later, and npm 10 or later.
- PostgreSQL installed locally, with a **dedicated disposable development database**. The repo's
  general Windows/PostgreSQL steps are in
  [`V1/V1-LOCAL-01-LOCAL-DEVELOPMENT-SETUP.md`](V1/V1-LOCAL-01-LOCAL-DEVELOPMENT-SETUP.md).
- WSL 2 with Ubuntu for a local `clamd` service (or another locally managed ClamAV daemon that
  accepts the clamd TCP protocol on loopback port 3310).
- A workforce test account with the PoA function scopes required for each action. The backend is
  authoritative; UI visibility is not a substitute for API authorization.

From the repository root, install the backend dependencies:

```powershell
npm ci
```

Install Admin Web dependencies separately:

```powershell
Push-Location apps/admin-web
npm ci
Pop-Location
```

## 2. Create and protect local private-storage paths

Keep both the encrypted object directory and encryption key outside the repository. The backend's
local adapter writes encrypted envelopes—not plaintext files—but Windows ACLs still need to prevent
other local users from reading either the objects or key.

```powershell
$poaRoot = Join-Path $env:LOCALAPPDATA 'MonieNaija\private-poa'
$objectsRoot = Join-Path $poaRoot 'objects'
New-Item -ItemType Directory -Force -Path $objectsRoot | Out-Null

$devAccount = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls.exe $poaRoot /inheritance:r /grant:r `
  "$($devAccount):(OI)(CI)F" `
  'SYSTEM:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply private PoA directory ACLs.' }
```

The developer account above must be the identity that runs the backend. If running the app as a
Windows service, grant the service identity instead. The Node implementation skips POSIX mode-bit
checks on Windows, so the NTFS ACL is the local protection boundary.

The encryption key file is created on the first successful local encryption if it does not exist
and the database confirms that no encrypted PoA objects already exist. The file begins with the
`MNPOA-KEY-V1` format marker and stores the active version plus a 32-byte base64 key. **Do not
manually replace, delete, commit, or casually move it.** Back it up under the same access controls.
If stored encrypted objects exist but the key file is missing, startup of the encryption operation
fails rather than generating a new key. Losing the key without a backup makes those objects
unreadable.

## 3. Install and expose ClamAV locally

Install WSL 2 and Ubuntu from an elevated PowerShell window if WSL is not already installed, then
restart Windows if prompted:

```powershell
wsl --install -d Ubuntu-24.04
```

In the Ubuntu shell, install ClamAV and update its signatures:

```bash
sudo apt-get update
sudo apt-get install -y clamav clamav-daemon
sudo service clamav-freshclam stop || true
sudo freshclam
```

Configure the daemon to listen only on loopback TCP port 3310. In
`/etc/clamav/clamd.conf`, ensure these two active (not commented) lines exist, with no conflicting
active `TCPSocket` or `TCPAddr` lines:

```text
TCPSocket 3310
TCPAddr 127.0.0.1
```

Then start/restart the daemon:

```bash
sudo service clamav-daemon restart
sudo service clamav-daemon status
```

From Windows PowerShell, check WSL localhost forwarding and the listener:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3310
```

`TcpTestSucceeded` must be `True`. Keep the daemon bound to loopback; do not expose port 3310 to a
LAN or the public internet. If WSL's localhost forwarding is not enabled in your Windows/WSL
configuration, configure a local-only port forward or use a locally managed ClamAV daemon, then
verify this same connection test before enabling uploads.

A missing, timed-out, infected, or otherwise non-clean scanner result must not make a document
available. It is quarantined/fails closed. Quarantined records do not have a manual “approve” or
“release” action in this workflow; use a new clean replacement submission after resolving the
scanner problem.

## 4. Configure the backend for local development

Use the root `.env` (ignored by Git) or process-scoped PowerShell variables. Preserve your existing
local database settings, and ensure they point to the dedicated disposable database—not a shared or
production database. The PoA values below are the exact local defaults from `.env.example`; paths
use forward slashes for `.env` compatibility.

```dotenv
NODE_ENV=development
POA_UPLOADS_ENABLED=false
POA_MAX_UPLOAD_BYTES=10485760
POA_STORAGE_PROVIDER=local
POA_LOCAL_STORAGE_ROOT=C:/Users/<your-user>/AppData/Local/MonieNaija/private-poa/objects
POA_ENCRYPTION_KEY_FILE=C:/Users/<your-user>/AppData/Local/MonieNaija/private-poa/encryption.key
POA_ENCRYPTION_ACTIVE_KEY_VERSION=v1
POA_ENCRYPTION_KEYRING_JSON=
POA_CLAMAV_HOST=127.0.0.1
POA_CLAMAV_PORT=3310
POA_CLAMAV_TIMEOUT_MS=5000
POA_S3_BUCKET=
POA_S3_REGION=
POA_S3_ENDPOINT=
POA_S3_FORCE_PATH_STYLE=false
```

Replace `<your-user>` with the Windows profile directory name. Alternatively, set process-scoped
values from PowerShell so they are not persisted globally:

```powershell
$env:NODE_ENV = 'development'
$env:POA_UPLOADS_ENABLED = 'false'
$env:POA_MAX_UPLOAD_BYTES = '10485760'
$env:POA_STORAGE_PROVIDER = 'local'
$env:POA_LOCAL_STORAGE_ROOT = $objectsRoot
$env:POA_ENCRYPTION_KEY_FILE = Join-Path $poaRoot 'encryption.key'
$env:POA_ENCRYPTION_ACTIVE_KEY_VERSION = 'v1'
$env:POA_CLAMAV_HOST = '127.0.0.1'
$env:POA_CLAMAV_PORT = '3310'
$env:POA_CLAMAV_TIMEOUT_MS = '5000'
```

For local development, leave `POA_ENCRYPTION_KEYRING_JSON` and the `POA_S3_*` values empty. Local
filesystem storage is development/test-only and requires no cloud credentials. Production uses the
S3-compatible adapter and an operator-managed, versioned keyring supplied through a secret manager;
keep the bucket private, block public access, use a least-privilege runtime identity, and do not put
cloud credentials or key material in Git or a checked-in `.env`.

## 5. Apply migration 0094, then start the app

With `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` configured for the disposable
local database, verify the target before running migrations. If using process-scoped PowerShell
variables, inspect the host and database name; if using `.env`, inspect those two values locally in
the ignored file (do not print or paste the password):

```powershell
Write-Host "Migration target (process environment): $env:DB_HOST / $env:DB_NAME"
```

Apply pending repository migrations from the repository root:

```powershell
npm run migration:run
```

This command applies pending migrations, including the additive
`src/migrations/1785753600094-AddSecureCustomerProofOfAddressUploads.ts`. Run it only against your
local disposable database. Do not use it against a shared, staging, or production database as part
of this manual test. The key file must not be generated before the migration can be checked; the
backend intentionally refuses to create a key if it cannot query whether encrypted PoA objects
already exist.

Start the backend in a PowerShell window with the local environment above:

```powershell
npm run start:dev
```

In another window, start Admin Web:

```powershell
Push-Location apps/admin-web
npm run dev -- --host 0.0.0.0
Pop-Location
```

The Vite development proxy sends `/api` requests to `http://localhost:3000` by default. Log in with
a local workforce test identity and open the customer in Customer 360°. With
`POA_UPLOADS_ENABLED=false`, the capability response and screen must show uploads disabled, and no
file request should be sent.

## 6. Enable uploads only after local checks pass

Before enabling, confirm all of the following:

1. The local database is the dedicated disposable database and migration 0094 is applied.
2. `POA_STORAGE_PROVIDER=local`, the object/key paths are outside the repository, and the ACLs
   restrict both paths to the backend identity and SYSTEM.
3. `clamd` is reachable from Windows at `127.0.0.1:3310` and has current signatures.
4. The workforce test user has the relevant server-side function scopes.

Then set `POA_UPLOADS_ENABLED=true` in the local `.env` or PowerShell process and restart the
backend. The UI first calls the authenticated per-customer `capabilities` endpoint. It exposes upload
only when the server reports `enabled: true`, the signed-in principal has the dedicated upload
scope, address-view permission is present, an active residential address can be selected, and the
customer-scoped metadata list loaded successfully. If the capability request fails, the feature is
disabled, the caller lacks scope, or required address/metadata reads fail, upload remains hidden or
disabled. The server rechecks authorization and configuration on every request; client-side checks
are only a convenience.

The same server-side scopes gate content access (`customer.download_proof_of_address`), withdrawal
(`customer.withdraw_proof_of_address`), and archival (`customer.archive_proof_of_address`). The
backend authorization catalogue currently assigns PoA functions to the corresponding workforce
roles. Do not grant broader roles just to make a button appear.

## 7. Manual test checklist

Use only synthetic files and a local test customer. The routes below are under
`http://localhost:3000/api/v1`; requests require a valid local workforce bearer token and the
specified function scope. Do not paste a bearer token into source control, logs, or chat.

1. **Disabled by default:** with `POA_UPLOADS_ENABLED=false`, call
   `GET /customers/{customerId}/proof-of-address/capabilities` as a principal with
   `customer.view_proof_of_address_metadata`. Expect `enabled: false`; the UI must not show upload,
   preview, download, replacement, withdrawal, or archive actions.
2. **Authorization:** with the server enabled but without `customer.upload_proof_of_address`, verify
   that upload controls are absent. Without `customer.download_proof_of_address`, preview/download
   controls must be absent. Direct API calls must still be denied by the backend.
3. **Clean upload:** as an authorized test principal, submit a signature-valid synthetic PDF,
   JPEG, or PNG smaller than 10 MiB. The multipart form fields are `file`, `residentialAddressId`,
   `category`, and `documentType`; `issuerName`, `documentDate`, and
   `supersedesSubmissionId` are optional. Send a fresh `idempotency-key` header for each new
   submission. Expect a stored record with a clean scan; preview/download should work only for a
   principal with the content permission.
4. **Limits and signatures:** test a file larger than the configured limit and a file whose
   extension/MIME claims do not match its bytes. Expect rejection; do not rely on the browser's
   file picker as a security check.
5. **Scanner fail-closed:** in the disposable test setup, stop `clamav-daemon` and upload a fresh
   valid synthetic document. Expect a quarantined record and no preview/download. Restart the
   scanner. The quarantined document remains quarantined; submit a new clean replacement rather
   than treating scanner recovery as approval. An organization-approved EICAR test fixture may be
   used to test detection; never use real malware.
6. **History and pagination:** load `/customers/{customerId}/proof-of-address?page=1&limit=20`,
   open a record's history, and load another page when available. Confirm history contains recorded
   lifecycle/scan events and does not expose document bytes.
7. **Replacement:** choose the latest revision and submit a different synthetic file. The
   replacement must retain the same residential address and candidate classification and send its
   ID as `supersedesSubmissionId`. Confirm a new revision is created and prior revisions remain in
   history. A clean scan is not approval.
8. **Withdrawal/archive:** withdraw a record with a non-empty reason. Confirm the history records
   it and content access is blocked. Archive only a withdrawn record, with a separate reason and
   archive permission. No document or customer data is hard-deleted by these actions.
9. **Cross-customer protection:** attempt to read a submission using a different customer's UUID;
   expect not-found/denial and no content. Also verify unauthenticated requests are rejected.
10. **Key persistence:** restart the backend with the same database and key file and confirm a clean
    synthetic document can still be decrypted by an authorized test account. For a missing-key
    refusal test, use a _separate disposable copy_ of the database/object directory. Never rename or
    remove the key from a database containing records you need to keep.
11. **No approval side effects:** confirm there is no documentary approval, physical verification
    approval, Tier 3, or wallet-status action in the screen or API flow.

### PowerShell multipart smoke test

PowerShell 7's `Invoke-RestMethod -Form` can exercise the upload endpoint without manually setting a
multipart `Content-Type` (the client must generate the boundary). Use a local bearer token from an
authorized workforce test session; do not save it to a script or `.env` file.

```powershell
$apiBase = 'http://localhost:3000/api/v1'
$customerId = Read-Host 'Synthetic local test customer UUID'
$residentialAddressId = Read-Host 'Active residential address UUID for that customer'
$filePath = Read-Host 'Path to a signature-valid synthetic PDF/JPEG/PNG'
$secureToken = Read-Host 'Local workforce bearer token' -AsSecureString
$tokenPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $token = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  $secureToken.Dispose()
}

$authHeaders = @{ Authorization = "Bearer $token" }
$uploadHeaders = @{
  Authorization = "Bearer $token"
  'idempotency-key' = [guid]::NewGuid().ToString()
}

Invoke-RestMethod -Uri "$apiBase/customers/$customerId/proof-of-address/capabilities" `
  -Method Get -Headers $authHeaders

$form = @{
  file = Get-Item -LiteralPath $filePath
  residentialAddressId = $residentialAddressId
  category = 'UTILITY'
  documentType = 'UTILITY_BILL'
  issuerName = 'Synthetic local test'
  documentDate = (Get-Date -Format 'yyyy-MM-dd')
}
Invoke-RestMethod -Uri "$apiBase/customers/$customerId/proof-of-address" `
  -Method Post -Headers $uploadHeaders -Form $form

Invoke-RestMethod -Uri "$apiBase/customers/$customerId/proof-of-address?page=1&limit=20" `
  -Method Get -Headers $authHeaders
```

For an authorized content download, substitute the returned submission UUID and use a disposable
output path:

```powershell
$submissionId = Read-Host 'Synthetic submission UUID'
$outFile = Join-Path $env:TEMP "poa-synthetic-download-$submissionId.bin"
Invoke-WebRequest `
  -Uri "$apiBase/customers/$customerId/proof-of-address/$submissionId/content?disposition=attachment" `
  -Method Get -Headers $authHeaders -OutFile $outFile
```

The browser UI is preferable for inline preview. To test lifecycle routes directly, POST JSON with a
non-empty reason to `.../{submissionId}/withdraw` or (after withdrawal and with the archive scope)
`.../{submissionId}/archive`. Avoid writing a real bearer token to shell history or logs; clear the in-memory string and headers
when done with `Remove-Variable token, secureToken, tokenPointer, authHeaders, uploadHeaders -ErrorAction SilentlyContinue`.

The local object files have random names and an encrypted `MNPOA1` envelope header. Inspect only a
synthetic test object if confirming that its contents are not plaintext; never print or expose the
key file. Keep local storage backups and the key backup together under restricted access.

## 8. Production boundary and limitations

- Local storage is rejected outside `development`/`test`; production requires `POA_STORAGE_PROVIDER=s3`,
  a private S3-compatible bucket, region, an operator-managed persistent versioned keyring, and
  runtime credentials. Cloud credentials are not needed for local development.
- The active key version must exist in the keyring. Preserve old key versions as long as stored
  objects use them. This implementation does not supply an operator key-rotation/migration tool;
  do not change the active version or remove an old key without a separately reviewed rotation.
- Scanner unavailability is not a clean result. Quarantine prevents preview/download; this feature
  does not provide an automatic rescan/release or documentary approval workflow.
- Candidate evidence types are not an approved regulatory acceptance list. Document upload, clean
  scanning, metadata, withdrawal, and archival do not approve evidence, verify a physical address,
  determine Tier 3 eligibility, or change wallet status.
