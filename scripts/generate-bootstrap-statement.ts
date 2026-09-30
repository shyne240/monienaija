/**
 * V1-BOOTSTRAP-IMPLEMENTATION-01 — Offline A2 workforce bootstrap statement generator.
 *
 * Produces the one-time, externally-signed RS256 bootstrap statement consumed by
 * POST /api/v1/internal/a2/workforce/bootstrap (A2FinanceRoleAdministrationService.consumeBootstrap).
 *
 * Cryptography/canonicalization/verification are REUSED from the production verifier
 * (src/authorization/workforce-crypto.ts); this script implements no second protocol.
 *
 * Operational contract:
 *  - Runs ENTIRELY offline; never calls the API; never transmits anything.
 *  - Reads an operator-supplied RSA private key from a PEM path, OR creates an ephemeral
 *    in-memory keypair (--generate-ephemeral). Private key material is NEVER printed,
 *    logged, persisted, or returned by any function in this file.
 *  - Fails closed on any missing/invalid required parameter.
 *  - stdout is JSON: { statement, publicJwk, envSnippet, selfCheck: 'OK' } — safe to capture.
 *
 * Usage:
 *   npm run bootstrap:statement -- --help
 *   npm run bootstrap:statement -- \
 *     --generate-ephemeral --kid bootstrap-2026-09-prod --environment production \
 *     --issuer https://idp.example.com --subject 9f3d...-oidc-sub \
 *     --audience monienaija-v1-bootstrap \
 *     --scopes '["privileged:execute"]' \
 *     --effective-from 2026-09-30T00:00:00.000Z --effective-to 2026-10-01T00:00:00.000Z \
 *     --nonce <openssl rand -hex 16> --approval-change-reference CHG-000123
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
import type {
  A2BootstrapStatementV1,
  A2TrustedJwkV1,
} from '../src/authorization/workforce-authentication.types';

/** Public (non-secret) generator output. */
export interface BootstrapStatementToolResult {
  readonly statement: string;
  readonly publicJwk: A2TrustedJwkV1;
  readonly envSnippet: { readonly A2_BOOTSTRAP_JWKS_JSON: string };
  readonly selfCheck: 'OK';
}

export interface BootstrapStatementToolInput {
  readonly privateKey: KeyObject;
  readonly kid: string;
  readonly environment: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly nonce: string;
  readonly approvalChangeReference: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
}

const KID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const DEFAULT_STATEMENT_TTL_MS = 15 * 60 * 1000;

function fail(detail: string): never {
  throw new Error(`bootstrap-statement: ${detail}`);
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
  // Canonical millisecond UTC form exactly as the bootstrap contract requires.
  return parsed.toISOString();
}

function parseScopes(value: string | undefined): readonly string[] {
  const raw = requiredText(value, 'scopes', 4096);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('scopes must be a JSON array of scope strings, e.g. \'["privileged:execute"]\'');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > 100 ||
    parsed.some((scope) => typeof scope !== 'string' || !scope.trim() || scope.length > 160)
  )
    fail('scopes must be a non-empty JSON array of scope strings (max 100, max 160 chars each)');
  const scopes = parsed.map((scope) => (scope as string).trim());
  if (new Set(scopes).size !== scopes.length) fail('scopes must not contain duplicates');
  return scopes;
}

/**
 * Builds the statement, signs it, and self-verifies it with the PRODUCTION verifier.
 * The private key only ever exists as a KeyObject argument inside this call stack.
 */
