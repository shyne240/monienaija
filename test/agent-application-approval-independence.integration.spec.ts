import { spawnSync } from 'node:child_process';

import { DataSource } from 'typeorm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * V1-AGENT-APPROVAL-INDEPENDENCE — separation of duties at the Agent application approval boundary.
 *
 * Everything here runs against real PostgreSQL and real HTTP with the real local role accounts and
 * their real catalogue functions. Two operators of the SAME role are used deliberately: the rule is
 * about principal identity, not seniority, and a test that used two different roles would pass even
 * if the guard were really checking roles.
 *
 * The submitting operator holds `agent.review_application` — without that, a self-approval attempt
 * would be refused for the wrong reason (missing function) and would prove nothing.
 */
interface HttpResponseBody {
  id?: string;
  status?: string;
  message?: unknown;
  accessToken?: string;
  sessionId?: string;
  principal?: { principalId?: string };
}

/** Narrow a supertest response body once, so assertions never reach through `any`. */
const payload = (res: { body: unknown }): HttpResponseBody => res.body as HttpResponseBody;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS fixture shared with the CLI seeder
const seed = require('../scripts/local-dev-seed-11-roles.js') as {
  ROLES: string[];
  emailFor(role: string): string;
  passwordFor(role: string): string;
};
const loginPath = '/api/v1/internal/a2/workforce/local-admin-sessions';
const SUBMITTER_ROLE = 'AGENT_NETWORK_MANAGER';
/*
 * The only other seeded account whose catalogue grants `agent.review_application`.
 * ADMINISTRATOR deliberately holds `agent.view` only, and no grant is widened here to change that.
 */
const CHECKER_ROLE = 'SUPER_ADMIN';

