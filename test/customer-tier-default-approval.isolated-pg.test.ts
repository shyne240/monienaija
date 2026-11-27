import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { RoleFunctionAccessType } from '../src/authorization-catalogue/authorization-catalogue.enums';
import { AuthorizationFunction } from '../src/authorization-catalogue/authorization-function.entity';
import { AuthorizationRole } from '../src/authorization-catalogue/authorization-role.entity';
import { AuthorizationRoleFunction } from '../src/authorization-catalogue/authorization-role-function.entity';
import { AuthorizationCatalogueRuntimeService } from '../src/authorization-catalogue/authorization-catalogue-runtime.service';
import { AuthorizationCatalogueSeedService } from '../src/authorization-catalogue/authorization-catalogue-seed.service';
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

const FUNCTIONS = ['customer.manage_classes'];

function principal(
  principalId: string,
  roles: readonly string[] = ['CUSTOMER_SERVICE'],
  overrides: Partial<AuthorizationPrincipal> = {},
) {
  return {
    type: 'OPERATOR' as const,
    principalId,
    sessionId: randomUUID(),
    assuranceLevel: 'MFA' as const,
    customerAccess: 'NONE' as const,
    roles: [...roles],
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

  const catalogueSeed = new AuthorizationCatalogueSeedService(
    db.getRepository(AuthorizationFunction),
    db.getRepository(AuthorizationRole),
    db.getRepository(AuthorizationRoleFunction),
  );
  await catalogueSeed.seedIfEmpty();
  const catalogueRuntime = new AuthorizationCatalogueRuntimeService(
    db.getRepository(AuthorizationRole),
    db.getRepository(AuthorizationRoleFunction),
  );

  const audit = new AuditService(db.getRepository(AuditEvent));
  const authorization = new AuthorizationService(db, audit);
  approvals = new PrivilegedActionApprovalService(
    db.getRepository(PrivilegedActionApproval),
    db.getRepository(SecurityEventHistory),
    db,
    audit,
    authorization,
    undefined,
    undefined,
    catalogueRuntime,
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
  >(
    `SELECT tier, class_id, status, approval_id, approved_by, version FROM customer_tier_default_classes WHERE tier = $1`,
    [tier],
  );
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

  it('lets a single-role maker propose and refuses self-approval from a second session or dual-role principal', async () => {
    const premium = await classId('PREMIUM');
    const standard = await classId('STANDARD');
    const business = await classId('BUSINESS');
    const maker = principal('maker-self', ['CUSTOMER_SERVICE']);

    const request = await tierDefaults.propose(maker, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Raise tier defaults to premium for review',
    });
    const approvalId = request.approvalId;
    expect(approvalId).toMatch(/^[0-9a-f-]{36}$/);

    // Same principalId, brand-new session, even with both roles and MFA: still refused.
    const selfDecision = await approvals
      .approve({
        principal: principal('maker-self', ['SUPER_ADMIN', 'CUSTOMER_SERVICE'], {
          sessionId: randomUUID(),
        }),
        approvalId,
        comment: 'self approval attempt',
      })
      .catch((error: Error) => ({ approved: false, reason: error.message }) as never);
    expect(selfDecision.approved).toBe(false);
    expect(selfDecision.reason).toBe('SELF_APPROVAL_FORBIDDEN');

    const stillPending = await mapping('LEVEL_1');
    expect(stillPending?.status).toBe('PENDING_APPROVAL');
    expect(stillPending?.class_id).toBe(standard);
  });

  it('lets an independent single-role checker approve, then applies the approved request to the seeded mapping', async () => {
    const premium = await classId('PREMIUM');
    const business = await classId('BUSINESS');
    const maker = principal('maker-independent', ['CUSTOMER_SERVICE']);
    const checker = principal('checker-independent', ['SUPER_ADMIN']);

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

    const maker = principal('maker-create', ['CUSTOMER_SERVICE']);
    const checker = principal('checker-create', ['CUSTOMER_SERVICE']);
    const request = await tierDefaults.propose(maker, {
      tierDefaults: { LEVEL_1: premium, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Recreate the missing LEVEL_3 mapping under approval',
    });
    const approvalId = request.approvalId;
    await approvals.approve({
      principal: checker,
      approvalId,
      comment: 'checker approves new row',
    });
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

  it('enforces configurable catalogue INITIATE maker and APPROVE checker custom roles', async () => {
    const standard = await classId('STANDARD');
    const premium = await classId('PREMIUM');
    const business = await classId('BUSINESS');

    const roleRepo = db.getRepository(AuthorizationRole);
    const rfRepo = db.getRepository(AuthorizationRoleFunction);

    const customMakerRole = await roleRepo.save(
      roleRepo.create({
        roleKey: 'TIER_DEFAULT_MAKER_ISOLATED',
        displayName: 'Tier Default Maker Isolated',
        description: 'Custom maker role holding INITIATE on customer.manage_classes',
        isSystemRole: false,
        readOnly: false,
        administrativeCapability: false,
        isActive: true,
      } as Partial<AuthorizationRole>),
    );
    const customCheckerRole = await roleRepo.save(
      roleRepo.create({
        roleKey: 'TIER_DEFAULT_CHECKER_ISOLATED',
        displayName: 'Tier Default Checker Isolated',
        description: 'Custom checker role holding APPROVE on customer.manage_classes',
        isSystemRole: false,
        readOnly: false,
        administrativeCapability: false,
        isActive: true,
      } as Partial<AuthorizationRole>),
    );

    await rfRepo.save([
      rfRepo.create({
        roleId: customMakerRole.id,
        functionCode: 'customer.manage_classes',
        accessType: RoleFunctionAccessType.INITIATE,
        isActive: true,
      } as Partial<AuthorizationRoleFunction>),
      rfRepo.create({
        roleId: customCheckerRole.id,
        functionCode: 'customer.manage_classes',
        accessType: RoleFunctionAccessType.APPROVE,
        isActive: true,
      } as Partial<AuthorizationRoleFunction>),
    ]);

    const customMaker = principal('custom-maker-1', ['TIER_DEFAULT_MAKER_ISOLATED']);
    const customMaker2 = principal('custom-maker-2', ['TIER_DEFAULT_MAKER_ISOLATED']);
    const customChecker = principal('custom-checker-1', ['TIER_DEFAULT_CHECKER_ISOLATED']);

    // APPROVE-only role cannot propose.
    await expect(
      tierDefaults.propose(customChecker, {
        tierDefaults: { LEVEL_1: standard, LEVEL_2: premium, LEVEL_3: business },
        reason: 'Checker cannot initiate',
      }),
    ).rejects.toThrow(/Governed change request denied/);

    // INITIATE role can propose.
    const request = await tierDefaults.propose(customMaker, {
      tierDefaults: { LEVEL_1: standard, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Custom maker initiates tier default update',
    });

    // Independent INITIATE-only principal still cannot approve.
    const deniedDecision = await approvals.approve({
      principal: customMaker2,
      approvalId: request.approvalId,
      comment: 'INITIATE-only cannot approve',
    });
    expect(deniedDecision.approved).toBe(false);
    expect(deniedDecision.reason).toBe('FUNCTION_MISSING');

    // Independent APPROVE role approves and executes.
    const approvedDecision = await approvals.approve({
      principal: customChecker,
      approvalId: request.approvalId,
      comment: 'Custom checker approves',
    });
    expect(approvedDecision.approved).toBe(true);

    const applied = await tierDefaults.execute(customChecker, request.approvalId, {
      tierDefaults: { LEVEL_1: standard, LEVEL_2: premium, LEVEL_3: business },
      reason: 'Custom maker initiates tier default update',
    });
    expect(applied.approvalId).toBe(request.approvalId);

    const events = await auditRows('LEVEL_1');
    const matching = events.find((e) => e.new_values.approvalId === request.approvalId);
    expect(matching).toBeDefined();
    expect(matching?.entity_id).toBe(tierDefaultAuditEntityId('LEVEL_1'));
    expect(matching?.new_values).toMatchObject({
      tier: 'LEVEL_1',
      classId: standard,
      status: 'APPROVED',
      approvalId: request.approvalId,
      approvedBy: 'custom-checker-1',
    });
  });
});
