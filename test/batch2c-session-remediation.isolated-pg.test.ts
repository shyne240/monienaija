import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerAuthenticationService } from '../src/customer-authentication/customer-authentication.service';
import { PasswordHashAlgorithm } from '../src/customer-authentication/customer-authentication.enums';
import { MobileOnboardingAuthService } from '../src/customer-registration/mobile-onboarding-auth.service';
import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
} from '../src/customer/customer.enums';
import { CustomerService } from '../src/customer/customer.service';
import type { TierEvidenceSnapshot } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierTransitionService } from '../src/kyc-verification/kyc-tier-transition.service';
import { PostgresKycStore } from '../src/kyc-verification/postgres-kyc.store';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';

// Portable provenance: see test/support/kyc-isolated-cluster.ts. The cluster's identity is
// proven from the runner-written marker + manifest and from the server's own settings, so no
// machine-specific absolute path is embedded here and the suite is runnable in CI.
const cluster = isolatedKycCluster();
const socket = cluster.socketDirectory;

const databaseName = `kyc_batch2c_auth_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: socket,
  port: cluster.port,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  migrationsRun: false,
  entities: [],
  migrations: [],
});

let created = false;
let db: DataSource;
let app: NestFastifyApplication;
const sms = new TestNotificationProvider();
const snapshots = new Map<string, TierEvidenceSnapshot>();
let phoneCounter = 1000000;

function nextNormalizedPhone(): string {
  phoneCounter += 1;
  return `809${String(phoneCounter).padStart(7, '0')}`;
}

function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(secret, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

const kycReviewerPrincipal: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: '00000000-0000-4000-8000-000000000099',
  sessionId: '00000000-0000-4000-8000-000000000098',
  roles: ['COMPLIANCE_LEAD'],
  scopes: ['kyc.review', 'kyc.approve', 'kyc.reject'],
  assuranceLevel: 'MFA',
  customerAccess: 'NONE',
  agentAccess: 'NONE',
  aggregatorAccess: 'NONE',
};

beforeAll(async () => {
  await admin.initialize();
  // Provenance (marker + manifest + data_directory match + socket-only + minimum server
  // version) is asserted by the shared helper instead of a hardcoded path regex.
  await assertIsolatedKycCluster(admin, cluster);
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: socket,
    port: cluster.port,
    username: 'kyc_synthetic',
    database: databaseName,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
  });
  await db.initialize();
  await db.runMigrations({ transaction: 'all' });

  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(KycTierEvidenceReader)
    .useValue({ read: (_m: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
    .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
    .useValue(sms)
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Seed governed KYC tier policy v1 once for the test database.
  const proposal = randomUUID();
  const req = { all: [], any: [] };
  const definition = {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: req, LEVEL_2: req },
    operator: { LEVEL_1: req, LEVEL_2: req },
  };
  await db.query(
    `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state)
     VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
    [
      proposal,
      randomUUID(),
      JSON.stringify(definition),
      'b'.repeat(64),
      randomUUID(),
      randomUUID(),
    ],
  );
  await db.query(
    `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id)
     VALUES(1,$1,$2,'maker','checker')`,
    [proposal, JSON.stringify(definition)],
  );
  await db.query('UPDATE kyc_tier_policy_head SET version=1');
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin.isInitialized) {
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.destroy();
  }
});

