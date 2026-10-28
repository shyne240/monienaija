import { GUARDS_METADATA } from '@nestjs/common/constants';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { CustomerComplianceAccessGuard } from '../src/customer-compliance/customer-compliance-access.guard';
import { CustomerComplianceController } from '../src/customer-compliance/customer-compliance.controller';
import {
  NON_FRAUD_CASE_CATEGORIES,
  FRAUD_CASE_CATEGORIES,
} from '../src/customer-compliance/customer-compliance-access';
import { ComplianceCaseCategory } from '../src/customer-compliance/customer-compliance.enums';

describe('customer compliance route boundary', () => {
  it.each(['GET', 'POST', 'PATCH'])(
    'resolves %s case paths to workforce, before the generic customer rule',
    (method) => {
      const result = new RoutePolicyRegistry().resolve({
        method,
        url: '/api/v1/customers/customer-id/compliance-cases/case-id/evidence?limit=1',
        params: { id: 'customer-id', caseId: 'case-id' },
      });
      expect(result.authenticationMode).toBe('WORKFORCE_SESSION');
      expect(result.resourceType).toBe('customer-compliance-case');
      expect(result.customerId).toBe('customer-id');
      expect(result.resourceId).toBe('case-id');
      expect(result.policy?.allowedPrincipalTypes).toEqual(['OPERATOR', 'PRIVILEGED']);
    },
  );

  it('attaches the case-function guard to the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CustomerComplianceController,
    ) as unknown as unknown[];
    expect(guards).toContain(CustomerComplianceAccessGuard);
  });

  it('explicitly partitions every current category and does not silently authorize new ones', () => {
    expect(FRAUD_CASE_CATEGORIES).toEqual([ComplianceCaseCategory.FRAUD]);
    expect(NON_FRAUD_CASE_CATEGORIES).not.toContain(ComplianceCaseCategory.FRAUD);
    expect([...NON_FRAUD_CASE_CATEGORIES, ...FRAUD_CASE_CATEGORIES].sort()).toEqual(
      Object.values(ComplianceCaseCategory).sort(),
    );
  });
});
