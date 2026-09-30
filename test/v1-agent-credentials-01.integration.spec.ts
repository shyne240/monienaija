/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * V1-AGENT-CREDENTIALS-01 — real Agent credential issuance & first-login rotation (real PostgreSQL + real HTTP).
 *
 * Proves the closed gap: activation → workforce credential issuance → agent first login →
 * mandatory rotation → normal session — with NO manual SQL for the credential path itself,
 * using only existing authentication architecture (same hashing, sessions, lockout, audits).
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';

describe('V1-AGENT-CREDENTIALS-01 (real PG) — Agent credential issuance & rotation', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-'))
        throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
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
        assuranceLevel: 'MFA',
      } as any;
    },
  };

  const OP = { Authorization: 'Bearer workforce-OPERATOR' };
  const SUPPORT = { Authorization: 'Bearer workforce-SUPPORT' };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1agentcreds');
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
    await app.getHttpAdapter().getInstance().ready();
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  // ── fixtures ──────────────────────────────────────────────────────────────
  async function approvedApplication(): Promise<string> {
    const cls = await classService.create({
      reference: `cls-ac-${randomUUID().slice(0, 8)}`,
      code: `AC-${randomUUID().slice(0, 6)}`,
      name: 'AC Class',
      isActive: true,
      applicableServices: ['CASH_IN'] as any,
      applicableLimits: {} as any,
      actor: 'test-actor',
    });
    const application = await appService.create({
      agentClassId: cls.id,
      applicantReference: `agent-ac-${randomUUID()}`,
      actor: 'applicant',
    });
    await appService.submit(application.id, 'applicant');
    const approved = await appService.approve(application.id, 'workforce-reviewer');
    return approved.id;
  }

  async function activeAgent(): Promise<string> {
    const applicationId = await approvedApplication();
    const agent = await lifecycleService.activateFromApplication(applicationId, 'workforce-operator-1');
    expect(agent.status).toBe('ACTIVE');
    return agent.id;
  }

  function issueHttp(agentId: string, headers: Record<string, string> = OP, body: any = {}) {
    return request(app.getHttpServer())
      .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
      .set(headers)
      .send(body);
  }

  async function rotatedAgentSession(): Promise<{ agentId: string; password: string; token: string }> {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    const temp = issued.body.temporaryPassword as string;
    const newPassword = `Agent-Own-${randomUUID().slice(0, 8)}-pw`;
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: temp, newPassword })
      .expect(200);
    return { agentId, password: newPassword, token: rotated.body.accessToken as string };
  }

  // ── 1-6: issuance, login, rotation core ───────────────────────────────────
  it('1. activated Agent receives a usable temporary credential state via the workforce issuance endpoint (no SQL)', async () => {
    const agentId = await activeAgent();
    const res = await issueHttp(agentId).expect(200);
    const { temporaryPassword, credentialId, rotationRequired, passwordExpiresAt } = res.body;
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/); // CSPRNG base64url, 16 chars
    expect(rotationRequired).toBe(true);
    expect(new Date(passwordExpiresAt).getTime()).toBeGreaterThan(Date.now());
    const rows = await dataSource.query(
      `SELECT status, rotation_required, password_version, password_expires_at, password_hash FROM agent_authentication_credentials WHERE id=$1`,
      [credentialId],
    );
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].rotation_required).toBe(true);
    expect(rows[0].password_version).toBe(1);
    expect(rows[0].password_expires_at).not.toBeNull();
    const audit = await dataSource.query(
      `SELECT action, actor, new_values FROM audit_events WHERE entity_type='AGENT_AUTHENTICATION_CREDENTIAL' AND entity_id=$1`,
      [credentialId],
    );
    expect(audit[0].action).toBe('CREDENTIALS_ISSUED');
    expect(audit[0].actor).toBe('workforce-operator-1');
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
    expect(JSON.stringify(audit)).not.toContain('PBKDF2$');
  });

  it('2. Agent authenticates through the real login endpoint with the temporary credential — but receives NO session while rotation is pending', async () => {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: issued.body.temporaryPassword })
      .expect(200);
    expect(res.body.rotationRequired).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    const sessions = await dataSource.query(
      `SELECT count(*)::text AS n FROM agent_authentication_sessions WHERE agent_id=$1`,
      [agentId],
    );
    expect(sessions[0].n).toBe('0');
  });

  it('3. initial credential is never stored as plaintext (hash only, PBKDF2 format)', async () => {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    const rows = await dataSource.query(
      `SELECT password_hash, hash_algorithm FROM agent_authentication_credentials WHERE agent_id=$1`,
      [agentId],
    );
    expect(rows[0].hash_algorithm).toBe('PBKDF2');
    expect(rows[0].password_hash).toMatch(/^PBKDF2\$sha256\$10000\$/);
    expect(rows[0].password_hash).not.toBe(issued.body.temporaryPassword);
    expect(rows[0].password_hash).not.toContain(issued.body.temporaryPassword);
  });

  it('4. first-login rotation is enforced (session only after rotation); rotate rejects wrong current password with real lockout accounting', async () => {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    const temp = issued.body.temporaryPassword as string;
    await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: 'wrong-wrong-wrong', newPassword: 'New-pass-12345' })
      .expect(401);
    const fails = await dataSource.query(
      `SELECT failed_authentication_count FROM agent_authentication_credentials WHERE agent_id=$1`,
      [agentId],
    );
    expect(fails[0].failed_authentication_count).toBe(1);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: temp, newPassword: 'New-pass-12345' })
      .expect(200);
    expect(rotated.body.accessToken).toBeTruthy();
    const cred = await dataSource.query(
      `SELECT rotation_required, password_version, password_expires_at, failed_authentication_count FROM agent_authentication_credentials WHERE agent_id=$1`,
      [agentId],
    );
    expect(cred[0].rotation_required).toBe(false);
    expect(cred[0].password_version).toBe(2);
    expect(cred[0].password_expires_at).toBeNull();
  });

  it('5. after rotation, the NEW credential works through the normal login', async () => {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    const newPassword = 'Agent-Set-Password-9';
    await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: issued.body.temporaryPassword, newPassword })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: newPassword })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.rotationRequired).toBeUndefined();
    const me = await request(app.getHttpServer())
      .get('/api/v1/agents/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(agentId);
  });

  it('6. the old temporary credential is dead after rotation', async () => {
    const agentId = await activeAgent();
    const issued = await issueHttp(agentId).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: issued.body.temporaryPassword, newPassword: 'Strong-First-88' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: issued.body.temporaryPassword })
      .expect(401);
  });

  // ── 7-9: lifecycle gating ─────────────────────────────────────────────────
  it('7. PENDING Agent (approved but not yet activated) cannot receive credentials', async () => {
    const applicationId = await approvedApplication();
    const application = await appService.getById(applicationId);
    const pendingAgentId = application.agentId!;
    expect(pendingAgentId).toBeTruthy();
    const res = await issueHttp(pendingAgentId).expect(409);
    expect(res.body.message).toMatch(/not ACTIVE/i);
    const rows = await dataSource.query(
      `SELECT count(*)::text AS n FROM agent_authentication_credentials WHERE agent_id=$1`,
      [pendingAgentId],
    );
    expect(rows[0].n).toBe('0');
  });

  it('8. SUSPENDED Agent cannot receive new credentials (issuance and reissuance denied)', async () => {
    const agentId = await activeAgent();
    await lifecycleService.suspend(agentId, 'workforce-operator-1', 'policy hold');
    const res = await issueHttp(agentId).expect(409);
    expect(res.body.message).toMatch(/not ACTIVE/i);
    const resRe = await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/agents/${agentId}/credentials/reissue`)
      .set(OP)
      .send({})
      .expect(409);
    expect(resRe.body.message).toMatch(/not ACTIVE|no authentication credential/i);
  });

  it('9. TERMINATED Agent cannot receive new credentials', async () => {
    const agentId = await activeAgent();
    await lifecycleService.terminate(agentId, 'workforce-operator-1', 'offboarded');
    const res = await issueHttp(agentId).expect(409);
    expect(res.body.message).toMatch(/not ACTIVE/i);
    // Also: credential issuance never resurrects the Agent
    const agent = await lifecycleService.getAgent(agentId);
    expect(agent.status).toBe('TERMINATED');
  });

  // ── 10-11: authorization ─────────────────────────────────────────────────
  it('10. unauthorized actors cannot issue credentials: SUPPORT (403), no token (401), CUSTOMER/AGENT-typed sessions (403)', async () => {
    const agentId = await activeAgent();
    await issueHttp(agentId, SUPPORT).expect(403);
    await issueHttp(agentId, {}).expect(401);
    await issueHttp(agentId, { Authorization: 'Bearer workforce-CUSTOMER' }).expect(403);
    await issueHttp(agentId, { Authorization: 'Bearer workforce-AGENT' }).expect(403);
    const rows = await dataSource.query(
      `SELECT count(*)::text AS n FROM agent_authentication_credentials WHERE agent_id=$1`,
      [agentId],
    );
    expect(rows[0].n).toBe('0');
  });

  it('11. a real AGENT bearer cannot reach the workforce surface (403) and a forged body agentId is ignored — identity comes from the authorized path', async () => {
    const { token: agentToken, agentId: agentA } = await rotatedAgentSession();
    const agentB = await activeAgent();
    // Agent A's real session on the workforce route → hard 403 from the guard
    await issueHttp(agentB, { Authorization: `Bearer ${agentToken}` }).expect(403);
    // Forged agentId in the request BODY is ignored; the path id is authoritative
    const res = await issueHttp(agentB, OP, { agentId: agentA }).expect(200);
    expect(res.body.agentId).toBe(agentB);
    const rowsA = await dataSource.query(
      `SELECT count(*)::text AS n FROM agent_authentication_credentials WHERE agent_id=$1 AND deleted_at IS NULL`,
      [agentA],
    );
    expect(rowsA[0].n).toBe('1'); // Agent A's own rotated credential untouched
  });

  // ── 12-13: duplicate prevention & reissuance ─────────────────────────────
  it('12. duplicate issuance is rejected (one active credential per Agent) and state stays consistent', async () => {
    const agentId = await activeAgent();
    await issueHttp(agentId).expect(200);
    const second = await issueHttp(agentId).expect(409);
    expect(second.body.message).toMatch(/already has an authentication credential/i);
    const rows = await dataSource.query(
      `SELECT count(*)::text AS n FROM agent_authentication_credentials WHERE agent_id=$1 AND deleted_at IS NULL`,
      [agentId],
    );
    expect(rows[0].n).toBe('1');
  });

  it('13. reissuance revokes the previous credential AND its sessions, old password dies, new temporary credential works', async () => {
    const { agentId, password, token } = await rotatedAgentSession();
    const reissue = await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/agents/${agentId}/credentials/reissue`)
      .set(OP)
      .send({})
      .expect(200);
    expect(reissue.body.rotationRequired).toBe(true);
    // previous session revoked
    await request(app.getHttpServer())
      .get('/api/v1/agents/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    // previous credential state
    const prev = await dataSource.query(
      `SELECT status, deleted_at FROM agent_authentication_credentials WHERE agent_id=$1 AND deleted_at IS NOT NULL`,
      [agentId],
    );
    expect(prev[0].status).toBe('REVOKED');
    expect(prev[0].deleted_at).not.toBeNull();
    // old rotated password dead; new temporary credential drives rotation-required login
    await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: reissue.body.temporaryPassword })
      .expect(200);
    expect(login.body.rotationRequired).toBe(true);
    expect(login.body.accessToken).toBeUndefined();
    // audit trail carries REISSUED + REVOKED without secret material
    const audit = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type='AGENT_AUTHENTICATION_CREDENTIAL' ORDER BY created_at`,
    );
    const actions = audit.map((a: any) => a.action);
    expect(actions).toContain('CREDENTIALS_ISSUED');
    expect(actions).toContain('PASSWORD_ROTATED');
    expect(actions).toContain('REVOKED');
    expect(actions).toContain('CREDENTIALS_REISSUED');
    expect(JSON.stringify(audit)).not.toContain(reissue.body.temporaryPassword);
    expect(JSON.stringify(audit)).not.toContain('PBKDF2$');
  });

  // ── 14: PIN separation ────────────────────────────────────────────────────
  it('14. Agent transaction PIN is untouched by credential issuance/rotation/reissuance (LOGIN PASSWORD ≠ TRANSACTION PIN)', async () => {
    const { agentId, token } = await rotatedAgentSession();
    await request(app.getHttpServer())
      .post('/api/v1/agents/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '9874' })
      .expect(200);
    const hashBefore = await dataSource.query(
      `SELECT pin_hash FROM agent_transaction_pins WHERE agent_id=$1`,
      [agentId],
    );
    expect(hashBefore).toHaveLength(1);
    // Reissue + rotate again — credential lifecycle churns fully
    const reissue = await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/agents/${agentId}/credentials/reissue`)
      .set(OP)
      .send({})
      .expect(200);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: reissue.body.temporaryPassword, newPassword: 'Second-Final-55' })
      .expect(200);
    // PIN row identical, still verifies in the new session
    const hashAfter = await dataSource.query(
      `SELECT pin_hash FROM agent_transaction_pins WHERE agent_id=$1`,
      [agentId],
    );
    expect(hashAfter[0].pin_hash).toBe(hashBefore[0].pin_hash);
    const verify = await request(app.getHttpServer())
      .post('/api/v1/agents/me/transaction-pin/verify')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .send({ pin: '9874' })
      .expect(200);
    expect(verify.body.verified).toBe(true);
  });

  // ── 15: MFA/OTP machinery untouched ──────────────────────────────────────
  it('15. credential issuance/rotation creates no MFA/OTP challenge and no customer-side security events', async () => {
    const { agentId } = await rotatedAgentSession();
    const challenges = await dataSource.query(
      `SELECT count(*)::text AS n FROM mfa_challenges`,
    );
    expect(challenges[0].n).toBe('0');
    const customerEvents = await dataSource.query(
      `SELECT count(*)::text AS n FROM security_event_histories WHERE customer_id IS NOT NULL`,
    );
    expect(customerEvents[0].n).toBe('0');
    void agentId;
  });

  // ── 20: no financial side effects ─────────────────────────────────────────
  it('16. credential issuance & rotation mutate NO financial state (ledger, wallets, journals, idempotency untouched)', async () => {
    const count = async (table: string) =>
      (await dataSource.query(`SELECT count(*)::text AS n FROM ${table}`))[0].n as string;
    const agentId = await activeAgent();
    const before = {
      lines: await count('ledger_lines'),
      journals: await count('ledger_journals'),
      wallets: await count('wallet_accounts'),
      idem: await count('idempotency_records'),
      transfers: await count('transfers'),
    };
    const issued = await issueHttp(agentId).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/agents/credentials/rotate')
      .send({ agentId, currentPassword: issued.body.temporaryPassword, newPassword: 'Final-pass-77' })
      .expect(200);
    expect({
      lines: await count('ledger_lines'),
      journals: await count('ledger_journals'),
      wallets: await count('wallet_accounts'),
      idem: await count('idempotency_records'),
      transfers: await count('transfers'),
    }).toEqual(before);
  });
});
