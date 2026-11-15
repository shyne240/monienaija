import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { TierEvidenceSnapshot } from '../../src/kyc-verification/kyc-tier-evidence.reader';
import { seedGovernedTierPolicy } from './kyc-test-fixtures';

/** Explicit, local-only provider override for integration subjects; never used by AppModule. */
export class TrustedTierFixture {
  private readonly snapshots = new Map<string, TierEvidenceSnapshot>();

  read(_manager: EntityManager, customerId: string): Promise<TierEvidenceSnapshot | null> {
    return Promise.resolve(this.snapshots.get(customerId) ?? null);
  }

  async seedPolicy(db: DataSource): Promise<void> {
    const req = { all: [], any: [] };
    await seedGovernedTierPolicy(db, {
      definition: {
        regulatoryRequirementsConfirmed: true,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        regulatory: { LEVEL_1: req, LEVEL_2: req, LEVEL_3: req },
        operator: { LEVEL_1: req, LEVEL_2: req, LEVEL_3: req },
      },
      makerId: 'fixture-maker',
      checkerId: 'fixture-checker',
    });
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
