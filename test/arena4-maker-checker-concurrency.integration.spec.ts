import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * ARENA 4 — maker/checker concurrency and replay, against real PostgreSQL.
 *
 * The administrative surfaces Arena 4 adds are read-only, so the governance property they depend
 * on is that the EXISTING maker/checker machinery is race-free: a governed change can be approved
 * once, consumed once, and cannot be replayed against a different resource or an older version.
 *
 * These tests drive `PrivilegedActionApprovalService` directly (it is the single decision and
 * consumption authority behind every approval route) and assert on authoritative database state,
 * not on the service's return value alone. Two decisions are always issued concurrently on
 * separate pooled connections, which is what the row lock (`FOR UPDATE`) exists to serialize.
 */

const FEE_RULE_ACTION = 'FEE_RULE_CREATE';
const FEE_RULE_RESOURCE_TYPE = 'FEE_RULE';
const FEE_RULE_SCOPE = 'fee_rule.create';
const FINGERPRINT = 'c'.repeat(64);

describe('Arena 4 maker/checker concurrency and replay (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let approvals: PrivilegedActionApprovalService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('arena4mc');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue({ validate: jest.fn() })
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    approvals = app.get(PrivilegedActionApprovalService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60000);

  const principal = (role: string, principalId: string): AuthorizationPrincipal => ({
    type: 'OPERATOR',
    principalId,
    // requester_session_id / approver_session_id are uuid columns, so the session id must be one.
    sessionId: randomUUID(),
    audience: 'workforce-admin',
    roles: [role],
    scopes: [FEE_RULE_SCOPE],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  });

  const maker = (suffix = 'maker') => principal('FINANCE_PREPARER', `arena4-${suffix}`);
  const checker = (suffix = 'checker') => principal('FINANCE_CONTROLLER', `arena4-${suffix}`);

  const requestApproval = async (resourceId: string) => {
    const decision = await approvals.request({
      resource: { type: FEE_RULE_RESOURCE_TYPE, id: resourceId },
      actionFingerprint: FINGERPRINT,
      reason: 'Create fee rule under two-person control',
      approvalScope: FEE_RULE_SCOPE,
      principal: maker(),
      policy: {
        resourceType: FEE_RULE_RESOURCE_TYPE,
        action: FEE_RULE_ACTION,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: ['FINANCE_PREPARER'],
        requiredFunctions: [FEE_RULE_SCOPE],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
    });
    expect(decision.reason).toBe('REQUESTED');
    expect(decision.approval?.status).toBe('REQUESTED');
    return decision.approval!.id;
  };

  interface ApprovalRow {
    status: string;
    version: number;
    approved_by: string | null;
    consumed_at: string | null;
  }

  const row = async (approvalId: string) => {
    const rows: ApprovalRow[] = await dataSource.query(
      `SELECT status, version, approved_by, consumed_at
         FROM privileged_action_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  const auditCount = async (approvalId: string, action: string) => {
    const rows: Array<{ count: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM audit_events
        WHERE entity_type = 'PRIVILEGED_ACTION_APPROVAL' AND entity_id = $1 AND action = $2`,
      [approvalId, action],
    );
    return rows[0]!.count;
  };

  describe('concurrent checker decisions', () => {
    it('commits exactly one decision when two checkers approve at the same instant', async () => {
      const approvalId = await requestApproval(randomUUID());

      const [first, second] = await Promise.all([
        approvals.approve({ approvalId, principal: checker('checker-a'), expectedVersion: 1 }),
        approvals.approve({ approvalId, principal: checker('checker-b'), expectedVersion: 1 }),
      ]);

      const winners = [first, second].filter((decision) => decision.approved);
      expect(winners).toHaveLength(1);
      // The loser observed the winner's committed state: it may not remain REQUESTED and it may
      // never also claim the approval.
      const loser = [first, second].find((decision) => !decision.approved)!;
      expect(['APPROVED', 'STALE_VERSION']).toContain(loser.reason);

      const stored = await row(approvalId);
      expect(stored.status).toBe('APPROVED');
      expect(stored.version).toBe(2);
      expect([first, second].filter((d) => d.approved)[0]!.approval!.approvedBy).toBe(
        stored.approved_by,
      );
      // One decision, therefore one audit record and one approver identity.
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_APPROVED')).toBe(1);
    });

    it('serializes a concurrent approve/reject pair to a single terminal outcome', async () => {
      const approvalId = await requestApproval(randomUUID());

      const [approved, rejected] = await Promise.all([
        approvals.approve({ approvalId, principal: checker('checker-c') }),
        approvals.reject({ approvalId, principal: checker('checker-d'), comment: 'declined' }),
      ]);

      // The race may be won by either decision, so the assertions are order-independent: exactly
      // one decision record exists, the stored status is that decision, and BOTH callers are told
      // the committed status rather than their own outcome. A rejection never reports success.
      const stored = await row(approvalId);
      expect(['APPROVED', 'REJECTED']).toContain(stored.status);
      expect(
        (await auditCount(approvalId, 'PRIVILEGED_ACTION_APPROVED')) +
          (await auditCount(approvalId, 'PRIVILEGED_ACTION_REJECTED')),
      ).toBe(1);
      expect(approved.approved).toBe(stored.status === 'APPROVED');
      expect(rejected.approved).toBe(false);
      expect(approved.reason).toBe(stored.status);
      expect(rejected.reason).toBe(stored.status);
    });

    it('records a rejection that commits first and refuses the later approval', async () => {
      const approvalId = await requestApproval(randomUUID());

      const rejection = await approvals.reject({
        approvalId,
        principal: checker('checker-i'),
        comment: 'declined',
      });
      expect(rejection.reason).toBe('REJECTED');
      expect((await row(approvalId)).status).toBe('REJECTED');

      const lateApproval = await approvals.approve({
        approvalId,
        principal: checker('checker-j'),
      });
      expect(lateApproval.approved).toBe(false);
      expect(lateApproval.reason).toBe('REJECTED');
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_REJECTED')).toBe(1);
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_APPROVED')).toBe(0);
    });

    it('rejects a decision made against a stale version', async () => {
      const approvalId = await requestApproval(randomUUID());

      const stale = await approvals.approve({
        approvalId,
        principal: checker('checker-e'),
        expectedVersion: 7,
      });
      expect(stale.approved).toBe(false);
      expect(stale.reason).toBe('STALE_VERSION');
      expect((await row(approvalId)).status).toBe('REQUESTED');

      const current = await approvals.approve({
        approvalId,
        principal: checker('checker-e'),
        expectedVersion: 1,
      });
      expect(current.approved).toBe(true);
      expect(current.reason).toBe('APPROVED');
    });

    it('refuses self-approval by the maker', async () => {
      const approvalId = await requestApproval(randomUUID());
      const decision = await approvals.approve({ approvalId, principal: maker() });
      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe('SELF_APPROVAL_FORBIDDEN');
      expect((await row(approvalId)).status).toBe('REQUESTED');
    });

    it('refuses a checker that lacks the approving function or MFA', async () => {
      const approvalId = await requestApproval(randomUUID());

      // The governed-action function gate is evaluated before the recorded approval scope, so a
      // checker holding no function at all is denied for the missing function (the stricter of
      // the two checks) rather than merely for scope.
      const noFunction = await approvals.approve({
        approvalId,
        principal: { ...checker('checker-f'), scopes: [] },
      });
      expect(noFunction.approved).toBe(false);
      expect(noFunction.reason).toBe('FUNCTION_MISSING');

      const noMfa = await approvals.approve({
        approvalId,
        principal: { ...checker('checker-g'), assuranceLevel: 'PASSWORD' },
      });
      expect(noMfa.approved).toBe(false);
      expect(noMfa.reason).toBe('MFA_REQUIRED');

      // Neither denied attempt may move the approval out of REQUESTED or record a decision.
      expect((await row(approvalId)).status).toBe('REQUESTED');
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_APPROVED')).toBe(0);
    });

    it('refuses a non-checker role even when it holds the approving function', async () => {
      const approvalId = await requestApproval(randomUUID());
      const wrongRole = await approvals.approve({
        approvalId,
        principal: principal('FINANCE_PREPARER', 'arena4-role-outsider'),
      });
      expect(wrongRole.approved).toBe(false);
      expect(wrongRole.reason).toBe('ROLE_MISSING');
      expect((await row(approvalId)).status).toBe('REQUESTED');
    });
  });

  describe('consumption replay', () => {
    const consume = (approvalId: string, resourceId: string, who = checker('checker-h')) =>
      approvals.consume({
        approvalId,
        principal: who,
        actionType: FEE_RULE_ACTION,
        resource: { type: FEE_RULE_RESOURCE_TYPE, id: resourceId },
        actionFingerprint: FINGERPRINT,
      });

    const approvedRule = async () => {
      const resourceId = randomUUID();
      const approvalId = await requestApproval(resourceId);
      const decision = await approvals.approve({ approvalId, principal: checker('checker-h') });
      expect(decision.approved).toBe(true);
      return { approvalId, resourceId };
    };

    it('consumes an approved change exactly once under concurrent execution', async () => {
      const { approvalId, resourceId } = await approvedRule();

      const [first, second] = await Promise.all([
        consume(approvalId, resourceId),
        consume(approvalId, resourceId),
      ]);

      expect([first, second].filter((decision) => decision.approved)).toHaveLength(1);
      const loser = [first, second].find((decision) => !decision.approved)!;
      expect(loser.reason).toBe('CONSUMED');

      const stored = await row(approvalId);
      expect(stored.status).toBe('CONSUMED');
      expect(stored.consumed_at).not.toBeNull();
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_CONSUMED')).toBe(1);
    });

    it('rejects a sequential replay of an already-consumed approval', async () => {
      const { approvalId, resourceId } = await approvedRule();
      expect((await consume(approvalId, resourceId)).approved).toBe(true);

      const replay = await consume(approvalId, resourceId);
      expect(replay.approved).toBe(false);
      expect(replay.reason).toBe('CONSUMED');
      expect(await auditCount(approvalId, 'PRIVILEGED_ACTION_CONSUMED')).toBe(1);
    });

    it('does not let an approval be replayed against a different resource', async () => {
      const { approvalId, resourceId } = await approvedRule();

      const wrongResource = await consume(approvalId, randomUUID());
      expect(wrongResource.approved).toBe(false);
      expect(wrongResource.reason).toBe('RESOURCE_MISMATCH');
      expect((await row(approvalId)).status).toBe('APPROVED');

      const wrongFingerprint = await approvals.consume({
        approvalId,
        principal: checker('checker-h'),
        actionType: FEE_RULE_ACTION,
        resource: { type: FEE_RULE_RESOURCE_TYPE, id: resourceId },
        actionFingerprint: 'd'.repeat(64),
      });
      expect(wrongFingerprint.reason).toBe('FINGERPRINT_MISMATCH');
      expect((await row(approvalId)).status).toBe('APPROVED');

      expect((await consume(approvalId, resourceId)).approved).toBe(true);
    });

    it('does not let an unrelated principal consume the approved change', async () => {
      const { approvalId, resourceId } = await approvedRule();
      const outsider: AuthorizationPrincipal = {
        ...principal('FINANCE_PREPARER', 'arena4-outsider'),
        scopes: [FEE_RULE_SCOPE],
      };
      const decision = await consume(approvalId, resourceId, outsider);
      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe('APPROVAL_SCOPE_MISSING');
      expect((await row(approvalId)).status).toBe('APPROVED');
    });
  });
});
