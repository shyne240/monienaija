/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports */
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';

const previousEnv: Record<string, string | undefined> = {};
const setTestEnv = (key: string, value: string) => {
  if (!(key in previousEnv)) previousEnv[key] = process.env[key];
  process.env[key] = value;
};

setTestEnv('CUSTOMER_REGISTRATION_SIMULATION_ENABLED', 'false');
setTestEnv('KYC_CUSTOMER_VERIFICATION_ENABLED', 'true');
setTestEnv('KYC_REGISTRATION_ENABLED', 'true');
setTestEnv('KYC_PROVIDER_CONTRACTS_REVIEWED', 'true');
setTestEnv('KYC_PROVIDER_LIVE_CALLS_ENABLED', 'true');
setTestEnv('KYC_CONSENT_NOTICE_VERSION', 'v1.0-ng');
setTestEnv(
  'KYC_CONSENT_NOTICE_TEXT',
  'I consent to MonieNaija verifying my BVN or NIN with licensed Nigerian identity providers for KYC compliance.',
);
setTestEnv('KYC_CONSENT_VALIDITY_SECONDS', '86400');
setTestEnv('KYC_OWNERSHIP_KEY_BASE64', Buffer.alloc(32, 0x5a).toString('base64'));
setTestEnv('KYC_OWNERSHIP_KEY_VERSION', 'v1');
setTestEnv('KYC_PROVIDER_SECRET_ENCRYPTION_KEY_BASE64', Buffer.alloc(32, 0x3c).toString('base64'));
setTestEnv('KYC_PROVIDER_SECRET_ENCRYPTION_KEY_ID', 'v1');
setTestEnv(
  'KYC_VERIFICATION_POLICY_JSON',
  JSON.stringify({
    version: 'v1',
    enabled: true,
    maxAttemptsPerConsent: 3,
    cooldownSeconds: 1,
    customerWindowSeconds: 3600,
    customerWindowLimit: 10,
    providerWindowSeconds: 60,
    providerWindowLimit: 100,
    timeoutMs: 5000,
    evidenceValiditySeconds: 86400,
  }),
);

import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { PremblyTransport } from '../src/identity-verification/prembly-transport';
import { PremblyVerificationProvider } from '../src/identity-verification/prembly-verification.provider';
import type { AppModule as AppModuleType } from '../src/app.module';
import { PremblyKycProvider } from '../src/kyc-verification/prembly-kyc.provider';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { RecordingSmsProvider } from './support/desk-otp-fixture';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { seedActivationCommercialConfig } from './support/activation-config-fixture';

const { AppModule } = require('../src/app.module') as { AppModule: typeof AppModuleType };

jest.setTimeout(180_000);

