import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { TestingModuleBuilder } from '@nestjs/testing';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../../src/kyc-verification/kyc-tier-evidence.reader';
import type { TierEvidence } from '../../src/kyc-verification/kyc-tier-decision';
import { identityBindingMac } from '../../src/kyc-verification/kyc-orchestrator';

/**
 * Shared **test-only** trusted-evidence reader.
 *
 * The production `KycTierEvidenceReader` returns `null` unconditionally, because no provider's
 * account, contract, authenticated provenance and key source have been confirmed for live use.
 * That is correct in production, and it is also why every integration suite that reaches a
 * financial gate fails closed with "Trusted KYC evidence is unavailable".
 *
 * This module supplies the missing seam **for tests only**, without weakening the production
 * reader and without adding any bypass to application code:
 *
 *   - it is not referenced by any application module; suites must opt in explicitly with
 *     `overrideTrustedEvidenceReader()`;
 *   - it refuses to construct unless `NODE_ENV === 'test'`;
 *   - its trust anchor is a per-process random key, so it cannot reproduce real provider
 *     evidence and cannot be pointed at production data;
 *   - **it is not eligible by default.** A suite must ask for `ELIGIBLE`; the default mode
 *     returns `null`, which preserves fail-closed behaviour for suites that test rejection;
 *   - it reads real `kyc_verification_attempts` / `kyc_consents` / `kyc_identity_claims` rows,
 *     so an eligible customer still needs genuine, current, consent-backed evidence in the
 *     database. Nothing is fabricated in memory.
 *
 * The identity binding reuses the production `identityBindingMac` contract, so the revision this
 * reader reports is exactly the one the production reader would compute from the same rows.
 */

export type TrustedEvidenceMode = 'UNAVAILABLE' | 'ELIGIBLE';

/** Domain-separated identity binding, mirroring the production `identityBindingMac` contract. */
export function identityBindingMacForTest(
  customerId: string,
  identity: { firstName: string; lastName: string; dateOfBirth: string; phone: string },
  key: Buffer,
): string {
  return identityBindingMac(customerId, identity, key);
}

export interface TestEvidenceReaderOptions {
  /**
   * `UNAVAILABLE` (default) reproduces production behaviour: no trusted evidence, so any
   * financial gate fails closed. `ELIGIBLE` returns evidence derived from real rows seeded by
   * `seedIdentityEvidence`, bound to a per-process key the suite can reproduce to compute the
   * identity revision.
   */
  mode?: TrustedEvidenceMode;
  key?: Buffer;
  keyVersion?: string;
}

export interface TestEvidenceReaderHandle {
  reader: KycTierEvidenceReader;
  mode: TrustedEvidenceMode;
  keyVersion: string;
  /** The MAC a seeded customer's evidence must carry for this reader to consider it verified. */
  identityMacFor(
    customerId: string,
    identity: { firstName: string; lastName: string; dateOfBirth: string; phone: string },
  ): string;
}

const KEY_VERSION = 'test-v1';

/**
 * Builds a reader bound to a fresh per-process key. Call once per suite, keep the handle, and
 * use `handle.identityMacFor(...)` when seeding evidence so the MAC matches the trust anchor.
 */
