import { Test } from '@nestjs/testing';
import { CreateAuthorizationCatalogue1785753600083 } from '../src/migrations/1785753600083-CreateAuthorizationCatalogue';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { KycProviderGovernanceController } from '../src/kyc-verification/kyc-provider-governance.controller';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { KycProviderGovernance1785753600109 } from '../src/migrations/1785753600109-KycProviderGovernance';
import {
  KycProviderGovernanceService,
  validateProviderConfiguration,
} from '../src/kyc-verification/kyc-provider-governance.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const schema = `kyc_gov_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
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
  const loc = await db.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const listen = await db.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const ver = await db.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(loc[0]?.data_directory ?? '') ||
    listen[0]?.listen_addresses !== '' ||
    !ver[0]?.server_version.startsWith('16.')
  )
    throw new Error('Not isolated PostgreSQL 16');
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  const runner = db.createQueryRunner();
  await new KycProviderGovernance1785753600109().up(runner);
  await runner.release();
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
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    expect(() => validateProviderConfiguration(config)).toThrow();
  } finally {
    process.env.NODE_ENV = old;
  }
});

test('rejects a proposal whose persisted content was changed before approval', async () => {
  const p = await svc.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: 2,
    configuration: config,
    reason: 'ROUTING_CHANGE',
  });
  await db.query(
    `UPDATE kyc_provider_change_proposals SET configuration=jsonb_set(configuration,'{providers,MONNIFY,enabled}','false'::jsonb) WHERE id=$1`,
    [p.id],
  );
  await expect(svc.decide(checker, p.id, true)).rejects.toMatchObject({ code: 'CONFLICT' });
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
    port: 55461,
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
