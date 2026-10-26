/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — Offline SUPER_ADMIN recovery/revocation statement
 * generator.
 *
 * Produces the signed RS256 statement consumed by
 * POST /api/v1/internal/a2/workforce/super-admin/recovery
 * (SuperAdminRecoveryService.consumeRevocation). Structural twin of
 * scripts/generate-bootstrap-statement.ts — same offline-only, private-key-never-logged
 * contract, same canonicalization/verification code (src/authorization/workforce-crypto.ts),
 * different payload shape (this statement names an EXISTING active SUPER_ADMIN assignment for
 * revocation; it never grants anything).
 *
 * Operational contract:
 *  - Runs ENTIRELY offline; never calls the API; never transmits anything.
 *  - Reads an operator-supplied RSA private key from a PEM path, OR creates an ephemeral
 *    in-memory keypair (--generate-ephemeral, for drills/tests only — a genuine recovery
 *    ceremony must use a durable, custody-controlled key, never a throwaway one). Private key
 *    material is NEVER printed, logged, persisted, or returned by any function in this file.
 *  - Fails closed on any missing/invalid required parameter.
 *  - stdout is JSON: { statement, publicJwk, envSnippet, selfCheck: 'OK' } — safe to capture.
 *  - --target-principal-id alone is sufficient: targetAssignmentReference is DERIVED here using
 *    the exact same deterministic formula the server uses
 *    (financeRoleAssignmentReference(principalId, 'SUPER_ADMIN', environment)) — the operator
 *    never has to compute or copy a hash by hand, and cannot accidentally mismatch it.
 *
 * Usage:
 *   npm run recovery:statement -- --help
 *   npm run recovery:statement -- \
 *     --generate-ephemeral --kid recovery-2026-10-01 --environment production \
 *     --target-principal-id https://idp.example.com:9f3d...-oidc-sub \
 *     --audience monienaija-v1-super-admin-recovery \
 *     --reason 'Departing CEO; board-approved successor ceremony pending' \
 *     --nonce <openssl rand -hex 16> --approval-change-reference CHG-000456
 */
import {
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { canonical, parseCompactJws, verifyRs256 } from '../src/authorization/workforce-crypto';
import { financeRoleAssignmentReference } from '../src/authorization/finance-role-administration.service';
import type {
  A2RecoveryStatementV1,
  A2TrustedJwkV1,
} from '../src/authorization/workforce-authentication.types';

/** Public (non-secret) generator output. */
export interface RecoveryStatementToolResult {
  readonly statement: string;
  readonly publicJwk: A2TrustedJwkV1;
  readonly envSnippet: { readonly A2_RECOVERY_JWKS_JSON: string };
  readonly selfCheck: 'OK';
}

export interface RecoveryStatementToolInput {
  readonly privateKey: KeyObject;
  readonly kid: string;
  readonly environment: string;
  readonly audience: string;
  readonly targetPrincipalId: string;
  readonly reason: string;
  readonly nonce: string;
  readonly approvalChangeReference: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
}

const KID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const DEFAULT_STATEMENT_TTL_MS = 15 * 60 * 1000;

function fail(detail: string): never {
  throw new Error(`recovery-statement: ${detail}`);
}

function requiredText(value: string | undefined, field: string, max: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > max) fail(`${field} is required (max ${max} chars)`);
  return trimmed!;
}

function instantText(value: string | undefined, field: string): string {
  const raw = requiredText(value, field, 64);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) fail(`${field} is not a valid timestamp: ${raw}`);
  return parsed.toISOString();
}

/**
 * Builds the statement, signs it, and self-verifies it with the PRODUCTION verifier.
 * The private key only ever exists as a KeyObject argument inside this call stack.
 */
