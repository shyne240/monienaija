import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { A2FinanceRoleAssignment } from '../../src/authorization/workforce-authentication.entity';
import type { A2WorkforceConfigurationV1 } from '../../src/authorization/workforce-authentication.types';
import { A2_WORKFORCE_CONFIG } from '../../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../../src/authorization/workforce-session.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './pg-harness';

/** Isolated real PostgreSQL, real Nest guard, catalogue-backed workforce sessions and HTTP. */
export async function createMission15aFixture(label: string) {
  const dataSource = await createIntegrationDataSource(label);
  const config = {
    enabled: true,
    environment: 'test',
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 3600,
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled: false,
    bootstrapIssuer: '',
    bootstrapAudience: '',
    bootstrapKeys: [],
    bootstrapFinanceAdminScopes: [],
    recoveryEnabled: false,
    recoveryAudience: '',
    recoveryKeys: [],
    roles: [],
    makerCheckerRules: [],
    rateLimits: [{ category: 'privileged-approval', capacity: 100, refillRatePerSecond: 100, enabled: true }],
    trustedProxyAddresses: [],
  } as unknown as A2WorkforceConfigurationV1;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource).useValue(dataSource)
    .overrideProvider(A2_WORKFORCE_CONFIG).useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const workforceSessions = moduleRef.get(A2WorkforceSessionService);

  async function workforce(roleKey: string): Promise<{ id: string; token: string }> {
    const id = `mission15a:${randomUUID()}`;
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(), assignmentReference: randomUUID(), assignmentVersion: 1,
      principalId: id, roleKey, scopes: [], status: 'ACTIVE', initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true, effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 3_600_000), assignedBy: 'test', assignedAt: now,
      revokedBy: null, revokedAt: null, bootstrapReference: null, approvalIds: [], auditReferences: [],
    });
    const session = await workforceSessions.establish({
      issuer: 'https://workforce.test', subject: id, principalId: id, audience: ['workforce-admin'],
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(), assuranceLevel: 'MFA', amr: ['pwd', 'otp'], acr: null,
      signingKeyId: 'test',
    });
    return { id, token: session.accessToken };
  }

  async function agent(classId?: string): Promise<{ id: string; credentialId: string; password: string }> {
    const id = randomUUID();
    const password = `Test-${randomUUID()}`;
    const salt = Buffer.from('mission-15a-test-salt');
    const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    const passwordHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
    await dataSource.query(
      `INSERT INTO agents(id,reference,status,agent_class_id) VALUES($1,$2,'ACTIVE',$3)`,
      [id, `M15-${randomUUID()}`, classId ?? null],
    );
    const credentials: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_authentication_credentials
       (agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status)
       VALUES($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [id, passwordHash],
    );
    return { id, credentialId: credentials[0]!.id, password };
  }

  async function login(identity: { id: string; password: string }): Promise<{ token: string; sessionId: string }> {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/agents/sessions',
      payload: { agentId: identity.id, password: identity.password },
    });
    if (response.statusCode !== 200) throw new Error(`Agent test login failed: ${response.statusCode}`);
    const body = response.json() as { accessToken: string; sessionId: string };
    return { token: body.accessToken, sessionId: body.sessionId };
  }

  async function close() {
    await app.close();
    await destroyIntegrationDataSource(dataSource);
  }
  return { dataSource, app, moduleRef, workforce, agent, login, close };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
