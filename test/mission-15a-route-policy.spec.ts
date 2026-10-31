import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

const registry = new RoutePolicyRegistry();
const id = '11111111-1111-4111-8111-111111111111';

describe('Mission 15A declared Agent route policies', () => {
  it.each([
    ['GET', `/api/v1/internal/agents/${id}/outlets`, 'agent.view'],
    ['GET', `/api/v1/internal/outlets/${id}`, 'agent.view'],
    ['HEAD', `/api/v1/internal/outlets/${id}/terminals`, 'agent.view'],
    ['GET', `/api/v1/internal/agents/${id}/terminals`, 'agent.view'],
    ['GET', `/api/v1/internal/terminals/${id}`, 'agent.view'],
    ['PATCH', `/api/v1/internal/outlets/${id}`, 'agent.manage_outlets_terminals'],
    ['PATCH', `/api/v1/internal/terminals/${id}`, 'agent.manage_outlets_terminals'],
    ['POST', `/api/v1/internal/outlets/${id}/suspend`, 'agent.manage_outlets_terminals'],
    ['GET', '/api/v1/internal/agents/applications', 'agent.review_application'],
    ['HEAD', `/api/v1/internal/agents/applications/${id}`, 'agent.review_application'],
    ['POST', `/api/v1/internal/agents/applications/${id}/review`, 'agent.review_application'],
    ['POST', `/api/v1/internal/agents/applications/${id}/approve`, 'agent.review_application'],
    ['POST', `/api/v1/internal/agents/applications/${id}/reject`, 'agent.review_application'],
    ['POST', `/api/v1/internal/agents/applications/${id}/activate`, 'agent.activate'],
    ['POST', `/api/v1/internal/admin/agents/applications/${id}/activate`, 'agent.activate'],
    ['POST', `/api/v1/internal/agents/${id}/activate`, 'agent.activate'],
    ['POST', `/api/v1/internal/admin/agents/${id}/suspend`, 'agent.suspend'],
    ['POST', `/api/v1/internal/agents/${id}/terminate`, 'agent.terminate'],
    ['POST', `/api/v1/internal/admin/agents/${id}/reactivate`, 'agent.reactivate'],
    ['POST', `/api/v1/internal/admin/agents/${id}/credentials`, 'agent.manage_credentials'],
    ['POST', `/api/v1/internal/admin/agents/${id}/credentials/reissue`, 'agent.manage_credentials'],
    ['POST', `/api/v1/internal/admin/agents/${id}/sessions/revoke`, 'agent.manage_credentials'],
    ['GET', '/api/v1/internal/agents', 'agent.view'],
    ['GET', `/api/v1/internal/agents/${id}`, 'agent.view'],
    ['HEAD', `/api/v1/internal/agents/${id}/financial-position`, 'agent.view'],
    ['GET', '/api/v1/internal/admin/cash-to-cash/transfers', 'transaction.view'],
    ['HEAD', '/api/v1/internal/admin/cash-to-cash/expiry-status', 'transaction.view'],
  ])('%s %s declares %s', (method, url, functionCode) => {
    const resolution = registry.resolve({ method, url: `${url}?page=1` });
    expect(resolution.public).toBe(false);
    expect(resolution.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(resolution.policy?.requiredFunctions).toEqual([functionCode]);
    expect(resolution.policy?.action).toBe(`${method}:${url}`);
  });

  it('does not replace the applicant capability or open internal reads through the public locator', () => {
    expect(registry.resolve({ method: 'GET', url: `/api/v1/agents/applications/${id}` }).authenticationMode).toBe('APPLICATION_ACCESS');
    expect(registry.resolve({ method: 'GET', url: '/api/v1/public/agents/cash-to-cash-outlets' }).public).toBe(true);
    expect(registry.resolve({ method: 'GET', url: `/api/v1/internal/outlets/${id}` }).public).toBe(false);
  });

  it('preserves the checker inbox and Agent SELF receiving-number policies', () => {
    const inbox = registry.resolve({ method: 'GET', url: '/api/v1/internal/agents/funding-requests' });
    expect(inbox.policy?.requiredRoles).toEqual(['FINANCE_CONTROLLER']);
    expect(inbox.policy?.requiredFunctions).toEqual(['agent.fund', 'agent.defund']);
    const own = registry.resolve({ method: 'GET', url: `/api/v1/agents/${id}/receiving-number`, params: { id } });
    expect(own.agentId).toBe(id);
    expect(own.policy?.agentAccess).toBe('SELF');
  });
});
