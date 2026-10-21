/**
 * V1-BOOTSTRAP-IMPLEMENTATION-01 — offline statement generator ↔ existing verifier (real PostgreSQL).
 *
 * Proves the NEW tooling contract against the EXISTING production verification path
 * (A2FinanceRoleAdministrationService.consumeBootstrap) with NO changes to production
 * auth code, NO mocks of PostgreSQL, NO permanent users, and ephemeral RSA keys only.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { canonical } from '../src/authorization/workforce-crypto';
import type { A2BootstrapStatementV1 } from '../src/authorization/workforce-authentication.types';
import { readFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { A2FinanceRoleAdministrationService } from '../src/authorization/finance-role-administration.service';
import { AuthorizationCatalogueRuntimeService } from '../src/authorization-catalogue/authorization-catalogue-runtime.service';
import { AuthorizationRole } from '../src/authorization-catalogue/authorization-role.entity';
import { AuthorizationRoleFunction } from '../src/authorization-catalogue/authorization-role-function.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import type {
  A2TrustedJwkV1,
  A2WorkforceConfigurationV1,
} from '../src/authorization/workforce-authentication.types';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { generateBootstrapStatement } from '../scripts/generate-bootstrap-statement';

describe('V1-WORKFORCE-BOOTSTRAP-01 — generator vs existing verifier (real PG)', () => {
  let dataSource: DataSource;
  let config: A2WorkforceConfigurationV1;
  let roles: A2FinanceRoleAdministrationService;
  let privateKey: KeyObject;
  let publicJwk: A2TrustedJwkV1;

  const ISSUER = 'https://idp.v1-bootstrap.test';
  const SUBJECT = `workforce-operator-bootstrap`;
  const AUDIENCE = 'monienaija-v1-bootstrap';
  const ENV = 'development';
  const KID = 'bootstrap-v1-01';

  const principalFor = (issuer: string, subject: string): AuthorizationPrincipal => ({
    type: 'OPERATOR',
    principalId: `${issuer}:${subject}`,
    audience: 'workforce-admin',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  });

  const baseInput = () => ({
    privateKey,
    kid: KID,
    environment: ENV,
    issuer: ISSUER,
    subject: SUBJECT,
    audience: AUDIENCE,
    scopes: ['privileged:execute'],
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    approvalChangeReference: 'CHG-V1-BOOTSTRAP-001',
  });

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1wbootstrap');
    // Ephemeral keypair, generated in-test exactly like the existing a2 suites do.
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    publicJwk = {
      ...(pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: KID,
      alg: 'RS256',
      use: 'sig',
      environment: ENV,
    } as A2TrustedJwkV1;
    config = workforceConfiguration({
      NODE_ENV: ENV,
      A2_WORKFORCE_ENABLED: 'true',
      A2_WORKFORCE_OIDC_ISSUER: 'https://oidc.v1-bootstrap.test',
      A2_WORKFORCE_OIDC_JWKS_URI: 'https://oidc.v1-bootstrap.test/jwks',
      A2_WORKFORCE_OIDC_AUDIENCE: 'monienaija-workforce',
      A2_WORKFORCE_OIDC_CLIENT_ID: 'monienaija-admin-console',
      A2_WORKFORCE_INTERNAL_AUDIENCE: 'workforce-admin',
      A2_BOOTSTRAP_ENABLED: 'true',
      A2_BOOTSTRAP_ISSUER: 'monienaija-v1-bootstrap-operator',
      A2_BOOTSTRAP_AUDIENCE: AUDIENCE,
      A2_BOOTSTRAP_JWKS_JSON: JSON.stringify([publicJwk]),
      A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['privileged:execute']),
      A2_FINANCE_ROLES_JSON: JSON.stringify([
        {
          roleKey: 'SUPER_ADMIN',
          displayName: 'Super Administrator',
          description: 'Bootstrap-granted privileged administration.',
          enabled: true,
          scopes: ['privileged:execute'],
          applicableActions: ['FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE'],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: true,
          checkerEligible: false,
          administrativeCapability: true,
        },
        {
          roleKey: 'FINANCE_PREPARER',
          displayName: 'Finance Preparer',
          description: 'Initiates finance control changes.',
          enabled: true,
          scopes: ['finance:prepare'],
          applicableActions: ['FINANCE_CONTROL_POLICY_ACTIVATE'],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: true,
          checkerEligible: false,
          administrativeCapability: false,
        },
        {
          roleKey: 'FINANCE_CONTROLLER',
          displayName: 'Finance Controller',
          description: 'Approves finance role/control changes.',
          enabled: true,
          scopes: ['privileged:approve', 'privileged:execute'],
          applicableActions: [
            'FINANCE_ROLE_ASSIGN',
            'FINANCE_ROLE_REVOKE',
            'FINANCE_CONTROL_POLICY_ACTIVATE',
          ],
          mfaRequired: true,
          approvalCapability: true,
          makerEligible: false,
          checkerEligible: true,
          administrativeCapability: false,
        },
        {
          roleKey: 'FINANCE_AUDITOR',
          displayName: 'Finance Auditor',
          description: 'Read-oriented assurance role.',
          enabled: true,
          scopes: ['finance:audit'],
          applicableActions: [],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: false,
          checkerEligible: false,
          administrativeCapability: false,
        },
        {
          roleKey: 'ADMINISTRATOR',
          displayName: 'Administrator',
          description: 'Delegated workforce administration; no finance or super-admin authority.',
          enabled: true,
          scopes: [],
          applicableActions: [],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: false,
          checkerEligible: false,
          administrativeCapability: false,
        },
      ]),
      A2_MAKER_CHECKER_RULES_JSON: JSON.stringify([
        {
          action: 'FINANCE_ROLE_ASSIGN',
          initiatingRoles: ['SUPER_ADMIN'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
        {
          action: 'FINANCE_ROLE_REVOKE',
          initiatingRoles: ['SUPER_ADMIN'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
        {
          action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
          initiatingRoles: ['FINANCE_PREPARER'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
      ]),
      A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify(
        ['workforce-authentication', 'workforce-bootstrap', 'finance-role-administration', 'privileged-approval'].map(
          (category) => ({ category, capacity: 100, refillRatePerSecond: 50, enabled: true }),
        ),
      ),
      A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['127.0.0.1', '::1/128']),
    });
    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const approvals = new PrivilegedActionApprovalService(
      dataSource.getRepository(PrivilegedActionApproval),
      dataSource.getRepository(SecurityEventHistory),
      dataSource,
      audit,
      new AuthorizationService(dataSource, audit),
    );
    const catalogue = new AuthorizationCatalogueRuntimeService(
      dataSource.getRepository(AuthorizationRole),
      dataSource.getRepository(AuthorizationRoleFunction),
    );
    roles = new A2FinanceRoleAdministrationService(dataSource, audit, approvals, config, catalogue);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  it('1. statement produced by the offline generator is accepted by the EXISTING verifier and creates the one-time SUPER_ADMIN', async () => {
    const { statement, selfCheck } = generateBootstrapStatement(baseInput());
    expect(selfCheck).toBe('OK');
    const view = await roles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT));
    expect(view.roleKey).toBe('SUPER_ADMIN');
    expect(view.status).toBe('ACTIVE');
    expect(view.principalId).toBe(`${ISSUER}:${SUBJECT}`);
    expect(view.scopes).toEqual(['privileged:execute']);
    expect(view.bootstrapReference).toMatch(/^a2-bootstrap-/);
    const rows = await dataSource.query(
      `SELECT role_key, status FROM a2_finance_role_assignments`,
    );
    expect(rows).toEqual([{ role_key: 'SUPER_ADMIN', status: 'ACTIVE' }]);
  });

  it('2. wrong identity fails closed (statement principal does not match the calling session principal)', async () => {
    const { statement } = generateBootstrapStatement(baseInput());
    // Statement binds ISSUER:SUBJECT — a DIFFERENT authenticated principal must be rejected.
    await expect(
      roles.consumeBootstrap(statement, principalFor(ISSUER, `attacker-${SUBJECT}`)),
    ).rejects.toThrow(/mismatch/i);
  });

  it('3. wrong scope fails closed (scopes must exactly equal the configured SUPER_ADMIN scopes)', async () => {
    const { statement } = generateBootstrapStatement({
      ...baseInput(),
      scopes: ['privileged:execute', 'finance:prepare'],
    });
    await expect(
      roles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/role or scopes not allowed/i);
  });

  it('4. expired and not-yet-valid statements fail closed (tool refuses to emit; server rejects)', async () => {
    // (a) Tool boundary: the generator itself refuses to emit an invalid-window statement.
    expect(() =>
      generateBootstrapStatement({
        ...baseInput(),
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        effectiveTo: new Date(Date.now() - 1_800_000).toISOString(),
        issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_800_000).toISOString(),
      }),
    ).toThrow(/outside validity|in the past/i);
    expect(() =>
      generateBootstrapStatement({
        ...baseInput(),
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
        effectiveTo: new Date(Date.now() + 7_200_000).toISOString(),
        expiresAt: new Date(Date.now() + 7_260_000).toISOString(),
      }),
    ).toThrow(/in the future|not yet valid/i);
    // (b) Server boundary: a directly-signed EXPIRED statement (bypassing the tool's guard,
    // as an external signer could produce) is rejected by the production verifier.
    const expiredWire = signStatementDirect({
      schemaVersion: 1,
      environment: ENV,
      issuer: ISSUER,
      workforceSubject: SUBJECT,
      principalId: `${ISSUER}:${SUBJECT}`,
      initialRoleKey: 'SUPER_ADMIN',
      scopes: ['privileged:execute'],
      effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
      effectiveTo: new Date(Date.now() - 1_800_000).toISOString(),
      audience: AUDIENCE,
      approvalChangeReference: 'CHG-V1-BOOTSTRAP-001',
      nonce: `nonce-expired-${Date.now()}`,
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() - 1_800_000).toISOString(),
      signingKeyReference: KID,
    });
    await expect(
      roles.consumeBootstrap(expiredWire, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/outside validity/i);
    // (c) Server boundary: not-yet-issued statement rejected.
    const notYetIssued = generateBootstrapStatement({
      ...baseInput(),
      issuedAt: new Date(Date.now() + 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    });
    await expect(
      roles.consumeBootstrap(notYetIssued.statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/outside validity/i);
  });

  it('5. replay and nonce-consumption remain protected after success', async () => {
    const { statement } = generateBootstrapStatement(baseInput());
    await roles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT));
    // Exact replay → replayed/conflict (one-time guard fires first once admin exists:
    // either rejection is a fail-closed outcome; assert it never succeeds again).
    await expect(
      roles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/already completed|replayed|conflict/i);
    // Second, different statement (new nonce) → completion guard still refuses.
    const second = generateBootstrapStatement(baseInput());
    await expect(
      roles.consumeBootstrap(second.statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/already completed/i);
  });

  it('6. malformed input fails safely', async () => {
    await expect(
      roles.consumeBootstrap('not-a-jws', principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/Malformed|compact|JWS/i);
    await expect(
      roles.consumeBootstrap('a.b.c', principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow();
    await expect(roles.consumeBootstrap('', principalFor(ISSUER, SUBJECT))).rejects.toThrow();
  });

  it('7. generator output never carries private key material (statement, JSON, or public JWK)', () => {
    const result = generateBootstrapStatement(baseInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('BEGIN');
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(result.publicJwk.kty).toBe('RSA');
    expect(serialized).not.toContain('"d"'); // JWK private parameter
  });

  it('8. MFA assurance remains mandatory for bootstrap', async () => {
    const { statement } = generateBootstrapStatement(baseInput());
    const passwordOnly: AuthorizationPrincipal = { ...principalFor(ISSUER, SUBJECT), assuranceLevel: 'PASSWORD' };
    await expect(roles.consumeBootstrap(statement, passwordOnly)).rejects.toThrow(
      /Bootstrap requires MFA/i,
    );
  });

  it('9. statement is environment-bound: a statement minted for another environment is rejected', async () => {
    const { statement } = generateBootstrapStatement({ ...baseInput(), environment: 'staging' });
    await expect(
      roles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/Unknown bootstrap signing key|mismatch/i);
  });

  it('10. bootstrap window closed: server-side config disable fails closed', async () => {
    const closed: A2WorkforceConfigurationV1 = { ...config, bootstrapEnabled: false };
    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const closedRoles = new A2FinanceRoleAdministrationService(
      dataSource,
      audit,
      new PrivilegedActionApprovalService(
        dataSource.getRepository(PrivilegedActionApproval),
        dataSource.getRepository(SecurityEventHistory),
        dataSource,
        audit,
        new AuthorizationService(dataSource, audit),
      ),
      closed,
      new AuthorizationCatalogueRuntimeService(
        dataSource.getRepository(AuthorizationRole),
        dataSource.getRepository(AuthorizationRoleFunction),
      ),
    );
    const { statement } = generateBootstrapStatement(baseInput());
    await expect(
      closedRoles.consumeBootstrap(statement, principalFor(ISSUER, SUBJECT)),
    ).rejects.toThrow(/Bootstrap disabled/i);
  });

  it('11. env template ships a VALID production policy set (validated by the real config parser)', () => {
    const env: Record<string, string> = {};
    // V1-TEST-01: the "docs: reorganize V1 documentation" commit (ce6a059) moved this
    // template from docs/config/ to docs/deployment/config/ without updating this test's
    // hardcoded path, which left the suite failing with ENOENT — a doc-reorg path drift,
    // not a defect in the template or the config parser it validates.
    for (const raw of readFileSync(
      'docs/deployment/config/v1-workforce-bootstrap.env.template',
      'utf8',
    ).split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      env[line.slice(0, eq)] = line.slice(eq + 1);
    }
    // Simulate the controlled bootstrap window exactly as the runbook instructs:
    env['A2_BOOTSTRAP_ENABLED'] = 'true';
    env['A2_BOOTSTRAP_JWKS_JSON'] = JSON.stringify([publicJwkForTemplate()]);
    const cfg = workforceConfiguration(env);
    expect(cfg.enabled).toBe(true);
    expect(cfg.roles.map((r) => r.roleKey).sort()).toEqual(
      ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'FINANCE_CONTROLLER', 'FINANCE_PREPARER', 'ADMINISTRATOR'].sort(),
    );
    expect(cfg.bootstrapFinanceAdminScopes).toEqual(['privileged:execute']);
    // Invariant: bootstrap scopes exactly match SUPER_ADMIN scopes.
    const admin = cfg.roles.find((r) => r.roleKey === 'SUPER_ADMIN')!;
    expect([...admin.scopes].sort()).toEqual([...cfg.bootstrapFinanceAdminScopes].sort());
    expect(cfg.makerCheckerRules.map((r) => r.action).sort()).toEqual(
      ['FINANCE_CONTROL_POLICY_ACTIVATE', 'FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE'],
    );
    expect(
      ['workforce-authentication', 'workforce-bootstrap', 'finance-role-administration', 'privileged-approval'].every(
        (c) => cfg.rateLimits.some((r) => r.category === c && r.enabled),
      ),
    ).toBe(true);
    // And the shipped default (disabled bootstrap) must parse as well.
    delete env['A2_BOOTSTRAP_ENABLED'];
    delete env['A2_BOOTSTRAP_JWKS_JSON'];
    expect(workforceConfiguration(env).bootstrapEnabled).toBe(false);
  });

  function publicJwkForTemplate(): A2TrustedJwkV1 {
    return { ...publicJwk, environment: 'production' };
  }

  /** Direct (tool-bypassing) signer for negative fixtures — same wire format, any payload. */
  function signStatementDirect(payload: A2BootstrapStatementV1): string {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })).toString(
      'base64url',
    );
    const body = Buffer.from(canonical(payload)).toString('base64url');
    const input = `${head}.${body}`;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return `${input}.${signer.sign(privateKey).toString('base64url')}`;
  }
});
