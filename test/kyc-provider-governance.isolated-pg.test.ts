import { Test } from '@nestjs/testing';
import { CreateAuthorizationCatalogue1785753600083 } from '../src/migrations/1785753600083-CreateAuthorizationCatalogue';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { KycProviderGovernanceController } from '../src/kyc-verification/kyc-provider-governance.controller';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';
import { KycProviderGovernance1785753600109 } from '../src/migrations/1785753600109-KycProviderGovernance';
import { KycGovernanceProtectedAuthority1785753600300 } from '../src/migrations/1785753600300-KycGovernanceProtectedAuthority';
import {
  KycProviderGovernanceService,
  validateProviderConfiguration,
} from '../src/kyc-verification/kyc-provider-governance.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { createKycAuthorityConnections } from './support/kyc-isolated-authority';
// Portable provenance: see test/support/kyc-isolated-cluster.ts. No absolute path from any one
// developer's machine is embedded here; the runner (scripts/run-isolated-kyc-tests.js) creates
// the disposable cluster and exports KYC_ISOLATED_TEST_SOCKET.
const cluster = isolatedKycCluster();
const socket = cluster.socketDirectory;
const schema = `kyc_gov_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: cluster.port,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  logging: false,
  extra: { options: `-c search_path=${schema}` },
});
const principal = (id: string, role: string, scopes: string[]): AuthorizationPrincipal => ({
  type: 'OPERATOR',
  principalId: id,
  sessionId: randomUUID(),
  roles: [role],
  scopes,
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
});
const maker = principal('maker', 'SUPER_ADMIN', ['kyc.provider.view', 'kyc.provider.propose']);
const checker = principal('checker', 'COMPLIANCE', ['kyc.provider.view', 'kyc.provider.approve']);
const config = {
  providers: {
    MONNIFY: { enabled: true, capabilities: ['BVN', 'NIN'] },
    DOJAH: { enabled: false, capabilities: [] },
    SYNTHETIC: { enabled: true, capabilities: ['BVN', 'NIN'] },
  },
  routes: {
    BVN: { primary: 'MONNIFY', fallback: 'SYNTHETIC' },
    NIN: { primary: 'SYNTHETIC', fallback: null },
  },
};
let svc: KycProviderGovernanceService;
let created = false;
beforeAll(async () => {
  await db.initialize();
  await assertIsolatedKycCluster(db, cluster);
  // Cluster provenance is asserted by the shared helper (marker + manifest + socket-only +
  // minimum server version). It used to be re-implemented here against a hardcoded path.
  await assertIsolatedKycCluster(db, cluster);
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  const runner = db.createQueryRunner();
  await new KycProviderGovernance1785753600109().up(runner);
  await runner.release();
  // Minimal tier-policy schema for the shared KYC authority migration. The full KYC tier migration
  // is exercised by kyc-tier-policy.isolated-pg.test.ts.
  await db.query(`CREATE TABLE kyc_tier_policy_head(
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version integer NOT NULL CHECK(version>=0)
  )`);
  await db.query('INSERT INTO kyc_tier_policy_head(singleton,version) VALUES(true,0)');
  await db.query(`CREATE TABLE kyc_tier_policy_proposals(
    id uuid PRIMARY KEY,request_id uuid NOT NULL UNIQUE,expected_version integer NOT NULL,
    definition jsonb NOT NULL,fingerprint char(64) NOT NULL,maker_id varchar(160) NOT NULL,
    maker_session_id uuid NOT NULL,checker_id varchar(160),checker_session_id uuid,
    state varchar(12) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',decided_at timestamptz
  )`);
  await db.query(`CREATE TABLE kyc_tier_policy_versions(
    version integer PRIMARY KEY,proposal_id uuid NOT NULL UNIQUE REFERENCES kyc_tier_policy_proposals(id),
    definition jsonb NOT NULL,maker_id varchar(160) NOT NULL,checker_id varchar(160) NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  await db.query('CREATE TABLE kyc_tier_evaluations(customer_id uuid NOT NULL)');
  await db.query(`CREATE TABLE kyc_evaluation_refresh(
    customer_id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,requested_at timestamptz NOT NULL DEFAULT now()
  )`);
  const authorityRunner = db.createQueryRunner();
  await new KycGovernanceProtectedAuthority1785753600300().up(authorityRunner);
  await authorityRunner.release();
  svc = new KycProviderGovernanceService(
    db,
    new AuthorizationService(db, { record: jest.fn().mockResolvedValue(undefined) } as never),
  );
});
afterAll(async () => {
  if (db.isInitialized) {
    if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.destroy();
  }
});
test('disabled by default; MFA, roles and functions required; independent checker atomically publishes', async () => {
  await expect(svc.resolve('BVN')).rejects.toMatchObject({ code: 'DISABLED' });
  const cmd = {
    requestId: randomUUID(),
    expectedVersion: 0,
    configuration: config,
    reason: 'INITIAL_SETUP' as const,
  };
  await expect(svc.propose({ ...maker, assuranceLevel: 'PASSWORD' }, cmd)).rejects.toMatchObject({
    code: 'BLOCKED',
  });
  await expect(svc.propose({ ...maker, scopes: [] }, cmd)).rejects.toMatchObject({
    code: 'BLOCKED',
  });
  const p = await svc.propose(maker, cmd);
  expect(await svc.propose(maker, cmd)).toEqual({ id: p.id, replay: true });
  await expect(
    svc.decide({ ...checker, principalId: maker.principalId }, p.id, true),
  ).rejects.toMatchObject({ code: 'BLOCKED' });
  await expect(svc.decide(maker, p.id, true)).rejects.toMatchObject({ code: 'BLOCKED' });
  expect(await svc.decide(checker, p.id, true)).toEqual({ version: 1, state: 'APPROVED' });
  expect(await svc.resolve('BVN')).toEqual({ provider: 'SYNTHETIC', version: 1 });
  expect((await svc.history(checker)).length).toBe(1);
  expect((await svc.proposals(checker)).length).toBe(1);
});
test('competing proposals at one version cannot both publish; revocation prevents dispatch selection', async () => {
  const command = () => ({
    requestId: randomUUID(),
    expectedVersion: 1,
    configuration: {
      providers: {
        MONNIFY: { enabled: false, capabilities: [] },
        SYNTHETIC: { enabled: false, capabilities: ['BVN', 'NIN'] },
      },
      routes: {
        BVN: { primary: 'SYNTHETIC', fallback: null },
        NIN: { primary: null, fallback: null },
      },
    },
    reason: 'PROVIDER_DISABLE' as const,
  });
  const [a, b] = await Promise.all([svc.propose(maker, command()), svc.propose(maker, command())]);
  const results = await Promise.allSettled([
    svc.decide(checker, a.id, true),
    svc.decide(checker, b.id, true),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(svc.resolve('BVN')).rejects.toMatchObject({ code: 'DISABLED' });
  await expect(
    db.transaction((m) => svc.resolveIn(m, 'BVN', 1, 'SYNTHETIC')),
  ).rejects.toMatchObject({ code: 'BLOCKED' });
});
test('strict configuration rejects unknown properties, capabilities, routes and production synthetic', () => {
  expect(() => validateProviderConfiguration({ ...config, credentials: 'secret' })).toThrow();
  expect(() =>
    validateProviderConfiguration({
      ...config,
      routes: { ...config.routes, BVN: { primary: 'OTHER', fallback: null } },
    }),
  ).toThrow();
  const legacy = validateProviderConfiguration({
    providers: {
      MONNIFY: { enabled: false, capabilities: [] },
      SYNTHETIC: { enabled: false, capabilities: [] },
    },
    routes: {
      BVN: { primary: null, fallback: null },
      NIN: { primary: null, fallback: null },
    },
  });
  expect(legacy.providers.DOJAH).toEqual({ enabled: false, capabilities: [] });
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    expect(() => validateProviderConfiguration(config)).toThrow();
  } finally {
    process.env.NODE_ENV = old;
  }
});

test('ordinary runtime login cannot forge KYC decisions or publish provider/tier state', async () => {
  const runtimeRole = `kyc_runtime_${randomUUID().replace(/-/g, '')}`;
  await db.query(
    `CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await db.query(`GRANT monienaija_runtime TO ${runtimeRole}`);
  const runtime = new DataSource({
    type: 'postgres',
    host: socket,
    port: cluster.port,
    username: runtimeRole,
    database: 'postgres',
    synchronize: false,
    logging: false,
    extra: { options: `-c search_path=${schema}` },
  });
  try {
    await runtime.initialize();
    expect(await runtime.query('SELECT version FROM kyc_provider_configuration')).toHaveLength(1);
    await expect(
      runtime.query('UPDATE kyc_provider_configuration SET version=version+1 WHERE singleton=true'),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        "UPDATE kyc_provider_change_proposals SET state='APPROVED' WHERE state='REQUESTED'",
      ),
    ).rejects.toThrow();
    await expect(
      runtime.query('UPDATE kyc_tier_policy_head SET version=version+1 WHERE singleton=true'),
    ).rejects.toThrow();
    await expect(
      runtime.query('SELECT * FROM protected_authority.kyc_governance_decisions'),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        `INSERT INTO protected_authority.kyc_governance_decisions(
        proposal_schema,proposal_kind,proposal_id,payload_digest,decision,maker_principal_id,
        maker_session_id,checker_principal_id,checker_session_id,assurance_level,decided_at,expires_at
      ) VALUES($1,'PROVIDER',$2,repeat('a',64),'APPROVED','maker',$3,'forged',$4,'MFA',now(),now()+interval '1 hour')`,
        [schema, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow();
  } finally {
    if (runtime.isInitialized) await runtime.destroy();
    await db.query(`REVOKE monienaija_runtime FROM ${runtimeRole}`);
    await db.query(`DROP ROLE ${runtimeRole}`);
  }
});

test('database trigger rejects mutation of a persisted proposal payload', async () => {
  const p = await svc.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: 2,
    configuration: config,
    reason: 'ROUTING_CHANGE',
  });
  await expect(
    db.query(
      `UPDATE kyc_provider_change_proposals SET configuration=jsonb_set(configuration,'{providers,MONNIFY,enabled}','false'::jsonb) WHERE id=$1`,
      [p.id],
    ),
  ).rejects.toThrow(/payload is immutable/i);
  expect((await svc.view(maker)).version).toBe(2);
});
test('Nest/Fastify workforce route authenticates and enforces maker/checker', async () => {
  const auth = new AuthorizationService(db, {
    record: jest.fn().mockResolvedValue(undefined),
  } as never);
  const guard = new RuntimeAccessGuard(
    { validate: jest.fn().mockResolvedValue({ valid: false }) } as never,
    auth,
    new RoutePolicyRegistry(),
    {
      validate: (token: string) => {
        if (token === 'maker') return Promise.resolve(maker);
        if (token === 'checker') return Promise.resolve(checker);
        if (token === 'password') return Promise.resolve({ ...maker, assuranceLevel: 'PASSWORD' });
        return Promise.reject(new Error('invalid'));
      },
    } as never,
    { enabled: true, internalAudience: 'test' } as never,
    { validate: jest.fn().mockResolvedValue({ valid: false }) } as never,
    { validate: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const mod = await Test.createTestingModule({
    controllers: [KycProviderGovernanceController],
    providers: [
      { provide: KycProviderGovernanceService, useValue: svc },
      { provide: APP_GUARD, useValue: guard },
    ],
  }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const http = app.getHttpAdapter().getInstance();
    const base = '/api/v1/internal/kyc/providers';
    expect((await http.inject({ method: 'GET', url: base })).statusCode).toBe(401);
    expect(
      (
        await http.inject({
          method: 'GET',
          url: base,
          headers: { authorization: 'Bearer password' },
        })
      ).statusCode,
    ).not.toBe(200);
    expect(
      (
        await http.inject({
          method: 'GET',
          url: base,
          headers: { authorization: 'Bearer checker' },
        })
      ).statusCode,
    ).toBe(200);
    const payload = {
      requestId: randomUUID(),
      expectedVersion: 2,
      configuration: config,
      reason: 'ROUTING_CHANGE',
    };
    expect(
      (
        await http.inject({
          method: 'POST',
          url: base + '/proposals',
          headers: { authorization: 'Bearer checker' },
          payload,
        })
      ).statusCode,
    ).not.toBe(200);
    const proposed = await http.inject({
      method: 'POST',
      url: base + '/proposals',
      headers: { authorization: 'Bearer maker' },
      payload,
    });
    expect(proposed.statusCode).toBe(200);
    const id = proposed.json<{ id: string }>().id;
    expect(
      (
        await http.inject({
          method: 'POST',
          url: base + '/proposals/' + id + '/approve',
          headers: { authorization: 'Bearer maker' },
        })
      ).statusCode,
    ).not.toBe(200);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: base + '/proposals/' + id + '/approve',
          headers: { authorization: 'Bearer checker' },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});

test('migration backfills dedicated grants in an already-seeded catalogue', async () => {
  const other = `kyc_catalogue_${randomUUID().replace(/-/g, '')}`;
  await db.query(`CREATE SCHEMA ${other}`);
  const isolated = new DataSource({
    type: 'postgres',
    host: socket,
    port: cluster.port,
    username: 'kyc_synthetic',
    database: 'postgres',
    synchronize: false,
    logging: false,
    extra: { options: `-c search_path=${other}` },
  });
  try {
    await isolated.initialize();
    const runner = isolated.createQueryRunner();
    await new CreateAuthorizationCatalogue1785753600083().up(runner);
    await runner.query(
      `INSERT INTO authorization_roles(role_key,display_name,description,is_system_seeded) VALUES ('SUPER_ADMIN','admin','test',true),('COMPLIANCE','compliance','test',true)`,
    );
    await new KycProviderGovernance1785753600109().up(runner);
    const rows = await isolated.query<Array<{ role_key: string; function_code: string }>>(
      `SELECT r.role_key,f.function_code FROM authorization_role_functions f JOIN authorization_roles r ON r.id=f.role_id ORDER BY r.role_key,f.function_code`,
    );
    expect(rows).toEqual([
      { role_key: 'COMPLIANCE', function_code: 'kyc.provider.approve' },
      { role_key: 'COMPLIANCE', function_code: 'kyc.provider.view' },
      { role_key: 'SUPER_ADMIN', function_code: 'kyc.provider.propose' },
      { role_key: 'SUPER_ADMIN', function_code: 'kyc.provider.view' },
    ]);
    await runner.release();
  } finally {
    if (isolated.isInitialized) await isolated.destroy();
    await db.query(`DROP SCHEMA ${other} CASCADE`);
  }
});

test('separate authority login publishes provider policy while the runtime login remains read-only', async () => {
  const connections = await createKycAuthorityConnections(db, cluster, schema);
  try {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as never;
    const auth = new AuthorizationService(connections.runtime, audit);
    const authority = new ProtectedAuthorityService(connections.runtime, connections.authority);
    const service = new KycProviderGovernanceService(connections.runtime, auth, authority);

    expect((await service.view(maker)).version).toBe(3);
    await expect(
      connections.runtime.query(
        'UPDATE kyc_provider_configuration SET version=version+1 WHERE singleton=true',
      ),
    ).rejects.toThrow();
    await expect(
      connections.runtime.query('SELECT * FROM protected_authority.kyc_governance_decisions'),
    ).rejects.toThrow();
    expect(await service.resolve('BVN')).toEqual({ provider: 'SYNTHETIC', version: 3 });

    const proposal = await service.propose(maker, {
      requestId: randomUUID(),
      expectedVersion: 3,
      configuration: config,
      reason: 'ROUTING_CHANGE',
    });
    expect(proposal.replay).toBe(false);
    expect(await service.decide(checker, proposal.id, true)).toEqual({
      version: 4,
      state: 'APPROVED',
    });
    await expect(service.decide(checker, proposal.id, true)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const evidence = await connections.authority.query<
      Array<{ decision: string; payload_digest: string }>
    >(
      'SELECT decision,payload_digest FROM protected_authority.kyc_governance_decisions WHERE proposal_schema=$1 AND proposal_kind=$2 AND proposal_id=$3',
      [schema, 'PROVIDER', proposal.id],
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.decision).toBe('APPROVED');
    expect(evidence[0]?.payload_digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      connections.authority.query(
        'UPDATE protected_authority.kyc_governance_decisions SET decision=$1 WHERE proposal_schema=$2 AND proposal_id=$3',
        ['REJECTED', schema, proposal.id],
      ),
    ).rejects.toThrow(/immutable/i);
    expect((await service.view(checker)).version).toBe(4);
  } finally {
    await connections.cleanup();
  }
});

test('Dojah routes stay fail-closed until account entitlement and production controls are confirmed', async () => {
  const current = await svc.view(maker);
  const candidate = {
    providers: {
      MONNIFY: { enabled: false, capabilities: [] },
      DOJAH: { enabled: true, capabilities: ['BVN', 'NIN'] },
      SYNTHETIC: { enabled: false, capabilities: [] },
    },
    routes: {
      BVN: { primary: 'DOJAH', fallback: null },
      NIN: { primary: 'DOJAH', fallback: null },
    },
  };
  const proposal = await svc.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: current.version,
    configuration: candidate,
    reason: 'ROUTING_CHANGE',
  });
  await svc.decide(checker, proposal.id, true);
  await expect(svc.resolve('BVN')).rejects.toMatchObject({ code: 'DISABLED' });
  await expect(svc.resolve('NIN')).rejects.toMatchObject({ code: 'DISABLED' });
});