export function generateBootstrapStatement(
  input: BootstrapStatementToolInput,
): BootstrapStatementToolResult {
  const kid = requiredText(input.kid, 'kid', 160);
  if (!KID_PATTERN.test(kid)) fail('kid fails the configured key-id pattern ([A-Za-z0-9][A-Za-z0-9_.:-]*)');
  const environment = requiredText(input.environment, 'environment', 80);
  const issuer = requiredText(input.issuer, 'issuer', 2048);
  const subject = requiredText(input.subject, 'subject', 255);
  const audience = requiredText(input.audience, 'audience', 80);
  const approvalChangeReference = requiredText(
    input.approvalChangeReference,
    'approval-change-reference',
    160,
  );
  const nonce = requiredText(input.nonce, 'nonce', 255);
  const scopes = parseScopes(JSON.stringify(input.scopes));

  const principalId = `${issuer}:${subject}`;
  if (principalId.length > 160)
    fail(`derived principalId exceeds 160 chars (${principalId.length}): shorten issuer/subject`);

  const now = Date.now();
  const effectiveFrom = instantText(input.effectiveFrom, 'effective-from');
  const effectiveTo = instantText(input.effectiveTo, 'effective-to');
  const issuedAt = input.issuedAt
    ? instantText(input.issuedAt, 'issued-at')
    : new Date(now).toISOString();
  const expiresAt = input.expiresAt
    ? instantText(input.expiresAt, 'expires-at')
    : new Date(Date.parse(issuedAt) + DEFAULT_STATEMENT_TTL_MS).toISOString();

  if (Date.parse(effectiveTo) <= Date.parse(effectiveFrom))
    fail('effective-to must be after effective-from');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    fail('expires-at must be after issued-at');
  if (Date.parse(effectiveFrom) > now)
    fail('effective-from is in the future: the consuming server would reject the statement as not yet valid');
  if (Date.parse(effectiveTo) <= now)
    fail('effective-to is in the past: the consuming server would reject the statement as outside validity');

  const payload: A2BootstrapStatementV1 = {
    schemaVersion: 1,
    environment,
    issuer,
    workforceSubject: subject,
    principalId,
    initialRoleKey: 'FINANCE_ADMIN',
    scopes,
    effectiveFrom,
    effectiveTo,
    audience,
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
    envSnippet: { A2_BOOTSTRAP_JWKS_JSON: JSON.stringify([publicJwk]) },
    selfCheck: 'OK',
  };
}

// ───────────────────────────── CLI (operator surface) ─────────────────────────────

const HELP = `Generate the one-time A2 workforce bootstrap statement (offline).

REQUIRED (all of them — the tool fails closed on any missing value):
  --environment <name>             Deployment NODE_ENV the statement binds to (e.g. production).
                                   Must equal the server's NODE_ENV and the key JWK environment.
  --issuer <uri>                   OIDC issuer of the bootstrapping operator's identity.
  --subject <sub>                  OIDC subject (sub) of the bootstrapping operator.
                                   principalId is derived as <issuer>:<subject> and must equal
                                   the calling workforce session's principal.
  --audience <value>               Must equal the server's A2_BOOTSTRAP_AUDIENCE.
  --scopes <json-array>            MUST exactly equal the configured FINANCE_ADMIN scopes and
                                   A2_BOOTSTRAP_ADMIN_SCOPES_JSON, e.g. '["privileged:execute"]'.
  --effective-from <iso>           Assignment window start (UTC ISO-8601, e.g. 2026-09-30T00:00:00.000Z).
                                   Must not be in the future at generation time.
  --effective-to <iso>             Assignment window end (must be after effective-from, in the future).
  --nonce <value>                  Single-use nonce. Generate fresh: openssl rand -hex 16.
                                   Never reuse: the server rejects replays and nonce conflicts.
  --approval-change-reference <v>  Change-ticket / approval reference recorded in audit.

PRIVATE KEY (exactly one of):
  --private-key-pem <path>         Path to an operator-controlled RSA private key (PEM).
  --generate-ephemeral             Create a throwaway RSA-2048 keypair in memory.

OPTIONAL:
  --kid <id>                       Key id (default "bootstrap-<UTC-date>"). Pattern [A-Za-z0-9][A-Za-z0-9_.:-]*.
  --issued-at <iso>                Default: now.
  --expires-at <iso>               Default: issued-at + 15 minutes. Consume the statement promptly.

OUTPUT (stdout, JSON — contains NO private key material):
  statement      Compact JWS to POST: POST /api/v1/internal/a2/workforce/bootstrap {"statement": ...}
  publicJwk      Public JWK (kid/kty/n/e/alg/use/environment) to trust via A2_BOOTSTRAP_JWKS_JSON.
  envSnippet     Copy-paste A2_BOOTSTRAP_JWKS_JSON value containing the public key only.
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
          issuer: { type: 'string' },
          subject: { type: 'string' },
          audience: { type: 'string' },
          scopes: { type: 'string' },
          'effective-from': { type: 'string' },
          'effective-to': { type: 'string' },
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
    const result = generateBootstrapStatement({
      privateKey: privateKey!,
      kid:
        values.kid ??
        `bootstrap-${new Date().toISOString().slice(0, 10)}`,
      environment: values.environment!,
      issuer: values.issuer!,
      subject: values.subject!,
      audience: values.audience!,
      scopes: parseScopes(values.scopes),
      effectiveFrom: values['effective-from']!,
      effectiveTo: values['effective-to']!,
      nonce: values.nonce!,
      approvalChangeReference: values['approval-change-reference']!,
      issuedAt: values['issued-at'],
      expiresAt: values['expires-at'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (generatedEphemeral)
      process.stderr.write(
        '[bootstrap-statement] ephemeral keypair used and discarded; only the PUBLIC key was printed.\n',
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