export function generateRevocationStatement(
  input: RecoveryStatementToolInput,
): RecoveryStatementToolResult {
  const kid = requiredText(input.kid, 'kid', 160);
  if (!KID_PATTERN.test(kid)) fail('kid fails the configured key-id pattern ([A-Za-z0-9][A-Za-z0-9_.:-]*)');
  const environment = requiredText(input.environment, 'environment', 80);
  const audience = requiredText(input.audience, 'audience', 80);
  const targetPrincipalId = requiredText(input.targetPrincipalId, 'target-principal-id', 160);
  const reason = requiredText(input.reason, 'reason', 500);
  const approvalChangeReference = requiredText(
    input.approvalChangeReference,
    'approval-change-reference',
    160,
  );
  const nonce = requiredText(input.nonce, 'nonce', 255);

  const now = Date.now();
  const issuedAt = input.issuedAt
    ? instantText(input.issuedAt, 'issued-at')
    : new Date(now).toISOString();
  const expiresAt = input.expiresAt
    ? instantText(input.expiresAt, 'expires-at')
    : new Date(Date.parse(issuedAt) + DEFAULT_STATEMENT_TTL_MS).toISOString();

  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    fail('expires-at must be after issued-at');
  if (Date.parse(expiresAt) <= now)
    fail('expires-at is in the past: the consuming server would reject the statement as outside validity');

  const targetAssignmentReference = financeRoleAssignmentReference(
    targetPrincipalId,
    'SUPER_ADMIN',
    environment,
  );

  const payload: A2RecoveryStatementV1 = {
    schemaVersion: 1,
    operation: 'REVOKE_SUPER_ADMIN',
    environment,
    audience,
    targetAssignmentReference,
    targetPrincipalId,
    reason,
    approvalChangeReference,
    nonce,
    issuedAt,
    expiresAt,
    // Verifier requires signingKeyReference === header kid.
    signingKeyReference: kid,
  };

  const publicJwk = {
    ...(createPublicKey(input.privateKey).export({ format: 'jwk' }) as Record<string, unknown>),
    kid,
    alg: 'RS256',
    use: 'sig',
    environment,
  } as A2TrustedJwkV1;

  // Exact wire format the production verifier accepts: canonical (recursively key-sorted,
  // whitespace-free) JSON payload segment; RS256 signature over "<header>.<payload>".
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }),
    'utf8',
  ).toString('base64url');
  const body = Buffer.from(canonical(payload), 'utf8').toString('base64url');
  const signingInput = `${header}.${body}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const statement = `${signingInput}.${signer.sign(input.privateKey).toString('base64url')}`;

  // Self-check through the REAL verifier before emitting anything.
  verifyRs256(parseCompactJws(statement), publicJwk, new Date());

  return {
    statement,
    publicJwk,
    envSnippet: { A2_RECOVERY_JWKS_JSON: JSON.stringify([publicJwk]) },
    selfCheck: 'OK',
  };
}

// ───────────────────────────── CLI (operator surface) ─────────────────────────────

const HELP = `Generate a SUPER_ADMIN recovery/revocation statement (offline).

REQUIRED (all of them — the tool fails closed on any missing value):
  --environment <name>             Deployment NODE_ENV the statement binds to (e.g. production).
                                   Must equal the server's NODE_ENV and the key JWK environment.
  --target-principal-id <id>       The EXACT principalId of the SUPER_ADMIN assignment to revoke
                                   (same value that was bound at bootstrap time, e.g.
                                   "<issuer>:<subject>"). The assignment reference the server
                                   must match is derived from this value automatically.
  --audience <value>               Must equal the server's A2_RECOVERY_AUDIENCE.
  --reason <text>                  Operational justification, recorded in the immutable audit
                                   trail (e.g. "Departing CEO; board-approved successor pending").
  --nonce <value>                  Single-use nonce. Generate fresh: openssl rand -hex 16.
                                   Never reuse: the server rejects replays and nonce conflicts.
  --approval-change-reference <v>  Change-ticket / board-approval reference recorded in audit.

