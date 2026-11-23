import type { EntityManager } from 'typeorm';
import type { TierEvidence } from './kyc-tier-decision';

export interface TierEvidenceSnapshot {
  /** Monotonic, database-managed customer identity revision. */
  identityRevision: string;
  evidence: TierEvidence[];
}
type EvidenceRow = {
  id: string;
  customer_id: string;
  identity_revision: string;
  type: TierEvidence['type'];
  status: TierEvidence['status'];
  provenance: TierEvidence['provenance'];
  verified_at: Date | null;
  expires_at: Date | null;
};

/**
 * Read only evidence produced by the durable provider-verification store. The SQL binds each
 * result to the currently live customer consent, a completed attempt, the verified ownership
 * claim, and the monotonic identity revision captured when the provider call was reserved.
 * Historical attempts without a revision, synthetic registration attempts, caller-supplied
 * evidence, and provider payloads are never admitted here.
 */
export interface TierEvidenceReadOptions {
  /**
   * Row-lock strength for the identity-revision read.
   *
   * `SHARE` (default) keeps the existing concurrency contract: a revision cannot be advanced
   * while the evidence is being read. `NONE` omits the lock entirely and exists ONLY for callers
   * inside a database-enforced `READ ONLY` transaction, where PostgreSQL rejects `FOR SHARE`.
   * Such a caller is reporting evidence, never admitting a financial operation.
   */
  lockMode?: 'SHARE' | 'NONE';
}

export class KycTierEvidenceReader {
  async read(
    manager: EntityManager,
    customerId: string,
    options: TierEvidenceReadOptions = {},
  ): Promise<TierEvidenceSnapshot | null> {
    const revisionLock = options.lockMode === 'NONE' ? '' : 'FOR SHARE';
    const revisions = await manager.query<Array<{ revision: string }>>(
      `SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1 ${revisionLock}`,
      [customerId],
    );
    const identityRevision = revisions[0]?.revision;
    if (!identityRevision || !/^[1-9][0-9]{0,18}$/.test(identityRevision)) return null;

    const rows = await manager.query<EvidenceRow[]>(
      `WITH ranked AS (
        SELECT a.id,a.customer_id,a.identity_revision::text AS identity_revision,
          a.kind AS type,
          CASE
            WHEN a.outcome='MATCH' AND ic.status='VERIFIED' THEN 'VERIFIED'
            ELSE 'REVIEW'
          END AS status,
          CASE WHEN a.provider='SYNTHETIC' THEN 'SYNTHETIC' ELSE 'VERIFIED_PROVIDER' END AS provenance,
          a.completed_at AS verified_at,a.expires_at,
          row_number() OVER (PARTITION BY a.kind ORDER BY a.completed_at DESC NULLS LAST,a.created_at DESC,a.id DESC) AS position
        FROM kyc_verification_attempts a
        JOIN kyc_consents c ON c.id=a.consent_id AND c.customer_id=a.customer_id AND c.kind=a.kind
          AND c.actor_id=a.customer_id AND c.identity_revision=a.identity_revision
          AND c.provider=a.provider AND c.route_version=a.provider_route_version
        JOIN authentication_sessions owner_session ON owner_session.id=c.session_id
          AND owner_session.customer_id=a.customer_id
          AND owner_session.audience IN ('customer-api','customer-onboarding')
        JOIN kyc_identity_claims ic ON ic.attempt_id=a.id AND ic.customer_id=a.customer_id
          AND ic.kind=a.kind
        WHERE a.customer_id=$1 AND a.identity_revision=$2::bigint
          AND a.provider IN ('MONNIFY','DOJAH','PREMBLY')
          AND a.provider_route_version IS NOT NULL
          AND c.session_id IS NOT NULL AND c.withdrawn_at IS NULL
          AND c.expires_at>clock_timestamp()
          AND a.outcome IN ('MATCH','REVIEW','UNKNOWN')
          AND ic.status IN ('VERIFIED','REVIEW','UNKNOWN')
      )
      SELECT id,customer_id,identity_revision,type,status,provenance,verified_at,expires_at
      FROM ranked
      WHERE position=1 AND (status<>'VERIFIED' OR expires_at>clock_timestamp())
      ORDER BY type,id`,
      [customerId, identityRevision],
    );

    const evidence = rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      identityRevision: row.identity_revision,
      type: row.type,
      status: row.status,
      provenance: row.provenance,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
    }));
    return { identityRevision, evidence };
  }
}
