import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../src/operations/audit.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { CustomerClassAssignmentService } from '../src/customer-class/customer-class-assignment.service';
import { CustomerClassResolverService } from '../src/customer-class/customer-class-resolver.service';
import { CustomerClassAssignmentSource } from '../src/customer-class/customer-class.enums';
import { CustomerTierDefaultClassService } from '../src/customer-class/customer-tier-default-class.service';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import type { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import type { TierEvidenceSnapshot } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierTransitionService } from '../src/kyc-verification/kyc-tier-transition.service';
import { approveIsolatedKycTierPolicy } from './support/kyc-governance-fixtures';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';

// Every assertion here runs on the disposable, socket-only cluster and on the complete migration
// chain — the earlier transition suite uses hand-built tables and therefore cannot see the
// customer_class_assignments schema (or its partial unique live-assignment index) at all.
const cluster = isolatedKycCluster();
const database = `kyc_tier_class_${randomUUID().replace(/-/g, '')}`;
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
let transition: KycTierTransitionService;
let assignments: CustomerClassAssignmentService;
const snapshots = new Map<string, TierEvidenceSnapshot>();

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

  const empty = { all: [], any: [] };
  await approveIsolatedKycTierPolicy(db, cluster, {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: empty, LEVEL_2: empty, LEVEL_3: empty },
    operator: { LEVEL_1: empty, LEVEL_2: empty, LEVEL_3: empty },
  });

  const audit = new AuditService(db.getRepository(AuditEvent));
  const authorization = new AuthorizationService(db, audit);
  // Test-only evidence adapter: the production reader needs a real customer-api session and
  // provider route, while the behaviour under test is the class write after an approved decision.
  const reader = {
    read: (_manager: EntityManager, customerId: string) =>
      Promise.resolve(snapshots.get(customerId) ?? null),
  } as unknown as KycTierEvidenceReader;
  const tierDefaults = new CustomerTierDefaultClassService(db, audit, {} as never, {} as never);
  transition = new KycTierTransitionService(
    db,
    new KycTierPolicyService(db, authorization),
    reader,
    audit,
    authorization,
    undefined,
    new CustomerClassResolverService(db),
    tierDefaults,
  );
  assignments = new CustomerClassAssignmentService(db, audit);
}, 180_000);

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

async function approveTierDefault(tier: string, code: string): Promise<string> {
  const id = await classId(code);
  await db.query(
    `UPDATE customer_tier_default_classes
        SET class_id = $1, status = 'APPROVED', approved_at = clock_timestamp(),
            approved_by = 'isolated-fixture', reason = 'Approved for transition test',
            updated_at = clock_timestamp()
      WHERE tier = $2`,
    [id, tier],
  );
  return id;
}

