import {
  AUTHORIZATION_FUNCTION_SEED,
  AUTHORIZATION_ROLE_FUNCTION_SEED,
} from '../src/authorization-catalogue/authorization-catalogue.seed';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

describe('secure Proof of Address authorization boundary', () => {
  const requiredCodes = [
    'customer.view_proof_of_address_metadata',
    'customer.upload_proof_of_address',
    'customer.download_proof_of_address',
    'customer.withdraw_proof_of_address',
    'customer.archive_proof_of_address',
  ];

  it('catalogues every PoA action as a distinct sensitive function', () => {
    for (const code of requiredCodes) {
      const entry = AUTHORIZATION_FUNCTION_SEED.find((item) => item.functionCode === code);
      expect(entry).toMatchObject({
        sensitivity: 'SENSITIVE',
        assignable: true,
        v1Status: 'IMPLEMENTED',
      });
    }
  });

  it('grants uploads/withdrawals to operations and content/archive access to compliance', () => {
    const grants = new Set(
      AUTHORIZATION_ROLE_FUNCTION_SEED.map(
        ({ roleKey, functionCode }) => `${roleKey}:${functionCode}`,
      ),
    );
    expect(grants.has('OPERATIONS:customer.upload_proof_of_address')).toBe(true);
    expect(grants.has('OPERATIONS:customer.withdraw_proof_of_address')).toBe(true);
    expect(grants.has('COMPLIANCE:customer.download_proof_of_address')).toBe(true);
    expect(grants.has('COMPLIANCE:customer.archive_proof_of_address')).toBe(true);
    expect(grants.has('FINANCE_AUDITOR:customer.download_proof_of_address')).toBe(false);
    expect(grants.has('CUSTOMER_SERVICE:customer.upload_proof_of_address')).toBe(false);
  });

  it('requires a workforce session and never exposes PoA as a customer self-service route', () => {
    const resolution = new RoutePolicyRegistry().resolve({
      method: 'GET',
      url: '/api/v1/customers/2a6d0906-8c3e-4cac-b683-29c0a1d5354e/proof-of-address',
      params: { customerId: '2a6d0906-8c3e-4cac-b683-29c0a1d5354e' },
    });
    expect(resolution).toMatchObject({
      public: false,
      authenticationMode: 'WORKFORCE_SESSION',
      resourceType: 'customer-proof-of-address',
      customerId: '2a6d0906-8c3e-4cac-b683-29c0a1d5354e',
      policy: {
        allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
        customerAccess: 'SELF',
      },
    });
    expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
  });
});