describe('Agent application approval independence (real PostgreSQL + real HTTP)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let classId: string;
  const old = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    ds = await createIntegrationDataSourceFromScratch('apprindep');
    if (ds.options.type !== 'postgres') throw new Error('Expected PostgreSQL');

    /*
     * Seed the real 11 local role accounts through their own CLI implementation — the same one the
     * developer workflow uses. No credential is invented or changed here; the assertions below
     * depend on the real catalogue functions those roles hold.
     */
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
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
    process.env = old;
  }, 60_000);

  beforeEach(async () => {
    await ds.query(`TRUNCATE agent_applications, agents, agent_classes CASCADE`);
    // Seeded here, not in beforeAll: truncation above must not leave the guards untested because
    // the catalogue silently went missing.
    const rows: Array<{ id: string }> = await ds.query(
      `INSERT INTO agent_classes (reference, code, name, description, is_active, requirements,
                                  required_document_categories, applicable_services, applicable_limits)
       VALUES ($1, $2, 'Independence class', 'sod fixture', TRUE, '{}'::jsonb, '[]'::jsonb,
               $3::jsonb, '{}'::jsonb)
       RETURNING id`,
      [
        `CLS-${Math.random().toString(36).slice(2, 10)}`,
        `SOD_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        // jsonb column: pass JSON text, not a JS array (pg would serialize that as a PG array).
        JSON.stringify(['CASH_IN']),
      ],
    );
    classId = rows[0]!.id;
  });

  async function signIn(role: string) {
    const res = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email: seed.emailFor(role), password: seed.passwordFor(role) });
    expect(res.status).toBe(201);
    const body = payload(res);
    return {
      accessToken: body.accessToken as string,
      sessionId: body.sessionId as string,
      principalId: body.principal?.principalId as string,
    };
  }

  /** Create + submit through the endpoints the console uses, as `token`'s principal. */
  async function submitAs(token: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/agents/applications')
      .send({
        applicantReference: `sod-${Math.random().toString(36).slice(2, 10)}`,
        agentClassId: classId,
        businessName: 'Separation of duties kiosk',
        contactEmail: 'sod@example.test',
      })
      .expect(201);
    const id = payload(created).id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/agents/applications/${id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return id;
  }

  const approve = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/internal/agents/applications/${id}/approve`)
      .set('Authorization', `Bearer ${token}`);

  it('records the submitting operator as the submitter', async () => {
    const maker = await signIn(SUBMITTER_ROLE);
    const id = await submitAs(maker.accessToken);
    const rows: Array<{ submitted_by: string | null; created_by: string }> = await ds.query(
      `SELECT submitted_by, created_by FROM agent_applications WHERE id=$1`,
      [id],
    );
    expect(rows[0]!.submitted_by).toBe(maker.principalId);
    // The row's creator is still the anonymous application principal — which is exactly why
    // `created_by` could never have answered the approval question.
    expect(rows[0]!.created_by).toBe(`agent-application:${id}`);
  });

  it('refuses self-approval and leaves the application untouched', async () => {
    const maker = await signIn(SUBMITTER_ROLE);
    const id = await submitAs(maker.accessToken);

    const res = await approve(maker.accessToken, id);
    expect(res.status).toBe(403);
    expect(String(payload(res).message)).toMatch(/separation of duties/i);

    const rows: Array<{ status: string; approved_at: string | null; agent_id: string | null }> =
      await ds.query(`SELECT status, approved_at, agent_id FROM agent_applications WHERE id=$1`, [
        id,
      ]);
    // The guard fires before any state change: no approval, no timestamp, no Agent created.
    expect(rows[0]!.status).toBe('SUBMITTED');
    expect(rows[0]!.approved_at).toBeNull();
    expect(rows[0]!.agent_id).toBeNull();
    expect(await ds.query(`SELECT id FROM agents`)).toHaveLength(0);

    // No APPROVED audit row was written either — a refusal must not leave a footprint that reads
    // like a decision.
    const audits: Array<{ action: string }> = await ds.query(
      `SELECT action FROM audit_events WHERE entity_type='AGENT_APPLICATION' AND entity_id=$1`,
      [id],
    );
    expect(audits.map((row) => row.action)).not.toContain('APPROVED');
  });

  it('refuses the same operator from a different session', async () => {
    const first = await signIn(SUBMITTER_ROLE);
    const id = await submitAs(first.accessToken);

    // A second, independent login for the same principal — a refreshed tab, a new device.
    const second = await signIn(SUBMITTER_ROLE);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.principalId).toBe(first.principalId);

    const res = await approve(second.accessToken, id);
    expect(res.status).toBe(403);
    expect(String(payload(res).message)).toMatch(/separation of duties/i);
  });

  it('lets an independently authorised checker approve the same application', async () => {
    const maker = await signIn(SUBMITTER_ROLE);
    const id = await submitAs(maker.accessToken);

    await expect(approve(maker.accessToken, id)).resolves.toMatchObject({ status: 403 });

    /*
     * A real second operator — a different seeded account whose catalogue grants
     * `agent.review_application`. No new role, no widened ADMINISTRATOR grant, no second workflow:
     * this is the same endpoint the console calls.
     */
    const checker = await signIn(CHECKER_ROLE);
    expect(checker.principalId).not.toBe(maker.principalId);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/applications/${id}/review`)
      .set('Authorization', `Bearer ${checker.accessToken}`)
      .expect(200);

    const res = await approve(checker.accessToken, id);
    expect(res.status).toBe(200);
    expect(payload(res).status).toBe('APPROVED');

    const rows: Array<{ status: string; approved_at: string | null; submitted_by: string }> =
      await ds.query(
        `SELECT status, approved_at, submitted_by FROM agent_applications WHERE id=$1`,
        [id],
      );
    expect(rows[0]!.status).toBe('APPROVED');
    expect(rows[0]!.approved_at).not.toBeNull();
    // The approving principal is not the submitter on the persisted row.
    expect(rows[0]!.submitted_by).toBe(maker.principalId);
    expect(rows[0]!.submitted_by).not.toBe(checker.principalId);
  });

  it('applies to the privileged account too — it is about the principal, not the role', async () => {
    /*
     * If the guard really compared roles rather than principals, a SUPER_ADMIN submitting their own
     * application would sail through — they hold every review function. They must not.
     */
    const privileged = await signIn(CHECKER_ROLE);
    const id = await submitAs(privileged.accessToken);

    const res = await approve(privileged.accessToken, id);
    expect(res.status).toBe(403);
    expect(String(payload(res).message)).toMatch(/separation of duties/i);
  });

  it('refuses approval when the submitter was never recorded, instead of guessing one', async () => {
    const checker = await signIn(CHECKER_ROLE);
    // A pre-attribution row: submitted before migration 1785753600809 existed.
    const rows: Array<{ id: string }> = await ds.query(
      `INSERT INTO agent_applications
         (id, reference, agent_class_id, status, applicant_reference, created_by, submitted_at)
       VALUES (gen_random_uuid(), $1, $2, 'SUBMITTED', 'legacy-applicant', 'agent-application:legacy', NOW())
       RETURNING id`,
      [`AGENT-APP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, classId],
    );
    const res = await approve(checker.accessToken, rows[0]!.id);
    expect(res.status).toBe(409);
    expect(String(payload(res).message)).toMatch(/submitter attribution/i);
    expect(String(payload(res).message)).toMatch(/must reject it with a reason/i);
  });

  it('does not let the submitter rewrite their own attribution to dodge the guard', async () => {
    const maker = await signIn(SUBMITTER_ROLE);
    const id = await submitAs(maker.accessToken);
    await expect(
      ds.query(`UPDATE agent_applications SET submitted_by='someone-else' WHERE id=$1`, [id]),
    ).rejects.toThrow(/immutable/i);
  });
});
