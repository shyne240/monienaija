import type { DataSource, EntityManager } from 'typeorm';

import { AuthorizationGuard } from '../src/authorization/authorization.guard';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type {
  AuthorizationPolicy,
  AuthorizationPrincipal,
} from '../src/authorization/authorization.types';
import type { Reflector } from '@nestjs/core';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const PRINCIPAL_ID = '00000000-0000-4000-8000-000000000003';

const customerPrincipal: AuthorizationPrincipal = {
  type: 'CUSTOMER',
  principalId: PRINCIPAL_ID,
  customerId: CUSTOMER_ID,
  sessionId: '00000000-0000-4000-8000-000000000004',
  audience: 'customer-api',
  roles: [],
  scopes: ['customer:read'],
  customerAccess: 'SELF',
  assuranceLevel: 'PASSWORD',
};

const customerPolicy: AuthorizationPolicy = {
  resourceType: 'customer',
  action: 'read',
  requiredScopes: ['customer:read'],
  allowedPrincipalTypes: ['CUSTOMER'],
  customerAccess: 'SELF',
};

function serviceFixture() {
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const dataSource = {
    transaction: jest.fn((callback: (manager: EntityManager) => Promise<unknown>) =>
      callback({} as EntityManager),
    ),
  };
  return {
    service: new AuthorizationService(dataSource as unknown as DataSource, auditService as never),
    auditService,
  };
}

describe('AuthorizationService', () => {
  it('allows customer self-access with the required scope and audits the decision', async () => {
    const testFixture = serviceFixture();
    const decision = await testFixture.service.authorize(customerPrincipal, customerPolicy, {
      type: 'customer',
      id: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
    });

    expect(decision).toMatchObject({
      allowed: true,
      principalType: 'CUSTOMER',
      action: 'read',
      customerId: CUSTOMER_ID,
    });
    expect(testFixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'AUTHORIZATION_DECISION',
        action: 'ALLOWED',
      }),
    );
  });

  it('denies cross-customer access and missing scopes without changing source state', async () => {
    const testFixture = serviceFixture();
    const denied = await testFixture.service.authorize(customerPrincipal, customerPolicy, {
      type: 'customer',
      id: OTHER_CUSTOMER_ID,
      customerId: OTHER_CUSTOMER_ID,
    });
    expect(denied).toMatchObject({ allowed: false, reason: 'CUSTOMER_SCOPE_MISMATCH' });

    const missingScope = await testFixture.service.authorize(
      { ...customerPrincipal, scopes: [] },
      customerPolicy,
      { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
    );
    expect(missingScope).toMatchObject({ allowed: false, reason: 'SCOPE_MISSING' });
    expect(testFixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'AUTHORIZATION_DECISION',
        action: 'DENIED',
      }),
    );
  });

  it('supports assigned support scopes and service audiences explicitly', () => {
    const testFixture = serviceFixture();
    const support: AuthorizationPrincipal = {
      type: 'SUPPORT',
      principalId: PRINCIPAL_ID,
      roles: ['SUPPORT'],
      scopes: ['customer:read'],
      customerAccess: 'ASSIGNED',
      assignedCustomerIds: [CUSTOMER_ID],
      audience: 'support-api',
    };
    const assigned = testFixture.service.evaluate(
      support,
      {
        ...customerPolicy,
        allowedPrincipalTypes: ['SUPPORT'],
        customerAccess: 'ASSIGNED',
        audience: 'support-api',
      },
      { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
    );
    expect(assigned).toMatchObject({ allowed: true });

    const service = testFixture.service.evaluate(
      {
        type: 'SERVICE',
        principalId: 'payments-service',
        roles: [],
        scopes: ['customer:read:any'],
        customerAccess: 'ANY',
        audience: 'internal-service',
      },
      {
        resourceType: 'customer',
        action: 'read',
        requiredScopes: ['customer:read:any'],
        allowedPrincipalTypes: ['SERVICE'],
        customerAccess: 'ANY',
        audience: 'internal-service',
      },
      { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
    );
    expect(service).toMatchObject({ allowed: true });
  });

  it('fails closed for missing principals, policies, roles, and MFA assurance', () => {
    const testFixture = serviceFixture();
    expect(
      testFixture.service.evaluate(undefined, customerPolicy, {
        type: 'customer',
        customerId: CUSTOMER_ID,
      }),
    ).toMatchObject({ allowed: false, reason: 'UNAUTHENTICATED' });
    expect(
      testFixture.service.evaluate(customerPrincipal, undefined, {
        type: 'customer',
        customerId: CUSTOMER_ID,
      }),
    ).toMatchObject({ allowed: false, reason: 'POLICY_MISSING' });
    expect(
      testFixture.service.evaluate(
        customerPrincipal,
        {
          ...customerPolicy,
          requiredRoles: ['SUPPORT'],
        },
        { type: 'customer', customerId: CUSTOMER_ID },
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'ROLE_MISSING',
    });
    expect(
      testFixture.service.evaluate(
        customerPrincipal,
        {
          ...customerPolicy,
          minimumAssurance: 'MFA',
        },
        { type: 'customer', customerId: CUSTOMER_ID },
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'MFA_REQUIRED',
    });
  });
});

describe('AuthorizationGuard', () => {
  it('fails closed when a route has no authorization policy', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const authorizationService = { authorize: jest.fn() };
    const guard = new AuthorizationGuard(
      reflector as unknown as Reflector,
      authorizationService as unknown as AuthorizationService,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    };
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'Authorization policy is not configured',
    );
  });

  it('attaches an allowed authorization decision to the request', async () => {
    const policy = customerPolicy;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(policy),
    };
    const decision = { allowed: true, resourceType: 'customer', action: 'read' };
    const authorizationService = { authorize: jest.fn().mockResolvedValue(decision) };
    const request: Record<string, unknown> = {
      authorizationPrincipal: customerPrincipal,
      params: { id: CUSTOMER_ID },
    };
    const guard = new AuthorizationGuard(
      reflector as unknown as Reflector,
      authorizationService as unknown as AuthorizationService,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.authorizationDecision).toBe(decision);
  });
});