async function subject(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO customers(id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic)
     VALUES ($1, $2, 'INDIVIDUAL', 'DRAFT', 'NONE', 'NOT_STARTED', FALSE)`,
    [id, id],
  );
  snapshots.set(id, {
    identityRevision: 'fixture',
    evidence: (['BVN', 'NIN'] as const).map((type) => ({
      id: randomUUID(),
      customerId: id,
      identityRevision: 'fixture',
      type,
      status: 'VERIFIED' as const,
      provenance: 'VERIFIED_PROVIDER' as const,
      verifiedAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() + 1_800_000),
    })),
  });
  return id;
}

async function rows(customerId: string) {
  return db.query<
    Array<{
      id: string;
      class_id: string;
      class_code: string;
      source: string;
      is_active: boolean;
      effective_to: Date | null;
      created_by: string;
      updated_by: string | null;
    }>
  >(
    `SELECT a.id, a.class_id, c.code AS class_code, a.source, a.is_active, a.effective_to,
            a.created_by, a.updated_by
       FROM customer_class_assignments a
       JOIN customer_classes c ON c.id = a.class_id
      WHERE a.customer_id = $1
      ORDER BY a.effective_from, a.id`,
    [customerId],
  );
}

async function transitionToLevelTwo(customerId: string) {
  await transition.enqueue(customerId);
  expect(await transition.process(customerId)).toBe('PROCESSED');
  const state = await db.query<Array<{ kyc_level: string }>>(
    `SELECT kyc_level FROM customers WHERE id = $1`,
    [customerId],
  );
  expect(state[0]?.kyc_level).toBe('LEVEL_2');
}

test('an approved tier change closes the automatic assignment and writes exactly one live default', async () => {
  const id = await subject();
  const standard = await classId('STANDARD');
  const premium = await approveTierDefault('LEVEL_2', 'PREMIUM');
  await db.transaction((manager) =>
    assignments.assignInManager(manager, {
      customerId: id,
      classId: standard,
      source: CustomerClassAssignmentSource.REGISTRATION_DEFAULT,
      actor: 'isolated-fixture',
    }),
  );

  await transitionToLevelTwo(id);

  const history = await rows(id);
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({
    class_code: 'STANDARD',
    source: 'REGISTRATION_DEFAULT',
    is_active: false,
  });
  expect(history[0]?.effective_to).not.toBeNull();
  expect(history[1]).toMatchObject({
    class_code: 'PREMIUM',
    source: 'TIER_DEFAULT',
    is_active: true,
    effective_to: null,
    created_by: 'SYSTEM_KYC_EVALUATOR',
  });
  expect(history[1]?.class_code === 'PREMIUM' && history[1]?.class_id === premium).toBe(true);
  expect(history.filter((row) => row.is_active)).toHaveLength(1);
  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM customer_class_assignments WHERE customer_id=$1 AND is_active`,
      [id],
    ),
  ).toEqual([{ n: 1 }]);
});

test('a previously inactive tier default is reactivated without a second live assignment', async () => {
  const id = await subject();
  const standard = await classId('STANDARD');
  const premium = await approveTierDefault('LEVEL_2', 'PREMIUM');
  await db.transaction((manager) =>
    assignments.assignInManager(manager, {
      customerId: id,
      classId: standard,
      source: CustomerClassAssignmentSource.REGISTRATION_DEFAULT,
      actor: 'isolated-fixture',
    }),
  );
  await db.query(
    `INSERT INTO customer_class_assignments
       (id, customer_id, class_id, effective_from, is_active, precedence, source, reason, created_by)
     VALUES ($1, $2, $3, clock_timestamp() - interval '1 hour', FALSE, 0, 'TIER_DEFAULT',
             'Earlier tier default', 'earlier-actor')`,
    [randomUUID(), id, premium],
  );

  await transitionToLevelTwo(id);

  const history = await rows(id);
  expect(history).toHaveLength(2);
  expect(history.filter((row) => row.is_active)).toHaveLength(1);
  const live = history.find((row) => row.is_active);
  expect(live).toMatchObject({ class_code: 'PREMIUM', source: 'TIER_DEFAULT' });
  // The audit actor belongs in updated_by; the original provenance stays in created_by.
  expect(live?.created_by).toBe('earlier-actor');
  expect(live?.updated_by).toBe('SYSTEM_KYC_EVALUATOR');
});

test('an approved tier change preserves a manual class assignment', async () => {
  const id = await subject();
  const premium = await classId('PREMIUM');
  await approveTierDefault('LEVEL_2', 'BUSINESS');
  await db.transaction((manager) =>
    assignments.assignInManager(manager, {
      customerId: id,
      classId: premium,
      source: CustomerClassAssignmentSource.MANUAL,
      reason: 'Compliance-approved manual premium class',
      actor: 'isolated-fixture',
    }),
  );

  await transitionToLevelTwo(id);

  const history = await rows(id);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    class_code: 'PREMIUM',
    source: 'MANUAL',
    is_active: true,
    effective_to: null,
  });
  const audit = await db.query<Array<{ new_values: { preservedManual: boolean } }>>(
    `SELECT new_values FROM audit_events
      WHERE entity_type = 'CUSTOMER_KYC_TRANSITION'
        AND action = 'TIER_CHANGE_CLASS_REEVALUATED' AND entity_id = $1`,
    [id],
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]?.new_values.preservedManual).toBe(true);
});
