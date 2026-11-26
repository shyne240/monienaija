import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { CommercialRuleGovernanceService } from '../src/authorization/commercial-rule-governance.service';
import { CUSTOMER_CLASS_TIER_DEFAULTS_ACTION } from '../src/authorization/governed-action.registry';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import {
  CustomerTierDefaultClassService,
  tierDefaultAuditEntityId,
} from '../src/customer-class/customer-tier-default-class.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';

// Tier default class approval runs on the disposable, socket-only cluster with the complete
// migration chain, so `audit_events.entity_id` really is `UUID NOT NULL` here. That constraint is
// what the tier code used to break; a hand-built schema would not catch it.
const cluster = isolatedKycCluster();
const database = `tier_default_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: cluster.socketDirectory,
  port: cluster.port,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  migrationsRun: false,
});
let created = false;
let db: DataSource;
let tierDefaults: CustomerTierDefaultClassService;
let approvals: PrivilegedActionApprovalService;

// `CUSTOMER_CLASS_TIER_DEFAULTS_ACTION.initiatingRoles` is ['SUPER_ADMIN','CUSTOMER_SERVICE'] and
// AuthorizationService applies requiredRoles with all-of semantics, so a proposer must hold BOTH.
// The approver gate (`PrivilegedActionApprovalService.decide`) uses `.some()`, i.e. either role.
// No single one of the eleven seeded workforce accounts holds both, so the effective policy is
// recorded in the checkpoint as an open decision rather than patched here.
const MAKER_ROLES = ['SUPER_ADMIN', 'CUSTOMER_SERVICE'];
const FUNCTIONS = ['customer.manage_classes'];

function principal(principalId: string, overrides: Partial<AuthorizationPrincipal> = {}) {
  return {
    type: 'OPERATOR' as const,
    principalId,
    sessionId: randomUUID(),
    assuranceLevel: 'MFA' as const,
    customerAccess: 'NONE' as const,
    roles: [...MAKER_ROLES],
    scopes: ['customer.manage_classes'],
    functions: FUNCTIONS,
    ...overrides,
  } as AuthorizationPrincipal;
}

beforeAll(async () => {
  await admin.initialize();
  await assertIsolatedKycCluster(admin, cluster);
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: cluster.socketDirectory,
    port: cluster.port,
    username: 'kyc_synthetic',
    database,
    synchronize: false,
    migrationsRun: false,
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
  });
  await db.initialize();
  await assertIsolatedKycCluster(db, cluster);
  const applied = await db.runMigrations({ transaction: 'all' });
  expect(applied.length).toBeGreaterThan(150);

  const audit = new AuditService(db.getRepository(AuditEvent));
  const authorization = new AuthorizationService(db, audit);
  approvals = new PrivilegedActionApprovalService(
    db.getRepository(PrivilegedActionApproval),
    db.getRepository(SecurityEventHistory),
    db,
    audit,
    authorization,
  );
  const governance = new CommercialRuleGovernanceService(approvals, audit, db);
  tierDefaults = new CustomerTierDefaultClassService(db, audit, approvals, governance);
}, 240_000);

afterAll(async () => {
  if (db?.isInitialized) await db.destroy();
  if (admin.isInitialized) {
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.destroy();
  }
});

async function classId(code: string): Promise<string> {
  const rows = await db.query<Array<{ id: string }>>(
    `SELECT id FROM customer_classes WHERE code = $1 AND deleted_at IS NULL`,
    [code],
  );
  if (!rows[0]) throw new Error(`seeded class ${code} missing`);
  return rows[0].id;
}

async function mapping(tier: string) {
  const rows = await db.query<
    Array<{
      tier: string;
      class_id: string;
      status: string;
      approval_id: string | null;
      approved_by: string | null;
      version: number;
    }>
  >(`SELECT tier, class_id, status, approval_id, approved_by, version FROM customer_tier_default_classes WHERE tier = $1`, [
    tier,
  ]);
  return rows[0];
}

async function auditRows(tier: string) {
  return db.query<
    Array<{ entity_id: string; action: string; actor: string; new_values: Record<string, unknown> }>
  >(
    `SELECT entity_id, action, actor, new_values FROM audit_events
      WHERE entity_type = 'CUSTOMER_CLASS_TIER_DEFAULT' AND entity_id = $1
      ORDER BY occurred_at ASC`,
    [tierDefaultAuditEntityId(tier)],
  );
}

describe('tier default class maker/checker approval', () => {
  it('derives a stable, distinct UUID for each tier because audit_events.entity_id is UUID NOT NULL', () => {
    const level1 = tierDefaultAuditEntityId('LEVEL_1');
    const all = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].map(tierDefaultAuditEntityId);
    expect(new Set(all).size).toBe(3);
    for (const id of all) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    // Stable across calls, so audit lookups by tier keep resolving.
    expect(tierDefaultAuditEntityId('LEVEL_1')).toBe(level1);
    // The tier code itself is not a UUID, which is why it cannot be the entity id.
    expect(level1).not.toBe('LEVEL_1');
  });

  it('starts from migration-seeded PENDING_APPROVAL mappings that are not effective', async () => {
    const view = await tierDefaults.list();
    expect(view.mappings).toHaveLength(3);
    expect(view.mappings.every((m) => m.status === 'PENDING_APPROVAL')).toBe(true);
    expect(view.pendingApprovalCount).toBe(3);
    expect(view.allApproved).toBe(false);
    const effective = await db.transaction((manager) =>
      tierDefaults.getApprovedDefaultForTier(manager, 'LEVEL_1'),
    );
    expect(effective).toBeNull();
  });

  it('refuses self-approval by the proposing principal, even with both roles and a second session', async () => {
    const premium = await classId('PREMIUM');
    const standard = await classId('STANDARD');
    const business = await classId('BUSINESS');
    const maker = principal('maker-self');

    const request = await tierDefaults.propose(maker, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Raise tier defaults to premium for review',
    });
    const approvalId = request.approvalId;
    expect(approvalId).toMatch(/^[0-9a-f-]{36}$/);

    // Same principal, second session, both initiating and approving roles, MFA: still refused.
    const selfDecision = await approvals
      .approve({
        // Same principalId, brand-new session, both roles, MFA: still refused.
        principal: principal('maker-self', { sessionId: randomUUID() }),
        approvalId,
        comment: 'self approval attempt',
      })
      .catch((error: Error) => ({ approved: false, reason: error.message } as never));
    expect(selfDecision.approved).toBe(false);

    const stillPending = await mapping('LEVEL_1');
    expect(stillPending?.status).toBe('PENDING_APPROVAL');
    expect(stillPending?.class_id).toBe(standard);
  });

  it('lets an independent checker approve, then applies the approved request to the seeded mapping', async () => {
    const premium = await classId('PREMIUM');
    const business = await classId('BUSINESS');
    const maker = principal('maker-independent');
    const checker = principal('checker-independent');

    const request = await tierDefaults.propose(maker, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Approved tier defaults after independent review',
    });
    const approvalId = request.approvalId;

    const decision = await approvals.approve({
      principal: checker,
      approvalId,
      comment: 'independent review complete',
    });
    expect(decision.approved).toBe(true);

    const stored = await db
      .getRepository(PrivilegedActionApproval)
      .findOneByOrFail({ id: approvalId });
    expect(stored.status).toBe('APPROVED');
    expect(stored.approvedBy).toBe('checker-independent');
    expect(stored).toMatchObject({
      actionType: CUSTOMER_CLASS_TIER_DEFAULTS_ACTION.action,
      resourceType: CUSTOMER_CLASS_TIER_DEFAULTS_ACTION.resourceType,
      resourceId: null,
    });

    // Apply the approved request: this is the path that used to die on the tier-code audit write.
    const applied = await tierDefaults.execute(checker, approvalId, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Approved tier defaults after independent review',
    });
    expect(applied.approvalId).toBe(approvalId);

    for (const tier of ['LEVEL_1', 'LEVEL_2', 'LEVEL_3']) {
      const row = await mapping(tier);
      expect(row?.status).toBe('APPROVED');
      expect(row?.approval_id).toBe(approvalId);
      expect(row?.approved_by).toBe('checker-independent');
      expect(row?.class_id).toBe(tier === 'LEVEL_3' ? business : premium);
      expect(row?.version).toBe(2);
    }

    const view = await tierDefaults.list();
    expect(view.allApproved).toBe(true);
    expect(view.pendingApprovalCount).toBe(0);
    const effective = await db.transaction((manager) =>
      tierDefaults.getApprovedDefaultForTier(manager, 'LEVEL_1'),
    );
    expect(effective?.classCode).toBe('PREMIUM');

    // Audit trail: one UUID-keyed UPDATED row per tier, carrying the tier code in the payload.
    for (const tier of ['LEVEL_1', 'LEVEL_2', 'LEVEL_3']) {
      const events = await auditRows(tier);
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event?.action).toBe('UPDATED');
      expect(event?.actor).toBe('checker-independent');
      expect(event?.entity_id).toBe(tierDefaultAuditEntityId(tier));
      expect(event?.new_values).toMatchObject({ tier, status: 'APPROVED', approvalId });
    }
  });

  it('creates a new mapping row and audits CREATED when the tier had none', async () => {
    const premium = await classId('PREMIUM');
    const business = await classId('BUSINESS');
    // Simulate a tier that has no mapping yet: the service must INSERT rather than UPDATE.
    await db.query(`DELETE FROM customer_tier_default_classes WHERE tier = 'LEVEL_3'`);

    const maker = principal('maker-create');
    const checker = principal('checker-create');
    const request = await tierDefaults.propose(maker, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Recreate the missing LEVEL_3 mapping under approval',
    });
    const approvalId = request.approvalId;
    await approvals.approve({ principal: checker, approvalId, comment: 'checker approves new row' });
    await tierDefaults.execute(checker, approvalId, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Recreate the missing LEVEL_3 mapping under approval',
    });

    const row = await mapping('LEVEL_3');
    expect(row?.status).toBe('APPROVED');
    expect(row?.approval_id).toBe(approvalId);
    expect(row?.version).toBe(1);

    const events = await auditRows('LEVEL_3');
    const created = events.find((event) => event.action === 'CREATED');
    expect(created).toBeDefined();
    expect(created?.entity_id).toBe(tierDefaultAuditEntityId('LEVEL_3'));
    expect(created?.new_values).toMatchObject({
      tier: 'LEVEL_3',
      classId: business,
      status: 'APPROVED',
      approvalId,
    });
  });
});
