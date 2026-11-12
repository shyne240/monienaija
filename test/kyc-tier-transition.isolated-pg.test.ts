import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CustomerController } from '../src/customer/customer.controller';
import { CustomerService } from '../src/customer/customer.service';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { CustomerKycLevel, CustomerKycStatus } from '../src/customer/customer.enums';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { KycTierPolicy1785753600110 } from '../src/migrations/1785753600110-KycTierPolicy';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { FixtureEvidenceReader } from './support/kyc-tier-fixture-evidence-reader';
import { KycTierTransitionService } from '../src/kyc-verification/kyc-tier-transition.service';
import { KycTierWorker } from '../src/kyc-verification/kyc-tier-worker.service';
import { identityBindingMac } from '../src/kyc-verification/kyc-orchestrator';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';
// Portable provenance: see test/support/kyc-isolated-cluster.ts. No absolute path from any one
// developer's machine is embedded here; the runner (scripts/run-isolated-kyc-tests.js) creates
// the disposable cluster and exports KYC_ISOLATED_TEST_SOCKET.
const cluster = isolatedKycCluster();
const socket = cluster.socketDirectory;
const schema = `kyc_tier_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: cluster.port,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  logging: false,
  entities: [AuditEvent],
  extra: { options: `-c search_path=${schema}` },
});
const actor = (id: string, role: string, scopes: string[]): AuthorizationPrincipal => ({
  type: 'OPERATOR',
  principalId: id,
  sessionId: randomUUID(),
  roles: [role],
  scopes,
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
});
const maker = actor('maker', 'SUPER_ADMIN', ['kyc.policy.propose']),
  checker = actor('checker', 'COMPLIANCE', ['kyc.policy.approve']);
const key = randomBytes(32);
const identity = {
  firstName: 'Synthetic',
  lastName: 'Test',
  dateOfBirth: '2000-01-01',
  phone: '08000000000',
};
let policy: KycTierPolicyService, service: KycTierTransitionService, worker: KycTierWorker;
let created = false;
const definition = () => ({
  regulatoryRequirementsConfirmed: true,
  effectiveFrom: '2020-01-01T00:00:00.000Z',
  effectiveUntil: null,
  regulatory: { LEVEL_1: { all: [], any: [] }, LEVEL_2: { all: [], any: [] } },
  operator: { LEVEL_1: { all: [], any: [] }, LEVEL_2: { all: [], any: [] } },
});
async function customer() {
  const id = randomUUID();
  await db.query(`INSERT INTO customers(id) VALUES ($1)`, [id]);
  await db.query(
    `INSERT INTO customer_profiles(customer_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,$4)`,
    [id, identity.firstName, identity.lastName, identity.dateOfBirth],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(customer_id,normalized_value) VALUES($1,$2)`,
    [id, identity.phone],
  );
  return id;
}
async function evidence(
  customerId: string,
  kind: 'BVN' | 'NIN',
  provider = 'ISOLATED_TRUSTED_FIXTURE',
) {
  const id = randomUUID(),
    consent = randomUUID();
  await db.query(
    `INSERT INTO kyc_consents(id,customer_id,session_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,
    [consent, customerId, randomUUID()],
  );
  await db.query(
    `INSERT INTO kyc_verification_attempts(id,customer_id,consent_id,kind,provider,outcome,identity_mac,mac_key_version,completed_at,expires_at) VALUES($1,$2,$3,$4,$5,'MATCH',$6,'fixture',clock_timestamp(),clock_timestamp()+interval '30 minutes')`,
    [id, customerId, consent, kind, provider, identityBindingMac(customerId, identity, key)],
  );
  await db.query(
    `INSERT INTO kyc_identity_claims(attempt_id,customer_id,status) VALUES($1,$2,'VERIFIED')`,
    [id, customerId],
  );
  return { id, consent };
}
async function state(id: string) {
  return (
    await db.query<Array<{ kyc_level: string; kyc_status: string }>>(
      'SELECT kyc_level,kyc_status FROM customers WHERE id=$1',
      [id],
    )
  )[0];
}
beforeAll(async () => {
  await db.initialize();
  await assertIsolatedKycCluster(db, cluster);
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  await db.query(
    `CREATE TABLE customers(id uuid PRIMARY KEY,status varchar(20) NOT NULL DEFAULT 'ACTIVE',kyc_level varchar(20) NOT NULL DEFAULT 'NONE',kyc_status varchar(20) NOT NULL DEFAULT 'NOT_STARTED',version int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE customer_profiles(customer_id uuid,first_name varchar(100),last_name varchar(100),date_of_birth date,is_active boolean NOT NULL DEFAULT true,deleted_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE customer_contact_methods(customer_id uuid,type varchar(10) NOT NULL DEFAULT 'PHONE',normalized_value text,is_primary boolean NOT NULL DEFAULT true,verified_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE customer_kyc_assessments(id uuid PRIMARY KEY,customer_id uuid,kyc_level varchar(20),kyc_status varchar(20),reason text,assessed_by text,is_current boolean,expires_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
  );
  await db.query(
    `CREATE UNIQUE INDEX current_assessment ON customer_kyc_assessments(customer_id) WHERE is_current`,
  );
  await db.query(
    `CREATE TABLE kyc_evaluation_refresh(customer_id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,requested_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  );
  await db.query(
    `CREATE TABLE kyc_consents(id uuid PRIMARY KEY,customer_id uuid,session_id uuid,expires_at timestamptz,withdrawn_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE kyc_verification_attempts(id uuid PRIMARY KEY,customer_id uuid,consent_id uuid,kind varchar(3),provider varchar(32),outcome varchar(24),identity_mac char(64),mac_key_version varchar(64),created_at timestamptz DEFAULT now(),completed_at timestamptz,expires_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE kyc_identity_claims(attempt_id uuid,customer_id uuid,status varchar(12))`,
  );
  await db.query(
    `CREATE TABLE audit_events(id uuid PRIMARY KEY,entity_type varchar(80),entity_id uuid,action varchar(80),actor varchar(160),correlation_id varchar(255),request_id varchar(255),previous_values jsonb,new_values jsonb,occurred_at timestamptz,created_at timestamptz DEFAULT now())`,
  );
  const runner = db.createQueryRunner();
  await new KycTierPolicy1785753600110().up(runner);
  await runner.release();
  const audit = new AuditService(db.getRepository(AuditEvent));
  policy = new KycTierPolicyService(db, new AuthorizationService(db, audit));
  service = new KycTierTransitionService(
    db,
    policy,
    new FixtureEvidenceReader({ provider: 'ISOLATED_TRUSTED_FIXTURE', key, keyVersion: 'fixture' }),
    audit,
    new AuthorizationService(db, audit),
  );
  worker = new KycTierWorker(db, service, policy);
  const p = await policy.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: 0,
    definition: definition(),
  });
  await policy.decide(checker, p.id, true);
});
afterAll(async () => {
  if (db.isInitialized) {
    if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.destroy();
  }
});
it('applies tier one then tier two once from identity-bound provider fixtures and audits each', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  expect(await service.process(id)).toBe('PROCESSED');
  expect(await state(id)).toMatchObject({ kyc_level: 'LEVEL_1', kyc_status: 'APPROVED' });
  await evidence(id, 'NIN');
  await service.enqueue(id);
  const results = await Promise.all([service.process(id), service.process(id)]);
  expect(results.sort()).toEqual(['NO_WORK', 'PROCESSED']);
  expect(await state(id)).toMatchObject({ kyc_level: 'LEVEL_2', kyc_status: 'APPROVED' });
  const audits = await db.query<
    Array<{
      actor: string;
      previous_values: Record<string, unknown>;
      new_values: Record<string, unknown>;
      occurred_at: Date;
    }>
  >(
    `SELECT actor,previous_values,new_values,occurred_at FROM audit_events WHERE entity_type='CUSTOMER_KYC_TRANSITION' AND new_values->>'customerId'=$1 ORDER BY occurred_at`,
    [id],
  );
  expect(audits).toHaveLength(2);
  expect(audits[0]).toMatchObject({
    actor: 'SYSTEM_KYC_EVALUATOR',
    previous_values: { level: 'NONE', status: 'NOT_STARTED' },
    new_values: {
      level: 'LEVEL_1',
      status: 'APPROVED',
      policyVersion: '1',
      reason: 'TIER_1_REQUIREMENTS_MET',
    },
  });
  expect(audits[1]).toMatchObject({
    previous_values: { level: 'LEVEL_1', status: 'APPROVED' },
    new_values: {
      level: 'LEVEL_2',
      status: 'APPROVED',
      policyVersion: '1',
      reason: 'TIER_2_REQUIREMENTS_MET',
    },
  });
  expect(audits[1]?.occurred_at).toBeInstanceOf(Date);
  expect(audits[1]?.new_values.evidenceIds).toHaveLength(2);
});
it('never approves synthetic provider outcomes and holds missing evidence', async () => {
  const id = await customer();
  await evidence(id, 'BVN', 'SYNTHETIC');
  await service.enqueue(id);
  await service.process(id);
  expect(await state(id)).toMatchObject({ kyc_level: 'NONE', kyc_status: 'NOT_STARTED' });
});
it('rechecks revoked evidence and downgrades to surviving tier', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  const n = await evidence(id, 'NIN');
  await service.enqueue(id);
  await service.process(id);
  expect((await state(id))?.kyc_level).toBe('LEVEL_2');
  await db.query('UPDATE kyc_consents SET withdrawn_at=clock_timestamp() WHERE id=$1', [n.consent]);
  await service.process(id);
  expect(await state(id)).toMatchObject({ kyc_level: 'LEVEL_1', kyc_status: 'APPROVED' });
});
it('does not downgrade or upgrade legacy assessments or with unavailable evidence reader', async () => {
  const id = await customer();
  await db.query(`UPDATE customers SET kyc_level='LEVEL_2',kyc_status='APPROVED' WHERE id=$1`, [
    id,
  ]);
  await service.enqueue(id);
  await service.process(id);
  expect((await state(id))?.kyc_level).toBe('LEVEL_2');
  const id2 = await customer();
  await evidence(id2, 'BVN');
  const closed = new KycTierTransitionService(
    db,
    policy,
    new KycTierEvidenceReader(),
    new AuditService(db.getRepository(AuditEvent)),
    new AuthorizationService(db, new AuditService(db.getRepository(AuditEvent))),
  );
  await closed.enqueue(id2);
  await closed.process(id2);
  expect((await state(id2))?.kyc_level).toBe('NONE');
});
it('worker discovers expiry without duplicating expiry events', async () => {
  const id = await customer();
  const a = await evidence(id, 'BVN');
  await service.enqueue(id);
  await service.process(id);
  await db.query(
    "UPDATE kyc_verification_attempts SET expires_at=clock_timestamp()-interval '1 second',completed_at=clock_timestamp()-interval '2 hours' WHERE id=$1",
    [a.id],
  );
  await worker.tick();
  expect((await state(id))?.kyc_level).toBe('NONE');
  const count = await db.query<Array<{ n: string }>>(
    `SELECT count(*) AS n FROM kyc_tier_expiry_events WHERE source_id=$1`,
    [a.id],
  );
  await worker.tick();
  const after = await db.query<Array<{ n: string }>>(
    `SELECT count(*) AS n FROM kyc_tier_expiry_events WHERE source_id=$1`,
    [a.id],
  );
  expect(count).toEqual(after);
});

it('enforces administrative authorization, audited holds and explicit evidence-gated release', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  await service.process(id);
  const reviewer = actor('reviewer', 'COMPLIANCE', ['kyc.reject', 'kyc.approve']);
  const command = {
    level: CustomerKycLevel.NONE,
    status: CustomerKycStatus.REJECTED,
    reason: 'EVIDENCE_REVOKED',
    assessedBy: 'ignored',
  };
  await expect(service.administrativeAssessment(id, command, undefined)).rejects.toThrow();
  await expect(
    service.administrativeAssessment(id, command, { ...reviewer, assuranceLevel: 'PASSWORD' }),
  ).rejects.toThrow();
  const first = await service.administrativeAssessment(id, command, reviewer);
  const replay = await service.administrativeAssessment(id, command, reviewer);
  expect(replay.id).toBe(first.id);
  await service.enqueue(id);
  await service.process(id);
  expect(await state(id)).toMatchObject({ kyc_level: 'NONE', kyc_status: 'REJECTED' });
  await expect(
    service.administrativeAssessment(
      id,
      {
        level: CustomerKycLevel.LEVEL_2,
        status: CustomerKycStatus.APPROVED,
        assessedBy: 'ignored',
      },
      reviewer,
    ),
  ).rejects.toThrow();
  expect((await state(id))?.kyc_status).toBe('REJECTED');
  await service.administrativeAssessment(
    id,
    { level: CustomerKycLevel.LEVEL_1, status: CustomerKycStatus.APPROVED, assessedBy: 'ignored' },
    reviewer,
  );
  expect(await state(id)).toMatchObject({ kyc_level: 'LEVEL_1', kyc_status: 'APPROVED' });
});
it('rolls back the assessment, customer and queue if audit persistence fails', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  const failing = {
    record: jest.fn().mockRejectedValue(new Error('synthetic audit failure')),
  } as unknown as AuditService;
  const isolated = new KycTierTransitionService(
    db,
    policy,
    new FixtureEvidenceReader({ provider: 'ISOLATED_TRUSTED_FIXTURE', key, keyVersion: 'fixture' }),
    failing,
    new AuthorizationService(db, failing),
  );
  await expect(isolated.process(id)).rejects.toThrow();
  expect(await state(id)).toMatchObject({ kyc_level: 'NONE', kyc_status: 'NOT_STARTED' });
  expect(
    (
      await db.query<Array<{ n: string }>>(
        'SELECT count(*) AS n FROM customer_kyc_assessments WHERE customer_id=$1',
        [id],
      )
    )[0]?.n,
  ).toBe('0');
});
it('the existing Cash-to-Cash assessment gate sees an approved and then revoked assessment', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  await service.process(id);
  const proto = AgentCashToCashClaimService.prototype as unknown as {
    assertCurrentApprovedKyc(q: DataSource, id: string): Promise<{ assessmentId: string }>;
  };
  expect((await proto.assertCurrentApprovedKyc.call(proto, db, id)).assessmentId).toBeTruthy();
  const reviewer = actor('reviewer-2', 'COMPLIANCE', ['kyc.reject']);
  await service.administrativeAssessment(
    id,
    {
      level: CustomerKycLevel.NONE,
      status: CustomerKycStatus.REJECTED,
      reason: 'EVIDENCE_REVOKED',
      assessedBy: 'ignored',
    },
    reviewer,
  );
  await expect(proto.assertCurrentApprovedKyc.call(proto, db, id)).rejects.toThrow();
});

it('customer assessment API enforces workforce authentication and verified evidence', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  const reviewer = actor('api-reviewer', 'COMPLIANCE', ['kyc.approve', 'kyc.reject']);
  const auth = new AuthorizationService(db, new AuditService(db.getRepository(AuditEvent)));
  const guard = new RuntimeAccessGuard(
    { validate: jest.fn().mockResolvedValue({ valid: false }) } as never,
    auth,
    new RoutePolicyRegistry(),
    {
      validate: (token: string) =>
        token === 'reviewer' ? Promise.resolve(reviewer) : Promise.reject(new Error('invalid')),
    } as never,
    { enabled: true, internalAudience: 'test' } as never,
    { validate: jest.fn().mockResolvedValue({ valid: false }) } as never,
    { validate: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const mod = await Test.createTestingModule({
    controllers: [CustomerController],
    providers: [
      { provide: CustomerService, useValue: {} },
      { provide: AuthorizationService, useValue: auth },
      { provide: KycTierTransitionService, useValue: service },
      { provide: APP_GUARD, useValue: guard },
    ],
  }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const http = app.getHttpAdapter().getInstance(),
      url = `/api/v1/customers/${id}/kyc-assessment`;
    const payload = { level: 'LEVEL_2', status: 'APPROVED', assessedBy: 'untrusted' };
    expect((await http.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect(
      (
        await http.inject({
          method: 'POST',
          url,
          headers: { authorization: 'Bearer reviewer' },
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect((await state(id))?.kyc_level).toBe('NONE');
    const result = await http.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer reviewer' },
      payload: { ...payload, level: 'LEVEL_1' },
    });
    expect(result.statusCode).toBe(201);
    expect((await state(id))?.kyc_level).toBe('LEVEL_1');
  } finally {
    await app.close();
  }
});

it('suspends a managed approval for an identity mismatch and holds it for review', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  await service.process(id);
  await db.query(`UPDATE customer_profiles SET first_name='Changed' WHERE customer_id=$1`, [id]);
  await service.process(id);
  expect(await state(id)).toMatchObject({ kyc_level: 'NONE', kyc_status: 'PENDING' });
  const records = await db.query<Array<{ reason: string }>>(
    'SELECT reason FROM kyc_tier_manual_holds WHERE customer_id=$1',
    [id],
  );
  expect(records[0]?.reason).toBe('MANUAL_REVIEW');
  const reviewer = actor('reviewer', 'COMPLIANCE', ['kyc.review']);
  expect((await service.reviews(reviewer)).some((row) => row.customer_id === id)).toBe(true);
  await expect(service.reviews(undefined)).rejects.toThrow();
  await db.query(`UPDATE customer_profiles SET first_name='Synthetic' WHERE customer_id=$1`, [id]);
  await service.process(id);
  expect((await state(id))?.kyc_level).toBe('NONE');
});
it('expires an existing managed approval even if the evidence source becomes unavailable', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  await service.process(id);
  await db.query(
    `UPDATE customer_kyc_assessments SET expires_at=clock_timestamp()-interval '1 second' WHERE customer_id=$1 AND is_current=true`,
    [id],
  );
  const audit = new AuditService(db.getRepository(AuditEvent));
  const closed = new KycTierTransitionService(
    db,
    policy,
    new KycTierEvidenceReader(),
    audit,
    new AuthorizationService(db, audit),
  );
  const tick = new KycTierWorker(db, closed, policy);
  await tick.tick();
  expect(await state(id)).toMatchObject({ kyc_level: 'NONE', kyc_status: 'PENDING' });
});
it('serializes policy publication with an in-flight evaluation and reevaluates the old decision', async () => {
  const id = await customer();
  await evidence(id, 'BVN');
  const original = definition();
  const changed = {
    ...original,
    regulatory: { ...original.regulatory, LEVEL_1: { all: ['PHONE'], any: [] } },
  };
  const p = await policy.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: 1,
    definition: changed,
  });
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>((r) => {
      entered = r;
    }),
    resume = new Promise<void>((r) => {
      release = r;
    });
  class SlowReader extends FixtureEvidenceReader {
    override async read(...args: Parameters<FixtureEvidenceReader['read']>) {
      entered();
      await resume;
      return super.read(...args);
    }
  }
  const audit = new AuditService(db.getRepository(AuditEvent));
  const slow = new KycTierTransitionService(
    db,
    policy,
    new SlowReader({ provider: 'ISOLATED_TRUSTED_FIXTURE', key, keyVersion: 'fixture' }),
    audit,
    new AuthorizationService(db, audit),
  );
  const evaluation = slow.process(id);
  await began;
  let published = false;
  const approval = policy.decide(checker, p.id, true).then((result) => {
    published = true;
    return result;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(published).toBe(false);
  release();
  await evaluation;
  await approval;
  expect((await state(id))?.kyc_level).toBe('LEVEL_1');
  await service.process(id);
  expect((await state(id))?.kyc_level).toBe('NONE');
});