async function seedCustomer(options?: {
  status?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  eligible?: boolean;
  password?: string;
  rotationRequired?: boolean;
  mobilePasscode?: string;
}) {
  const customerId = randomUUID();
  const phone = nextNormalizedPhone();
  const status = options?.status ?? 'ACTIVE';
  const eligible = options?.eligible ?? true;

  await db.query(
    `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
     VALUES($1,$2,'INDIVIDUAL',$3,$4,$5,false)`,
    [
      customerId,
      `cus-${customerId.slice(0, 12)}`,
      status,
      eligible ? 'LEVEL_1' : 'NONE',
      eligible ? 'APPROVED' : 'NOT_STARTED',
    ],
  );
  await db.query(
    `INSERT INTO customer_profiles(id,customer_id,display_name,first_name,last_name,date_of_birth,is_active)
     VALUES($1,$2,'Ada Lovelace','Ada','Lovelace','1992-04-12',true)`,
    [randomUUID(), customerId],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(id,customer_id,type,value,normalized_value,is_primary,verified_at)
     VALUES($1,$2,'PHONE',$3,$3,true,clock_timestamp())`,
    [randomUUID(), customerId, phone],
  );

  if (eligible) {
    await db.query(
      `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,assessed_by,is_current,expires_at)
       VALUES($1,$2,'LEVEL_1','APPROVED','fixture',true,clock_timestamp()+interval '1 hour')`,
      [randomUUID(), customerId],
    );
    snapshots.set(customerId, {
      identityRevision: 'rev-1',
      evidence: [
        {
          id: randomUUID(),
          customerId,
          identityRevision: 'rev-1',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10_000),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
    });
  } else {
    snapshots.set(customerId, {
      identityRevision: 'rev-1',
      evidence: [],
    });
  }

  let credentialId: string | undefined;
  const secret = options?.mobilePasscode ?? options?.password;
  if (secret) {
    credentialId = randomUUID();
    const rotationRequired = options?.rotationRequired ?? false;
    await db.query(
      `INSERT INTO customer_authentication_credentials(
         id,customer_id,password_hash,hash_algorithm,password_version,status,
         rotation_required,password_expires_at,mobile_otp_required
       ) VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',$4,$5,$6)`,
      [
        credentialId,
        customerId,
        hashSecret(secret),
        rotationRequired,
        rotationRequired ? new Date(Date.now() + 3600_000) : null,
        Boolean(options?.mobilePasscode),
      ],
    );
  }

  return { customerId, phone, credentialId };
}

async function createVerifiedRegistrationSession(phone: string) {
  const registrationSessionId = randomUUID();
  const registrationToken = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO kyc_registration_sessions(id,phone,authorization_hash,status,verified_at,expires_at)
     VALUES($1,$2,$3,'VERIFIED',clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
    [registrationSessionId, phone, createHash('sha256').update(registrationToken).digest('hex')],
  );
  return { registrationSessionId, registrationToken };
}

