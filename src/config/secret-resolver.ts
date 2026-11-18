/**
 * ARENA 3D Group 9 — secret resolution and rotation.
 *
 * ## The problem this solves
 *
 * Secrets in this codebase come from environment variables, and environment variables have two
 * properties that are fine for a laptop and wrong for production:
 *
 *  1. **They cannot be rotated without a restart.** A leaked provider key means a redeploy, and a
 *     redeploy means a gap in service or a coordinated restart across instances.
 *  2. **They have no provenance.** Nothing records which value a running process is using, so "did the
 *     rotation take effect?" is answered by guesswork, and "was this request signed with the old or new
 *     key?" is unanswerable after the fact.
 *
 * This module adds a resolution layer *in front of* the environment. It does not replace configuration
 * or invent a secret manager; it introduces a single place where a secret is fetched, versioned and
 * rotated, and it makes the following true:
 *
 *  - a secret is resolved by **name**, never passed around as a value;
 *  - every resolved secret carries a **version**, so a caller can tell the version it used and the
 *    rotation can be observed rather than assumed;
 *  - rotation is **per-secret** and does not require restarting the process;
 *  - a secret **never appears** in `toString()`, `JSON.stringify`, an error message, a health response
 *    or a log line, because the handle does not expose the value at all except through an explicit
 *    `reveal()` that records an audit event.
 *
 * ## What this deliberately is not
 *
 * There is no vendor SDK here (no Vault, no AWS Secrets Manager, no GCP Secret Manager). Choosing one is
 * a product-owner decision, and the mission forbids inventing provider entitlements. What is built is
 * the *contract* such a backend must satisfy, an environment-backed implementation that satisfies it
 * today, and the guarantees the rest of the application codes against — so swapping in a managed backend
 * later is a change to one provider, not to every call site.
 */
import { createHash, randomUUID } from 'node:crypto';

import { REDACTED_VALUE } from '../common/sensitive-data-redaction';

/** A resolved secret. The value is reachable only through `reveal()`, which is audited. */
export interface SecretHandle {
  readonly name: string;
  /** Monotonic per-process version, incremented on each rotation. */
  readonly version: number;
  /** SHA-256 of the value, first 12 hex characters. Safe to log; not reversible to the value. */
  readonly fingerprint: string;
  /** ISO-8601 instant this version became effective. */
  readonly resolvedAt: string;
  /**
   * Returns the secret value. Every call is recorded so that a secret read is attributable.
   * Never let the return value reach a log, an error, a response body or a metric label.
   */
  reveal(purpose: string): string;
  /** Safe representation. Deliberately useless as a credential. */
  toString(): string;
  toJSON(): Record<string, string | number>;
}

/** A source of secret values. The only thing a managed backend needs to implement. */
export interface SecretBackend {
  /** Backend identifier, used in health output. Must not itself be sensitive. */
  readonly kind: string;
  /** Returns the raw value, or undefined when the name is unknown. */
  read(name: string): string | undefined;
}

export interface SecretAccessRecord {
  name: string;
  version: number;
  purpose: string;
  at: string;
}

export interface RotationOutcome {
  name: string;
  previousVersion: number;
  newVersion: number;
  /** True when the value actually changed. A rotation to an identical value is reported as a no-op. */
  changed: boolean;
  /** Fingerprints only — never values. */
  previousFingerprint: string;
  newFingerprint: string;
  at: string;
}

/**
 * Environment-variable backend.
 *
 * Names map to upper-snake environment keys. The mapping is explicit rather than derived from the name
 * so a typo cannot silently resolve to a different variable, and so the inventory of resolvable secrets
 * is a reviewable list rather than "whatever happens to be in the environment".
 */
export class EnvironmentSecretBackend implements SecretBackend {
  readonly kind = 'environment';

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly mapping: Readonly<Record<string, string>> = DEFAULT_SECRET_ENVIRONMENT_MAPPING,
  ) {}

  read(name: string): string | undefined {
    const variable = this.mapping[name];
    if (!variable) return undefined;
    const value = this.environment[variable];
    return value === undefined || value === '' ? undefined : value;
  }

  /** Names this backend can resolve. Used by health output; contains no values. */
  knownNames(): string[] {
    return Object.keys(this.mapping);
  }
}

/**
 * The secrets this application may resolve by name.
 *
 * This is a subset of the SECRET-classified keys from the Group 8 inventory: only the ones that can
 * change at runtime without a schema or policy change. `DB_PASSWORD` is deliberately absent — rotating
 * the database password is a connection-pool operation with its own lifecycle, not a secret lookup, and
 * pretending otherwise would hide a restart requirement behind an interface that claims there is none.
 */
export const DEFAULT_SECRET_ENVIRONMENT_MAPPING = {
  'banking.monnify.apiKey': 'BANKING_MONNIFY_API_KEY',
  'banking.monnify.secretKey': 'BANKING_MONNIFY_SECRET_KEY',
  'banking.monnify.clientSecret': 'BANKING_MONNIFY_CLIENT_SECRET',
  'banking.monnify.contractCode': 'BANKING_MONNIFY_CONTRACT_CODE',
  'banking.monnify.apiKey.live': 'MONNIFY_API_KEY',
  'banking.monnify.secretKey.live': 'MONNIFY_SECRET_KEY',
  'kyc.dojah.secretKey': 'DOJAH_SECRET_KEY',
  'notification.brevo.apiKey': 'BREVO_API_KEY',
  'notification.resend.apiKey': 'RESEND_API_KEY',
  'settlement.robase.apiKey': 'ROBASE_API_KEY',
  'kyc.ownershipKey': 'KYC_OWNERSHIP_KEY_BASE64',
  'notification.encryptionKey': 'NOTIFICATION_PROVIDER_ENCRYPTION_KEY',
} as const;

