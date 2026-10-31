import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import type { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import type { AgentAuthenticationSessionService } from '../src/agent-authentication/agent-authentication-session.service';
import type { SupportAuthenticationService } from '../src/support-authentication/support-authentication.service';

const CURRENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION_PATH = `/api/v1/internal/a2/workforce/sessions/${CURRENT}`;

function context(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

function fixture(overrides: Partial<AuthorizationPrincipal> = {}) {
  const principal: AuthorizationPrincipal = {
    type: 'OPERATOR', principalId: 'auditor', sessionId: CURRENT,
    roles: ['FINANCE_AUDITOR'], scopes: [], customerAccess: 'NONE',
    readOnlyPrincipal: true, ...overrides,
  };
  const customerSessions = { validate: jest.fn().mockResolvedValue({ valid: false }) };
  const authorization = { evaluate: jest.fn(), authorize: jest.fn() };
  const registry = new RoutePolicyRegistry();
  const a2Sessions = { validate: jest.fn().mockResolvedValue(principal) };
  const agents = { validate: jest.fn().mockResolvedValue({ valid: false }) };
  const support = { validate: jest.fn().mockRejectedValue(new UnauthorizedException()) };
  const config = { enabled: true, internalAudience: 'workforce-admin' } as A2WorkforceConfigurationV1;
  const guard = new RuntimeAccessGuard(
    customerSessions as unknown as AuthenticationSessionService,
    authorization as unknown as AuthorizationService,
    registry,
    a2Sessions as unknown as A2WorkforceSessionService,
    config,
    agents as unknown as AgentAuthenticationSessionService,
    support as unknown as SupportAuthenticationService,
  );
  return { guard, registry, principal, a2Sessions, support, authorization };
}

function req(method = 'DELETE', url = SESSION_PATH, params: Record<string, string> | undefined = { id: CURRENT }) {
  return { method, url, params, headers: { authorization: 'Bearer test-token' } };
}

describe('Mission 19A — exact read-only current-session exception', () => {
  it('permits only the validated A2 current session and keeps the principal attached', async () => {
    const f = fixture();
    const request = req();
    await expect(f.guard.canActivate(context(request) as never)).resolves.toBe(true);
    expect(request).toHaveProperty('authorizationPrincipal', f.principal);
    expect(f.a2Sessions.validate).toHaveBeenCalledWith('test-token', 'workforce-admin');
    expect(f.support.validate).not.toHaveBeenCalled();
  });

  it('accepts a query string without broadening the path or depending on a role name', async () => {
    const f = fixture({ roles: ['ANOTHER_READ_ONLY_ROLE'] });
    await expect(f.guard.canActivate(context(req('delete', `${SESSION_PATH}?source=logout`)) as never)).resolves.toBe(true);
  });

  it.each([
    ['POST on the same path', 'POST', SESSION_PATH, { id: CURRENT }],
    ['PUT on the same path', 'PUT', SESSION_PATH, { id: CURRENT }],
    ['PATCH on the same path', 'PATCH', SESSION_PATH, { id: CURRENT }],
    ['another session', 'DELETE', `/api/v1/internal/a2/workforce/sessions/${OTHER}`, { id: OTHER }],
    ['forged current parameter with another path', 'DELETE', `/api/v1/internal/a2/workforce/sessions/${OTHER}`, { id: CURRENT }],
    ['forged other parameter with current path', 'DELETE', SESSION_PATH, { id: OTHER }],
    ['missing parameter', 'DELETE', SESSION_PATH, {}],
    ['a role deletion', 'DELETE', `/api/v1/internal/a2/workforce/roles/${CURRENT}/FINANCE_AUDITOR`, { id: CURRENT }],
    ['a route suffix', 'DELETE', `${SESSION_PATH}/extra`, { id: CURRENT }],
    ['a trailing slash', 'DELETE', `${SESSION_PATH}/`, { id: CURRENT }],
    ['a route-name lookalike', 'DELETE', `/api/v1/internal/a2/workforce/sessions-extra/${CURRENT}`, { id: CURRENT }],
    ['an encoded path lookalike with a decoded matching parameter', 'DELETE', SESSION_PATH.replace(CURRENT, `%31${CURRENT.slice(1)}`), { id: CURRENT }],
    ['another internal resource', 'DELETE', `/api/v1/internal/agents/${CURRENT}`, { id: CURRENT }],
    ['an applicant route', 'DELETE', `/api/v1/agents/applications/${CURRENT}`, { id: CURRENT }],
  ])('continues to deny %s', async (_label, method, url, params) => {
    const f = fixture();
    await expect(f.guard.canActivate(context(req(method, url, params)) as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([undefined, '', OTHER])('requires a nonempty matching sessionId from A2 (value %s)', async (sessionId) => {
    const f = fixture({ sessionId });
    await expect(f.guard.canActivate(context(req()) as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not grant the exception to a SUPPORT fallback even if its fields resemble an A2 session', async () => {
    const f = fixture();
    f.a2Sessions.validate.mockRejectedValue(new UnauthorizedException());
    f.support.validate.mockResolvedValue({ ...f.principal, type: 'SUPPORT' });
    await expect(f.guard.canActivate(context(req()) as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects absent, malformed and invalid bearer credentials before the exception', async () => {
    const f = fixture();
    for (const headers of [{}, { authorization: 'Basic test-token' }, { authorization: 'Bearer' }]) {
      await expect(f.guard.canActivate(context({ ...req(), headers }) as never)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    f.a2Sessions.validate.mockRejectedValue(new UnauthorizedException('Invalid workforce session'));
    await expect(f.guard.canActivate(context(req()) as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not skip a declared workforce authorization gate', async () => {
    const f = fixture();
    jest.spyOn(f.registry, 'resolve').mockReturnValue({
      public: false, authenticationMode: 'WORKFORCE_SESSION', resourceType: 'session',
      policy: { resourceType: 'session', action: 'revoke', requiredFunctions: ['session.gate'] },
    });
    f.authorization.evaluate.mockReturnValue({ allowed: false, reason: 'FUNCTION_MISSING' });
    await expect(f.guard.canActivate(context(req()) as never)).rejects.toMatchObject({
      status: 403, message: 'Authorization denied: FUNCTION_MISSING',
    });
    expect(f.authorization.evaluate).toHaveBeenCalledTimes(1);
  });

  it('leaves safe reads and non-read-only principals on their existing guard path', async () => {
    const readOnly = fixture();
    await expect(readOnly.guard.canActivate(context(req('GET')) as never)).resolves.toBe(true);
    const writable = fixture({ readOnlyPrincipal: false });
    await expect(writable.guard.canActivate(context(req('DELETE', `/api/v1/internal/a2/workforce/sessions/${OTHER}`, { id: OTHER })) as never)).resolves.toBe(true);
  });
});
