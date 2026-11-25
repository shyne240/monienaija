import { BadRequestException } from '@nestjs/common';
import { lagosBoundary, HISTORY_SQL, HISTORY_LIST_SQL } from './transaction-history.controller';
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

describe('History list projection optimization', () => {
  test('only detail investigation construction differs; scope, keys and journals are shared', () => {
    // Every source uses the same template. Detail-only JSON and its audit lookup are
    // deliberately absent from list plans; no second identity/scope implementation.
    expect(HISTORY_SQL).toContain('jsonb_build_object');
    expect(HISTORY_SQL).toContain('redemptionMethod');
    expect(HISTORY_LIST_SQL).not.toContain('jsonb_build_object');
    expect(HISTORY_LIST_SQL).not.toContain('SELECT e.new_values');
    expect(HISTORY_LIST_SQL).toContain('workforce_institution_assignments');
    expect(HISTORY_LIST_SQL).toContain('banking_inbound_float_links');
    expect(HISTORY_LIST_SQL).toContain('customer_funding_scope_evidence');
    expect(HISTORY_LIST_SQL).toContain('ARRAY[t.journal_id,t.claim_journal_id]');
  });
});
