/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/operations/audit.service';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { financeRoleAssignmentReference } from '../src/authorization/finance-role-administration.service';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

// The same exported implementation is invoked by the CLI, not a replacement fixture.
const seed = require('../scripts/local-dev-seed-11-roles.js') as {
  ROLES: string[];
  emailFor(role: string): string;
  passwordFor(role: string): string;
  principalFor(email: string, config: any): string;
  seedLocalRoles(ds: DataSource, config: any, audit: AuditService): Promise<any[]>;
};
const loginPath = '/api/v1/internal/a2/workforce/local-admin-sessions';

describe('local development 11-role fixture (real migrations, PostgreSQL, Nest HTTP)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let config: any;
  let audit: AuditService;
  const old = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    ds = await createIntegrationDataSourceFromScratch('localdev11');
    if (ds.options.type !== 'postgres') throw new Error('Expected PostgreSQL');
    const options = ds.options;
    const cli = spawnSync(process.execPath, ['scripts/local-dev-seed-11-roles.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: String(options.host),
        DB_PORT: String(options.port),
        DB_NAME: String(options.database),
        DB_USER: String(options.username),
        DB_PASSWORD: String(options.password),
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    expect({ status: cli.status, stderr: cli.stderr }).toEqual({ status: 0, stderr: '' });
    expect(await ds.query('SELECT id FROM local_admin_credentials')).toHaveLength(11);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    config = mod.get('A2_WORKFORCE_CONFIG');
    audit = mod.get(AuditService);
  }, 180_000);
  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
    process.env = old;
  }, 60_000);

  it('creates all 11, authenticates each via HTTP with its exact catalogue and legacy permissions, and preserves rows on repetition', async () => {
    expect(await ds.query('SELECT id FROM local_admin_credentials')).toHaveLength(11);
    const credsBefore = await ds.query(
      'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY email',
    );
    const rolesBefore = await ds.query(
      'SELECT id,principal_id,role_key,assignment_reference,record_version FROM a2_finance_role_assignments ORDER BY principal_id',
    );
    for (const role of seed.ROLES) {
      const email = seed.emailFor(role);
      const login = await request(app.getHttpServer())
        .post(loginPath)
        .send({ email, password: seed.passwordFor(role) });
      expect(login.status).toBe(201);
      expect(login.body.principal.roles).toEqual([role]);
      expect(login.body.principal.principalId).toBe(seed.principalFor(email, config));
      const assignment = rolesBefore.find(
        (row: any) => row.principal_id === login.body.principal.principalId,
      );
      expect(assignment.assignment_reference).toBe(
        financeRoleAssignmentReference(login.body.principal.principalId, role, config.environment),
      );
      const rows: Array<{ function_code: string }> = await ds.query(
        `SELECT rf.function_code FROM authorization_role_functions rf JOIN authorization_roles r ON r.id=rf.role_id WHERE r.role_key=$1 AND r.is_active AND rf.is_active`,
        [role],
      );
      const expected = [
        ...new Set([
          ...rows.map((x) => x.function_code),
          ...(config.roles.find((r: any) => r.roleKey === role && r.enabled)?.scopes ?? []),
        ]),
      ].sort();
      expect(expected.length).toBeGreaterThan(0);
      expect([...login.body.principal.scopes].sort()).toEqual(expected);
      const dashboard = await request(app.getHttpServer())
        .get('/api/v1/internal/a2/workforce/dashboard/my-dashboard')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.isFallback).toBe(false);
      if (role === 'TREASURY') {
        const denied = await request(app.getHttpServer())
          .get('/api/v1/customers')
          .set('Authorization', `Bearer ${login.body.accessToken}`);
        expect(denied.status).toBe(403);
      }
    }
    const again = await seed.seedLocalRoles(ds, config, audit);
    expect(again.every((x) => !x.credentialCreated && !x.assignmentCreated)).toBe(true);
    expect(
      await ds.query('SELECT id,email,password_hash FROM local_admin_credentials ORDER BY email'),
    ).toEqual(credsBefore);
    expect(
      await ds.query(
        'SELECT id,principal_id,role_key,assignment_reference,record_version FROM a2_finance_role_assignments ORDER BY principal_id',
      ),
    ).toEqual(rolesBefore);
  });

  it('repairs a known fixture after issuer changes, without deleting the previous assignment', async () => {
    const email = seed.emailFor('OPERATIONS');
    const current = seed.principalFor(email, config);
    const oldPrincipal = seed.principalFor(email, {
      ...config,
      oidcIssuer: 'https://previous-issuer.invalid',
    });
    const oldRef = financeRoleAssignmentReference(oldPrincipal, 'OPERATIONS', config.environment);
    await ds.query(
      'UPDATE a2_finance_role_assignments SET principal_id=$1, assignment_reference=$2 WHERE principal_id=$3',
      [oldPrincipal, oldRef, current],
    );
    const before = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email, password: seed.passwordFor('OPERATIONS') });
    expect(before.status).toBe(401);
    expect(JSON.stringify(before.body)).toContain('No valid workforce roles');
    const result = await seed.seedLocalRoles(ds, config, audit);
    expect(result.find((x) => x.email === email).assignmentCreated).toBe(true);
    expect(
      await ds.query('SELECT id FROM a2_finance_role_assignments WHERE principal_id=$1', [
        oldPrincipal,
      ]),
    ).toHaveLength(1);
    const after = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email, password: seed.passwordFor('OPERATIONS') });
    expect(after.status).toBe(201);
    expect(after.body.principal.roles).toEqual(['OPERATIONS']);
  });

  it('repairs a missing fixture role when an unrelated principal already has the finance role', async () => {
    const role = 'FINANCE_CONTROLLER';
    const principal = seed.principalFor(seed.emailFor(role), config);
    const other = 'https://other.invalid:unrelated-workforce-user';
    await ds.query(
      `INSERT INTO a2_finance_role_assignments
      (id,assignment_reference,assignment_version,principal_id,role_key,scopes,status,interim,initiated_scope,effective_from,effective_to,assigned_by,assigned_at,approval_ids,audit_references,record_version)
      SELECT $1, $2, 1, $3,role_key,scopes,status,interim,initiated_scope,effective_from,effective_to,'unrelated',assigned_at,approval_ids,audit_references,1
      FROM a2_finance_role_assignments WHERE principal_id=$4`,
      [randomUUID(), `unrelated:${randomUUID()}`, other, principal],
    );
    await ds.query('DELETE FROM a2_finance_role_assignments WHERE principal_id=$1', [principal]);
    const result = await seed.seedLocalRoles(ds, config, audit);
    expect(result.find((x) => x.email === seed.emailFor(role)).assignmentCreated).toBe(true);
    expect(
      await ds.query('SELECT id FROM a2_finance_role_assignments WHERE principal_id=$1', [other]),
    ).toHaveLength(1);
    const login = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email: seed.emailFor(role), password: seed.passwordFor(role) });
    expect(login.status).toBe(201);
    expect(login.body.principal.roles).toEqual([role]);
  });

  it('refuses to grant privileges to an unrecognized existing credential and rolls back the entire seed', async () => {
    const email = seed.emailFor('CUSTOMER_SERVICE');
    const principal = seed.principalFor(email, config);
    const salt = randomBytes(16);
    const hash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync('UnrelatedPassword123!', salt, 10000, 32, 'sha256').toString('base64url')}`;
    await ds.query('UPDATE local_admin_credentials SET password_hash=$1 WHERE email=$2', [
      hash,
      email,
    ]);
    await ds.query('DELETE FROM a2_finance_role_assignments WHERE principal_id=$1', [principal]);
    const count = (await ds.query('SELECT count(*)::int AS n FROM a2_finance_role_assignments'))[0]
      .n;
    await expect(seed.seedLocalRoles(ds, config, audit)).rejects.toThrow(
      'unrecognized existing password',
    );
    expect(
      (await ds.query('SELECT count(*)::int AS n FROM a2_finance_role_assignments'))[0].n,
    ).toBe(count);
    expect(
      (
        await ds.query('SELECT password_hash FROM local_admin_credentials WHERE email=$1', [email])
      )[0].password_hash,
    ).toBe(hash);
    // Restore the controlled fixture for the following tests.
    const defaultPassword = seed.passwordFor('CUSTOMER_SERVICE');
    const defaultHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(defaultPassword, salt, 10000, 32, 'sha256').toString('base64url')}`;
    await ds.query('UPDATE local_admin_credentials SET password_hash=$1 WHERE email=$2', [
      defaultHash,
      email,
    ]);
    await seed.seedLocalRoles(ds, config, audit);
  });

  it('preserves a legacy admin and changed passwords; refuses unsafe environments and role conflicts', async () => {
    const localAuth = app.get(LocalAdminAuthenticationService);
    await localAuth.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const email = seed.emailFor('TREASURY');
    const salt = randomBytes(16),
      changed = 'MyDisposableChangedPassword123!';
    const hash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(changed, salt, 10000, 32, 'sha256').toString('base64url')}`;
    await ds.query('UPDATE local_admin_credentials SET password_hash=$1 WHERE email=$2', [
      hash,
      email,
    ]);
    const result = await seed.seedLocalRoles(ds, config, audit);
    expect(result.find((x) => x.email === email).password).toBe('existing password preserved');
    expect(
      (
        await ds.query('SELECT password_hash FROM local_admin_credentials WHERE email=$1', [email])
      )[0].password_hash,
    ).toBe(hash);
    const login = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email, password: changed });
    expect(login.status).toBe(201);
    const legacy = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    expect(legacy.status).toBe(201);
    expect(legacy.body.principal.roles).toEqual(['SUPER_ADMIN']);
    process.env.NODE_ENV = 'production';
    await expect(seed.seedLocalRoles(ds, config, audit)).rejects.toThrow('Refusing outside');
    const productionCli = spawnSync(process.execPath, ['scripts/local-dev-seed-11-roles.js'], {
      env: process.env,
      encoding: 'utf8',
    });
    expect(productionCli.status).not.toBe(0);
    expect(productionCli.stderr).toContain('Refusing outside');
    const refusedOption = spawnSync(
      process.execPath,
      ['scripts/local-dev-seed-11-roles.js', '--verify'],
      { env: process.env, encoding: 'utf8' },
    );
    expect(refusedOption.status).not.toBe(0);
    expect(refusedOption.stderr).toContain('accepts no arguments');
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = '';
    await expect(seed.seedLocalRoles(ds, config, audit)).rejects.toThrow('LOCAL_DEV_SEED_CONFIRM');
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    await ds.query(
      "UPDATE a2_finance_role_assignments SET status='REVOKED' WHERE principal_id=$1",
      [seed.principalFor(email, config)],
    );
    await expect(seed.seedLocalRoles(ds, config, audit)).rejects.toThrow('revoked assignment');
    expect(
      (
        await ds.query('SELECT status FROM a2_finance_role_assignments WHERE principal_id=$1', [
          seed.principalFor(email, config),
        ])
      )[0].status,
    ).toBe('REVOKED');
  });
});
