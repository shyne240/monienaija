import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

/**
 * Admin Web Finance Operations route registration.
 *
 * The point of these assertions is that the surface does not fall through to the generic
 * `/api/v1/internal/` branch, which authenticates a workforce caller without constraining the
 * capability. Each route must name the same catalogue function its controller re-checks, and no
 * new mutation route may be introduced by a read-model module.
 */
const registry = new RoutePolicyRegistry();
const JOURNAL_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Finance Operations route policies', () => {
  it.each([
    ['GET', '/api/v1/internal/finance-operations/ledger/journals', 'ledger.view'],
    ['GET', `/api/v1/internal/finance-operations/ledger/journals/${JOURNAL_ID}`, 'ledger.view'],
    [
      'GET',
      `/api/v1/internal/finance-operations/ledger/journals/${JOURNAL_ID}/reversal-eligibility`,
      'ledger.view',
    ],
    [
      'GET',
      '/api/v1/internal/finance-operations/transactions/00000000-0000-4000-8000-00000000aa01/journal',
      'transaction.view',
    ],
    [
      'GET',
      '/api/v1/internal/finance-operations/reconciliation/institutions',
      'reconciliation.view',
    ],
    ['GET', '/api/v1/internal/finance-operations/reconciliation/breaks', 'reconciliation.view'],
  ])('%s %s declares %s', (method, url, functionCode) => {
    const resolution = registry.resolve({
      method,
      url: `${url}?reference=SYNTH&from=2026-11-01&to=2026-11-30`,
    });
    expect(resolution.public).toBe(false);
    expect(resolution.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(resolution.policy?.requiredFunctions).toEqual([functionCode]);
    expect(resolution.policy?.allowedPrincipalTypes).toEqual(['OPERATOR', 'SERVICE', 'PRIVILEGED']);
    expect(resolution.policy?.action).toBe(`${method}:${url}`);
    expect(resolution.auditDeniedWorkforceFunction).toBe(true);
    expect(resolution.policy?.customerAccess).toBe('NONE');
  });

  it('does not invent a write route for the finance operations surface', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const resolution = registry.resolve({
        method,
        url: `/api/v1/internal/finance-operations/ledger/journals/${JOURNAL_ID}/reversal`,
      });
      // It intentionally falls through to the generic internal branch (no dedicated capability),
      // and the reversal itself remains on the registered POST /api/v1/ledger route.
      expect(resolution.policy?.requiredFunctions ?? []).toEqual([]);
      expect(resolution.resourceType).toBe('internal-route');
    }
  });

  it('keeps the governed reversal write routes on the ledger controller, not this module', () => {
    const requestReversal = registry.resolve({
      method: 'POST',
      url: `/api/v1/ledger/journals/${JOURNAL_ID}/reversal-request`,
    });
    expect(requestReversal.public).toBe(false);
    expect(requestReversal.authenticationMode).toBe('WORKFORCE_SESSION');

    const execute = registry.resolve({
      method: 'POST',
      url: `/api/v1/ledger/journals/${JOURNAL_ID}/reversal`,
    });
    expect(execute.public).toBe(false);
    expect(execute.authenticationMode).toBe('WORKFORCE_SESSION');
  });

  it('keeps institution-addressed reconciliation behind the reconciliation function', () => {
    const resolution = registry.resolve({
      method: 'GET',
      url: `/api/v1/internal/banking/reconciliation/${INSTITUTION_ID}/exceptions`,
    });
    expect(resolution.policy?.requiredFunctions).toEqual(['reconciliation.view']);
    const resolve = registry.resolve({
      method: 'POST',
      url: '/api/v1/internal/banking/reconciliation/exceptions/33333333-3333-4333-8333-333333333333/resolve',
    });
    expect(resolve.policy?.requiredFunctions).toEqual(['banking.reconciliation.resolve']);
  });
});