PRIVATE KEY (exactly one of):
  --private-key-pem <path>         Path to an operator-controlled RSA private key (PEM). This
                                   key MUST be configured independently of
                                   A2_BOOTSTRAP_JWKS_JSON and of any in-app administrator
                                   credential — see docs/deployment/V1-SUPER-ADMIN-RECOVERY-
                                   RUNBOOK-01.md §3 for the required custody separation.
  --generate-ephemeral             Create a throwaway RSA-2048 keypair in memory. For local
                                   drills/tests ONLY — never for a genuine recovery ceremony.

OPTIONAL:
  --kid <id>                       Key id (default "recovery-<UTC-date>"). Pattern [A-Za-z0-9][A-Za-z0-9_.:-]*.
  --issued-at <iso>                Default: now.
  --expires-at <iso>               Default: issued-at + 15 minutes. Consume the statement promptly.

OUTPUT (stdout, JSON — contains NO private key material):
  statement      Compact JWS to POST: POST /api/v1/internal/a2/workforce/super-admin/recovery
                 {"statement": ...}
  publicJwk      Public JWK (kid/kty/n/e/alg/use/environment) to trust via A2_RECOVERY_JWKS_JSON.
  envSnippet     Copy-paste A2_RECOVERY_JWKS_JSON value containing the public key only.
  selfCheck      'OK' — the statement was verified with the production verifier before printing.

The private key is never printed, logged, or written anywhere by this tool.
`;

function cli(argv: readonly string[]): number {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv as string[],
        allowPositionals: false,
        options: {
          help: { type: 'boolean', short: 'h', default: false },
          'generate-ephemeral': { type: 'boolean', default: false },
          'private-key-pem': { type: 'string' },
          kid: { type: 'string' },
          environment: { type: 'string' },
          'target-principal-id': { type: 'string' },
          audience: { type: 'string' },
          reason: { type: 'string' },
          nonce: { type: 'string' },
          'approval-change-reference': { type: 'string' },
          'issued-at': { type: 'string' },
          'expires-at': { type: 'string' },
        },
      });
    } catch (error) {
      fail(`invalid arguments: ${(error as Error).message}`);
    }
  })();
  const values = parsed!.values;
  if (values.help || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 2 : 0;
  }
  if (values['generate-ephemeral'] && values['private-key-pem'])
    fail('choose exactly one key source: --generate-ephemeral OR --private-key-pem');
  let privateKey: KeyObject;
  let generatedEphemeral = false;
  if (values['generate-ephemeral']) {
    privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    generatedEphemeral = true;
  } else if (values['private-key-pem']) {
    // Only the CLI touches the filesystem; private key material never leaves the process.
    let pem: string;
    try {
      pem = readFileSync(values['private-key-pem'], 'utf8');
    } catch {
      fail('could not read the private key PEM file (path not shown for safety)');
    }
    try {
      privateKey = createPrivateKey(pem!);
    } catch {
      fail('the supplied file is not a valid PEM private key');
    }
  } else {
    fail('a private key source is required: --generate-ephemeral OR --private-key-pem <path>');
  }
  try {
    const result = generateRevocationStatement({
      privateKey: privateKey!,
      kid: values.kid ?? `recovery-${new Date().toISOString().slice(0, 10)}`,
      environment: values.environment!,
      targetPrincipalId: values['target-principal-id']!,
      audience: values.audience!,
      reason: values.reason!,
      nonce: values.nonce!,
      approvalChangeReference: values['approval-change-reference']!,
      issuedAt: values['issued-at'],
      expiresAt: values['expires-at'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (generatedEphemeral)
      process.stderr.write(
        '[recovery-statement] ephemeral keypair used and discarded; only the PUBLIC key was printed. ' +
          'Never use --generate-ephemeral for a genuine recovery ceremony.\n',
      );
    return 0;
  } finally {
    // privateKey goes out of scope here; nothing derived from it was persisted or printed.
  }
}

if (require.main === module) {
  try {
    process.exitCode = cli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
