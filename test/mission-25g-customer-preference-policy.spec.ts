import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal, AuthorizationRequest } from '../src/authorization/authorization.types';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { CustomerPreferenceController } from '../src/customer-preference/customer-preference.controller';
import { CustomerLanguage, CustomerTheme } from '../src/customer-preference/customer-preference.enums';
import type { CustomerPreferenceService } from '../src/customer-preference/customer-preference.service';
import type { AuditService } from '../src/operations/audit.service';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const path = `/api/v1/customers/${id}/preferences`;
const self: AuthorizationPrincipal = {
  type: 'CUSTOMER', principalId: id, customerId: id, sessionId: 'validated-session',
  customerAccess: 'SELF', roles: [], scopes: [],
};
const workforce: AuthorizationPrincipal = {
  type: 'OPERATOR', principalId: 'workforce-user', sessionId: 'validated-workforce-session',
  customerAccess: 'ANY', roles: ['CUSTOMER_SERVICE'], scopes: ['customer.view'],
};

function req(principal?: AuthorizationPrincipal): AuthorizationRequest {
  return { authorizationPrincipal: principal };
}

describe('Mission 25G preference route policy', () => {
  const registry = new RoutePolicyRegistry();
  // evaluate() is pure; no database/audit mock is involved in the real-HTTP suite.
  const authz = new AuthorizationService({} as DataSource, {} as AuditService);

  it.each(['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])(
    '%s applies CUSTOMER SELF to the preference route and all descendants', (method) => {
      for (const suffix of ['', '/history', '/future/descendant']) {
        const url = `${path}${suffix}`;
        const route = registry.resolve({ method, url: `${url}?ignored=query`, params: { id } });
        expect(route.resourceType).toBe('customer-preference');
        expect(route.customerId).toBe(id);
        expect(route.policy).toMatchObject({
          allowedPrincipalTypes: ['CUSTOMER'], customerAccess: 'SELF', action: `${method}:${url}`,
        });
        const resource = { type: route.resourceType, id: route.resourceId, customerId: route.customerId };
        expect(authz.evaluate(self, route.policy, resource).allowed).toBe(true);
        expect(authz.evaluate({ ...self, principalId: otherId, customerId: otherId }, route.policy, resource).allowed).toBe(false);
        expect(authz.evaluate(workforce, route.policy, resource).allowed).toBe(false);
      }
    },
  );

  it('fails closed for missing, empty or inconsistent router parameters', () => {
    for (const params of [undefined, {}, { id: '' }, { id: otherId }]) {
      const route = registry.resolve({ method: 'GET', url: path, params });
      const resource = { type: route.resourceType, id: route.resourceId, customerId: route.customerId };
      expect(route.policy?.allowedPrincipalTypes).toEqual([]);
      expect(authz.evaluate(self, route.policy, resource).allowed).toBe(false);
      expect(authz.evaluate(workforce, route.policy, resource).allowed).toBe(false);
    }
  });

  it('recognizes percent-encoded router segments without treating encoded slashes as separators', () => {
    for (const url of [
      `/%61pi/v1/%63ustomers/${id}/%70references/history`,
      `/api/v1/customers/%31${id.slice(1)}/prefer%65nces/%68istory`,
    ]) {
      const route = registry.resolve({ method: 'GET', url, params: { id } });
      expect(route.resourceType).toBe('customer-preference');
      expect(route.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
    }
    const notARoute = registry.resolve({ method: 'GET', url: `/api/v1/customers/${id}/preferences%2Fhistory`, params: { id } });
    expect(notARoute.resourceType).toBe('customer');
  });

  it('does not grant the nonexistent me/preferences alias and leaves neighboring customer policies alone', () => {
    const me = registry.resolve({ method: 'GET', url: '/api/v1/customers/me/preferences', params: { id: 'me' } });
    expect(me.resourceType).toBe('customer-preference');
    expect(authz.evaluate(self, me.policy, { type: me.resourceType, customerId: me.customerId }).allowed).toBe(false);
    for (const suffix of ['/profile', '/kyc', '/preferences-old']) {
      const route = registry.resolve({ method: 'GET', url: `/api/v1/customers/${id}${suffix}`, params: { id } });
      expect(route.resourceType).toBe('customer');
      expect(route.policy?.allowedPrincipalTypes).toContain('OPERATOR');
    }
  });
});

describe('Mission 25G preference controller defense in depth', () => {
  const service = {
    createPreferences: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    listHistory: jest.fn(),
  };
  const controller = new CustomerPreferenceController(service as unknown as CustomerPreferenceService);
  const create = {
    language: CustomerLanguage.EN,
    theme: CustomerTheme.SYSTEM,
    notifications: { email: true, sms: true, push: true, inApp: true },
    security: { loginAlerts: true, transactionAlerts: true, deviceRegistrationAlerts: true, biometricAllowed: false },
    actor: 'forged-actor',
  };

  beforeEach(() => jest.clearAllMocks());

  it('requires a real, consistent self identity on all handlers, even if the guard were misconfigured', () => {
    const handlers = [
      (r: AuthorizationRequest) => controller.getPreferences(id, r),
      (r: AuthorizationRequest) => controller.listHistory(id, r),
      (r: AuthorizationRequest) => controller.createPreferences(id, create, r),
      (r: AuthorizationRequest) => controller.updatePreferences(id, { theme: CustomerTheme.DARK }, r),
    ];
    for (const handler of handlers) {
      expect(() => handler(req())).toThrow(UnauthorizedException);
      for (const principal of [
        workforce,
        { ...self, customerId: otherId },
        { ...self, principalId: otherId },
        { ...self, sessionId: undefined },
        { ...self, customerAccess: 'ANY' as const },
      ]) expect(() => handler(req(principal))).toThrow(ForbiddenException);
    }
    expect(() => controller.getPreferences('', req(self))).toThrow(ForbiddenException);
    expect(service.createPreferences).not.toHaveBeenCalled();
    expect(service.updatePreferences).not.toHaveBeenCalled();
    expect(service.getPreferences).not.toHaveBeenCalled();
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it('replaces client actor on create and update while preserving the rest of the command', async () => {
    await controller.createPreferences(id, create, req(self));
    expect(service.createPreferences).toHaveBeenCalledWith(id, { ...create, actor: id });
    await controller.updatePreferences(id, { theme: CustomerTheme.DARK, actor: 'forged' }, req(self));
    expect(service.updatePreferences).toHaveBeenCalledWith(id, { theme: CustomerTheme.DARK, actor: id });
    await controller.getPreferences(id, req(self));
    await controller.listHistory(id, req(self));
    expect(service.getPreferences).toHaveBeenCalledWith(id);
    expect(service.listHistory).toHaveBeenCalledWith(id);
  });
});
