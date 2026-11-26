import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

/**
 * Platform Funds vs. Bank Balance route registration.
 *
 * The point of these assertions is that the surface does not fall through to the generic
 * `/api/v1/internal/` branch, which authenticates a workforce caller without constraining the
 * capability — and that no write route was smuggled onto a read-looking pattern. Each route must
 * name the same catalogue function its controller re-checks (`ledger.view`; no function is
 * invented), be WORKFORCE_SESSION, and audit denied workforce functions.
 */
const registry = new RoutePolicyRegistry();
const COMPARISON_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const BASE = '/api/v1/internal/finance-operations/platform-funds';

describe('Platform Funds route policies', () => {
  it.each([
    ['GET', `${BASE}/scope`],
    ['GET', `${BASE}/settlement-accounts`],
    ['GET', `${BASE}/comparisons`],
    ['POST', `${BASE}/comparisons/preview`],
    ['POST', `${BASE}/comparisons`],
    ['GET', `${BASE}/comparisons/${COMPARISON_ID}`],
    ['PATCH', `${BASE}/comparisons/${COMPARISON_ID}`],
    ['POST', `${BASE}/comparisons/${COMPARISON_ID}/timing-items`],
    ['DELETE', `${BASE}/comparisons/${COMPARISON_ID}/timing-items/${ITEM_ID}`],
    ['POST', `${BASE}/comparisons/${COMPARISON_ID}/submit`],
    ['POST', `${BASE}/comparisons/${COMPARISON_ID}/review`],
    ['GET', `${BASE}/comparisons/${COMPARISON_ID}/snapshots`],
  ])('%s %s declares ledger.view on WORKFORCE_SESSION', (method, url) => {
    const resolution = registry.resolve({ method, url });
    expect(resolution.public).toBe(false);
    expect(resolution.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(resolution.policy?.requiredFunctions).toEqual(['ledger.view']);
    expect(resolution.policy?.allowedPrincipalTypes).toEqual(['OPERATOR', 'SERVICE', 'PRIVILEGED']);
    expect(resolution.policy?.action).toBe(`${method}:${url}`);
    expect(resolution.auditDeniedWorkforceFunction).toBe(true);
    expect(resolution.policy?.customerAccess).toBe('NONE');
    expect(resolution.policy?.agentAccess).toBe('NONE');
    expect(resolution.policy?.aggregatorAccess).toBe('NONE');
  });

  it('does not swallow unregistered descendant routes (falls through to the generic branch)', () => {
    for (const url of [
      `${BASE}/comparisons/${COMPARISON_ID}/execute`,
      `${BASE}/comparisons/${COMPARISON_ID}/timing-items/${ITEM_ID}/replace`,
      `${BASE}/admin-override`,
    ]) {
      const resolution = registry.resolve({ method: 'POST', url });
      expect(resolution.resourceType).toBe('internal-route');
    }
  });

  it('keeps GET and POST on the same path distinct in the policy action', () => {
    const list = registry.resolve({ method: 'GET', url: `${BASE}/comparisons` });
    const create = registry.resolve({ method: 'POST', url: `${BASE}/comparisons` });
    expect(list.policy?.action).toBe(`GET:${BASE}/comparisons`);
    expect(create.policy?.action).toBe(`POST:${BASE}/comparisons`);
    expect(list.resourceType).not.toBe(create.resourceType);
  });
});
