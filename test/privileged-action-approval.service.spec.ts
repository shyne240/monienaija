import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import type { AuditService } from '../src/operations/audit.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const REQUESTER_ID = '00000000-0000-4000-8000-000000000002';
const APPROVER_ID = '00000000-0000-4000-8000-000000000003';
const REQUESTER_SESSION = '00000000-0000-4000-8000-000000000004';
const APPROVER_SESSION = '00000000-0000-4000-8000-000000000005';
const ACTION_FINGERPRINT = 'a'.repeat(64);

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    }
    record.createdAt ??= new Date('2026-01-01T00:00:00.000Z');
    record.updatedAt = new Date('2026-01-01T00:00:00.000Z');
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ) ?? null,
    );
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: unknown): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected privileged-action repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

const requester: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: REQUESTER_ID,
  customerId: CUSTOMER_ID,
  sessionId: REQUESTER_SESSION,
  roles: ['SECURITY_ADMIN'],
  scopes: ['privileged:request'],
  customerAccess: 'ANY',
  assuranceLevel: 'MFA',
};

const approver: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: APPROVER_ID,
  customerId: CUSTOMER_ID,
  sessionId: APPROVER_SESSION,
  roles: ['SECURITY_APPROVER'],
  scopes: ['privileged:approve', 'privileged:execute', 'privileged:break-glass'],
  customerAccess: 'ANY',
  assuranceLevel: 'MFA',
};

function fixture() {
  const approvalRepository = new MemoryRepository<PrivilegedActionApproval>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
    [PrivilegedActionApproval, approvalRepository as unknown as MemoryRepository<ObjectLiteral>],
    [SecurityEventHistory, securityEventRepository as unknown as MemoryRepository<ObjectLiteral>],
  ]);
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({ allowed: true, action: 'DELETE_CUSTOMER' }),
  };
  const service = new PrivilegedActionApprovalService(
    approvalRepository as unknown as Repository<PrivilegedActionApproval>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    new MemoryDataSource(new MemoryManager(repositories)) as unknown as DataSource,
    auditService as unknown as AuditService,
    authorizationService as unknown as AuthorizationService,
  );
  return {
    service,
    approvalRepository,
    securityEventRepository,
    auditService,
    authorizationService,
  };
}

function requestCommand() {
  return {
    principal: requester,
    policy: {
      resourceType: 'customer',
      action: 'DELETE_CUSTOMER',
      requiredScopes: ['privileged:request'],
      allowedPrincipalTypes: ['PRIVILEGED'] as const,
      customerAccess: 'ANY' as const,
      minimumAssurance: 'MFA' as const,
    },
    resource: { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
    actionFingerprint: ACTION_FINGERPRINT,
    reason: 'Security incident response',
    now: new Date('2026-01-01T00:00:00.000Z'),
    expiresInSeconds: 600,
  };
}

describe('PrivilegedActionApprovalService', () => {
  it('enforces maker-checker approval and consumes an approved action once', async () => {
    const testFixture = fixture();
    const requested = await testFixture.service.request(requestCommand());
    expect(requested).toMatchObject({ approved: false, reason: 'REQUESTED' });
    const approvalId = requested.approval?.id;
    expect(approvalId).toBeDefined();
    expect(requested.approval?.expiresAt.toISOString()).toBe('2026-01-01T00:10:00.000Z');

    await expect(
      testFixture.service.approve({
        principal: requester,
        approvalId: approvalId as string,
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });
    const approved = await testFixture.service.approve({
      principal: approver,
      approvalId: approvalId as string,
      now: new Date('2026-01-01T00:01:00.000Z'),
    });
    expect(approved).toMatchObject({ approved: true, reason: 'APPROVED' });

    await expect(
      testFixture.service.consume({
        principal: approver,
        approvalId: approvalId as string,
        actionType: 'DELETE_CUSTOMER',
        resource: { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
        actionFingerprint: 'b'.repeat(64),
        now: new Date('2026-01-01T00:01:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'FINGERPRINT_MISMATCH' });

    const consumed = await testFixture.service.consume({
      principal: approver,
      approvalId: approvalId as string,
      actionType: 'DELETE_CUSTOMER',
      resource: { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
      actionFingerprint: ACTION_FINGERPRINT,
      now: new Date('2026-01-01T00:02:00.000Z'),
    });
    expect(consumed).toMatchObject({ approved: true, reason: 'CONSUMED' });
    await expect(
      testFixture.service.consume({
        principal: approver,
        approvalId: approvalId as string,
        actionType: 'DELETE_CUSTOMER',
        resource: { type: 'customer', id: CUSTOMER_ID, customerId: CUSTOMER_ID },
        actionFingerprint: ACTION_FINGERPRINT,
        now: new Date('2026-01-01T00:03:00.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'CONSUMED' });
  });

  it('requires approval scope and MFA assurance and handles expiry/rejection/cancellation', async () => {
    const testFixture = fixture();
    const requested = await testFixture.service.request(requestCommand());
    const approvalId = requested.approval?.id as string;
    const noMfa = { ...approver, assuranceLevel: 'PASSWORD' as const };
    await expect(
      testFixture.service.approve({
        principal: noMfa,
        approvalId,
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'MFA_REQUIRED' });
    await expect(
      testFixture.service.approve({
        principal: { ...approver, scopes: [] },
        approvalId,
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'APPROVAL_SCOPE_MISSING' });

    const second = await testFixture.service.request(requestCommand());
    await expect(
      testFixture.service.reject({
        principal: approver,
        approvalId: second.approval?.id as string,
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'REJECTED' });

    const third = await testFixture.service.request(requestCommand());
    await expect(
      testFixture.service.cancel({
        principal: requester,
        approvalId: third.approval?.id as string,
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'CANCELLED' });

    const expired = await testFixture.service.request(requestCommand());
    await expect(
      testFixture.service.approve({
        principal: approver,
        approvalId: expired.approval?.id as string,
        now: new Date('2026-01-01T00:11:00.000Z'),
      }),
    ).resolves.toMatchObject({ approved: false, reason: 'EXPIRED' });
  });

  it('activates and revokes time-bound emergency access with audit evidence', async () => {
    const testFixture = fixture();
    const activated = await testFixture.service.activateEmergencyAccess({
      principal: approver,
      resourceType: 'security-console',
      resourceId: 'console-1',
      reason: 'Active incident response',
      expiresInSeconds: 300,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(activated).toMatchObject({
      approved: true,
      reason: 'APPROVED',
      approval: { status: PrivilegedActionApprovalStatus.EMERGENCY_ACTIVE, isEmergency: true },
    });
    await expect(
      testFixture.service.revokeEmergencyAccess(activated.approval?.id as string, approver),
    ).resolves.toMatchObject({ approved: false, reason: 'CANCELLED' });
    const auditText = JSON.stringify(testFixture.auditService.record.mock.calls);
    expect(auditText).not.toContain(ACTION_FINGERPRINT);
    expect(testFixture.securityEventRepository.records.size).toBeGreaterThan(0);
  });
});
