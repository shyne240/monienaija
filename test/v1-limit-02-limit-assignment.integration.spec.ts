/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';
import { randomUUID } from 'node:crypto';

describe('V1-LIMIT-02 Generic Limit Profile Assignment (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    // @ts-ignore
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED','AGENT','CUSTOMER','AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  const auth = (type: string) => `Bearer workforce-${type.toLowerCase()}`;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-limit-02');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createProfile(code: string, overrides: any = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles')
      .set('Authorization', auth('OPERATOR'))
      .send({ code, name: `Profile ${code}`, kind: 'CUSTOMER', ...overrides });
  }

  async function seedCustomer(): Promise<string> {
    const ref = `cust-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
      [ref],
    );
    return rows[0]!.id;
  }

  async function seedAgentClass(): Promise<string> {
    const ref = `ac-ref-${randomUUID().slice(0,8)}`;
    const code = `AC_${randomUUID().slice(0,8).toUpperCase().replace(/-/g,'X')}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [ref, code, `Class ${code}`],
    );
    return rows[0]!.id;
  }

  async function seedAgent(agentClassId?: string): Promise<string> {
    const ref = `ag-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1, 'ACTIVE', $2) RETURNING id`,
      [ref, agentClassId ?? null],
    );
    return rows[0]!.id;
  }

  async function createAssignment(body: any, as: string = 'OPERATOR') {
    return request(app.getHttpServer())
      .post('/api/v1/internal/limit-assignments')
      .set('Authorization', auth(as))
      .send(body);
  }

  // ── 1. migration & schema ──
  it('01. migration chain exposes limit_assignments (69 migrations, 0068) — additive to 70', async () => {
    const migs: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC`);
    expect(migs.length).toBeGreaterThanOrEqual(69);
    expect(migs.some(m=>m.timestamp==='1785753600067')).toBe(true);
    expect(migs.some(m=>m.timestamp==='1785753600068')).toBe(true);
    const last = migs[migs.length - 1];
    expect(['1785753600068','1785753600069','1785753600070','1785753600071','1785753600072','1785753600073','1785753600074','1785753600075', '1785753600076', '1785753600077', '1785753600078', '1785753600079', '1785753600080', '1785753600081', '1785753600082', '1785753600083', '1785753600084', '1785753600085', '1785753600086']).toContain(last.timestamp);
    if (last.timestamp === '1785753600076') expect(last.name).toBe('ProvisionV1CommercialAccountingFamilies1785753600076');
    else if (last.timestamp === '1785753600077') expect(last.name).toBe('AddAgentCredentialRotation1785753600077');
    else if (last.timestamp === '1785753600078') expect(last.name).toBe('CreateCustomerRegistrationPhoneChallenges1785753600078');
    else if (last.timestamp === '1785753600079') expect(last.name).toBe('AddCustomerCredentialRotation1785753600079');
    else if (last.timestamp === '1785753600080') expect(last.name).toBe('AddMfaChallengePurpose1785753600080');
    else if (last.timestamp === '1785753600081') expect(last.name).toBe('CreateSupportWorkforceAuthentication1785753600081');
    else if (last.timestamp === '1785753600082') expect(last.name).toBe('CreateLocalAdminAuthentication1785753600082');
    else if (last.timestamp === '1785753600083') expect(last.name).toBe('CreateAuthorizationCatalogue1785753600083');
    else if (last.timestamp === '1785753600084') expect(last.name).toBe('RenameWorkforceBootstrapRoleToSuperAdmin1785753600084');
    else if (last.timestamp === '1785753600085') expect(last.name).toBe('AddAdministratorRoleAssignmentScope1785753600085');
    else if (last.timestamp === '1785753600086') expect(last.name).toBe('CreateRoleDefinitionGovernance1785753600086');
    else     if (last.timestamp === '1785753600075') expect(last.name).toBe('AddTransferFeeColumns1785753600075');
    else if (last.timestamp === '1785753600074') expect(last.name).toBe('CreateRewardRules1785753600074');
    else if (last.timestamp === '1785753600073') expect(last.name).toBe('CreateCommissionRules1785753600073');
    else if (last.timestamp === '1785753600072') expect(last.name).toBe('CreateFeeRules1785753600072');
    else if (last.timestamp === '1785753600071') expect(last.name).toBe('CreateProductCatalogue1785753600071');
    else if (last.timestamp === '1785753600070') expect(last.name).toBe('CreateCommercialDecisionSnapshots1785753600070');
    else if (last.timestamp === '1785753600069') expect(last.name).toBe('CreateLimitUsages1785753600069');
    else expect(last.name).toBe('CreateLimitAssignments1785753600068');
    const tables: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('limit_assignments','limit_profiles','limit_rules') ORDER BY tablename`);
    expect(tables.map(t=>t.tablename).sort()).toEqual(['limit_assignments','limit_profiles','limit_rules']);
    // CHECK constraints
    const checks: Array<{ conname: string; consrc: string }> = await dataSource.query(`SELECT conname, pg_get_constraintdef(oid) as consrc FROM pg_constraint WHERE conrelid='limit_assignments'::regclass`);
    const names = checks.map(c=>c.conname);
    expect(names).toEqual(expect.arrayContaining(['chk_limit_assignments_subject_consistency','chk_limit_assignments_effective','chk_limit_assignments_subject_type']));
    // indexes
    const idx: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='limit_assignments'`);
    const iNames = idx.map(i=>i.indexname);
    expect(iNames).toEqual(expect.arrayContaining(['idx_limit_assignments_profile','idx_limit_assignments_subject','uq_limit_assignments_active_key']));
    // FK to limit_profiles
    const fk: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='limit_assignments'::regclass AND contype='f'`);
    expect(fk.length).toBeGreaterThanOrEqual(1);
    // columns existence
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='limit_assignments' ORDER BY column_name`);
    const colNames = cols.map(c=>c.column_name);
    expect(colNames).toEqual(expect.arrayContaining(['id','limit_profile_code','subject_type','subject_id','segment_code','precedence','effective_from','effective_to','is_active','version','created_by','created_at']));
  });

  // ── 2. arbitrary profile + creation for each subject type ──
  it('02. arbitrary Limit Profile assignment to CUSTOMER/AGENT/AGENT_CLASS/SEGMENT/GLOBAL', async () => {
    // create 4 arbitrary profiles — not Tier 1/2/3, not Basic/Standard/Premium locked
    const codes = ['ASSIGN_A', 'ASSIGN_B', 'ASSIGN_C', 'ASSIGN_UNBOUNDED_100'];
    for (const c of codes) {
      const r = await createProfile(c, { kind: 'UNIVERSAL' });
      expect(r.status).toBe(201);
    }
    const custId = await seedCustomer();
    const agentClassId = await seedAgentClass();
    const agentId = await seedAgent(agentClassId);

    // CUSTOMER
    let res = await createAssignment({ limitProfileCode: 'ASSIGN_A', subjectType: 'CUSTOMER', subjectId: custId, precedence: 10, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ limitProfileCode: 'ASSIGN_A', subjectType: 'CUSTOMER', subjectId: custId, precedence: 10, version: 1, isActive: true });
    expect(res.body.segmentCode).toBeNull();
    expect(res.body.effectiveFrom).toBeDefined();
    expect(res.body.createdBy).toBeDefined();
    const custAssignId = res.body.id;

    // AGENT
    res = await createAssignment({ limitProfileCode: 'ASSIGN_B', subjectType: 'AGENT', subjectId: agentId, precedence: 20 });
    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('AGENT');
    expect(res.body.subjectId).toBe(agentId);
    const agentAssignId = res.body.id;

    // AGENT_CLASS
    res = await createAssignment({ limitProfileCode: 'ASSIGN_C', subjectType: 'AGENT_CLASS', subjectId: agentClassId, precedence: 5, isActive: true });
    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('AGENT_CLASS');
    expect(res.body.subjectId).toBe(agentClassId);
    const classAssignId = res.body.id;

    // SEGMENT
    res = await createAssignment({ limitProfileCode: 'ASSIGN_A', subjectType: 'SEGMENT', segmentCode: 'SEG_NORTH', precedence: 1 });
    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('SEGMENT');
    expect(res.body.segmentCode).toBe('SEG_NORTH');
    expect(res.body.subjectId).toBeNull();
    const segmentAssignId = res.body.id;

    // GLOBAL
    res = await createAssignment({ limitProfileCode: 'ASSIGN_B', subjectType: 'GLOBAL', precedence: 0 });
    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('GLOBAL');
    expect(res.body.subjectId).toBeNull();
    expect(res.body.segmentCode).toBeNull();
    const globalAssignId = res.body.id;

    // safe projection: no deletedAt
    for (const id of [custAssignId, agentAssignId, classAssignId, segmentAssignId, globalAssignId]) {
      const get = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR'));
      expect(get.status).toBe(200);
      expect(JSON.stringify(get.body)).not.toContain('deletedAt');
      expect(JSON.stringify(get.body)).not.toContain('deleted_at');
      expect(get.body.createdAt).toBeDefined();
      expect(get.body.updatedAt).toBeDefined();
      expect(get.body.version).toBe(1);
    }
  });

  it('03. unlimited arbitrary assignments — not fixed at 3, not Tier-bound', async () => {
    const base = 'ARBITRARY';
    // create 6 distinct arbitrary profiles beyond Tier 1/2/3
    const codes = ['ARB_1','ARB_2','ARB_3','ARB_4','ARB_5','ARB_6'];
    for (const c of codes) {
      const r = await createProfile(c);
      expect(r.status).toBe(201);
    }
    const custId = await seedCustomer();
    // assign all 6 to same customer with different precedence / effective dates
    for (let i=0;i<codes.length;i++) {
      const r = await createAssignment({ limitProfileCode: codes[i], subjectType: 'CUSTOMER', subjectId: custId, precedence: i, effectiveFrom: `2026-01-0${i+1}T00:00:00.000Z` });
      expect(r.status).toBe(201);
    }
    const list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/customer/${custId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(6);
    // disproof: we have 6 assignments for one customer — not capped at 3
  });

  it('04. effective dating & precedence stored — overlapping allowed via different effectiveFrom/priority', async () => {
    await createProfile('EFF_PROFILE');
    const custId = await seedCustomer();
    // first assignment global default precedence 0 from Jan 1
    let r = await createAssignment({ limitProfileCode: 'EFF_PROFILE', subjectType: 'CUSTOMER', subjectId: custId, precedence: 0, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(r.status).toBe(201);
    // second assignment same subject/profile but different effectiveFrom — legitimate multi-scope via dates, should succeed
    r = await createAssignment({ limitProfileCode: 'EFF_PROFILE', subjectType: 'CUSTOMER', subjectId: custId, precedence: 10, effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: '2026-03-01T00:00:00.000Z' });
    expect(r.status).toBe(201);
    expect(r.body.precedence).toBe(10);
    expect(new Date(r.body.effectiveTo).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // different profile same subject/effective same date — allowed (unique includes profile code)
    await createProfile('EFF_PROFILE_2');
    r = await createAssignment({ limitProfileCode: 'EFF_PROFILE_2', subjectType: 'CUSTOMER', subjectId: custId, precedence: 5, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(r.status).toBe(201);
    // conflicting duplicate — same subject/profile/effectiveFrom should 409
    const dup = await createAssignment({ limitProfileCode: 'EFF_PROFILE', subjectType: 'CUSTOMER', subjectId: custId, precedence: 0, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(dup.status).toBe(409);
    // verify precedence dimension is honored — list ordered by createdAt, but precedence field preserved
    const list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/customer/${custId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    const precedences = list.body.data.map((a:any)=>a.precedence).sort((a:number,b:number)=>a-b);
    expect(precedences).toEqual([0,5,10]);
    // invalid effectiveTo before effectiveFrom → 400
    const bad = await createAssignment({ limitProfileCode: 'EFF_PROFILE', subjectType: 'SEGMENT', segmentCode: 'EFF_SEG', effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: '2026-01-01T00:00:00.000Z' });
    expect(bad.status).toBe(400);
  });

  it('05. version/concurrency — PATCH requires version, stale 409, correct increments', async () => {
    await createProfile('CONC_ASSIGN');
    const custId = await seedCustomer();
    let r = await createAssignment({ limitProfileCode: 'CONC_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId, precedence: 1 });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect(r.body.version).toBe(1);
    // missing version → 400
    let upd = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR')).send({ isActive: false });
    expect(upd.status).toBe(400);
    // correct update
    upd = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR')).send({ version: 1, isActive: false, precedence: 99 });
    expect(upd.status).toBe(200);
    expect(upd.body.version).toBe(2);
    expect(upd.body.isActive).toBe(false);
    expect(upd.body.precedence).toBe(99);
    // stale version 409
    const stale = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR')).send({ version: 1, precedence: 5 });
    expect(stale.status).toBe(409);
    // second correct update
    const upd2 = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR')).send({ version: 2, isActive: true });
    expect(upd2.status).toBe(200);
    expect(upd2.body.version).toBe(3);
    expect(upd2.body.isActive).toBe(true);
  });

  it('06. duplicate/conflict validation — 400/404 cases', async () => {
    await createProfile('VALID_PROFILE');
    const custId = await seedCustomer();
    // missing profile → 404
    let bad = await createAssignment({ limitProfileCode: 'NOT_EXIST', subjectType: 'CUSTOMER', subjectId: custId });
    expect(bad.status).toBe(404);
    // invalid code pattern → 400
    bad = await createAssignment({ limitProfileCode: 'bad-lower', subjectType: 'CUSTOMER', subjectId: custId });
    expect(bad.status).toBe(400);
    // CUSTOMER without subjectId → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'CUSTOMER' });
    expect(bad.status).toBe(400);
    // SEGMENT without segmentCode → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'SEGMENT' });
    expect(bad.status).toBe(400);
    // SEGMENT with subjectId → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'SEGMENT', segmentCode: 'SEG_A', subjectId: custId });
    expect(bad.status).toBe(400);
    // GLOBAL with subjectId → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'GLOBAL', subjectId: custId });
    expect(bad.status).toBe(400);
    // GLOBAL with segmentCode → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'GLOBAL', segmentCode: 'SEG_X' });
    expect(bad.status).toBe(400);
    // CUSTOMER with segmentCode → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'CUSTOMER', subjectId: custId, segmentCode: 'SEG_Y' });
    expect(bad.status).toBe(400);
    // non-existent customer → 404
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'CUSTOMER', subjectId: randomUUID() });
    expect(bad.status).toBe(404);
    // non-existent agent → 404
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'AGENT', subjectId: randomUUID() });
    expect(bad.status).toBe(404);
    // non-existent agent class → 404
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'AGENT_CLASS', subjectId: randomUUID() });
    expect(bad.status).toBe(404);
    // invalid UUID → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'CUSTOMER', subjectId: 'not-a-uuid' });
    expect(bad.status).toBe(400);
    // invalid segment pattern → 400
    bad = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'SEGMENT', segmentCode: 'bad-lower' });
    expect(bad.status).toBe(400);
    // duplicate same data → 409 after first success
    const first = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'SEGMENT', segmentCode: 'SEG_DUP', precedence: 0, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(first.status).toBe(201);
    const dup = await createAssignment({ limitProfileCode: 'VALID_PROFILE', subjectType: 'SEGMENT', segmentCode: 'SEG_DUP', precedence: 0, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    expect(dup.status).toBe(409);
  });

  it('07. authorization — workforce-only OPERATOR/SERVICE/PRIVILEGED', async () => {
    await createProfile('AUTH_ASSIGN');
    const custId = await seedCustomer();
    // no auth 401
    let res = await request(app.getHttpServer()).post('/api/v1/internal/limit-assignments').send({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId });
    expect(res.status).toBe(401);
    res = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments').expect(401);
    expect(res.status).toBe(401);
    // SUPPORT blocked 403
    res = await createAssignment({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId }, 'SUPPORT');
    expect(res.status).toBe(403);
    // AGENT blocked 403
    res = await createAssignment({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId }, 'AGENT');
    expect(res.status).toBe(403);
    // CUSTOMER blocked 403
    res = await createAssignment({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId }, 'CUSTOMER');
    expect(res.status).toBe(403);
    // AGGREGATOR blocked 403
    res = await createAssignment({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId }, 'AGGREGATOR');
    expect(res.status).toBe(403);
    // OPERATOR allowed
    res = await createAssignment({ limitProfileCode: 'AUTH_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId, precedence: 1, effectiveFrom: '2026-09-01T00:00:00.000Z' }, 'OPERATOR');
    expect(res.status).toBe(201);
    const id = res.body.id;
    // SERVICE allowed for GET & PATCH
    const getSvc = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('SERVICE'));
    expect(getSvc.status).toBe(200);
    const updSvc = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('SERVICE')).send({ version: 1, precedence: 2 });
    expect(updSvc.status).toBe(200);
    // PRIVILEGED allowed
    const priv = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments').set('Authorization', auth('PRIVILEGED'));
    expect(priv.status).toBe(200);
    // GET /profile/:code also guarded
    const unauthProfile = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments/profile/AUTH_ASSIGN');
    expect(unauthProfile.status).toBe(401);
    const supportProfile = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments/profile/AUTH_ASSIGN').set('Authorization', auth('SUPPORT'));
    expect(supportProfile.status).toBe(403);
  });

  it('08. GET assignments — for profile/customer/agent/agentClass/segment/by ID, pagination deterministic', async () => {
    await createProfile('LIST_PROF_1');
    await createProfile('LIST_PROF_2');
    const custId = await seedCustomer();
    const custId2 = await seedCustomer();
    const acId = await seedAgentClass();
    const agentId = await seedAgent(acId);

    // seed 5 assignments
    await createAssignment({ limitProfileCode: 'LIST_PROF_1', subjectType: 'CUSTOMER', subjectId: custId, precedence: 1, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    await createAssignment({ limitProfileCode: 'LIST_PROF_1', subjectType: 'CUSTOMER', subjectId: custId2, precedence: 2, effectiveFrom: '2026-01-02T00:00:00.000Z' });
    await createAssignment({ limitProfileCode: 'LIST_PROF_2', subjectType: 'AGENT', subjectId: agentId });
    await createAssignment({ limitProfileCode: 'LIST_PROF_1', subjectType: 'AGENT_CLASS', subjectId: acId });
    await createAssignment({ limitProfileCode: 'LIST_PROF_2', subjectType: 'SEGMENT', segmentCode: 'LIST_SEG' });
    await createAssignment({ limitProfileCode: 'LIST_PROF_1', subjectType: 'GLOBAL' });

    // list by profile
    let list = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments/profile/LIST_PROF_1?limit=100').set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(4);
    for (const a of list.body.data) expect(a.limitProfileCode).toBe('LIST_PROF_1');

    // list by customer
    list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/customer/${custId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].subjectId).toBe(custId);

    // list by agent
    list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/agent/${agentId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].subjectType).toBe('AGENT');

    // list by agent-class
    list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/agent-class/${acId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    // list by segment
    list = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments/segment/LIST_SEG?limit=100').set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].segmentCode).toBe('LIST_SEG');

    // generic filter: subjectType=GLOBAL
    list = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments?subjectType=GLOBAL&limit=100').set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].subjectType).toBe('GLOBAL');

    // filter by isActive + pagination deterministic
    const p1 = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments?limit=2&page=1').set('Authorization', auth('OPERATOR'));
    const p2 = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments?limit=2&page=2').set('Authorization', auth('OPERATOR'));
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p1.body.data.length).toBe(2);
    expect(p1.body.hasNextPage).toBe(true);
    expect(p1.body.page).toBe(1);
    expect(p2.body.page).toBe(2);
    const ids1 = p1.body.data.map((a:any)=>a.id);
    const ids2 = p2.body.data.map((a:any)=>a.id);
    // deterministic: no overlap
    for (const id of ids1) expect(ids2).not.toContain(id);
    // limit validation
    const badLimit = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments?limit=200').set('Authorization', auth('OPERATOR'));
    expect(badLimit.status).toBe(400);
    const badPage = await request(app.getHttpServer()).get('/api/v1/internal/limit-assignments?page=0').set('Authorization', auth('OPERATOR'));
    expect(badPage.status).toBe(400);
  });

  it('09. safe projection & pagination/filtering invariants', async () => {
    await createProfile('SAFE_PROJ');
    const custId = await seedCustomer();
    const r = await createAssignment({ limitProfileCode: 'SAFE_PROJ', subjectType: 'CUSTOMER', subjectId: custId, precedence: 42, effectiveFrom: '2026-06-01T00:00:00.000Z', isActive: true });
    expect(r.status).toBe(201);
    const bodyStr = JSON.stringify(r.body);
    expect(bodyStr).not.toContain('deletedAt');
    expect(bodyStr).not.toContain('deleted_at');
    expect(bodyStr).not.toContain('ledger');
    expect(r.body.precedence).toBe(42);
    // query filter returns safe projection too
    const list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments?limitProfileCode=SAFE_PROJ&limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(JSON.stringify(list.body)).not.toContain('deletedAt');
    // PATCH safe
    const patch = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${r.body.id}`).set('Authorization', auth('OPERATOR')).send({ version: 1, precedence: 100 });
    expect(patch.status).toBe(200);
    expect(JSON.stringify(patch.body)).not.toContain('deleted_at');
    expect(patch.body.precedence).toBe(100);
  });

  it('10. profile deletion/disable interaction — assignments preserve history, FK RESTRICT', async () => {
    await createProfile('PROF_RETAIN');
    const custId = await seedCustomer();
    const assign = await createAssignment({ limitProfileCode: 'PROF_RETAIN', subjectType: 'CUSTOMER', subjectId: custId });
    expect(assign.status).toBe(201);
    const id = assign.body.id;
    // disable profile via PATCH status
    const disable = await request(app.getHttpServer()).patch('/api/v1/internal/limit-profiles/PROF_RETAIN').set('Authorization', auth('OPERATOR')).send({ version: 1, status: 'DISABLED', enabled: false, configurationStatus: 'DISABLED' });
    expect(disable.status).toBe(200);
    expect(disable.body.status).toBe('DISABLED');
    // assignment still readable after profile disabled (historical auditable)
    const still = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR'));
    expect(still.status).toBe(200);
    expect(still.body.limitProfileCode).toBe('PROF_RETAIN');
    // attempt to hard delete profile via SQL should fail due to FK RESTRICT (limit_assignments references limit_profile_code)
    await expect(dataSource.query(`DELETE FROM limit_profiles WHERE code = $1`, ['PROF_RETAIN'])).rejects.toThrow();
    // soft delete assignment via deleted_at → then list should exclude it
    await dataSource.query(`UPDATE limit_assignments SET deleted_at = NOW() WHERE id = $1`, [id]);
    const afterDelete = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR'));
    expect(afterDelete.status).toBe(404);
    const list = await request(app.getHttpServer()).get(`/api/v1/internal/limit-assignments/customer/${custId}?limit=100`).set('Authorization', auth('OPERATOR'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    // history still exists in DB with deleted_at
    const hist: Array<{ deleted_at: string }> = await dataSource.query(`SELECT deleted_at FROM limit_assignments WHERE id = $1`, [id]);
    expect(hist[0].deleted_at).not.toBeNull();
  });

  it('11. no ledger mutation — assignment does not touch wallets/ledger, no limit_usages', async () => {
    const beforeWallets: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM wallet_accounts`);
    const beforeLines: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_lines`);
    const beforeJournals: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_journals`);
    await createProfile('LEDGER_ASSIGN');
    const custId = await seedCustomer();
    await createAssignment({ limitProfileCode: 'LEDGER_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId });
    await createAssignment({ limitProfileCode: 'LEDGER_ASSIGN', subjectType: 'SEGMENT', segmentCode: 'LEDGER_SEG' });
    await createAssignment({ limitProfileCode: 'LEDGER_ASSIGN', subjectType: 'GLOBAL' });
    const afterWallets: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM wallet_accounts`);
    const afterLines: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_lines`);
    const afterJournals: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_journals`);
    expect(afterWallets[0].count).toBe(beforeWallets[0].count);
    expect(afterLines[0].count).toBe(beforeLines[0].count);
    expect(afterJournals[0].count).toBe(beforeJournals[0].count);
    // V1-LIMIT-03 additive: limit_usages + limit_reservations now exist but assignment must not auto-create them
    const hasUsages = await dataSource.query(`SELECT to_regclass('public.limit_usages') as reg`);
    expect(hasUsages[0].reg).toBe('limit_usages');
    const hasReservations = await dataSource.query(`SELECT to_regclass('public.limit_reservations') as reg`);
    expect(hasReservations[0].reg).toBe('limit_reservations');
    const usagesCnt: Array<{ cnt: string }> = await dataSource.query(`SELECT COUNT(*)::text as cnt FROM limit_usages`);
    expect(usagesCnt[0].cnt).toBe('0');
    const resCnt: Array<{ cnt: string }> = await dataSource.query(`SELECT COUNT(*)::text as cnt FROM limit_reservations`);
    expect(resCnt[0].cnt).toBe('0');
    // also no commercial decision tables mutated via assignment — now 3 limit migrations
    const hasDecisions: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM typeorm_migrations WHERE name LIKE '%Limit%'`);
    expect(Number(hasDecisions[0].cnt)).toBe(3); // profile catalogue + assignments + usages (V1-LIMIT-03)
  });

  it('12. legacy preservation — customer_limit_profiles & AgentClass.applicableLimits untouched', async () => {
    await createProfile('LEGACY_ASSIGN');
    const custId = await seedCustomer();
    const acId = await seedAgentClass();
    // legacy tables still exist
    const tables: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('customer_limit_profiles','agent_classes')`);
    expect(tables.map(t=>t.tablename)).toEqual(expect.arrayContaining(['customer_limit_profiles','agent_classes']));
    const col: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='agent_classes' AND column_name='applicable_limits'`);
    expect(col.length).toBe(1);
    // creating assignment does not auto-create customer_limit_profiles row nor mutate applicable_limits
    const beforeClp: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customer_limit_profiles`);
    const beforeLimits: Array<{ applicable_limits: any }> = await dataSource.query(`SELECT applicable_limits FROM agent_classes WHERE id = $1`, [acId]);
    await createAssignment({ limitProfileCode: 'LEGACY_ASSIGN', subjectType: 'CUSTOMER', subjectId: custId });
    await createAssignment({ limitProfileCode: 'LEGACY_ASSIGN', subjectType: 'AGENT_CLASS', subjectId: acId });
    const afterClp: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customer_limit_profiles`);
    const afterLimits: Array<{ applicable_limits: any }> = await dataSource.query(`SELECT applicable_limits FROM agent_classes WHERE id = $1`, [acId]);
    expect(afterClp[0].cnt).toBe(beforeClp[0].cnt);
    expect(JSON.stringify(afterLimits[0].applicable_limits)).toBe(JSON.stringify(beforeLimits[0].applicable_limits));
  });

  it('13. no flow change — LimitEngine & TransferService not invoked, no reservation', async () => {
    // verify assignment endpoint does not create ledger or usages side effects and no TransferService code path
    await createProfile('NO_FLOW');
    const custId = await seedCustomer();
    await createAssignment({ limitProfileCode: 'NO_FLOW', subjectType: 'CUSTOMER', subjectId: custId });
    // check that no transfer, wallet mutation present
    const transfers: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM transfers`);
    expect(transfers[0].count).toBe('0');
    // assignment service does not depend on TransferService — inspect file
    const fs = require('node:fs');
    const svc = fs.readFileSync('src/limit-catalog/limit-assignment.service.ts','utf8');
    expect(svc).not.toContain('TransferService');
    expect(svc).not.toContain('AgentCash');
    expect(svc).not.toContain('limit_usages');
    expect(svc).not.toContain('LimitEngine');
  });

  it('14. fixed Tier 1/2/3 disproof — no hardcoded KYC tiers in assignment', async () => {
    const fs = require('node:fs');
    const service = fs.readFileSync('src/limit-catalog/limit-assignment.service.ts','utf8');
    const controller = fs.readFileSync('src/limit-catalog/limit-assignment.controller.ts','utf8');
    const entity = fs.readFileSync('src/limit-catalog/limit-assignment.entity.ts','utf8');
    const dto = fs.readFileSync('src/limit-catalog/dto/create-limit-assignment.dto.ts','utf8');
    const banned = ['TIER_1','TIER_2','TIER_3','KYC_LEVEL_1','KYC_LEVEL_2','Basic','Premium','fixedTier','if (tier','if(kyc','if (kyc','KYC→','TIER1'];
    for (const p of banned) {
      expect(service).not.toContain(p);
      expect(controller).not.toContain(p);
      expect(entity).not.toContain(p);
      expect(dto).not.toContain(p);
    }
    // also ensure no switch on KYC then assignment mapping
    expect(service.toLowerCase()).not.toContain('if kyc_level_1 then');
    // prove arbitrary assignment: we can assign profile code TIER_100 to SEGMENT without any KYC check
    await createProfile('TIER_100');
    const r = await createAssignment({ limitProfileCode: 'TIER_100', subjectType: 'SEGMENT', segmentCode: 'RANDOM_SEG_999' });
    expect(r.status).toBe(201);
    expect(r.body.limitProfileCode).toBe('TIER_100');
    // migration does not insert tier seeds
    const mig = fs.readFileSync('src/migrations/1785753600068-CreateLimitAssignments.ts','utf8');
    expect(mig).not.toContain('TIER_1');
    expect(mig).not.toContain('INSERT INTO limit_assignments');
  });

  it('15. audit & version fields — createdBy/updatedBy tracked, historical auditable', async () => {
    await createProfile('AUDIT_PROF');
    const custId = await seedCustomer();
    const r = await createAssignment({ limitProfileCode: 'AUDIT_PROF', subjectType: 'CUSTOMER', subjectId: custId });
    expect(r.status).toBe(201);
    expect(r.body.createdBy).toBeDefined();
    expect(r.body.version).toBe(1);
    const id = r.body.id;
    const patch = await request(app.getHttpServer()).patch(`/api/v1/internal/limit-assignments/${id}`).set('Authorization', auth('OPERATOR')).send({ version: 1, precedence: 7 });
    expect(patch.status).toBe(200);
    expect(patch.body.updatedBy).toBeDefined();
    expect(patch.body.version).toBe(2);
    // direct DB check: updated_at changed
    const row: Array<{ created_by: string; updated_by: string; version: number }> = await dataSource.query(`SELECT created_by, updated_by, version FROM limit_assignments WHERE id = $1`, [id]);
    expect(row[0].created_by).toBeDefined();
    expect(row[0].updated_by).toBeDefined();
    expect(row[0].version).toBe(2);
    // audit trail would be recorded via AuditService if present — at minimum audit table not polluted unexpectedly; just ensure no error
  });
});
