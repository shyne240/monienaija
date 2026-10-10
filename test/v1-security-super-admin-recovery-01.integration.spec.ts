/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — Protected CEO Recovery (real PostgreSQL).
 *
 * Proves the offline statement generator (scripts/generate-revocation-statement.ts) against the
 * production verifier/consumer (SuperAdminRecoveryService.consumeRevocation) with NO mocks of
 * PostgreSQL, ephemeral RSA test-only keys only, and no production credentials of any kind.
 *
 * Every signing key used in this file is generated in-process for this test run and discarded —
 * see generateKeyPairSync() calls below. None of them are, or resemble, production secrets.
 */
import { createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { AuthorizationService } from '../src/authorization/authorization.service';
import {
  A2FinanceRoleAdministrationService,
  financeRoleAssignmentReference,
} from '../src/authorization/finance-role-administration.service';
import { SuperAdminRecoveryService } from '../src/authorization/super-admin-recovery.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { AuthorizationCatalogueRuntimeService } from '../src/authorization-catalogue/authorization-catalogue-runtime.service';
import { AuthorizationRole } from '../src/authorization-catalogue/authorization-role.entity';
import { AuthorizationRoleFunction } from '../src/authorization-catalogue/authorization-role-function.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { canonical } from '../src/authorization/workforce-crypto';
import {
  A2FinanceRoleAssignment,
  A2SuperAdminRecoveryConsumption,
  A2WorkforceSession,
} from '../src/authorization/workforce-authentication.entity';
import type {
  A2RecoveryStatementV1,
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
import { generateRevocationStatement } from '../scripts/generate-revocation-statement';
import { generateBootstrapStatement } from '../scripts/generate-bootstrap-statement';

describe('V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — Protected CEO Recovery (real PG)', () => {
  let dataSource: DataSource;
  let config: A2WorkforceConfigurationV1;
  let roles: A2FinanceRoleAdministrationService;
  let sessions: A2WorkforceSessionService;
  let recovery: SuperAdminRecoveryService;
  let audit: AuditService;

  let bootstrapPrivateKey: KeyObject;
  let bootstrapPublicJwk: A2TrustedJwkV1;
  let recoveryPrivateKey: KeyObject;
  let recoveryPublicJwk: A2TrustedJwkV1;
  let untrustedPrivateKey: KeyObject;

  const ENV = 'development';
  const ISSUER = 'https://idp.v1-recovery.test';
  const SUBJECT = 'workforce-super-admin-recovery';
  const SUPER_ADMIN_PRINCIPAL_ID = `${ISSUER}:${SUBJECT}`;
  const BOOTSTRAP_KID = 'bootstrap-v1-recovery-01';
  const RECOVERY_KID = 'recovery-v1-01';
  const BOOTSTRAP_AUDIENCE = 'monienaija-v1-recovery-bootstrap';
  const RECOVERY_AUDIENCE = 'monienaija-v1-super-admin-recovery';

  const administratorPrincipal: AuthorizationPrincipal = {
    type: 'PRIVILEGED',
    principalId: 'administrator-01',
    audience: 'workforce-admin',
    roles: ['ADMINISTRATOR'],
    scopes: [],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };

  const bootstrapPrincipal: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: SUPER_ADMIN_PRINCIPAL_ID,
    audience: 'workforce-admin',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };

  const baseRecoveryInput = () => ({
    privateKey: recoveryPrivateKey,
    kid: RECOVERY_KID,
    environment: ENV,
    audience: RECOVERY_AUDIENCE,
    targetPrincipalId: SUPER_ADMIN_PRINCIPAL_ID,
    reason: 'Board-approved CEO succession; see CHG-V1-RECOVERY-001',
    nonce: `recovery-nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    approvalChangeReference: 'CHG-V1-RECOVERY-001',
  });

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1recovery');

    const bootstrapPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    bootstrapPrivateKey = bootstrapPair.privateKey;
    bootstrapPublicJwk = {
      ...(bootstrapPair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: BOOTSTRAP_KID,
      alg: 'RS256',
      use: 'sig',
      environment: ENV,
    } as A2TrustedJwkV1;

    const recoveryPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    recoveryPrivateKey = recoveryPair.privateKey;
    recoveryPublicJwk = {
      ...(recoveryPair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: RECOVERY_KID,
      alg: 'RS256',
      use: 'sig',
      environment: ENV,
    } as A2TrustedJwkV1;

    // A structurally unrelated keypair: NEVER registered in A2_RECOVERY_JWKS_JSON. Used to prove
    // an ordinary administrator (who has no access to the real recovery private key) cannot
    // fabricate a statement the verifier will accept, even using the identical wire format.
    untrustedPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

    config = workforceConfiguration({
      NODE_ENV: ENV,
      A2_WORKFORCE_ENABLED: 'true',
      A2_WORKFORCE_OIDC_ISSUER: 'https://oidc.v1-recovery.test',
      A2_WORKFORCE_OIDC_JWKS_URI: 'https://oidc.v1-recovery.test/jwks',
      A2_WORKFORCE_OIDC_AUDIENCE: 'monienaija-workforce',
      A2_WORKFORCE_OIDC_CLIENT_ID: 'monienaija-admin-console',
      A2_WORKFORCE_INTERNAL_AUDIENCE: 'workforce-admin',
      A2_BOOTSTRAP_ENABLED: 'true',
      A2_BOOTSTRAP_ISSUER: 'monienaija-v1-recovery-operator',
      A2_BOOTSTRAP_AUDIENCE: BOOTSTRAP_AUDIENCE,
      A2_BOOTSTRAP_JWKS_JSON: JSON.stringify([bootstrapPublicJwk]),
      A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['privileged:execute']),
      // V1-SECURITY-SUPER-ADMIN-RECOVERY-01: independent trust configuration — a DIFFERENT
      // keypair from the bootstrap one above, proving the two ceremonies do not share custody.
      A2_RECOVERY_ENABLED: 'true',
      A2_RECOVERY_AUDIENCE: RECOVERY_AUDIENCE,
      A2_RECOVERY_JWKS_JSON: JSON.stringify([recoveryPublicJwk]),
      A2_FINANCE_ROLES_JSON: JSON.stringify([
        {
          roleKey: 'SUPER_ADMIN',
          displayName: 'Super Administrator',
          description: 'Protected CEO role.',
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
        [
          'workforce-authentication',
          'workforce-bootstrap',
          'finance-role-administration',
          'privileged-approval',
        ].map((category) => ({ category, capacity: 100, refillRatePerSecond: 50, enabled: true })),
      ),
      A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['127.0.0.1', '::1/128']),
    });

    audit = new AuditService(dataSource.getRepository(AuditEvent));
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
    sessions = new A2WorkforceSessionService(dataSource, audit, catalogue, config);
    recovery = new SuperAdminRecoveryService(dataSource, audit, sessions, config);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /** Bootstraps the one ACTIVE SUPER_ADMIN this suite's recovery statements target. */
  async function bootstrapSuperAdmin(): Promise<void> {
    const { statement } = generateBootstrapStatement({
      privateKey: bootstrapPrivateKey,
      kid: BOOTSTRAP_KID,
      environment: ENV,
      issuer: ISSUER,
      subject: SUBJECT,
      audience: BOOTSTRAP_AUDIENCE,
      scopes: ['privileged:execute'],
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
      nonce: `bootstrap-nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      approvalChangeReference: 'CHG-V1-RECOVERY-BOOTSTRAP',
    });
    await roles.consumeBootstrap(statement, bootstrapPrincipal);
  }

  /** Creates an ACTIVE workforce session row for the given principal (for revocation checks). */
  async function createActiveSession(principalId: string): Promise<string> {
    const r = dataSource.getRepository(A2WorkforceSession);
    const row = await r.save(
      r.create({
        id: randomUUID(),
        principalId,
        issuer: ISSUER,
        subject: SUBJECT,
        tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        audience: 'workforce-admin',
        status: 'ACTIVE',
        assuranceLevel: 'MFA',
        roles: ['SUPER_ADMIN'],
        scopes: ['privileged:execute'],
        assertionEvidence: {
          issuer: ISSUER,
          subject: SUBJECT,
          principalId,
          audience: ['workforce-admin'],
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          authenticatedAt: new Date().toISOString(),
          assuranceLevel: 'MFA',
          amr: ['mfa'],
          acr: null,
          signingKeyId: 'test',
        },
        authenticatedAt: new Date(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
        lastSeenAt: new Date(),
        revokedAt: null,
        revokeReason: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    return row.id;
  }

  /** Direct (tool-bypassing) signer for negative fixtures — same wire format, any payload/key. */
  function signStatementDirect(payload: A2RecoveryStatementV1, key: KeyObject, kid: string): string {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString(
      'base64url',
    );
    const body = Buffer.from(canonical(payload)).toString('base64url');
    const input = `${head}.${body}`;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return `${input}.${signer.sign(key).toString('base64url')}`;
  }

  it('1. valid externally-signed statement is consumed: SUPER_ADMIN revoked, sessions revoked, audit recorded, atomically', async () => {
    await bootstrapSuperAdmin();
    const sessionId = await createActiveSession(SUPER_ADMIN_PRINCIPAL_ID);
    const { statement, selfCheck } = generateRevocationStatement(baseRecoveryInput());
    expect(selfCheck).toBe('OK');

    const view = await recovery.consumeRevocation(statement, administratorPrincipal);
    expect(view.operation).toBe('REVOKE_SUPER_ADMIN');
    expect(view.targetPrincipalId).toBe(SUPER_ADMIN_PRINCIPAL_ID);
    expect(view.revokedSessionCount).toBe(1);
    expect(view.consumedBy).toBe(administratorPrincipal.principalId);
    expect(view.recoveryReference).toMatch(/^a2-recovery-/);

    const assignmentRows = await dataSource.query(
      `SELECT role_key, status, revoked_by FROM a2_finance_role_assignments WHERE role_key = 'SUPER_ADMIN'`,
    );
    expect(assignmentRows).toEqual([
      { role_key: 'SUPER_ADMIN', status: 'REVOKED', revoked_by: `recovery:${administratorPrincipal.principalId}` },
    ]);

    const session = await dataSource
      .getRepository(A2WorkforceSession)
      .findOne({ where: { id: sessionId } });
    expect(session?.status).toBe('REVOKED');

    const auditRows = await dataSource.query(
      `SELECT action FROM audit_events WHERE action = 'SUPER_ADMIN_REVOKED'`,
    );
    expect(auditRows).toHaveLength(1);

    const consumptionRows = await dataSource.query(
      `SELECT operation, target_principal_id, consumed_by FROM a2_super_admin_recovery_consumptions`,
    );
    expect(consumptionRows).toEqual([
      {
        operation: 'REVOKE_SUPER_ADMIN',
        target_principal_id: SUPER_ADMIN_PRINCIPAL_ID,
        consumed_by: administratorPrincipal.principalId,
      },
    ]);
  });

  it('2. invalid signature / unknown signing key fails closed', async () => {
    await bootstrapSuperAdmin();
    const input = baseRecoveryInput();
    // Signed with a key never registered in A2_RECOVERY_JWKS_JSON, using the exact same kid the
    // trusted key uses — proves the server matches on the ACTUAL key material, not merely the kid.
    const payload: A2RecoveryStatementV1 = {
      schemaVersion: 1,
      operation: 'REVOKE_SUPER_ADMIN',
      environment: ENV,
      audience: RECOVERY_AUDIENCE,
      targetAssignmentReference: financeRoleAssignmentReference(
        SUPER_ADMIN_PRINCIPAL_ID,
        'SUPER_ADMIN',
        ENV,
      ),
      targetPrincipalId: SUPER_ADMIN_PRINCIPAL_ID,
      reason: input.reason,
      approvalChangeReference: input.approvalChangeReference,
      nonce: input.nonce,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      signingKeyReference: RECOVERY_KID,
    };
    const forged = signStatementDirect(payload, untrustedPrivateKey, RECOVERY_KID);
    await expect(recovery.consumeRevocation(forged, administratorPrincipal)).rejects.toThrow(
      /Invalid RS256 signature/i,
    );
  });

  it('2b. an entirely unregistered key id is rejected before any signature check', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement({
      ...baseRecoveryInput(),
      privateKey: untrustedPrivateKey,
      kid: 'never-registered-kid',
    });
    await expect(recovery.consumeRevocation(statement, administratorPrincipal)).rejects.toThrow(
      /Unknown recovery signing key/i,
    );
  });

  it('3. expired statement fails closed', async () => {
    await bootstrapSuperAdmin();
    const input = baseRecoveryInput();
    const payload: A2RecoveryStatementV1 = {
      schemaVersion: 1,
      operation: 'REVOKE_SUPER_ADMIN',
      environment: ENV,
      audience: RECOVERY_AUDIENCE,
      targetAssignmentReference: financeRoleAssignmentReference(
        SUPER_ADMIN_PRINCIPAL_ID,
        'SUPER_ADMIN',
        ENV,
      ),
      targetPrincipalId: SUPER_ADMIN_PRINCIPAL_ID,
      reason: input.reason,
      approvalChangeReference: input.approvalChangeReference,
      nonce: input.nonce,
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() - 1_800_000).toISOString(),
      signingKeyReference: RECOVERY_KID,
    };
    const expired = signStatementDirect(payload, recoveryPrivateKey, RECOVERY_KID);
    await expect(recovery.consumeRevocation(expired, administratorPrincipal)).rejects.toThrow(
      /outside validity/i,
    );
    // The generator itself also refuses to emit an already-expired statement.
    expect(() =>
      generateRevocationStatement({
        ...baseRecoveryInput(),
        issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_800_000).toISOString(),
      }),
    ).toThrow(/in the past/i);
  });

  it('4. malformed statement fails safely', async () => {
    await bootstrapSuperAdmin();
    await expect(
      recovery.consumeRevocation('not-a-jws', administratorPrincipal),
    ).rejects.toThrow(/Malformed|compact|JWS/i);
    await expect(recovery.consumeRevocation('a.b.c', administratorPrincipal)).rejects.toThrow();
    await expect(recovery.consumeRevocation('', administratorPrincipal)).rejects.toThrow();
  });

  it('5. wrong-purpose statement (operation other than REVOKE_SUPER_ADMIN) fails closed', async () => {
    await bootstrapSuperAdmin();
    const input = baseRecoveryInput();
    const payload = {
      schemaVersion: 1,
      operation: 'GRANT_SUPER_ADMIN',
      environment: ENV,
      audience: RECOVERY_AUDIENCE,
      targetAssignmentReference: financeRoleAssignmentReference(
        SUPER_ADMIN_PRINCIPAL_ID,
        'SUPER_ADMIN',
        ENV,
      ),
      targetPrincipalId: SUPER_ADMIN_PRINCIPAL_ID,
      reason: input.reason,
      approvalChangeReference: input.approvalChangeReference,
      nonce: input.nonce,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      signingKeyReference: RECOVERY_KID,
    } as unknown as A2RecoveryStatementV1;
    const wrongPurpose = signStatementDirect(payload, recoveryPrivateKey, RECOVERY_KID);
    await expect(
      recovery.consumeRevocation(wrongPurpose, administratorPrincipal),
    ).rejects.toThrow(/mismatch/i);
  });

  it('6. wrong-target statement (names a principal/reference that is not the active SUPER_ADMIN) is rejected without mutating anything', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement({
      ...baseRecoveryInput(),
      targetPrincipalId: 'https://idp.v1-recovery.test:someone-else-entirely',
    });
    await expect(recovery.consumeRevocation(statement, administratorPrincipal)).rejects.toThrow(
      /No matching active SUPER_ADMIN/i,
    );
    const rows = await dataSource.query(
      `SELECT status FROM a2_finance_role_assignments WHERE role_key = 'SUPER_ADMIN'`,
    );
    expect(rows).toEqual([{ status: 'ACTIVE' }]); // untouched
    const consumptionRows = await dataSource.query(
      `SELECT count(*)::int AS c FROM a2_super_admin_recovery_consumptions`,
    );
    expect(consumptionRows[0].c).toBe(0); // atomic: nothing persisted on failure
  });

  it('7. replayed statement is rejected after a successful consumption (sequential)', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    await recovery.consumeRevocation(statement, administratorPrincipal);
    await expect(recovery.consumeRevocation(statement, administratorPrincipal)).rejects.toThrow(
      /replayed|No matching active SUPER_ADMIN/i,
    );
  });

  it('8. concurrently-consumed statement: exactly one of two simultaneous attempts succeeds', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    const results = await Promise.allSettled([
      recovery.consumeRevocation(statement, administratorPrincipal),
      recovery.consumeRevocation(statement, administratorPrincipal),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rows = await dataSource.query(
      `SELECT status FROM a2_finance_role_assignments WHERE role_key = 'SUPER_ADMIN'`,
    );
    expect(rows).toEqual([{ status: 'REVOKED' }]);
    const consumptionRows = await dataSource.query(
      `SELECT count(*)::int AS c FROM a2_super_admin_recovery_consumptions`,
    );
    expect(consumptionRows[0].c).toBe(1);
  });

  it('9. unauthorized workforce principal (not ADMINISTRATOR) cannot trigger consumption, even with a valid statement', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    const operations: AuthorizationPrincipal = {
      ...administratorPrincipal,
      principalId: 'operations-01',
      roles: ['OPERATIONS'],
    };
    await expect(recovery.consumeRevocation(statement, operations)).rejects.toThrow(
      /ADMINISTRATOR role/i,
    );
    const rows = await dataSource.query(
      `SELECT status FROM a2_finance_role_assignments WHERE role_key = 'SUPER_ADMIN'`,
    );
    expect(rows).toEqual([{ status: 'ACTIVE' }]);
  });

  it('10. attempted self-authorization: the targeted SUPER_ADMIN principal cannot trigger its own revocation, even holding a genuinely valid statement', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    const superAdminActing: AuthorizationPrincipal = {
      ...administratorPrincipal,
      principalId: SUPER_ADMIN_PRINCIPAL_ID,
      roles: ['SUPER_ADMIN'], // no ADMINISTRATOR role
    };
    await expect(recovery.consumeRevocation(statement, superAdminActing)).rejects.toThrow(
      /ADMINISTRATOR role/i,
    );
  });

  it('11. attempted fabrication by an ordinary administrator: a self-signed, unregistered-key "statement" is rejected', async () => {
    await bootstrapSuperAdmin();
    // The administrator (who holds no recovery private key) tries to mint their own statement
    // with a freshly-generated key of their own — exactly what an attacker with ordinary
    // Admin Web access, but no access to the offline signing ceremony, would attempt.
    const selfMinted = generateRevocationStatement({
      ...baseRecoveryInput(),
      privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
      kid: RECOVERY_KID, // even reusing the real trusted kid does not help without the real key
    });
    await expect(
      recovery.consumeRevocation(selfMinted.statement, administratorPrincipal),
    ).rejects.toThrow(/Invalid RS256 signature/i);
  });

  it('12. missing/unsafe crypto configuration fails closed: recovery disabled', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    const disabledConfig: A2WorkforceConfigurationV1 = { ...config, recoveryEnabled: false };
    const disabledRecovery = new SuperAdminRecoveryService(dataSource, audit, sessions, disabledConfig);
    await expect(
      disabledRecovery.consumeRevocation(statement, administratorPrincipal),
    ).rejects.toThrow(/Recovery disabled/i);
  });

  it('13. MFA assurance remains mandatory for recovery consumption', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement(baseRecoveryInput());
    const passwordOnly: AuthorizationPrincipal = {
      ...administratorPrincipal,
      assuranceLevel: 'PASSWORD',
    };
    await expect(recovery.consumeRevocation(statement, passwordOnly)).rejects.toThrow(/MFA/i);
  });

  it('14. statement is environment-bound: a statement minted for another environment is rejected', async () => {
    await bootstrapSuperAdmin();
    const { statement } = generateRevocationStatement({ ...baseRecoveryInput(), environment: 'staging' });
    await expect(recovery.consumeRevocation(statement, administratorPrincipal)).rejects.toThrow(
      /Unknown recovery signing key|mismatch/i,
    );
  });

  it('15. generator output never carries private key material', () => {
    const result = generateRevocationStatement(baseRecoveryInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('BEGIN');
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(result.publicJwk.kty).toBe('RSA');
    expect(serialized).not.toContain('"d"');
  });

  it('16. preserves ordinary SUPER_ADMIN assignment/revocation restrictions — unchanged by this feature', async () => {
    await bootstrapSuperAdmin();
    await expect(
      roles.assign({
        targetPrincipalId: 'someone-new',
        roleKey: 'SUPER_ADMIN',
        effectiveFrom: new Date().toISOString(),
        effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
        principal: administratorPrincipal,
        correlationId: 'test',
      }),
    ).rejects.toThrow(/not allowed|prohibited/i);
    await expect(
      roles.revoke({
        targetPrincipalId: SUPER_ADMIN_PRINCIPAL_ID,
        roleKey: 'SUPER_ADMIN',
        effectiveFrom: new Date().toISOString(),
        effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
        principal: administratorPrincipal,
        correlationId: 'test',
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('17. the workforce.super_admin.recover catalogue function is granted to ADMINISTRATOR only', async () => {
    const rows: Array<{ role_key: string }> = await dataSource.query(
      `SELECT r.role_key FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
        WHERE rf.function_code = 'workforce.super_admin.recover' AND rf.is_active = true`,
    );
    expect(rows.map((r) => r.role_key)).toEqual(['ADMINISTRATOR']);
  });
});