export type SecretName = keyof typeof DEFAULT_SECRET_ENVIRONMENT_MAPPING;

export interface SecretResolverOptions {
  backend: SecretBackend;
  /** Injectable clock, so rotation timing is testable without sleeping. */
  now?: () => Date;
  /** Sink for access records. Defaults to discarding them; production wires the audit service. */
  onAccess?: (record: SecretAccessRecord) => void;
}

/**
 * Resolves and rotates secrets.
 *
 * Handles are cached per name. `rotated` handles stay valid — they keep the value they resolved — so a
 * request that started before a rotation completes with the key it began with rather than failing
 * halfway. That is the property that makes rotation safe to perform while serving traffic.
 */
export class SecretResolver {
  private readonly handles = new Map<string, SecretHandle>();
  private readonly versions = new Map<string, number>();
  private readonly backend: SecretBackend;
  private readonly now: () => Date;
  private readonly onAccess: (record: SecretAccessRecord) => void;

  constructor(options: SecretResolverOptions) {
    this.backend = options.backend;
    this.now = options.now ?? (() => new Date());
    this.onAccess = options.onAccess ?? (() => undefined);
  }

  /** Resolves a secret, throwing if it is unknown or unset. Throws carry no value, only the name. */
  resolve(name: string): SecretHandle {
    const existing = this.handles.get(name);
    if (existing) return existing;
    const handle = this.materialise(name, 1);
    this.handles.set(name, handle);
    this.versions.set(name, 1);
    return handle;
  }

  /**
   * Re-reads a secret and returns a new handle. Callers that already hold the old handle keep working.
   *
   * A rotation to an identical value is reported as `changed: false` and does not increment the version,
   * because a version bump that did not change the credential would make "which version signed this?"
   * ambiguous for no benefit.
   */
  rotate(name: string): RotationOutcome {
    const previous = this.handles.get(name);
    const previousVersion = previous?.version ?? 0;
    const previousFingerprint = previous?.fingerprint ?? '';
    const value = this.backend.read(name);
    if (value === undefined) {
      // A failed rotation must not silently keep the old value in service while reporting success.
      throw new Error(`Secret ${name} could not be rotated: the backend returned no value`);
    }
    const fingerprint = fingerprintOf(value);
    if (previous && previousFingerprint === fingerprint) {
      return {
        name,
        previousVersion,
        newVersion: previousVersion,
        changed: false,
        previousFingerprint,
        newFingerprint: fingerprint,
        at: this.now().toISOString(),
      };
    }
    const nextVersion = previousVersion + 1;
    this.handles.set(name, this.materialise(name, nextVersion, value, fingerprint));
    this.versions.set(name, nextVersion);
    return {
      name,
      previousVersion,
      newVersion: nextVersion,
      changed: true,
      previousFingerprint,
      newFingerprint: fingerprint,
      at: this.now().toISOString(),
    };
  }

  /** Rotates every known secret. Returns one outcome per name that resolved. */
  rotateAll(): RotationOutcome[] {
    return this.knownNames()
      .filter((name) => this.handles.has(name) || this.backend.read(name) !== undefined)
      .map((name) => this.rotate(name));
  }

  /**
   * Names available from the backend. Contains no values, so it is safe in a health payload — but it is
   * still only the *names* that are configured, not their contents.
   */
  knownNames(): string[] {
    return this.backend instanceof EnvironmentSecretBackend
      ? this.backend.knownNames()
      : [...this.handles.keys()];
  }

  /**
   * Rotation status for health output: names, versions, fingerprints and timestamps. Explicitly built
   * field by field rather than by serialising a handle, so a future field added to a handle cannot leak
   * by being picked up automatically.
   */
  describe(): Array<{ name: string; version: number; fingerprint: string; resolvedAt: string }> {
    return [...this.handles.values()].map((handle) => ({
      name: handle.name,
      version: handle.version,
      fingerprint: handle.fingerprint,
      resolvedAt: handle.resolvedAt,
    }));
  }

  private materialise(
    name: string,
    version: number,
    preselected?: string,
    preselectedFingerprint?: string,
  ): SecretHandle {
    const value = preselected ?? this.backend.read(name);
    if (value === undefined) {
      throw new Error(`Secret ${name} is not configured (backend: ${this.backend.kind})`);
    }
    const fingerprint = preselectedFingerprint ?? fingerprintOf(value);
    const resolvedAt = this.now().toISOString();
    const onAccess = this.onAccess;
    let accessCount = 0;

    const handle: SecretHandle = {
      name,
      version,
      fingerprint,
      resolvedAt,
      reveal(purpose: string): string {
        accessCount += 1;
        onAccess({ name, version, purpose, at: new Date().toISOString() });
        return value;
      },
      toString(): string {
        return `[Secret ${name} v${version} ${fingerprint}]`;
      },
      toJSON(): Record<string, string | number> {
        return { name, version, fingerprint, resolvedAt, accessCount, value: REDACTED_VALUE };
      },
    };
    // Freeze so a caller cannot bolt a `value` property onto the handle and defeat the whole point.
    return Object.freeze(handle);
  }
}

function fingerprintOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Process-wide resolver. Constructed lazily so importing this module has no side effects. */
let singleton: SecretResolver | undefined;

export function getSecretResolver(): SecretResolver {
  if (!singleton) {
    singleton = new SecretResolver({ backend: new EnvironmentSecretBackend() });
  }
  return singleton;
}

/** Test seam. Passing `undefined` restores lazy construction. */
export function setSecretResolver(resolver: SecretResolver | undefined): void {
  singleton = resolver;
}

/** Correlation id for a rotation operation, so an audit trail can group the outcomes. */
export function rotationCorrelationId(): string {
  return `rot_${randomUUID()}`;
}
