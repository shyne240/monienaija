import type { EntityManager } from 'typeorm';
import { identityBindingMac } from '../../src/kyc-verification/kyc-orchestrator';
import type { TierEvidence } from '../../src/kyc-verification/kyc-tier-decision';

/** Test-only evidence adapter; never registered in the application. */
export interface IsolatedEvidenceTrust {
  provider: 'ISOLATED_TRUSTED_FIXTURE';
  key: Buffer;
  keyVersion: string;
}
export interface TierEvidenceSnapshot {
  identityRevision: string;
  evidence: TierEvidence[];
}
export class FixtureEvidenceReader {
  constructor(private readonly isolatedTrust: IsolatedEvidenceTrust | null = null) {
    if (
      isolatedTrust &&
      (process.env.NODE_ENV !== 'test' ||
        isolatedTrust.provider !== 'ISOLATED_TRUSTED_FIXTURE' ||
        isolatedTrust.key.length < 32)
    )
      throw new Error('Isolated evidence trust requires a test runtime');
  }
  /**
   * A null snapshot means unavailable, not an absence of evidence. Never turn it
   * into an automatic upgrade or downgrade. A provider must be enabled here only
   * after its account, API contract, authenticated provenance and key source are
   * confirmed. No such production provider is currently enabled.
   */
  async read(m: EntityManager, customerId: string): Promise<TierEvidenceSnapshot | null> {
    const trust = this.isolatedTrust;
    if (!trust || process.env.NODE_ENV !== 'test') return null;
    const profiles = await m.query<
      Array<{ first_name: string | null; last_name: string | null; date_of_birth: string | null }>
    >(
      `SELECT first_name,last_name,date_of_birth::text AS date_of_birth FROM customer_profiles WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL FOR SHARE`,
      [customerId],
    );
    const phones = await m.query<Array<{ normalized_value: string }>>(
      `SELECT normalized_value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL FOR SHARE`,
      [customerId],
    );
    const p = profiles[0],
      phone = phones[0];
    if (!p?.first_name || !p.last_name || !p.date_of_birth || phones.length !== 1 || !phone)
      return null;
    const binding = identityBindingMac(
      customerId,
      {
        firstName: p.first_name,
        lastName: p.last_name,
        dateOfBirth: p.date_of_birth,
        phone: phone.normalized_value,
      },
      trust.key,
    );
    const rows = await m.query<
      Array<{
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
      }>
    >(
      `SELECT a.id,a.kind,a.outcome,a.identity_mac,a.mac_key_version,a.completed_at,a.expires_at,
      (c.session_id IS NOT NULL AND c.withdrawn_at IS NULL AND c.expires_at>clock_timestamp()) AS consent_active,c.expires_at AS consent_expires_at,cl.status AS claim_status
      FROM kyc_verification_attempts a JOIN kyc_consents c ON c.id=a.consent_id
      LEFT JOIN kyc_identity_claims cl ON cl.attempt_id=a.id
      WHERE a.customer_id=$1 AND a.provider=$2 ORDER BY a.created_at,a.id FOR SHARE OF a,c`,
      [customerId, trust.provider],
    );
    const evidence: TierEvidence[] = rows
      .filter((r) => r.outcome !== 'DISPATCHING')
      .map((r) => ({
        id: r.id,
        customerId,
        identityRevision:
          r.identity_mac === binding && r.mac_key_version === trust.keyVersion
            ? binding
            : 'IDENTITY_MISMATCH',
        type: r.kind,
        status: !r.consent_active
          ? 'REVOKED'
          : r.outcome === 'MATCH' && r.claim_status === 'VERIFIED'
            ? 'VERIFIED'
            : 'REVIEW',
        provenance: 'VERIFIED_PROVIDER',
        verifiedAt: r.completed_at,
        expiresAt:
          r.expires_at && r.consent_expires_at < r.expires_at ? r.consent_expires_at : r.expires_at,
      }));
    return { identityRevision: binding, evidence };
  }
}
