import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The environment inventory must stay true to the schema.
 *
 * Three properties, each of which has already failed at least once in this repository's history:
 *
 *  1. **Completeness.** Every variable the schema knows about appears in `.env.example`. A variable
 *     that exists only in source is one an operator supplies by reading TypeScript, which means the
 *     deployment is configured by whoever happened to notice.
 *  2. **Classification honesty.** Credentials are labelled SECRET and non-credentials are not. A host
 *     name labelled SECRET trains people to paste real secrets into ticket comments "because it is
 *     only config"; a password labelled INTERNAL gets logged.
 *  3. **Placeholder safety.** `.env.example` contains no working credential. It is committed.
 */
const ROOT = join(__dirname, '..');

function schemaKeys(): string[] {
  const source = readFileSync(join(ROOT, 'src/config/environment.ts'), 'utf8');
  const matches = [...source.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
  return [...new Set(matches)].sort();
}

function exampleEntries(): Map<string, string> {
  const text = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const entries = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) entries.set(match[1]!, match[2]!.trim());
  }
  return entries;
}

function inventory(): Array<{ key: string; classification: string }> {
  const text = readFileSync(
    join(ROOT, 'docs/integration/ENVIRONMENT-CONFIGURATION-INVENTORY.md'),
    'utf8',
  );
  // Tolerant of column padding: Prettier aligns the Markdown table, so a strict `| x | y |` pattern
  // silently matches nothing once the generator's output has been formatted. That failure mode is
  // worse than a crash - the inventory looks empty and every assertion against it passes vacuously.
  return [...text.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*(\w+)\s*\|/gm)].map((m) => ({
    key: m[1]!,
    classification: m[2]!,
  }));
}

/**
 * Asks the application's own production validation whether a value would be accepted.
 *
 * Imported lazily so the module graph of the schema (which reads `process.env` at load time) is not
 * disturbed before the test body sets it up.
 */
function isAcceptedInProduction(key: string, value: string): boolean {
  // Loaded lazily and deliberately: the module validates configuration at import time, so importing it at the
  // top of this file would evaluate the environment before the test has set it up.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateEnvironment } = require('../src/config/environment') as {
    validateEnvironment: (env: Record<string, string | undefined>) => unknown;
  };
  const base: Record<string, string> = {
    NODE_ENV: 'production',
    DB_HOST: 'db.internal.example',
    DB_NAME: 'monienaija',
    DB_USER: 'app',
    JWT_SECRET: 'x'.repeat(32),
  };
  try {
    validateEnvironment({ ...base, [key]: value });
    return true;
  } catch {
    return false;
  }
}

describe('environment configuration inventory', () => {
  it('documents every schema variable in .env.example', () => {
    const documented = exampleEntries();
    const missing = schemaKeys().filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it('classifies every schema variable exactly once', () => {
    const rows = inventory();
    const keys = rows.map((row) => row.key);
    expect(keys.sort()).toEqual(schemaKeys());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels every credential as SECRET', () => {
    const secrets = new Set(
      inventory()
        .filter((row) => row.classification === 'SECRET')
        .map((row) => row.key),
    );
    // Named exhaustively rather than by pattern: the point is that a new credential variable is added
    // here deliberately and classified, not swept in by a regex that might be wrong in either
    // direction (and has been, twice).
    const mustBeSecret = [
      'A2_BOOTSTRAP_JWKS_JSON',
      'A2_RECOVERY_JWKS_JSON',
      'A6_PARTNER_PRODUCTION_CALLBACK_SECRET',
      'A6_PARTNER_SANDBOX_CALLBACK_SECRET',
      'BANKING_MONNIFY_API_KEY',
      'BANKING_MONNIFY_CLIENT_SECRET',
      'BANKING_MONNIFY_CONTRACT_CODE',
      'BANKING_MONNIFY_SECRET_KEY',
      'BREVO_API_KEY',
      'DB_PASSWORD',
      'DOJAH_SECRET_KEY',
      'KYC_OWNERSHIP_KEY_BASE64',
      'MONNIFY_API_KEY',
      'MONNIFY_SECRET_KEY',
      'NOTIFICATION_PROVIDER_ENCRYPTION_KEY',
      'PROTECTED_AUTHORITY_DB_PASSWORD',
      'RESEND_API_KEY',
      'ROBASE_API_KEY',
    ];
    expect(mustBeSecret.filter((key) => !secrets.has(key))).toEqual([]);
  });

  it('does not label non-credentials as SECRET', () => {
    const secrets = new Set(
      inventory()
        .filter((row) => row.classification === 'SECRET')
        .map((row) => row.key),
    );
    // Each of these was mislabelled SECRET at some point. A hostname, a port, a database name, a
    // username, a cipher name, a partner identifier and a public key endpoint are not credentials.
    const notSecret = [
      'DB_HOST',
      'DB_PORT',
      'DB_NAME',
      'DB_USER',
      'DB_SSL',
      'A6_PARTNER_SIGNING_ALGORITHM',
      'A6_PARTNER_KEY',
      'A2_WORKFORCE_OIDC_JWKS_URI',
      'A6_PARTNER_SANDBOX_BASE_URL',
      'PROTECTED_AUTHORITY_DB_HOST',
      'PROTECTED_AUTHORITY_DB_USER',
    ];
    expect(notSecret.filter((key) => secrets.has(key))).toEqual([]);
  });

  it('contains no working credential in the committed example file', () => {
    const entries = exampleEntries();
    const secrets = new Set(
      inventory()
        .filter((row) => row.classification === 'SECRET')
        .map((row) => row.key),
    );

    /**
     * A populated secret is acceptable only if the production profile would refuse it.
     *
     * This is the distinction that matters and it took a real finding to get right: `DB_PASSWORD` is
     * `change-me-local-only` in the example file, which looks like a committed credential until you
     * learn it is on the schema's own `PLACEHOLDER_SECRETS` blocklist. The security property is not
     * "the file contains no characters", it is "no value in this file can be used to reach a
     * production deployment". So the assertion is against the application's actual validation rather
     * than against a list of strings maintained here, where the two could silently diverge.
     */
    const populated = [...entries.entries()].filter(
      ([key, value]) => secrets.has(key) && value.length > 0,
    );

    for (const [key, value] of populated) {
      // An empty JSON array is not a credential at all; it is the absence of one, spelled out.
      if (value === '[]') continue;
      const accepted = isAcceptedInProduction(key, value);
      expect({ key, acceptedInProduction: accepted }).toEqual({
        key,
        acceptedInProduction: false,
      });
    }
  });

  it('starts every money-moving capability disabled', () => {
    const entries = exampleEntries();
    // A deployment that copies this file verbatim must not begin moving money. Each of these toggles
    // gates a capability that can affect balances or identity evidence.
    for (const key of [
      'BANKING_ENABLED',
      'BANKING_DISPATCH_WORKER_ENABLED',
      'MONNIFY_VERIFICATION_ENABLED',
      'DOJAH_VERIFICATION_ENABLED',
      'KYC_CUSTOMER_VERIFICATION_ENABLED',
      'KYC_PROVIDER_LIVE_CALLS_ENABLED',
      'A6_PARTNER_ENABLED',
      'POA_UPLOADS_ENABLED',
    ]) {
      expect({ key, value: entries.get(key) }).toEqual({ key, value: 'false' });
    }
  });

  it('does not default the example file to production', () => {
    // A template that starts in production mode invites someone to run it against real data before
    // the validation that would refuse it has a chance to be configured correctly.
    expect(exampleEntries().get('NODE_ENV')).toBe('development');
  });
});