describe('V1 Staff-Created Account Claim Journey (Real HTTP + PostgreSQL)', () => {
  let dataSource!: DataSource;
  let app!: NestFastifyApplication;
  let sessions!: A2WorkforceSessionService;
  let smsProvider!: RecordingSmsProvider;

  let superAdmin!: { principalId: string; token: string };
  let compliance!: { principalId: string; token: string };
  let operations!: { principalId: string; token: string };

  let phoneSequence = 4100;
  const nextNigerianPhone = (): { local: string; e164: string } => {
    phoneSequence += 1;
    const suffix = String(phoneSequence).padStart(4, '0');
    return {
      local: `0803555${suffix}`,
      e164: `+234803555${suffix}`,
    };
  };

  let bvnSequence = 22230000000;
  const nextBvn = (): string => {
    bvnSequence += 1;
    return String(bvnSequence);
  };

  const acceptedPremblyBvns = new Map<
    string,
    { firstName: string; lastName: string; dateOfBirth: string; phone: string }
  >();

  beforeAll(async () => {
    smsProvider = new RecordingSmsProvider();
    dataSource = await createIntegrationDataSource('task1staffclaim');
    // This journey asserts that staff completion succeeds, so the synthetic commercial
    // configuration the activation gate requires has to exist. Without it the gate correctly
    // refuses activation (TIER_DEFAULT_NOT_APPROVED / NO_ENABLED_PRODUCTS) and the journey would
    // never reach the claim it exists to prove. The gate itself is untouched: suites that remove
    // configuration still observe it.
    await seedActivationCommercialConfig(dataSource, { actor: 'staff-claim-journey' });

    const premblyTransport: PremblyTransport = (_path, options) => {
      const bvn = options.number;
      const expected = acceptedPremblyBvns.get(bvn);
      if (!expected) {
        return Promise.resolve({
          status: 200,
          body: {
            status: true,
            response_code: '01',
            detail: 'Record not found',
          },
        });
      }
      return Promise.resolve({
        status: 200,
        body: {
          status: true,
          response_code: '00',
          verification: { status: 'VERIFIED', reference: `prembly-ref-${bvn}` },
          data: {
            bvn,
            firstName: expected.firstName,
            lastName: expected.lastName,
            dateOfBirth: expected.dateOfBirth,
            phoneNumber1: expected.phone,
          },
        },
      });
    };

    const premblyAdapter = new PremblyVerificationProvider({
      credentialResolver: {
        getApiKey: () => Promise.resolve('prembly-live-test-key-0123456789'),
      },
      transport: premblyTransport,
    });

    const workforceConfig = {
      enabled: true,
      issuer: 'https://local-dev-identity.monienaija.invalid',
      clientId: 'monienaija-workforce',
      clientSecret: 'test-secret',
      redirectUri: 'https://admin.monienaija.internal/callback',
      internalAudience: 'workforce-admin',
      sessionTtlSeconds: 3600,
      idleTimeoutSeconds: 1800,
      roles: [],
      makerCheckerRules: [],
      rateLimits: [],
      trustedProxyAddresses: ['127.0.0.1'],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(smsProvider)
      .overrideProvider('KYC_PROVIDER_RUNTIME')
      .useValue({
        providers: [new PremblyKycProvider(premblyAdapter)],
        readiness: {
          MONNIFY: false,
          DOJAH: false,
          PREMBLY: true,
          SYNTHETIC: false,
          isReady: (provider: string) => provider === 'PREMBLY',
          capabilities: { PREMBLY: { BVN: true, NIN: true } },
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    sessions = moduleRef.get(A2WorkforceSessionService);

    const establishRole = async (roleKey: string, label: string) => {
      const principalId = `task1:${label}:${randomUUID()}`.slice(0, 160);
      const now = new Date();
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `task1:${randomUUID()}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 3_600_000),
        assignedBy: 'task1-test-harness',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      } as unknown as A2FinanceRoleAssignment);

      const established = await sessions.establish({
        issuer: 'https://local-dev-identity.monienaija.invalid',
        subject: principalId,
        principalId,
        audience: ['workforce-admin'],
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
        authenticatedAt: now.toISOString(),
        assuranceLevel: 'MFA',
        amr: ['pwd', 'otp'],
        acr: null,
        signingKeyId: 'task1-test-key',
      });
      return { principalId, token: established.accessToken };
    };

    superAdmin = await establishRole('SUPER_ADMIN', 'super-admin');
    compliance = await establishRole('COMPLIANCE', 'compliance');
    operations = await establishRole('OPERATIONS', 'operations');

    // Governed Prembly routing for BVN and NIN (maker SUPER_ADMIN -> checker COMPLIANCE)
    const providerProp = await request(app.getHttpServer())
      .post('/api/v1/internal/kyc/providers/proposals')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({
        requestId: randomUUID(),
        expectedVersion: 0,
        reason: 'INITIAL_SETUP',
        configuration: {
          providers: {
            MONNIFY: { enabled: false, capabilities: [] },
            DOJAH: { enabled: false, capabilities: [] },
            PREMBLY: { enabled: true, capabilities: ['BVN', 'NIN'] },
            SYNTHETIC: { enabled: false, capabilities: [] },
          },
          routes: {
            BVN: { primary: 'PREMBLY', fallback: null },
            NIN: { primary: 'PREMBLY', fallback: null },
            ADDRESS_VERIFICATION: { primary: null, fallback: null },
            ENHANCED_DUE_DILIGENCE: { primary: null, fallback: null },
          },
        },
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/kyc/providers/proposals/${providerProp.body.id}/approve`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({})
      .expect(200);

    // Governed Tier 1 KYC policy (maker SUPER_ADMIN -> checker COMPLIANCE)
    const tierProp = await request(app.getHttpServer())
      .post('/api/v1/internal/kyc/tier-policies/proposals')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({
        requestId: randomUUID(),
        expectedVersion: 0,
        definition: {
          regulatoryRequirementsConfirmed: true,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          effectiveUntil: null,
          regulatory: {
            LEVEL_1: { all: [], any: [['BVN', 'NIN']] },
            LEVEL_2: { all: ['BVN', 'NIN'], any: [] },
          },
          operator: {
            LEVEL_1: { all: [], any: [['BVN', 'NIN']] },
            LEVEL_2: { all: ['BVN', 'NIN'], any: [] },
          },
        },
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/kyc/tier-policies/proposals/${tierProp.body.id}/approve`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({})
      .expect(200);

    // Approved default Tier 1 customer class via supported Admin API
    await request(app.getHttpServer())
      .post('/api/v1/internal/customer-classes')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({
        code: 'TIER_1_STANDARD',
        name: 'Tier 1 Standard Individual',
        description: 'Default class for verified Tier 1 retail customers',
        status: 'ACTIVE',
        enabled: true,
        configurationStatus: 'CONFIGURED',
        isDefault: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Clears test-runner OTP cooldown and loopback-IP rate buckets between back-to-back scenarios. */
  async function clearPhoneOtpCooldown(): Promise<void> {
    await dataSource.query(
      `DELETE FROM a2_security_rate_buckets
        WHERE category IN (
          'CUSTOMER_REGISTRATION_OTP_COOLDOWN_PER_PHONE',
          'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP',
          'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_PHONE'
        )`,
    );
    await dataSource.query(
      `DELETE FROM kyc_registration_rate_buckets
        WHERE bucket_key LIKE 'create-ip:%'
           OR bucket_key LIKE 'issue-ip:%'
           OR bucket_key LIKE 'issue-phone:%'
           OR bucket_key LIKE 'create-phone:%'`,
    );
    await dataSource.query(`DELETE FROM kyc_registration_phone_locks`);
  }

  /** Drives mobile phone OTP verification over real HTTP and returns the verified registration session. */
  async function startVerifiedMobileSession(phone: {
    local: string;
    e164: string;
  }): Promise<{ sessionId: string; token: string }> {
    await clearPhoneOtpCooldown();
    const startRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/start')
      .send({ phone: phone.local })
      .expect(200);

    const sessionId = startRes.body.id as string;
    const pendingToken = startRes.body.token as string;

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/otp')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ sessionId, requestId: randomUUID() })
      .expect(200);

    const code = smsProvider.lastCode(phone.e164);
    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/otp/verify')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ sessionId, code })
      .expect(200);

    return { sessionId, token: verifyRes.body.authorization as string };
  }

  /** Completes Admin Web Steps 1–5 (Customer + Profile + Verified Phone + Address + Identity Document). */
  async function registerDraftCustomerByStaff(options?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }) {
    const phone = nextNigerianPhone();
    const bvn = nextBvn();
    const firstName = options?.firstName ?? 'Amina';
    const lastName = options?.lastName ?? 'Bello';
    const dateOfBirth = options?.dateOfBirth ?? '1994-06-15';

    acceptedPremblyBvns.set(bvn, {
      firstName,
      lastName,
      dateOfBirth,
      phone: phone.e164,
    });

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ type: 'INDIVIDUAL' })
      .expect(201);
    const customerId = createRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/registration-profile`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({
        firstName,
        lastName,
        dateOfBirth,
        nationality: 'NG',
      })
      .expect(201);

    const contactRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/contact-method`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({
        type: 'PHONE',
        value: phone.local,
        isPrimary: true,
      })
      .expect(201);
    const contactId = contactRes.body.id as string;

    await clearPhoneOtpCooldown();
    await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp')
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ phone: phone.local })
      .expect(200);

    const otpCode = smsProvider.lastCode(phone.e164);
    const otpVerified = await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp/verify')
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ phone: phone.local, code: otpCode })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/contact-methods/${contactId}`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ verificationToken: otpVerified.body.verificationToken })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/address`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({
        type: 'RESIDENTIAL',
        lineOne: '14 Zoo Road',
        city: 'Kano',
        state: 'Kano',
        country: 'NG',
        postalCode: '700213',
        isPrimary: true,
      })
      .expect(201);

    // Separation of duties: OPERATIONS cannot record sensitive identity documents (403 FUNCTION_MISSING)
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({
        type: 'BVN',
        documentNumber: bvn,
        issuingCountry: 'NG',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        type: 'BVN',
        documentNumber: bvn,
        issuingCountry: 'NG',
      })
      .expect(201);

    return { customerId, phone, bvn, firstName, lastName, dateOfBirth };
  }

  it('proves the complete staff-created Tier 1 registration -> mobile claim -> sign-in -> idempotent NGN wallet journey', async () => {
    const { customerId, phone, bvn } = await registerDraftCustomerByStaff();

    // 1. Verify default Tier 1 customer class was assigned by the registration dependency
    const reviewBeforeVerify = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/registration-review`)
      .set('Authorization', `Bearer ${operations.token}`)
      .expect(200);

    expect(reviewBeforeVerify.body.defaults.customerClass).toMatchObject({
      configured: true,
      classCode: 'TIER_1_STANDARD',
      source: 'REGISTRATION_DEFAULT',
    });
    expect(reviewBeforeVerify.body.trustedEvidence.state).toBe('MISSING');
    expect(reviewBeforeVerify.body.activatable).toBe(false);

    // KYC workspace truthfully reports approvalEligibleNow=false before provider verification
    const dossierBefore = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/customers/${customerId}`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .expect(200);
    expect(dossierBefore.body.supportedDecisions.approvalEligibleNow).toBe(false);
    expect(dossierBefore.body.consentNotice).toMatchObject({ version: 'v1.0-ng' });

    // Attempting KYC approval before provider verification fails closed
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/kyc-assessment`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        level: 'LEVEL_1',
        status: 'APPROVED',
        assessedBy: compliance.principalId,
      })
      .expect(409);

    // Separation of duties: OPERATIONS cannot execute KYC identity verification
    await request(app.getHttpServer())
      .post(`/api/v1/internal/kyc/review-workspace/customers/${customerId}/verify-identity`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: 'v1.0-ng',
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(403);

    // 2. COMPLIANCE executes governed Prembly BVN verification with customer consent attestation
    const verifyRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/kyc/review-workspace/customers/${customerId}/verify-identity`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: dossierBefore.body.consentNotice.version,
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
        expectedProvider: 'PREMBLY',
        expectedRouteVersion: 1,
      })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      kind: 'BVN',
      status: 'MATCH',
      provider: 'PREMBLY',
      routeVersion: 1,
    });

    // Dossier now truthfully reports approvalEligibleNow=true
    const dossierAfter = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/customers/${customerId}`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .expect(200);
    expect(dossierAfter.body.supportedDecisions.approvalEligibleNow).toBe(true);

    // 3. COMPLIANCE approves Tier 1 KYC assessment; OPERATIONS activates customer (DRAFT -> ACTIVE)
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/kyc-assessment`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        level: 'LEVEL_1',
        status: 'APPROVED',
        assessedBy: compliance.principalId,
        reason: 'Verified BVN matches Tier 1 requirements',
      })
      .expect(201);

    // Regression: approving KYC re-assigns the Level 1 tier-default customer class. That write
    // named `assigned_by` and `previous_class_id`, columns `customer_class_assignments` has never
    // had (the actor is recorded in created_by/updated_by), so it raised QueryFailedError and the
    // endpoint answered 500. Assert the assignment actually landed.
    const tierDefaultAssignment = await dataSource.query<
      Array<{ class_id: string; created_by: string; source: string }>
    >(
      `SELECT class_id::text AS class_id, created_by, source FROM customer_class_assignments
        WHERE customer_id = $1 AND source = 'TIER_DEFAULT' AND is_active = true`,
      [customerId],
    );
    expect(tierDefaultAssignment).toHaveLength(1);
    expect(tierDefaultAssignment[0]?.created_by).toBe(compliance.principalId);

    const activateCustomerRes = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(activateCustomerRes.body.status).toBe('ACTIVE');

    // Staff completion alone leaves customer ACTIVE + COMPLETED onboarding + ELIGIBLE, with 0 credentials and 0 wallets
    const reviewAfterStaff = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/registration-review`)
      .set('Authorization', `Bearer ${operations.token}`)
      .expect(200);

    expect(reviewAfterStaff.body).toMatchObject({
      customerStatus: 'ACTIVE',
      trustedEvidence: { state: 'VERIFIED', verifiedKinds: ['BVN'] },
      onboardingWorkflow: {
        status: 'COMPLETED',
        eligibility: 'ELIGIBLE',
        completed: true,
      },
      wallet: null,
      outstanding: ['wallet'],
    });

    // 4. Pre-claim mobile session proof: customer is ready to CLAIM, cannot provision wallet or access financial endpoints
    const mobileSession = await startVerifiedMobileSession(phone);

    const preClaimState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({ sessionId: mobileSession.sessionId })
      .expect(200);

    expect(preClaimState.body).toMatchObject({
      stage: 'CLAIM',
      claim: { available: true, matchedThisSession: false },
      credentials: { passcodeSet: false, pinSet: false },
      customer: { status: 'ACTIVE', kycLevel: 'LEVEL_1', kycStatus: 'APPROVED' },
      outstanding: ['wallet'],
    });

    await request(app.getHttpServer())
      .post('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .set('Idempotency-Key', `preclaim-${randomUUID()}`)
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/eligibility`)
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({ status: 'ELIGIBLE' })
      .expect(401);

    const preClaimWallets = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM wallet_accounts WHERE lower(customer_id) = lower($1)',
      [customerId],
    );
    expect(Number(preClaimWallets[0]?.count ?? '0')).toBe(0);

    // 5. Customer claims account with matching BVN, resumes interrupted claim, sets passcode + separate PIN, and signs in
    const matchRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({
        sessionId: mobileSession.sessionId,
        kind: 'BVN',
        identifier: bvn,
      })
      .expect(200);
    expect(matchRes.body).toEqual({ status: 'MATCH' });

    // Interruption check: reloading onboarding-state in the same session returns RESUME_CLAIM
    const resumeState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({ sessionId: mobileSession.sessionId })
      .expect(200);
    expect(resumeState.body).toMatchObject({
      stage: 'RESUME_CLAIM',
      claim: { available: true, matchedThisSession: true },
      credentials: { passcodeSet: false, pinSet: false },
    });

    // Passcode and transaction PIN must be distinct; identical values fail closed without consuming the match
    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-credentials')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({
        sessionId: mobileSession.sessionId,
        passcode: '246810',
        passcodeConfirmation: '246810',
        pin: '246810',
        pinConfirmation: '246810',
      })
      .expect(401);

    const setupRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-credentials')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({
        sessionId: mobileSession.sessionId,
        passcode: '246810',
        passcodeConfirmation: '246810',
        pin: '135791',
        pinConfirmation: '135791',
      })
      .expect(200);
    expect(setupRes.body).toEqual({ status: 'SET_UP' });

    const postClaimState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({ sessionId: mobileSession.sessionId })
      .expect(200);
    expect(postClaimState.body).toMatchObject({
      stage: 'LOGIN',
      credentials: { passcodeSet: true, pinSet: true },
      customer: { status: 'ACTIVE', kycLevel: 'LEVEL_1', kycStatus: 'APPROVED' },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-login')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({
        sessionId: mobileSession.sessionId,
        passcode: '246810',
      })
      .expect(200);

    expect(loginRes.body).toMatchObject({
      customerId,
      audience: 'customer-api',
    });
    const customerToken = loginRes.body.accessToken as string;

    // Customer cannot self-mutate workforce onboarding/eligibility governance endpoints even after authenticating
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/eligibility`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'ELIGIBLE', actor: customerId })
      .expect(403);

    // Un-OTP'd /customers/sessions must reject a 6-digit mobile-claimed passcode (mobile_otp_required=true)
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ identifier: phone.local, password: '246810' })
      .expect(401);

    // 6. Customer provisions NGN wallet idempotently (`GET/POST /customers/me/activation`)
    const activationViewBefore = await request(app.getHttpServer())
      .get('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(activationViewBefore.body).toMatchObject({
      customerId,
      activatable: true,
      wallet: null,
      outstanding: ['wallet'],
    });

    const firstKey = `claim-activate-${randomUUID()}`;
    const firstActivation = await request(app.getHttpServer())
      .post('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', firstKey)
      .send({})
      .expect(200);

    expect(firstActivation.body).toMatchObject({
      customerId,
      activated: true,
      replayed: false,
      currency: 'NGN',
      wallet: { currency: 'NGN', status: 'ACTIVE' },
      checks: {
        customerActive: true,
        verifiedPrimaryPhone: true,
        onboardingCompleted: true,
        eligibility: 'ELIGIBLE',
        verifiedTier: 'LEVEL_1',
        financialEligibility: 'ELIGIBLE',
      },
    });
    const walletId = firstActivation.body.wallet.walletId as string;
    const provisioningWalletId = firstActivation.body.wallet.provisioningWalletId as string;

    // Replay with the SAME Idempotency-Key returns the exact same wallet
    const sameKeyReplay = await request(app.getHttpServer())
      .post('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', firstKey)
      .send({})
      .expect(200);
    expect(sameKeyReplay.body).toMatchObject({
      replayed: true,
      wallet: { walletId, provisioningWalletId, currency: 'NGN', status: 'ACTIVE' },
    });

    // Replay with a DIFFERENT Idempotency-Key also converges on the single primary NGN wallet
    const secondKeyReplay = await request(app.getHttpServer())
      .post('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `claim-activate-${randomUUID()}`)
      .send({})
      .expect(200);
    expect(secondKeyReplay.body).toMatchObject({
      replayed: true,
      wallet: { walletId, provisioningWalletId, currency: 'NGN', status: 'ACTIVE' },
    });

    const [walletAccountRows, customerWalletRows] = await Promise.all([
      dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM wallet_accounts WHERE lower(customer_id) = lower($1)',
        [customerId],
      ),
      dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM customer_wallets WHERE customer_id = $1 AND deleted_at IS NULL',
        [customerId],
      ),
    ]);
    expect(Number(walletAccountRows[0]?.count ?? '0')).toBe(1);
    expect(Number(customerWalletRows[0]?.count ?? '0')).toBe(1);

    const myWallets = await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(myWallets.body).toEqual([
      expect.objectContaining({
        id: walletId,
        currency: 'NGN',
        status: 'ACTIVE',
      }),
    ]);

    // 7. Re-claiming an already-claimed & activated account is refused cleanly, while phone-OTP
    //    + passcode re-sign-in continues to issue a full customer-api session
    const postActivationSession = await startVerifiedMobileSession(phone);
    const activatedState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${postActivationSession.token}`)
      .send({ sessionId: postActivationSession.sessionId })
      .expect(200);
    expect(activatedState.body).toMatchObject({
      stage: 'ACTIVATED',
      credentials: { passcodeSet: true, pinSet: true, mobileOtpRequired: true },
      wallet: { provisioned: true, currency: 'NGN' },
      outstanding: [],
    });

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${postActivationSession.token}`)
      .send({
        sessionId: postActivationSession.sessionId,
        kind: 'BVN',
        identifier: bvn,
      })
      .expect(401);

    const reSignInRes = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-login')
      .set('Authorization', `Bearer ${postActivationSession.token}`)
      .send({ sessionId: postActivationSession.sessionId, passcode: '246810' })
      .expect(200);
    expect(reSignInRes.body).toMatchObject({
      customerId,
      audience: 'customer-api',
      accessToken: expect.any(String),
    });
  });

  it('supports the admin temporary-password path without stranding the customer in credentials_incomplete', async () => {
    const { customerId, phone } = await registerDraftCustomerByStaff({
      firstName: 'Musa',
      lastName: 'Abdullahi',
    });

    // Issuing temporary credentials while DRAFT is rejected (409 Customer is not ACTIVE)
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/customers/${customerId}/credentials`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ reason: 'Desk temporary credential attempt before activation' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/kyc/review-workspace/customers/${customerId}/verify-identity`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: 'v1.0-ng',
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/kyc-assessment`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        level: 'LEVEL_1',
        status: 'APPROVED',
        assessedBy: compliance.principalId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Staff issues temporary password on ACTIVE customer (secret is delivered via SMS, never returned in admin response)
    const tempCredRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/customers/${customerId}/credentials`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({})
      .expect(200);
    expect(tempCredRes.body.temporaryPassword).toBeUndefined();
    expect(tempCredRes.body.delivery).toMatchObject({ channel: 'SMS', delivered: true });
    const smsEntry = [...smsProvider.sent]
      .reverse()
      .find(
        (entry) =>
          (entry.to === phone.local || entry.to === phone.e164) &&
          entry.message.includes('your login password is '),
      );
    const temporaryPassword = /your login password is ([A-Za-z0-9_-]+)\./.exec(
      smsEntry?.message ?? '',
    )?.[1] as string;
    expect(typeof temporaryPassword).toBe('string');

    // Mobile onboarding-state routes customer to LOGIN with rotationRequired=true (NOT PENDING_REVIEW)
    const mobileSession = await startVerifiedMobileSession(phone);
    const stateWithTemp = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${mobileSession.token}`)
      .send({ sessionId: mobileSession.sessionId })
      .expect(200);

    expect(stateWithTemp.body).toMatchObject({
      stage: 'LOGIN',
      credentials: { passcodeSet: true, pinSet: false, rotationRequired: true },
    });
    expect(stateWithTemp.body.outstanding).not.toContain('credentials_incomplete');

    // Login with temporary password signals rotationRequired=true without issuing a session
    const tempLogin = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ identifier: phone.local, password: temporaryPassword })
      .expect(200);
    expect(tempLogin.body).toEqual({
      customerId,
      rotationRequired: true,
    });

    // Customer rotates temporary password to permanent password, sets PIN, and provisions wallet
    const permanentPassword = 'Perm#Pass9482!';
    await request(app.getHttpServer())
      .post('/api/v1/customers/credentials/rotate')
      .send({
        customerId,
        currentPassword: temporaryPassword,
        newPassword: permanentPassword,
      })
      .expect(200);

    const fullLogin = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ identifier: phone.local, password: permanentPassword })
      .expect(200);
    const accessToken = fullLogin.body.accessToken as string;
    expect(typeof accessToken).toBe('string');

    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pin: '482915' })
      .expect(200);

    const walletRes = await request(app.getHttpServer())
      .post('/api/v1/customers/me/activation')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', `temp-cred-activate-${randomUUID()}`)
      .send({})
      .expect(200);
    expect(walletRes.body.wallet.status).toBe('ACTIVE');
  });

  it('enforces negative claim & fail-closed evidence rules: wrong phone, unverified evidence, wrong BVN lockout, rejected KYC, and post-verification profile edit', async () => {
    // (a) Wrong / unregistered phone cannot claim any customer's BVN
    const unregisteredPhone = nextNigerianPhone();
    const wrongPhoneSession = await startVerifiedMobileSession(unregisteredPhone);
    const wrongPhoneState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${wrongPhoneSession.token}`)
      .send({ sessionId: wrongPhoneSession.sessionId })
      .expect(200);
    expect(wrongPhoneState.body).toMatchObject({ stage: 'NEW', customer: null });

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${wrongPhoneSession.token}`)
      .send({
        sessionId: wrongPhoneSession.sessionId,
        kind: 'BVN',
        identifier: '22230000001',
      })
      .expect(401);

    // (b) Unverified evidence stays PENDING_REVIEW and claim-match returns PENDING
    const unverified = await registerDraftCustomerByStaff({
      firstName: 'Zainab',
      lastName: 'Sani',
    });
    const unverifiedSession = await startVerifiedMobileSession(unverified.phone);
    const unverifiedState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${unverifiedSession.token}`)
      .send({ sessionId: unverifiedSession.sessionId })
      .expect(200);
    expect(unverifiedState.body).toMatchObject({
      stage: 'PENDING_REVIEW',
      claim: { available: false, matchedThisSession: false },
    });

    const unverifiedMatch = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${unverifiedSession.token}`)
      .send({
        sessionId: unverifiedSession.sessionId,
        kind: 'BVN',
        identifier: unverified.bvn,
      })
      .expect(200);
    expect(unverifiedMatch.body).toEqual({ status: 'PENDING' });

    // (c) Wrong BVN attempts return MISMATCH up to 5 times, then LOCKED on attempt 6; credential setup without match fails
    const wrongBvnTarget = await registerDraftCustomerByStaff({
      firstName: 'Ibrahim',
      lastName: 'Danjuma',
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/internal/kyc/review-workspace/customers/${wrongBvnTarget.customerId}/verify-identity`,
      )
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: 'v1.0-ng',
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(200);

    const wrongBvnSession = await startVerifiedMobileSession(wrongBvnTarget.phone);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const mismatch = await request(app.getHttpServer())
        .post('/api/v1/customers/registration-sessions/claim-match')
        .set('Authorization', `Bearer ${wrongBvnSession.token}`)
        .send({
          sessionId: wrongBvnSession.sessionId,
          kind: 'BVN',
          identifier: '99999999999',
        })
        .expect(200);
      expect(mismatch.body).toEqual({ status: 'MISMATCH' });
    }
    const locked = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${wrongBvnSession.token}`)
      .send({
        sessionId: wrongBvnSession.sessionId,
        kind: 'BVN',
        identifier: wrongBvnTarget.bvn,
      })
      .expect(200);
    expect(locked.body).toEqual({ status: 'LOCKED' });

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-credentials')
      .set('Authorization', `Bearer ${wrongBvnSession.token}`)
      .send({
        sessionId: wrongBvnSession.sessionId,
        passcode: '112233',
        passcodeConfirmation: '112233',
        pin: '445566',
        pinConfirmation: '445566',
      })
      .expect(401);

    // (d) Rejected KYC assessment reports REJECTED on mobile onboarding-state
    const rejectedTarget = await registerDraftCustomerByStaff({
      firstName: 'Halima',
      lastName: 'Yusuf',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${rejectedTarget.customerId}/kyc-assessment`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        level: 'NONE',
        status: 'REJECTED',
        assessedBy: compliance.principalId,
        reason: 'IDENTITY_CONFLICT',
      })
      .expect(201);

    const rejectedSession = await startVerifiedMobileSession(rejectedTarget.phone);
    const rejectedState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${rejectedSession.token}`)
      .send({ sessionId: rejectedSession.sessionId })
      .expect(200);
    expect(rejectedState.body).toMatchObject({
      stage: 'REJECTED',
      claim: null,
    });

    // (e) Identity revision bump after verification invalidates stale evidence fail-closed
    const mutatedTarget = await registerDraftCustomerByStaff({
      firstName: 'Sadiq',
      lastName: 'Lawal',
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/internal/kyc/review-workspace/customers/${mutatedTarget.customerId}/verify-identity`,
      )
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: 'v1.0-ng',
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${mutatedTarget.customerId}/profile`)
      .set('Authorization', `Bearer ${operations.token}`)
      .send({ firstName: 'Sadiq-Modified' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${mutatedTarget.customerId}/kyc-assessment`)
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        level: 'LEVEL_1',
        status: 'APPROVED',
        assessedBy: compliance.principalId,
      })
      .expect(409);

    const mutatedSession = await startVerifiedMobileSession(mutatedTarget.phone);
    const mutatedMatch = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${mutatedSession.token}`)
      .send({
        sessionId: mutatedSession.sessionId,
        kind: 'BVN',
        identifier: mutatedTarget.bvn,
      })
      .expect(200);
    expect(mutatedMatch.body).toEqual({ status: 'PENDING' });

    // (f) Revoked/expired registration session fails closed (401), while a fresh phone OTP session starts cleanly at CLAIM
    const expiryTarget = await registerDraftCustomerByStaff({
      firstName: 'Fatima',
      lastName: 'Bello',
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/internal/kyc/review-workspace/customers/${expiryTarget.customerId}/verify-identity`,
      )
      .set('Authorization', `Bearer ${compliance.token}`)
      .send({
        kind: 'BVN',
        customerConsentConfirmed: true,
        noticeVersion: 'v1.0-ng',
        consentRequestId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(200);

    const interruptedSession = await startVerifiedMobileSession(expiryTarget.phone);
    const interruptedMatch = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-match')
      .set('Authorization', `Bearer ${interruptedSession.token}`)
      .send({
        sessionId: interruptedSession.sessionId,
        kind: 'BVN',
        identifier: expiryTarget.bvn,
      })
      .expect(200);
    expect(interruptedMatch.body).toEqual({ status: 'MATCH' });

    // Revoke session via supported endpoint (equivalent to session expiry/invalidation)
    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/revoke')
      .set('Authorization', `Bearer ${interruptedSession.token}`)
      .send({ sessionId: interruptedSession.sessionId })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${interruptedSession.token}`)
      .send({ sessionId: interruptedSession.sessionId })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/claim-credentials')
      .set('Authorization', `Bearer ${interruptedSession.token}`)
      .send({
        sessionId: interruptedSession.sessionId,
        passcode: '334455',
        passcodeConfirmation: '334455',
        pin: '667788',
        pinConfirmation: '667788',
      })
      .expect(401);

    // Fresh phone OTP session recovers cleanly into CLAIM (requiring fresh BVN match)
    const recoveredSession = await startVerifiedMobileSession(expiryTarget.phone);
    const recoveredState = await request(app.getHttpServer())
      .post('/api/v1/customers/registration-sessions/onboarding-state')
      .set('Authorization', `Bearer ${recoveredSession.token}`)
      .send({ sessionId: recoveredSession.sessionId })
      .expect(200);
    expect(recoveredState.body).toMatchObject({
      stage: 'CLAIM',
      claim: { available: true, matchedThisSession: false },
    });
  });
});