export function createTestEvidenceReader(
  options: TestEvidenceReaderOptions = {},
): TestEvidenceReaderHandle {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The trusted-evidence test reader may only be constructed under NODE_ENV=test');
  }
  const mode = options.mode ?? 'UNAVAILABLE';
  const key: Buffer = options.key ?? randomBytes(32);
  const keyVersion = options.keyVersion ?? KEY_VERSION;
  if (key.length < 32) throw new Error('Test evidence trust key must be at least 32 bytes');

  class TestKycTierEvidenceReader extends KycTierEvidenceReader {
    readonly mode: TrustedEvidenceMode = mode;

    override async read(
      manager: EntityManager,
      customerId: string,
    ): Promise<TierEvidenceSnapshot | null> {
      if (mode !== 'ELIGIBLE') return null;

      const profiles: Array<{
        first_name: string | null;
        last_name: string | null;
        date_of_birth: string | null;
      }> = await manager.query(
        `SELECT first_name, last_name, date_of_birth::text AS date_of_birth
           FROM customer_profiles
          WHERE customer_id = $1 AND is_active = true AND deleted_at IS NULL
          FOR SHARE`,
        [customerId],
      );
      const phones: Array<{ normalized_value: string }> = await manager.query(
        `SELECT normalized_value
           FROM customer_contact_methods
          WHERE customer_id = $1 AND type = 'PHONE' AND is_primary = true
            AND verified_at IS NOT NULL AND deleted_at IS NULL
          FOR SHARE`,
        [customerId],
      );
      const profile = profiles[0];
      const phone = phones[0];
      // Same rule as production: exactly one verified primary phone, and a complete identity.
      if (
        !profile?.first_name ||
        !profile.last_name ||
        !profile.date_of_birth ||
        phones.length !== 1 ||
        !phone
      ) {
        return null;
      }

      const binding = identityBindingMac(
        customerId,
        {
          firstName: profile.first_name,
          lastName: profile.last_name,
          dateOfBirth: profile.date_of_birth,
          phone: phone.normalized_value,
        },
        key,
      );

      const rows: Array<{
        id: string;
        kind: 'BVN' | 'NIN';
        outcome: string;
        identity_mac: string;
        mac_key_version: string;
        completed_at: Date | null;
        expires_at: Date | null;
        consent_active: boolean;
        consent_expires_at: Date;
        claim_status: string | null;
      }> = await manager.query(
        `SELECT a.id, a.kind, a.outcome, a.identity_mac, a.mac_key_version, a.completed_at,
                a.expires_at,
                (c.withdrawn_at IS NULL AND c.expires_at > clock_timestamp()) AS consent_active,
                c.expires_at AS consent_expires_at,
                cl.status AS claim_status
           FROM kyc_verification_attempts a
           JOIN kyc_consents c ON c.id = a.consent_id
           LEFT JOIN kyc_identity_claims cl ON cl.attempt_id = a.id
          WHERE a.customer_id = $1
          ORDER BY a.created_at, a.id
          FOR SHARE OF a, c`,
        [customerId],
      );

      const evidence: TierEvidence[] = rows
        .filter((row) => row.outcome !== 'DISPATCHING')
        .map((row) => {
          // Constant-time comparison: an unverified MAC must never be treated as matching.
          const expected = Buffer.from(binding, 'hex');
          const actual = Buffer.from(row.identity_mac ?? '', 'hex');
          const macMatches = expected.length === actual.length && timingSafeEqual(expected, actual);
          return {
            id: row.id,
            customerId,
            identityRevision:
              macMatches && row.mac_key_version === keyVersion ? binding : 'IDENTITY_MISMATCH',
            type: row.kind,
            status: !row.consent_active
              ? 'REVOKED'
              : row.outcome === 'MATCH' && row.claim_status === 'VERIFIED'
                ? 'VERIFIED'
                : 'REVIEW',
            provenance: 'VERIFIED_PROVIDER',
            verifiedAt: row.completed_at,
            expiresAt:
              row.expires_at && row.consent_expires_at < row.expires_at
                ? row.consent_expires_at
                : row.expires_at,
          };
        });

      return { identityRevision: binding, evidence };
    }
  }

  const reader = new TestKycTierEvidenceReader();
  return {
    reader,
    mode,
    keyVersion,
    identityMacFor: (customerId, identity) => identityBindingMac(customerId, identity, key),
  };
}

/**
 * Applies a test evidence reader to a TestingModuleBuilder. Explicit opt-in: nothing in this
 * repository installs it automatically, so a suite that exercises KYC *rejection* keeps the
 * fail-closed production reader unless it deliberately asks for eligible evidence.
 */
export function overrideTrustedEvidenceReader(
  builder: TestingModuleBuilder,
  handle: TestEvidenceReaderHandle,
): TestingModuleBuilder {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Overriding trusted KYC evidence is only permitted under NODE_ENV=test');
  }
  return builder.overrideProvider(KycTierEvidenceReader).useValue(handle.reader);
}

// Re-exported so suites can reference the token without a second import path.
export { KycTierEvidenceReader };
