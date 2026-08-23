import { createServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { A2WorkforceOidcService } from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A2 workforce session coverage against real PostgreSQL.
 *
 * Uses a locally generated RSA keypair and a real loopback HTTP JWKS endpoint, so the
 * production JWKS fetch path in A2WorkforceOidcService is genuinely exercised — `fetch` is
 * not stubbed. No external identity provider is contacted and nothing here is
 * provider-specific: the configuration is generic OIDC (issuer, audience, client id, JWKS
 * URI) and would work against any conforming provider.
 */
describe('A2 workforce session (real PostgreSQL + real JWKS endpoint)', () => {
  let dataSource: DataSource;
  let jwks: Server;
  let jwksUri: string;
  let config: A2WorkforceConfigurationV1;
  let oidc: A2WorkforceOidcService;
  let sessions: A2WorkforceSessionService;

  const KID = 'a2-integration-key-1';
  const ISSUER = 'https://identity.integration.invalid';
  const AUDIENCE = 'workforce';
  const CLIENT_ID = 'workforce-client';

  let privateKeyPem: string;
  let jwkPublic: Record<string, unknown>;
  let jwksRequests = 0;
  let jwksHealthy = true;

  const roles = [
    role('FINANCE_ADMIN', ['privileged:execute'], {
      administrativeCapability: true,
      makerEligible: true,
      applicableActions: ['FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE'],
    }),
    role('FINANCE_PREPARER', ['finance:prepare'], {
      makerEligible: true,
      applicableActions: ['FINANCE_CONTROL_POLICY_ACTIVATE'],
    }),
    role('FINANCE_CONTROLLER', ['privileged:approve', 'privileged:execute'], {
      approvalCapability: true,
      checkerEligible: true,
      applicableActions: [
        'FINANCE_ROLE_ASSIGN',
        'FINANCE_ROLE_REVOKE',
        'FINANCE_CONTROL_POLICY_ACTIVATE',
      ],
    }),
    role('FINANCE_AUDITOR', ['finance:audit']),
  ];

  const rules = [
    'FINANCE_ROLE_ASSIGN',
    'FINANCE_ROLE_REVOKE',
    'FINANCE_CONTROL_POLICY_ACTIVATE',
  ].map((action) => ({
    action,
    initiatingRoles: [
      action === 'FINANCE_CONTROL_POLICY_ACTIVATE' ? 'FINANCE_PREPARER' : 'FINANCE_ADMIN',
    ],
    approvingRoles: ['FINANCE_CONTROLLER'],
    minimumApprovals: 1,
    separationRequired: true,
    selfApprovalProhibited: true,
    mfaRequired: true,
    minimumAssurance: 'MFA',
    materialityRequired: false,
  }));

  const rates = [
    'workforce-authentication',
    'workforce-bootstrap',
    'finance-role-administration',
    'privileged-approval',
  ].map((category) => ({ category, capacity: 100, refillRatePerSecond: 50, enabled: true }));

  function role(roleKey: string, scopes: string[], overrides: Record<string, unknown> = {}) {
    return {
      roleKey,
      displayName: roleKey,
      description: `${roleKey} description`,
      enabled: true,
      scopes,
      applicableActions: [],
      mfaRequired: true,
      approvalCapability: false,
      makerEligible: false,
      checkerEligible: false,
      administrativeCapability: false,
      ...overrides,
    };
  }

  function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
  }

  function signJwt(payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID, ...header }));
    const body = base64url(JSON.stringify(payload));
    const signingInput = `${head}.${body}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    return `${signingInput}.${signer.sign(privateKeyPem).toString('base64url')}`;
  }

  function assertionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: ISSUER,
      sub: `workforce-user-${randomUUID().slice(0, 8)}`,
      aud: AUDIENCE,
      azp: CLIENT_ID,
      iat: now,
      exp: now + 600,
      auth_time: now,
      acr: 'mfa',
      amr: ['mfa', 'pwd'],
      ...overrides,
    };
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a2workforce');

    // Real, locally generated RSA keypair. No key material is imported from anywhere.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const exported = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    jwkPublic = { ...exported, kid: KID, alg: 'RS256', use: 'sig' };

    // A genuine loopback HTTP JWKS endpoint; the service fetches from it for real.
    jwks = createServer((request, response) => {
      jwksRequests += 1;
      if (!jwksHealthy) {
        response.writeHead(503).end('unavailable');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwkPublic] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    const address = jwks.address() as AddressInfo;
    jwksUri = `http://127.0.0.1:${address.port}/jwks`;

    config = workforceConfiguration({
      NODE_ENV: 'development',
      A2_WORKFORCE_ENABLED: 'true',
      A2_WORKFORCE_OIDC_ISSUER: ISSUER,
      A2_WORKFORCE_OIDC_JWKS_URI: jwksUri,
      A2_WORKFORCE_OIDC_AUDIENCE: AUDIENCE,
      A2_WORKFORCE_OIDC_CLIENT_ID: CLIENT_ID,
      A2_WORKFORCE_INTERNAL_AUDIENCE: 'workforce-admin',
      A2_WORKFORCE_SESSION_TTL_SECONDS: '900',
      A2_BOOTSTRAP_ENABLED: 'false',
      A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['privileged:execute']),
      A2_BOOTSTRAP_JWKS_JSON: '[]',
      A2_FINANCE_ROLES_JSON: JSON.stringify(roles),
      A2_MAKER_CHECKER_RULES_JSON: JSON.stringify(rules),
      A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify(rates),
      A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['127.0.0.1', '::1/128']),
    });

    oidc = new A2WorkforceOidcService(config);
    sessions = new A2WorkforceSessionService(
      dataSource,
      new AuditService(dataSource.getRepository(AuditEvent)),
      config,
    );
  }, 180000);

  afterAll(async () => {
    if (jwks) await new Promise<void>((resolve) => jwks.close(() => resolve()));
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    jwksHealthy = true;
  });

  it('fetches the JWKS over real HTTP and validates a genuinely signed assertion', async () => {
    const before = jwksRequests;
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    expect(jwksRequests).toBeGreaterThan(before);
    expect(evidence.assuranceLevel).toBe('MFA');
    expect(evidence.issuer).toBe(ISSUER);
  });

  it('rejects a session token presented to the wrong audience', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    await expect(
      sessions.validate(session.accessToken, 'some-other-audience'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an assertion signed by a key the JWKS does not publish', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const foreign = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'unpublished-key' }));
    const body = base64url(JSON.stringify(assertionPayload()));
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    const token = `${head}.${body}.${signer.sign(foreign).toString('base64url')}`;
    await expect(oidc.validate(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered payload under the published key', async () => {
    const token = signJwt(assertionPayload());
    const [head, , signature] = token.split('.');
    const tampered = base64url(JSON.stringify(assertionPayload({ sub: 'attacker' })));
    await expect(oidc.validate(`${head}.${tampered}.${signature}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a mismatched issuer and a mismatched audience', async () => {
    await expect(
      oidc.validate(signJwt(assertionPayload({ iss: 'https://evil.invalid' }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      oidc.validate(signJwt(assertionPayload({ aud: 'someone-else' }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired assertion', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(
      oidc.validate(signJwt(assertionPayload({ iat: past, exp: past + 60, auth_time: past }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the real JWKS endpoint is unavailable', async () => {
    const fresh = new A2WorkforceOidcService(config);
    jwksHealthy = false;
    await expect(fresh.validate(signJwt(assertionPayload()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('establishes a workforce session row in real PostgreSQL', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    expect(session.accessToken).toBeTruthy();
    expect(session.tokenType).toBe('Bearer');

    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id, principal_id FROM a2_workforce_sessions',
    );
    expect(rows).toHaveLength(1);
  });

  it('validates an established session token', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    const validated = await sessions.validate(session.accessToken, config.internalAudience);
    expect(validated.principalId).toBe(evidence.principalId);
    expect(validated.assuranceLevel).toBe('MFA');
  });

  it('revokes a session and refuses it afterwards', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    await sessions.revoke(session.sessionId, session.principal, 'integration revocation');
    await expect(
      sessions.validate(session.accessToken, config.internalAudience),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an unknown session token', async () => {
    await expect(
      sessions.validate('not-a-real-session-token', config.internalAudience),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired session token', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    await dataSource.query(
      `UPDATE a2_workforce_sessions SET expires_at = now() - interval '1 hour'`,
    );
    await expect(
      sessions.validate(session.accessToken, config.internalAudience),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('never persists the raw session token', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    const session = await sessions.establish(evidence);
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT * FROM a2_workforce_sessions',
    );
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(session.accessToken);
  });

  it('requires MFA assurance before a privileged session is issued', async () => {
    const evidence = await oidc.validate(signJwt(assertionPayload()));
    await expect(
      sessions.establish({ ...evidence, assuranceLevel: 'SINGLE_FACTOR' as never }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM a2_workforce_sessions',
    );
    expect(rows).toHaveLength(0);
  });

  it('remains provider-neutral: configuration carries no provider-specific identifiers', () => {
    const serialised = JSON.stringify(config).toLowerCase();
    expect(serialised).not.toContain('google');
    expect(serialised).not.toContain('googleapis');
    expect(serialised).not.toContain('accounts.google.com');
    expect(config.oidcJwksUri).toBe(jwksUri);
  });
});
