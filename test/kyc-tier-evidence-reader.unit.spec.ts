import type { EntityManager } from 'typeorm';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';

const customerId = '00000000-0000-4000-8000-000000000001';
const evidenceId = '00000000-0000-4000-8000-000000000002';

describe('KycTierEvidenceReader', () => {
  it('binds provider evidence to the current identity revision and the consented provider route', async () => {
    const verifiedAt = new Date('2026-11-15T10:00:00Z');
    const expiresAt = new Date('2026-11-16T10:00:00Z');
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const query = jest.fn((sql: string, parameters?: unknown[]) => {
      statements.push({ sql, parameters: parameters ?? [] });
      if (statements.length === 1) return Promise.resolve([{ revision: '2' }]);
      return Promise.resolve([
        {
          id: evidenceId,
          customer_id: customerId,
          identity_revision: '2',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verified_at: verifiedAt,
          expires_at: expiresAt,
        },
      ]);
    });
    const manager = { query } as unknown as EntityManager;

    await expect(new KycTierEvidenceReader().read(manager, customerId)).resolves.toEqual({
      identityRevision: '2',
      evidence: [
        {
          id: evidenceId,
          customerId,
          identityRevision: '2',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt,
          expiresAt,
        },
      ],
    });
    expect(statements[1]?.sql).toContain('a.identity_revision=$2::bigint');
    expect(statements[1]?.sql).toContain('c.provider=a.provider');
    expect(statements[1]?.sql).toContain('c.route_version=a.provider_route_version');
    expect(statements[1]?.parameters).toEqual([customerId, '2']);
  });

  it('returns unavailable when the customer has no valid revision row', async () => {
    const query = jest.fn().mockResolvedValue([{ revision: '0' }]);
    const manager = { query } as unknown as EntityManager;
    await expect(new KycTierEvidenceReader().read(manager, customerId)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
