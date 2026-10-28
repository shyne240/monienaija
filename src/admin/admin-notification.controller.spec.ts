import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AuditService } from '../operations/audit.service';

import { AdminNotificationController } from './admin-notification.controller';

const CUSTOMER_UUID = '11111111-1111-4111-8111-111111111111';
const AGENT_UUID = '22222222-2222-4222-8222-222222222222';
const AGGREGATOR_UUID = '33333333-3333-4333-8333-333333333333';

describe('AdminNotificationController — notification.view_deliveries enforcement & redaction', () => {
  function setup() {
    const query = jest.fn();
    const auditRecord = jest.fn().mockResolvedValue(undefined);
    const dataSource = {
      query,
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb({})),
    } as unknown as DataSource;
    const auditService = {
      record: auditRecord,
    } as unknown as AuditService;

    const authService = new AuthorizationService(dataSource, auditService);
    const controller = new AdminNotificationController(dataSource, authService);

    return { controller, query, auditRecord };
  }

  function workforcePrincipal(
    roleKey: string,
    scopes: readonly string[],
    type: AuthorizationPrincipal['type'] = roleKey === 'SUPER_ADMIN' ? 'PRIVILEGED' : 'OPERATOR',
  ): AuthorizationPrincipal {
    return {
      type,
      principalId: `workforce-${roleKey.toLowerCase()}`,
      audience: 'workforce-admin',
      roles: [roleKey],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal: roleKey === 'FINANCE_AUDITOR',
    };
  }

  it.each([
    ['OPERATIONS', 'OPERATOR'],
    ['FINANCE_AUDITOR', 'OPERATOR'],
    ['SUPER_ADMIN', 'PRIVILEGED'],
  ] as const)(
    'allows authorized workforce role %s (%s) holding notification.view_deliveries and audits ALLOWED',
    async (roleKey, principalType) => {
      const { controller, query, auditRecord } = setup();
      query
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([
          {
            id: '44444444-4444-4444-8444-444444444444',
            event_type: 'customer.funding.approved',
            event_key: 'customer.funding.approved:req-1',
            aggregate_type: 'CUSTOMER_FUNDING',
            aggregate_id: 'req-1',
            recipient_type: 'CUSTOMER',
            recipient_id: CUSTOMER_UUID,
            channel: 'SMS',
            status: 'SENT',
            attempts: 1,
            provider_ref: 'test-ref-1',
            correlation_id: 'corr-1',
            causation_id: null,
            message: 'Your funding of NGN 100.00 was approved.',
            last_error: null,
            created_at: new Date('2026-10-28T08:00:00.000Z'),
            updated_at: new Date('2026-10-28T08:00:00.000Z'),
            sent_at: new Date('2026-10-28T08:00:00.000Z'),
            failed_at: null,
          },
        ]);

      const principal = workforcePrincipal(roleKey, ['notification.view_deliveries'], principalType);
      const result = await controller.listDeliveries({ headers: {}, authorizationPrincipal: principal });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.recipientId).toBe(CUSTOMER_UUID);
      expect(query).toHaveBeenCalledTimes(2);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityType: 'AUTHORIZATION_DECISION',
          action: 'ALLOWED',
          actor: principal.principalId,
          newValues: expect.objectContaining({
            allowed: true,
            resourceType: 'internal-notifications',
            action: 'notification.view_deliveries',
            requiredFunctions: ['notification.view_deliveries'],
          }) as unknown as Record<string, unknown>,
        }),
      );
    },
  );

  it.each([
    ['FINANCE_PREPARER', ['ledger.view', 'fee_rule.view']],
    ['FINANCE_CONTROLLER', ['ledger.view', 'privileged:approve']],
    ['AGENT_NETWORK_MANAGER', ['agent.view', 'agent.fund']],
    ['COMPLIANCE', ['kyc.view', 'customer.view']],
    ['RISK_FRAUD', ['risk_fraud.manage_fraud_case']],
    ['CUSTOMER_SERVICE', ['customer.view', 'customer.manage_support_case']],
    ['TREASURY', ['reconciliation.view']],
    ['ADMINISTRATOR', ['workforce.user.view', 'customer.view', 'agent.view']],
  ] as const)(
    'rejects workforce role %s lacking notification.view_deliveries with 403 FUNCTION_MISSING and zero DB reads',
    async (roleKey, scopes) => {
      const { controller, query, auditRecord } = setup();
      const principal = workforcePrincipal(roleKey, scopes, 'OPERATOR');

      await expect(
        controller.listDeliveries({ headers: {}, authorizationPrincipal: principal }),
      ).rejects.toThrow(ForbiddenException);

      expect(query).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityType: 'AUTHORIZATION_DECISION',
          action: 'DENIED',
          actor: principal.principalId,
          newValues: expect.objectContaining({
            allowed: false,
            reason: 'FUNCTION_MISSING',
            resourceType: 'internal-notifications',
            requiredFunctions: ['notification.view_deliveries'],
          }) as unknown as Record<string, unknown>,
        }),
      );
    },
  );

  it('rejects SUPPORT workforce principal lacking notification.view_deliveries with 403 FUNCTION_MISSING', async () => {
    const { controller, query, auditRecord } = setup();
    const supportPrincipal: AuthorizationPrincipal = {
      type: 'SUPPORT',
      principalId: 'support-user-1',
      audience: 'support-workforce',
      roles: ['SUPPORT'],
      scopes: ['support:ticket:read', 'customer.manage_support_case'],
      customerAccess: 'NONE',
      assuranceLevel: 'PASSWORD',
    };

    await expect(
      controller.listDeliveries({ headers: {}, authorizationPrincipal: supportPrincipal }),
    ).rejects.toThrow(ForbiddenException);

    expect(query).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'AUTHORIZATION_DECISION',
        action: 'DENIED',
        newValues: expect.objectContaining({
          reason: 'FUNCTION_MISSING',
        }) as unknown as Record<string, unknown>,
      }),
    );
  });

  it('rejects unauthenticated requests with 401 and zero DB reads', async () => {
    const { controller, query } = setup();

    await expect(controller.listDeliveries({ headers: {} })).rejects.toThrow(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects CUSTOMER, AGENT, and AGGREGATOR principals even if scopes were forged', async () => {
    const { controller, query } = setup();

    const customer: AuthorizationPrincipal = {
      type: 'CUSTOMER',
      principalId: CUSTOMER_UUID,
      customerId: CUSTOMER_UUID,
      roles: ['CUSTOMER'],
      scopes: ['notification.view_deliveries'],
      customerAccess: 'SELF',
    };
    const agent: AuthorizationPrincipal = {
      type: 'AGENT',
      principalId: AGENT_UUID,
      agentId: AGENT_UUID,
      roles: ['AGENT'],
      scopes: ['notification.view_deliveries'],
      customerAccess: 'NONE',
      agentAccess: 'SELF',
    };
    const aggregator: AuthorizationPrincipal = {
      type: 'AGGREGATOR',
      principalId: AGGREGATOR_UUID,
      aggregatorId: AGGREGATOR_UUID,
      roles: ['AGGREGATOR'],
      scopes: ['notification.view_deliveries'],
      customerAccess: 'NONE',
      aggregatorAccess: 'SELF',
    };

    for (const principal of [customer, agent, aggregator]) {
      await expect(
        controller.listDeliveries({ headers: {}, authorizationPrincipal: principal }),
      ).rejects.toThrow(UnauthorizedException);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('prevents query parameters (valid or invalid) from bypassing authorization or acting as a validation oracle', async () => {
    const { controller, query } = setup();
    const unauthorizedOps = workforcePrincipal('CUSTOMER_SERVICE', ['customer.view'], 'OPERATOR');

    // Valid filter combinations
    await expect(
      controller.listDeliveries(
        { headers: {}, authorizationPrincipal: unauthorizedOps },
        '1',
        '20',
        'FAILED',
        'CUSTOMER',
        'EMAIL',
        'customer.funding.approved',
        CUSTOMER_UUID,
      ),
    ).rejects.toThrow(ForbiddenException);

    // Invalid filter values must still return 403 Forbidden (not 400 Bad Request) before parsing
    await expect(
      controller.listDeliveries(
        { headers: {}, authorizationPrincipal: unauthorizedOps },
        '0',
        '999',
        'NOT_A_STATUS',
        'INVALID_RECIPIENT',
        'WHATSAPP',
        'x'.repeat(300),
        'not-a-uuid',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(query).not.toHaveBeenCalled();
  });

  it('redacts PHONE recipient identifiers and excludes destination/payload/secrets while preserving CUSTOMER/AGENT UUIDs', async () => {
    const { controller, query } = setup();
    query.mockResolvedValueOnce([{ count: '3' }]).mockResolvedValueOnce([
      {
        id: '10000000-0000-4000-8000-000000000001',
        event_type: 'customer.funding.approved',
        event_key: 'evt-cust',
        aggregate_type: 'CUSTOMER_FUNDING',
        aggregate_id: 'agg-1',
        recipient_type: 'CUSTOMER',
        recipient_id: CUSTOMER_UUID,
        channel: 'EMAIL',
        status: 'SENT',
        attempts: 1,
        provider_ref: 'resend-1',
        correlation_id: null,
        causation_id: null,
        message: 'Approved',
        last_error: null,
        created_at: new Date('2026-10-28T08:02:00.000Z'),
        updated_at: new Date('2026-10-28T08:02:00.000Z'),
        sent_at: new Date('2026-10-28T08:02:00.000Z'),
        failed_at: null,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        event_type: 'agent.suspended',
        event_key: 'evt-agent',
        aggregate_type: 'AGENT',
        aggregate_id: AGENT_UUID,
        recipient_type: 'AGENT',
        recipient_id: AGENT_UUID,
        channel: 'SMS',
        status: 'SENT',
        attempts: 1,
        provider_ref: 'robase-1',
        correlation_id: null,
        causation_id: null,
        message: 'Agent notification',
        last_error: null,
        created_at: new Date('2026-10-28T08:01:00.000Z'),
        updated_at: new Date('2026-10-28T08:01:00.000Z'),
        sent_at: new Date('2026-10-28T08:01:00.000Z'),
        failed_at: null,
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        event_type: 'cash_to_cash.created',
        event_key: 'evt-c2c',
        aggregate_type: 'CASH_TO_CASH',
        aggregate_id: 'c2c-1',
        recipient_type: 'PHONE',
        recipient_id: '8012345678',
        channel: 'SMS',
        status: 'SENT',
        attempts: 1,
        provider_ref: 'robase-2',
        correlation_id: null,
        causation_id: null,
        message: 'Cash-to-Cash transfer ready.',
        last_error: null,
        created_at: new Date('2026-10-28T08:00:00.000Z'),
        updated_at: new Date('2026-10-28T08:00:00.000Z'),
        sent_at: new Date('2026-10-28T08:00:00.000Z'),
        failed_at: null,
      },
    ]);

    const principal = workforcePrincipal('OPERATIONS', ['notification.view_deliveries'], 'OPERATOR');
    const result = await controller.listDeliveries({ headers: {}, authorizationPrincipal: principal });

    expect(result.data[0]?.recipientId).toBe(CUSTOMER_UUID);
    expect(result.data[1]?.recipientId).toBe(AGENT_UUID);
    expect(result.data[2]?.recipientType).toBe('PHONE');
    expect(result.data[2]?.recipientId).toBe('*******678');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('8012345678');
    expect(serialized).not.toContain('"destination"');
    expect(serialized).not.toContain('"payload"');
  });
});
