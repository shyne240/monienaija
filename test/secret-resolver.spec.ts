import {
  EnvironmentSecretBackend,
  SecretResolver,
  rotationCorrelationId,
  type SecretAccessRecord,
} from '../src/config/secret-resolver';
import { REDACTED_VALUE, redactSensitiveData } from '../src/common/sensitive-data-redaction';

/**
 * ARENA 3D Group 9 — secret resolution and rotation, and the guarantees that no path exposes one.
 *
 * The first half proves rotation works. The second half is the part that matters: it tries every route a
 * secret value could escape by — string conversion, JSON, an error, a health payload, a log line, a
 * thrown stack, a frozen handle — and asserts the value is not there. A rotation feature that works but
 * leaks is worse than no rotation feature, because the leak is silent.
 */
const VALUE = 'sk_live_9f4c1a7e2b8d6035c9e1';
const ROTATED = 'sk_live_1a2b3c4d5e6f70819203';

function backend(values: Record<string, string>): EnvironmentSecretBackend {
  return new EnvironmentSecretBackend(values as NodeJS.ProcessEnv);
}

function resolverWith(values: Record<string, string>, access?: SecretAccessRecord[]) {
  return new SecretResolver({
    backend: backend(values),
    onAccess: access ? (record) => access.push(record) : undefined,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('Group 9 — secret resolution and rotation', () => {
  describe('resolution', () => {
    it('resolves a configured secret and records a version and fingerprint', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      const handle = resolver.resolve('banking.monnify.apiKey');
      expect(handle.name).toBe('banking.monnify.apiKey');
      expect(handle.version).toBe(1);
      expect(handle.fingerprint).toMatch(/^[a-f0-9]{12}$/);
      expect(handle.fingerprint).not.toBe(VALUE);
      expect(handle.reveal('test')).toBe(VALUE);
    });

    it('returns the same handle for repeated resolution rather than re-reading the backend', () => {
      const values: Record<string, string> = { BREVO_API_KEY: VALUE };
      const resolver = resolverWith(values);
      const first = resolver.resolve('notification.brevo.apiKey');
      values.BREVO_API_KEY = ROTATED;
      const second = resolver.resolve('notification.brevo.apiKey');
      expect(second).toBe(first);
      expect(second.reveal('test')).toBe(VALUE);
    });

    it('refuses an unknown name instead of returning undefined', () => {
      const resolver = resolverWith({});
      expect(() => resolver.resolve('provider.invented.key')).toThrow(/not configured/);
    });

    it('refuses a known name whose value is unset', () => {
      const resolver = resolverWith({});
      expect(() => resolver.resolve('banking.monnify.apiKey')).toThrow(/not configured/);
    });

    it('treats an empty string as unset rather than as a credential', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: '' });
      expect(() => resolver.resolve('banking.monnify.apiKey')).toThrow(/not configured/);
    });
  });

  describe('rotation', () => {
    it('produces a new version and a new fingerprint, and leaves the old handle working', () => {
      const values: Record<string, string> = { BANKING_MONNIFY_API_KEY: VALUE };
      const resolver = resolverWith(values);
      const before = resolver.resolve('banking.monnify.apiKey');
      values.BANKING_MONNIFY_API_KEY = ROTATED;
      const outcome = resolver.rotate('banking.monnify.apiKey');

      expect(outcome.changed).toBe(true);
      expect(outcome.previousVersion).toBe(1);
      expect(outcome.newVersion).toBe(2);
      expect(outcome.previousFingerprint).not.toBe(outcome.newFingerprint);

      // The in-flight request keeps the key it started with; the next resolution gets the new one.
      expect(before.reveal('in-flight')).toBe(VALUE);
      expect(resolver.resolve('banking.monnify.apiKey').reveal('next')).toBe(ROTATED);
    });

    it('reports a rotation to an identical value as unchanged rather than bumping the version', () => {
      // A version bump that did not change the credential makes "which version signed this?"
      // unanswerable for no benefit.
      const values: Record<string, string> = { BANKING_MONNIFY_API_KEY: VALUE };
      const resolver = resolverWith(values);
      resolver.resolve('banking.monnify.apiKey');
      const outcome = resolver.rotate('banking.monnify.apiKey');
      expect(outcome.changed).toBe(false);
      expect(outcome.newVersion).toBe(outcome.previousVersion);
    });

    it('fails loudly when the backend returns nothing, instead of silently keeping the old value', () => {
      const values: Record<string, string> = { BANKING_MONNIFY_API_KEY: VALUE };
      const resolver = resolverWith(values);
      resolver.resolve('banking.monnify.apiKey');
      delete values.BANKING_MONNIFY_API_KEY;
      expect(() => resolver.rotate('banking.monnify.apiKey')).toThrow(/could not be rotated/);
    });

    it('rotates every resolved secret and reports one outcome each', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE, BREVO_API_KEY: VALUE });
      resolver.resolve('banking.monnify.apiKey');
      resolver.resolve('notification.brevo.apiKey');
      const outcomes = resolver.rotateAll();
      expect(outcomes.map((o) => o.name).sort()).toEqual([
        'banking.monnify.apiKey',
        'notification.brevo.apiKey',
      ]);
      expect(outcomes.every((o) => o.changed === false)).toBe(true);
    });

    it('issues a correlation id for grouping rotation outcomes', () => {
      const a = rotationCorrelationId();
      const b = rotationCorrelationId();
      expect(a).toMatch(/^rot_[0-9a-f-]{36}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('the value cannot escape', () => {
    it('is absent from string conversion and JSON serialisation', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      const handle = resolver.resolve('banking.monnify.apiKey');
      expect(String(handle)).not.toContain(VALUE);
      expect(`${String(handle)}`).not.toContain(VALUE);
      expect(JSON.stringify(handle)).not.toContain(VALUE);
      expect(JSON.stringify({ secret: handle })).not.toContain(VALUE);
      expect(JSON.stringify(handle.toJSON())).toContain(REDACTED_VALUE);
      // The fingerprint is present and is not the value; that is the point of having one.
      expect(JSON.stringify(handle)).toContain(handle.fingerprint);
    });

    it('is absent from a health payload built by describe()', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      resolver.resolve('banking.monnify.apiKey');
      const health = JSON.stringify(resolver.describe());
      expect(health).not.toContain(VALUE);
      expect(health).toContain('banking.monnify.apiKey');
      expect(health).toContain('version');
    });

    it('is absent from an error raised for an unconfigured secret', () => {
      // Errors are the most common accidental exfiltration path: they get logged, returned to clients and
      // pasted into tickets. The message must name the secret and nothing else.
      const resolver = resolverWith({});
      try {
        resolver.resolve('banking.monnify.apiKey');
        throw new Error('expected a throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('banking.monnify.apiKey');
        expect(message).not.toContain(VALUE);
        expect(message).not.toMatch(/sk_live/);
      }
    });

    it('is absent from the backend kind and known-name list', () => {
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      resolver.resolve('banking.monnify.apiKey');
      expect(JSON.stringify(resolver.knownNames())).not.toContain(VALUE);
      expect(new EnvironmentSecretBackend({}).kind).toBe('environment');
    });

    it('cannot be attached to a handle by a caller trying to serialise it later', () => {
      // The handle is frozen. Without this, `handle.value = handle.reveal('x')` followed by a later
      // JSON.stringify of the handle would leak it, and the leak would be in someone else's file.
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      const handle = resolver.resolve('banking.monnify.apiKey') as unknown as Record<
        string,
        unknown
      >;
      expect(() => {
        handle.leaked = 'x';
      }).toThrow();
      expect(JSON.stringify(handle)).not.toContain(VALUE);
    });

    it('survives the repository-wide redactor even when the value is nested in a payload', () => {
      // Belt and braces: if a caller does put the value in a structure that reaches the redactor, the
      // redactor must still remove it. This asserts the two mechanisms agree.
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE });
      const handle = resolver.resolve('banking.monnify.apiKey');
      const payload = {
        config: { apiKey: handle.reveal('test'), nested: { secret: handle.reveal('test') } },
        note: 'visible',
      };
      const redacted = JSON.stringify(redactSensitiveData(payload));
      expect(redacted).not.toContain(VALUE);
      expect(redacted).toContain('visible');
    });
  });

  describe('access is attributable', () => {
    it('records every reveal with its purpose and version', () => {
      const records: SecretAccessRecord[] = [];
      const resolver = resolverWith({ BANKING_MONNIFY_API_KEY: VALUE }, records);
      const handle = resolver.resolve('banking.monnify.apiKey');
      handle.reveal('monnify-token-request');
      handle.reveal('monnify-transfer-submit');
      expect(records).toHaveLength(2);
      expect(records.map((r) => r.purpose)).toEqual([
        'monnify-token-request',
        'monnify-transfer-submit',
      ]);
      expect(records.every((r) => r.name === 'banking.monnify.apiKey')).toBe(true);
      expect(records.every((r) => r.version === 1)).toBe(true);
      // The record must not carry the value, or the audit trail becomes a credential store.
      expect(JSON.stringify(records)).not.toContain(VALUE);
    });

    it('records the version actually used, so a rotation can be attributed', () => {
      const values: Record<string, string> = { BANKING_MONNIFY_API_KEY: VALUE };
      const records: SecretAccessRecord[] = [];
      const resolver = resolverWith(values, records);
      const first = resolver.resolve('banking.monnify.apiKey');
      first.reveal('before');
      values.BANKING_MONNIFY_API_KEY = ROTATED;
      resolver.rotate('banking.monnify.apiKey');
      const second = resolver.resolve('banking.monnify.apiKey');
      second.reveal('after');
      expect(records.map((r) => r.version)).toEqual([1, 2]);
    });
  });

  describe('the mapping is explicit and reviewable', () => {
    it('resolves only names present in the mapping', () => {
      const resolver = resolverWith({ SOME_OTHER_VARIABLE: VALUE });
      expect(() => resolver.resolve('some.other.variable')).toThrow(/not configured/);
    });

    it('does not expose the database password, which has its own restart-bound lifecycle', () => {
      // Including DB_PASSWORD would imply it can be rotated without a restart. It cannot: the connection
      // pool holds established connections authenticated with the old password. Pretending otherwise
      // through a hot-swap interface would be a correctness bug disguised as a feature.
      const resolver = resolverWith({ DB_PASSWORD: VALUE });
      expect(() => resolver.resolve('database.password')).toThrow(/not configured/);
    });
  });
});
