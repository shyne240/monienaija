import { ServiceUnavailableException } from '@nestjs/common';
import { type EntityManager, QueryFailedError } from 'typeorm';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import type { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import type { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';

// Test an abort at each dependency boundary, not a successful KYC decision. Nothing in
// this fixture is a substitute for the PG suites' real policy and trusted evidence setup.
describe.each(['policy', 'evidence'] as const)('Financial eligibility %s boundary', (boundary) => {
  async function refused(error: Error) {
    const policies = { effective: jest.fn().mockResolvedValue({}) };
    const reader = { read: jest.fn() };
    (boundary === 'policy' ? policies.effective : reader.read).mockRejectedValue(error);
    const service = new CustomerFinancialEligibilityService(
      policies as unknown as KycTierPolicyService,
      reader as unknown as KycTierEvidenceReader,
    );
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM customers'))
        return [
          {
            status: 'ACTIVE',
            kyc_status: 'APPROVED',
            kyc_level: 'LEVEL_1',
            deleted_at: null,
            is_synthetic: false,
          },
        ];
      if (sql.includes('clock_timestamp()')) return [{ now: new Date() }];
      if (sql.includes('FROM kyc_tier_manual_holds') || sql.includes('FROM kyc_identity_conflicts'))
        return [];
      if (sql.includes('FROM customer_contact_methods')) return [{ id: 'fixture' }];
      throw new Error('Unexpected query after failed authority');
    });
    return service.require({ query } as unknown as EntityManager, 'fixture-customer');
  }

  it.each(['40001', '40P01'])('preserves the original %s transaction abort', async (code) => {
    const error = new QueryFailedError(
      'SELECT 1',
      [],
      Object.assign(new Error('aborted'), { code }),
    );
    await expect(refused(error)).rejects.toBe(error);
  });

  it('does not treat an arbitrary dependency failure as retryable, even if it supplies a code', async () => {
    const unavailable = Object.assign(new Error('unavailable'), { code: '40001' });
    await expect(refused(unavailable)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
