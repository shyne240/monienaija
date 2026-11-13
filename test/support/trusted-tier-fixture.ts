import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { TierEvidenceSnapshot } from '../../src/kyc-verification/kyc-tier-evidence.reader';

/** Explicit, local-only provider override for integration subjects; never used by AppModule. */
export class TrustedTierFixture {
  private readonly snapshots = new Map<string, TierEvidenceSnapshot>();

  read(_manager: EntityManager, customerId: string): Promise<TierEvidenceSnapshot | null> {
    return Promise.resolve(this.snapshots.get(customerId) ?? null);
  }

  async seedPolicy(db: DataSource): Promise<void> {
    const req = { all: [], any: [] };
    const definition = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: req, LEVEL_2: req },
      operator: { LEVEL_1: req, LEVEL_2: req },
    };
    const proposal = randomUUID();
    await db.query(
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'fixture-maker',$5,'fixture-checker',$6,'APPROVED')`,
      [
        proposal,
        randomUUID(),
        JSON.stringify(definition),
        'a'.repeat(64),
        randomUUID(),
        randomUUID(),
      ],
    );
    await db.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'fixture-maker','fixture-checker') ON CONFLICT (version) DO NOTHING`,
      [proposal, JSON.stringify(definition)],
    );
    // The suite-wide TRUNCATE removes the singleton head row created by migration 1785753600110, so
    // restore it explicitly rather than relying on an UPDATE that would affect zero rows.
    await db.query(
      `INSERT INTO kyc_tier_policy_head(singleton,version) VALUES(true,1)
       ON CONFLICT (singleton) DO UPDATE SET version=GREATEST(kyc_tier_policy_head.version,1)`,
    );
  }

  async approveLevelOne(db: DataSource, customerId: string): Promise<void> {
    await db.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [customerId],
    );
    this.snapshots.set(customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
  }

  withdraw(customerId: string): void {
    this.snapshots.delete(customerId);
  }
}