describe('Batch 2C CD-12 & CD-13 Session and Authentication Remediation (Isolated PG 16)', () => {
  test('1. eligible customer login succeeds across session endpoints and binds credential version', async () => {
    const { customerId, phone } = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'ValidCustomerPass!1',
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { phone: `+234${phone}`, password: 'ValidCustomerPass!1' },
    });
    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json<{
      accessToken: string;
      sessionId: string;
      customerId: string;
      expiresAt: string;
    }>();
    expect(body.customerId).toBe(customerId);
    expect(body.accessToken).toBeTruthy();

    const [sessionRow] = await db.query<
      Array<{ audience: string; onboarding_password_version: number; status: string }>
    >(
      `SELECT audience, onboarding_password_version, status FROM authentication_sessions WHERE id = $1`,
      [body.sessionId],
    );
    expect(sessionRow).toEqual({
      audience: 'customer-api',
      onboarding_password_version: 1,
      status: 'ACTIVE',
    });

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json<{ id: string }>().id).toBe(customerId);

    const directAuthRes = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/authenticate`,
      payload: { password: 'ValidCustomerPass!1' },
    });
    expect(directAuthRes.statusCode).toBe(200);
    expect(directAuthRes.json<{ authenticated: boolean }>().authenticated).toBe(true);
  });

  test('2. restricted onboarding login preserves phone-first six-digit passcode flow without financial access', async () => {
    const { customerId, phone } = await seedCustomer({
      status: 'DRAFT',
      eligible: false,
      mobilePasscode: '246810',
    });
    const { registrationSessionId, registrationToken } =
      await createVerifiedRegistrationSession(phone);

    const routeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/registration-sessions/onboarding-route',
      headers: { authorization: `Bearer ${registrationToken}` },
      payload: { sessionId: registrationSessionId },
    });
    expect(routeRes.statusCode).toBe(200);
    expect(routeRes.json()).toEqual({ next: 'LOGIN' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/registration-sessions/onboarding-login',
      headers: { authorization: `Bearer ${registrationToken}` },
      payload: { sessionId: registrationSessionId, passcode: '246810' },
    });
    expect(loginRes.statusCode).toBe(200);
    const onboarding = loginRes.json<{
      accessToken: string;
      audience: string;
      customerId: string;
    }>();
    expect(onboarding.audience).toBe('customer-onboarding');
    expect(onboarding.customerId).toBe(customerId);

    const statusRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/registration-sessions/onboarding-session',
      headers: { authorization: `Bearer ${onboarding.accessToken}` },
      payload: {},
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toMatchObject({
      customerId,
      audience: 'customer-onboarding',
      status: 'ACTIVE',
      financialEligible: false,
    });

    // Restricted onboarding bearer cannot access financial or ordinary customer endpoints.
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${onboarding.accessToken}` },
    });
    expect(meRes.statusCode).toBe(401);

    const walletsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me/wallets',
      headers: { authorization: `Bearer ${onboarding.accessToken}` },
    });
    expect(walletsRes.statusCode).toBe(401);
  });

  test('3. authenticated self-logout succeeds after eligibility withdrawal across all logout routes and rejects replay', async () => {
    const { customerId } = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'LogoutAfterLoss!1',
    });
    const other = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'OtherCustomer!1',
    });

    const issueLogin = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId, password: 'LogoutAfterLoss!1' },
      });
      expect(res.statusCode).toBe(200);
      return res.json<{ accessToken: string; sessionId: string }>();
    };

    const s1 = await issueLogin();
    const s2 = await issueLogin();
    const s3 = await issueLogin();

    // Withdraw KYC evidence; financial access fails immediately on s1.
    snapshots.get(customerId)!.evidence[0]!.status = 'REVOKED';
    const deniedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${s1.accessToken}` },
    });
    expect(deniedMe.statusCode).toBe(401);

    // Self-logout on s1 (which already tripped withdrawn-authority revocation) still succeeds once.
    const logout1 = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions/logout',
      headers: { authorization: `Bearer ${s1.accessToken}` },
    });
    expect(logout1.statusCode).toBe(200);
    expect(logout1.json()).toMatchObject({ revoked: true });

    // Replaying logout with s1 is now rejected with 401.
    const replayLogout1 = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions/logout',
      headers: { authorization: `Bearer ${s1.accessToken}` },
    });
    expect(replayLogout1.statusCode).toBe(401);

    // Cross-customer session revocation remains strictly forbidden (403) even on logout route.
    const crossCustomerDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/customers/${other.customerId}/sessions/current`,
      headers: { authorization: `Bearer ${s2.accessToken}` },
    });
    expect(crossCustomerDelete.statusCode).toBe(403);

    // DELETE /customers/:id/sessions/current succeeds for the ineligible owner on s2.
    const deleteCurrent = await app.inject({
      method: 'DELETE',
      url: `/api/v1/customers/${customerId}/sessions/current`,
      headers: { authorization: `Bearer ${s2.accessToken}` },
    });
    expect(deleteCurrent.statusCode).toBe(200);
    expect(deleteCurrent.json()).toMatchObject({ revoked: true, sessionId: s2.sessionId });

    // Suspend customer via CustomerService; s3 can still self-logout via DELETE /customers/:id/sessions.
    await app
      .get(CustomerService)
      .updateStatus(customerId, { status: CustomerStatus.SUSPENDED, actor: 'ops-actor' });
    const deleteAll = await app.inject({
      method: 'DELETE',
      url: `/api/v1/customers/${customerId}/sessions`,
      headers: { authorization: `Bearer ${s3.accessToken}` },
    });
    expect(deleteAll.statusCode).toBe(200);
  });

  test('4. revoked financial authority never silently returns when suspension or manual KYC hold is lifted', async () => {
    // Sub-case A: Customer suspension -> reactivation (no requests made during suspension).
    const suspendedCase = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'NoSilentReturn!1',
    });
    const preSuspendLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId: suspendedCase.customerId, password: 'NoSilentReturn!1' },
    });
    const preSuspendToken = preSuspendLogin.json<{ accessToken: string }>().accessToken;

    const customerService = app.get(CustomerService);
    await customerService.updateStatus(suspendedCase.customerId, {
      status: CustomerStatus.SUSPENDED,
      actor: 'compliance-ops',
    });
    await customerService.updateStatus(suspendedCase.customerId, {
      status: CustomerStatus.ACTIVE,
      actor: 'compliance-ops',
    });

    const afterUnsuspendMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${preSuspendToken}` },
    });
    expect(afterUnsuspendMe.statusCode).toBe(401);

    const afterUnsuspendRotate = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${suspendedCase.customerId}/sessions/rotate`,
      headers: { authorization: `Bearer ${preSuspendToken}` },
    });
    expect(afterUnsuspendRotate.statusCode).toBe(401);

    // Sub-case B: KYC manual hold -> hold lifted via administrative approval.
    const holdCase = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'NoSilentHoldReturn!1',
    });
    const preHoldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId: holdCase.customerId, password: 'NoSilentHoldReturn!1' },
    });
    const preHoldToken = preHoldLogin.json<{ accessToken: string }>().accessToken;

    const transitions = app.get(KycTierTransitionService);
    await transitions.administrativeAssessment(
      holdCase.customerId,
      {
        level: CustomerKycLevel.NONE,
        status: CustomerKycStatus.PENDING,
        reason: 'MANUAL_REVIEW',
        assessedBy: kycReviewerPrincipal.principalId,
      },
      kycReviewerPrincipal,
    );
    await transitions.administrativeAssessment(
      holdCase.customerId,
      {
        level: CustomerKycLevel.LEVEL_1,
        status: CustomerKycStatus.APPROVED,
        assessedBy: kycReviewerPrincipal.principalId,
      },
      kycReviewerPrincipal,
    );

    const afterHoldLiftedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${preHoldToken}` },
    });
    expect(afterHoldLiftedMe.statusCode).toBe(401);

    // Fresh re-authentication issues a new working session.
    const freshLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId: holdCase.customerId, password: 'NoSilentHoldReturn!1' },
    });
    expect(freshLogin.statusCode).toBe(200);
  });

  test('5. credential-version binding is enforced across AuthenticationSessionService and PostgresKycStore', async () => {
    const { customerId, credentialId } = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'BoundVersionPass!1',
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId, password: 'BoundVersionPass!1' },
    });
    const { accessToken } = loginRes.json<{ accessToken: string }>();

    const sessionService = app.get(AuthenticationSessionService);
    const kycStore = new PostgresKycStore(db, sessionService);

    // Valid bound session can grant KYC consent via PostgresKycStore.
    const consentId = await kycStore.grantConsent({
      customerId,
      sessionToken: accessToken,
      kind: 'BVN',
      noticeVersion: 'v1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(consentId).toBeTruthy();

    // Rotate password through CustomerAuthenticationService (advances passwordVersion to 2).
    await app.get(CustomerAuthenticationService).rotatePassword(customerId, credentialId!, {
      passwordHash: hashSecret('BoundVersionPass!2'),
      hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
      passwordVersion: 2,
      actor: 'security-admin',
    });

    // Old token is rejected by AuthenticationSessionService AND PostgresKycStore (no SQL bypass).
    expect((await sessionService.validate({ token: accessToken })).valid).toBe(false);
    await expect(
      kycStore.withdrawConsent(customerId, consentId, accessToken),
    ).rejects.toMatchObject({ code: 'BLOCKED' });

    // Even if a session were still ACTIVE in DB with stale onboarding_password_version=1, both reject it.
    await db.query(
      `UPDATE authentication_sessions SET status='ACTIVE', revoked_at=NULL, revoke_reason=NULL WHERE customer_id=$1`,
      [customerId],
    );
    await expect(
      kycStore.withdrawConsent(customerId, consentId, accessToken),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect((await sessionService.validate({ token: accessToken })).valid).toBe(false);
  });

  test('6. self-service password change preserves current session on new credential version and revokes all other sessions', async () => {
    const { customerId } = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'InitialSelfPass!1',
    });

    const deviceALogin = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId, password: 'InitialSelfPass!1' },
    });
    const deviceBLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId, password: 'InitialSelfPass!1' },
    });
    const deviceA = deviceALogin.json<{ accessToken: string; sessionId: string }>();
    const deviceB = deviceBLogin.json<{ accessToken: string; sessionId: string }>();

    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/me/password',
      headers: { authorization: `Bearer ${deviceA.accessToken}` },
      payload: {
        currentPassword: 'InitialSelfPass!1',
        newPassword: 'UpdatedSelfPass!2',
      },
    });
    expect(changeRes.statusCode).toBe(200);
    expect(changeRes.json()).toEqual({ changed: true, passwordVersion: 2 });

    // Caller's current session (device A) was rebound to passwordVersion=2 and remains active.
    const deviceAMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me/profile',
      headers: { authorization: `Bearer ${deviceA.accessToken}` },
    });
    expect(deviceAMe.statusCode).toBe(200);

    // Other concurrent session (device B) was immediately revoked and fails closed.
    const deviceBMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me/profile',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deviceBMe.statusCode).toBe(401);

    const [rowB] = await db.query<Array<{ status: string; revoke_reason: string }>>(
      `SELECT status, revoke_reason FROM authentication_sessions WHERE id = $1`,
      [deviceB.sessionId],
    );
    expect(rowB).toEqual({ status: 'REVOKED', revoke_reason: 'Password changed' });
  });

  test('7. initial credential rotation and session issuance are atomic and never strand customers on partial failure', async () => {
    const { customerId, credentialId } = await seedCustomer({
      status: 'ACTIVE',
      eligible: false,
      password: 'TempInitPass!1',
      rotationRequired: true,
    });

    // Attempt 1 while ineligible: fails uniformly with 401 and leaves rotation_required=true intact.
    const failedRotate = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/credentials/rotate',
      payload: {
        customerId,
        currentPassword: 'TempInitPass!1',
        newPassword: 'PermanentCustomerPass!2',
      },
    });
    expect(failedRotate.statusCode).toBe(401);

    // Simulate an injected mid-transaction failure inside issueInManager for an eligible customer.
    await db.query(`UPDATE customers SET kyc_level='LEVEL_1', kyc_status='APPROVED' WHERE id=$1`, [
      customerId,
    ]);
    await db.query(
      `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,assessed_by,is_current,expires_at)
       VALUES($1,$2,'LEVEL_1','APPROVED','fixture',true,clock_timestamp()+interval '1 hour')`,
      [randomUUID(), customerId],
    );
    snapshots.set(customerId, {
      identityRevision: 'rev-atomic',
      evidence: [
        {
          id: randomUUID(),
          customerId,
          identityRevision: 'rev-atomic',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10_000),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
    });

    const sessionService = app.get(AuthenticationSessionService);
    const issueSpy = jest
      .spyOn(sessionService, 'issueInManager')
      .mockRejectedValueOnce(new Error('Simulated session-store write failure'));

    const abortedRotate = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/credentials/rotate',
      payload: {
        customerId,
        currentPassword: 'TempInitPass!1',
        newPassword: 'PermanentCustomerPass!2',
      },
    });
    expect(abortedRotate.statusCode).toBe(500);
    issueSpy.mockRestore();

    // Verify atomic rollback: rotation_required is STILL true and password_version is STILL 1!
    const [credAfterAbort] = await db.query<
      Array<{ rotation_required: boolean; password_version: number }>
    >(
      `SELECT rotation_required, password_version FROM customer_authentication_credentials WHERE id = $1`,
      [credentialId],
    );
    expect(credAfterAbort).toEqual({ rotation_required: true, password_version: 1 });

    // Customer is NOT stranded: retrying with the same temporary password now succeeds cleanly!
    const succeededRotate = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/credentials/rotate',
      payload: {
        customerId,
        currentPassword: 'TempInitPass!1',
        newPassword: 'PermanentCustomerPass!2',
      },
    });
    expect(succeededRotate.statusCode).toBe(200);
    const rotatedSession = succeededRotate.json<{ accessToken: string; customerId: string }>();
    expect(rotatedSession.customerId).toBe(customerId);
    expect(rotatedSession.accessToken).toBeTruthy();
  });

  test('8. invalid authentication responses are uniform across wrong password, unknown user, locked credential, and ineligible customer', async () => {
    const ineligibleActive = await seedCustomer({
      status: 'ACTIVE',
      eligible: false,
      password: 'RightPassword!123',
    });
    const ineligibleRotation = await seedCustomer({
      status: 'ACTIVE',
      eligible: false,
      password: 'RightTempPassword!123',
      rotationRequired: true,
    });
    const lockedUser = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'LockedPassword!123',
    });
    await db.query(
      `UPDATE customer_authentication_credentials SET account_locked = true, failed_authentication_count = 5 WHERE id = $1`,
      [lockedUser.credentialId],
    );

    const unknownId = randomUUID();
    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId: unknownId, password: 'AnyPassword!123' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId: ineligibleActive.customerId, password: 'WrongPassword!999' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId: ineligibleActive.customerId, password: 'RightPassword!123' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId: ineligibleRotation.customerId, password: 'RightTempPassword!123' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/sessions',
        payload: { customerId: lockedUser.customerId, password: 'LockedPassword!123' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/customers/${ineligibleActive.customerId}/authenticate`,
        payload: { password: 'RightPassword!123' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/customers/${ineligibleActive.customerId}/authenticate`,
        payload: { password: 'WrongPassword!999' },
      }),
    ]);

    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        statusCode: 401,
        message: 'Invalid credentials',
        error: 'Unauthorized',
      });
    }
  });

  test('9. mobile onboarding session handoff issues ordinary customer-api sessions and retires restricted onboarding sessions cleanly', async () => {
    const { customerId, phone } = await seedCustomer({
      status: 'DRAFT',
      eligible: false,
      mobilePasscode: '135790',
    });

    // Step 1: Login while DRAFT/ineligible -> gets restricted customer-onboarding token (~15m TTL).
    const reg1 = await createVerifiedRegistrationSession(phone);
    const onboardingAuth = app.get(MobileOnboardingAuthService);
    const restricted = await onboardingAuth.login(
      reg1.registrationSessionId,
      reg1.registrationToken,
      '135790',
    );
    expect(restricted.audience).toBe('customer-onboarding');

    // Step 2: Customer completes KYC & becomes ACTIVE + financially eligible.
    await db.query(
      `UPDATE customers SET status='ACTIVE', kyc_level='LEVEL_1', kyc_status='APPROVED' WHERE id=$1`,
      [customerId],
    );
    await db.query(
      `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,assessed_by,is_current,expires_at)
       VALUES($1,$2,'LEVEL_1','APPROVED','fixture',true,clock_timestamp()+interval '1 hour')`,
      [randomUUID(), customerId],
    );
    snapshots.set(customerId, {
      identityRevision: 'rev-handoff',
      evidence: [
        {
          id: randomUUID(),
          customerId,
          identityRevision: 'rev-handoff',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10_000),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
    });

    // Existing restricted token does NOT silently escalate, but onboarding-session signals financialEligible=true.
    const statusCheck = await onboardingAuth.session(restricted.accessToken);
    expect(statusCheck).toMatchObject({
      customerId,
      audience: 'customer-onboarding',
      status: 'ACTIVE',
      financialEligible: true,
    });
    const stillRestrictedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${restricted.accessToken}` },
    });
    expect(stillRestrictedMe.statusCode).toBe(401);

    // Step 3: Fresh mobile onboarding-login upgrades cleanly to an ordinary customer-api session (~1h TTL) and revokes prior onboarding session.
    const reg2 = await createVerifiedRegistrationSession(phone);
    const upgraded = await onboardingAuth.login(
      reg2.registrationSessionId,
      reg2.registrationToken,
      '135790',
    );
    expect(upgraded.audience).toBe('customer-api');
    expect(upgraded.expiresAt.getTime() - Date.now()).toBeGreaterThan(45 * 60_000);

    const [oldOnboardingRow] = await db.query<Array<{ status: string }>>(
      `SELECT status FROM authentication_sessions WHERE id = $1`,
      [restricted.sessionId],
    );
    expect(oldOnboardingRow).toEqual({ status: 'REVOKED' });

    // Upgraded session works identically on ordinary customer endpoints AND onboarding-session inspection.
    const ordinaryMe = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me',
      headers: { authorization: `Bearer ${upgraded.accessToken}` },
    });
    expect(ordinaryMe.statusCode).toBe(200);
    expect(await onboardingAuth.session(upgraded.accessToken)).toMatchObject({
      customerId,
      sessionId: upgraded.sessionId,
      audience: 'customer-api',
      status: 'ACTIVE',
      financialEligible: true,
    });
  });

  test('10. concurrent read-only validations avoid exclusive row locks while mutating requests retain FOR UPDATE serialization', async () => {
    const { customerId } = await seedCustomer({
      status: 'ACTIVE',
      eligible: true,
      password: 'ConcurrencyLockPass!1',
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { customerId, password: 'ConcurrencyLockPass!1' },
    });
    const { accessToken, sessionId } = loginRes.json<{ accessToken: string; sessionId: string }>();

    // Hold a PostgreSQL FOR SHARE lock on customers, kyc_tier_manual_holds, customer_kyc_assessments,
    // and authentication_sessions in an open transaction. Any FOR UPDATE would block behind this lock!
    const sharedLocker = db.createQueryRunner();
    await sharedLocker.connect();
    await sharedLocker.startTransaction();
    try {
      await sharedLocker.query(`SELECT id FROM customers WHERE id = $1 FOR SHARE`, [customerId]);
      await sharedLocker.query(
        `SELECT id FROM customer_kyc_assessments WHERE customer_id = $1 FOR SHARE`,
        [customerId],
      );
      await sharedLocker.query(`SELECT id FROM authentication_sessions WHERE id = $1 FOR SHARE`, [
        sessionId,
      ]);

      // 10 parallel GET requests (mode='READ') must ALL complete quickly without blocking on FOR SHARE!
      const parallelReads = await Promise.all(
        Array.from({ length: 10 }, () =>
          app.inject({
            method: 'GET',
            url: '/api/v1/customers/me',
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        ),
      );
      expect(parallelReads.map((r) => r.statusCode)).toEqual(Array(10).fill(200));

      // Meanwhile, a mutating request (PATCH /customers/me/profile -> mode='MUTATION') MUST acquire
      // FOR UPDATE on customers and therefore wait behind sharedLocker until sharedLocker finishes!
      let mutationSettled = false;
      const pendingMutation = app
        .inject({
          method: 'PATCH',
          url: '/api/v1/customers/me/profile',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { displayName: 'Ada Byron' },
        })
        .then((res) => {
          mutationSettled = true;
          return res;
        });

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(mutationSettled).toBe(false);

      // Release sharedLocker; the pending mutation now acquires FOR UPDATE and succeeds cleanly.
      await sharedLocker.commitTransaction();
      const mutationRes = await pendingMutation;
      expect(mutationRes.statusCode).toBe(200);
    } finally {
      if (sharedLocker.isTransactionActive) {
        await sharedLocker.rollbackTransaction();
      }
      await sharedLocker.release();
    }
  });
});
