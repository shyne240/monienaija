import { BadRequestException } from '@nestjs/common';
import { lagosBoundary } from './transaction-history.controller';
import { RoutePolicyRegistry } from '../authorization/route-policy-registry';

describe('Transaction history shared authorization contract', () => {
  test.each([
    '/api/v1/internal/admin/transaction-history',
    '/api/v1/internal/admin/transaction-history/CASH_TO_CASH/11111111-1111-4111-8111-111111111111',
  ])('requires a workforce session and transaction.view on %s', (url) => {
    const policy = new RoutePolicyRegistry().resolve({ method: 'GET', url });
    expect(policy).toMatchObject({
      public: false,
      authenticationMode: 'WORKFORCE_SESSION',
      policy: {
        requiredFunctions: ['transaction.view'],
        allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
      },
    });
  });
  test('calendar days are Lagos days, never server-local days', () => {
    expect(lagosBoundary('2026-11-24')).toBe('2026-11-23T23:00:00.000Z');
    expect(lagosBoundary('2024-02-29')).toBe('2024-02-28T23:00:00.000Z');
    for (const day of ['2026-02-29', '2026-99-99', '2026-11-31', '2026-1-1', 'bad'])
      expect(() => lagosBoundary(day)).toThrow(BadRequestException);
  });
});
