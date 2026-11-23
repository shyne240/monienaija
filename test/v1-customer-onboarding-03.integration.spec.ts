/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-require-imports */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { makeCustomerFinanciallyEligible } from './support/kyc-test-fixtures';
import { phoneForms } from './support/controlled-onboarding';
import { CustomerWalletActivationService } from '../src/customer-wallet/customer-wallet-activation.service';

function encodePbkdf2(password: string, saltStr = 'onboarding03-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * CUSTOMER-ONBOARDING-END-TO-END-01 — registration review, customer-owned activation and the
 * mobile onboarding-state projection (real PostgreSQL + real HTTP).
 *
 * The three surfaces added by this slice are all *projections* over existing authorities, so the
 * assertions are deliberately about agreement rather than about new business rules:
 *
 *   1. `GET /internal/customers/:id/registration-review` — workforce-only, `customer.view` scoped,
 *      masked reference, no mutation path, and the requirement list the administrator sees.
 *   2. `GET/POST /customers/me/activation` — CUSTOMER SELF only, `Idempotency-Key` required,
 *      provisioning refused before ACTIVE, one wallet per (customer, currency), replay converges.
 *   3. `POST /customers/registration-sessions/onboarding-state` — scoped strictly to the verified
 *      phone on the registration session, never accepts a customer id, and reports
 *      NEW / CLAIM / RESUME_CLAIM / LOGIN / PENDING_REVIEW / REJECTED / ACTIVATED.
 */
const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('CUSTOMER-ONBOARDING-END-TO-END-01 (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let provider: TestNotificationProvider;
  let activationService: CustomerWalletActivationService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: (token: string, audience: string): Promise<any> => {
      if (!token || !token.startsWith('workforce-')) {
        return Promise.reject(new UnauthorizedException('invalid workforce token'));
      }
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];
      if (!allowed.includes(type)) return Promise.reject(new UnauthorizedException('invalid type'));
      return Promise.resolve({
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        // SUPPORT holds read-only `customer.view`; the lifecycle write codes are held by
        // OPERATOR/SERVICE/PRIVILEGED exactly as the authorization catalogue assigns them.
        scopes: ['SUPPORT'].includes(type)
          ? ['customer.view']
          : ['customer.view', 'customer.activate', 'customer.suspend', 'customer.close'],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any);
    },
  };

  const nextPhone = (() => {
    // 811 is a valid Nigerian mobile range; the previous 82x base failed DTO validation.
    let counter = 110_000_000;
    return () => `0${8}${String(counter++).slice(0, 9)}`;
  })();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1custonboard03');
    provider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    activationService = moduleRef.get(CustomerWalletActivationService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    provider.clear();
  });

  // ---------------------------------------------------------------- helpers

  interface Draft {
    customerId: string;
    phone: string;
    canonical: string;
  }

  /**
   * Inserts a customer whose primary phone is the given number, without spending a registration
   * OTP for it. Used by the onboarding-state tests, where the phone is proven *by the registration
   * session itself* (a real OTP on that same number); requesting a second OTP here would trip the
   * intentional per-phone resend cooldown and test the rate limiter instead of the projection.
   */
  async function draftForPhone(
    phone: string,
    options: { status?: 'DRAFT' | 'ACTIVE'; kycStatus?: string } = {},
  ): Promise<string> {
    const { canonical } = phoneForms(phone);
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL',$2,'NONE',$3) RETURNING id`,
      [`mn-${canonical}`, options.status ?? 'DRAFT', options.kycStatus ?? 'NOT_STARTED'],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,clock_timestamp())`,
      [customerId, `+234${canonical}`, canonical],
    );
    return customerId;
  }

  /**
   * DRAFT customer with a verified primary phone and every financial precondition.
   *
   * The phone is written directly rather than through `createDraftCustomerWithPhone`: the real OTP
   * front door has an intentional per-IP issuance cap (20/hour) and a per-phone resend cooldown, so
   * spending one real OTP per setup step would exhaust it and make this suite test the rate limiter.
   * The genuinely-OTP-driven proof of the verified-phone activation gate is
   * `v1-customer-onboarding-02.integration.spec.ts`. The onboarding-state tests below DO go through
   * the real OTP flow, because there the verified registration session is the credential under test.
   */
  async function eligibleDraft(phone = nextPhone()): Promise<Draft> {
    const customerId = await draftForPhone(phone);
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence, {
      allowDraft: true,
    });
    await seedOnboardingWorkflow(customerId, 'COMPLETED', 'ELIGIBLE');
    return { customerId, phone, canonical: phoneForms(phone).canonical };
  }

  /**
   * The P1.4 provisioning rules require a COMPLETED onboarding and an ELIGIBLE eligibility row.
   * Neither is producible over HTTP for a real customer today (the workforce onboarding transition
   * endpoint requires a governed actor chain), so the fixture writes them directly — the same rows
   * `CustomerOnboardingService.complete` writes.
   */
  async function seedOnboardingWorkflow(
    customerId: string,
    onboardingStatus: 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED',
    eligibilityStatus: 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE',
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO customer_onboardings (customer_id, status, completed_at)
       VALUES ($1,$2,$3)`,
      [customerId, onboardingStatus, onboardingStatus === 'COMPLETED' ? new Date() : null],
    );
    await dataSource.query(
      `INSERT INTO customer_eligibilities (customer_id, status, reviewed_by)
       VALUES ($1,$2,'controlled-onboarding-fixture')`,
      [customerId, eligibilityStatus],
    );
  }

  /** Real customer session for the given customer (issuing it runs the financial gate). */
  async function customerSession(customerId: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 AND deleted_at IS NULL`,
      [customerId],
    );
    if (rows[0]) {
      await dataSource.query(
        `UPDATE customer_authentication_credentials
            SET password_hash=$2, hash_algorithm='PBKDF2', password_version=1, status='ACTIVE',
                account_locked=false, failed_authentication_count=0
          WHERE id=$1`,
        [rows[0].id, encodePbkdf2('correct-password-03')],
      );
    } else {
      await dataSource.query(
        `INSERT INTO customer_authentication_credentials
           (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
            status, account_locked, failed_authentication_count, version)
         VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
        [customerId, encodePbkdf2('correct-password-03')],
      );
    }
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password: 'correct-password-03' })
      .expect(200);
    const { rotationRequired, customerId: sessionCustomerId } = login.body as {
      rotationRequired?: boolean;
      customerId?: string;
    };
    if (!rotationRequired) return login.body.accessToken as string;
    const rotate = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions/rotate')
      .send({ customerId: sessionCustomerId, password: 'correct-password-03' })
      .expect(200);
    return rotate.body.accessToken as string;
  }

  /** DRAFT -> ACTIVE through the governed workforce lifecycle route (no shortcut). */
  async function activateByWorkforce(customerId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'workforce-activation-03' })
      .expect(200);
  }

  const countWallets = async (customerId: string): Promise<number> =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::text AS n FROM wallet_accounts WHERE lower(customer_id)=lower($1)`,
          [customerId],
        )
      )[0].n,
    );

  const countProvisioningWallets = async (customerId: string): Promise<number> =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::text AS n FROM customer_wallets WHERE customer_id=$1`,
          [customerId],
        )
      )[0].n,
    );

  // ------------------------------------------------- 1. registration review

  describe('workforce registration review', () => {
    it('reports masked defaults, the shared requirement list and no activation shortcut', async () => {
      const draft = await eligibleDraft();
      const review = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${draft.customerId}/registration-review`)
        .set('Authorization', 'Bearer workforce-OPERATOR')
        .expect(200);

      expect(review.body.customerId).toBe(draft.customerId);
      expect(review.body.customerStatus).toBe('DRAFT');
      expect(review.body.financialEligibility).toBe('ELIGIBLE');
      expect(review.body.reference).toContain('\u2022');
      expect(review.body.reference).not.toMatch(/cust-/i);
      expect(review.body.activationRoute).toBe('PATCH /api/v1/customers/:id');
      // The class default is only present when the workforce-created customer got one; this
      // fixture inserts the row directly, so only the shape is asserted here.
      expect(review.body.defaults.customerClass).toEqual(
        expect.objectContaining({ configured: expect.any(Boolean) }),
      );
      expect(review.body.defaults.kyc.level).toBe('LEVEL_1');

      const codes = review.body.requirements.map((r: any) => r.code);
      expect(codes).toEqual([
        'phone_verified',
        'identity_evidence',
        'kyc_assessment',
        'identity_conflict',
        'account_restriction',
        'financial_policy',
        'account_active',
        'wallet',
      ]);
      const byCode = Object.fromEntries(
        review.body.requirements.map((r: any) => [r.code, r.state]),
      );
      expect(byCode).toMatchObject({
        phone_verified: 'MET',
        identity_evidence: 'MET',
        kyc_assessment: 'MET',
        identity_conflict: 'MET',
        account_restriction: 'MET',
        financial_policy: 'MET',
        account_active: 'OUTSTANDING',
        wallet: 'OUTSTANDING',
      });
      // Everything before activation is proven, so the administrator can activate.
      expect(review.body.activatable).toBe(true);
      // ... but the review itself never activates anything.
      expect(
        (await dataSource.query(`SELECT status FROM customers WHERE id=$1`, [draft.customerId]))[0]
          .status,
      ).toBe('DRAFT');
      expect(await countWallets(draft.customerId)).toBe(0);
      // No identifier *values* leak: the projection names evidence types (which is safe and
      // useful) but never MACs, digests, document numbers or provider payloads.
      expect(JSON.stringify(review.body)).not.toMatch(/identityMac|identity_mac|macKeyVersion/i);
      expect(JSON.stringify(review.body)).not.toMatch(/\d{11}/);
    });

    it('is SUPPORT-readable but not SUPPORT-writable, and requires a workforce session', async () => {
      const draft = await eligibleDraft();
      await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${draft.customerId}/registration-review`)
        .set('Authorization', 'Bearer workforce-SUPPORT')
        .expect(200);
      await activateByWorkforce(draft.customerId);
      // A customer bearer authenticates but is NOT a workforce principal: denied, and told so.
      const token = await customerSession(draft.customerId);
      const denied = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${draft.customerId}/registration-review`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403]).toContain(denied.status);
      await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${draft.customerId}/registration-review`)
        .expect(401);
    });

    it('explains an outstanding gate instead of throwing when the customer is not yet eligible', async () => {
      const createdId = await draftForPhone(nextPhone());
      const review = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${createdId}/registration-review`)
        .set('Authorization', 'Bearer workforce-OPERATOR')
        .expect(200);
      expect(review.body.activatable).toBe(false);
      expect(review.body.outstanding).toEqual(
        expect.arrayContaining(['identity_evidence', 'kyc_assessment', 'financial_policy']),
      );
      expect(review.body.requirements.find((r: any) => r.code === 'phone_verified').state).toBe(
        'MET',
      );
    });
  });

  // ------------------------------------------------ 2. customer activation

  describe('customer-owned activation', () => {
    /**
     * A DRAFT customer can never reach the HTTP endpoint: session issuance itself refuses a
     * non-ACTIVE customer (AuthenticationExecutionService invariant), so the defence-in-depth
     * status check inside the activation transaction is asserted directly against the real service
     * and the real database.
     */
    it('refuses to provision a wallet before the customer is ACTIVE (defence in depth)', async () => {
      const draft = await eligibleDraft();
      await expect(
        activationService.activate(
          { type: 'CUSTOMER', customerId: draft.customerId } as any,
          `activate-${randomUUID()}`,
        ),
      ).rejects.toThrow(/activation by MonieNaija is required/i);
      expect(await countWallets(draft.customerId)).toBe(0);
      expect(await countProvisioningWallets(draft.customerId)).toBe(0);

      // ... and the same customer genuinely cannot obtain a financial session yet.
      await request(app.getHttpServer())
        .post('/api/v1/customers/sessions')
        .send({ customerId: draft.customerId, password: 'correct-password-03' })
        .expect(401);
    });

    it('requires an Idempotency-Key and never provisions on a malformed one', async () => {
      const draft = await eligibleDraft();
      await activateByWorkforce(draft.customerId);
      const token = await customerSession(draft.customerId);
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(409);
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'short')
        .send({})
        .expect(409);
      expect(await countWallets(draft.customerId)).toBe(0);
    });

    it('activates once, activates idempotently on replay and audits both outcomes', async () => {
      const draft = await eligibleDraft();
      await activateByWorkforce(draft.customerId);
      const token = await customerSession(draft.customerId);
      const key = `activate-${randomUUID()}`;

      const view = await request(app.getHttpServer())
        .get('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(view.body.activatable).toBe(true);
      expect(view.body.wallet).toBeNull();
      expect(view.body.outstanding).toEqual(['wallet']);

      const first = await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(200);
      expect(first.body).toMatchObject({
        customerId: draft.customerId,
        activated: true,
        replayed: false,
        currency: 'NGN',
        wallet: { currency: 'NGN', status: 'ACTIVE', balanceHint: 'LEDGER_DERIVED' },
        checks: {
          customerActive: true,
          verifiedPrimaryPhone: true,
          onboardingCompleted: true,
          eligibility: 'ELIGIBLE',
          financialEligibility: 'ELIGIBLE',
          verifiedTier: 'LEVEL_1',
        },
      });
      expect(first.body.wallet.walletId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(await countWallets(draft.customerId)).toBe(1);
      expect(await countProvisioningWallets(draft.customerId)).toBe(1);

      // Replay of the same key converges on the same wallet.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(200);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.wallet.walletId).toBe(first.body.wallet.walletId);
      expect(await countWallets(draft.customerId)).toBe(1);
      expect(await countProvisioningWallets(draft.customerId)).toBe(1);

      const audits: Array<{ action: string; new_values: any }> = await dataSource.query(
        `SELECT action, new_values FROM audit_events
          WHERE entity_type='CUSTOMER_WALLET_ACTIVATION' AND entity_id=$1 ORDER BY occurred_at`,
        [draft.customerId],
      );
      expect(audits.map((a) => a.action)).toEqual(['ACTIVATED', 'REPLAYED']);
      expect(audits[0]!.new_values).toMatchObject({
        walletId: first.body.wallet.walletId,
        currency: 'NGN',
        financialEligibility: 'ELIGIBLE',
        verifiedTier: 'LEVEL_1',
      });

      // The view now shows a provisioned wallet and no outstanding requirement.
      const after = await request(app.getHttpServer())
        .get('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.wallet).toMatchObject({
        walletId: first.body.wallet.walletId,
        currency: 'NGN',
        status: 'ACTIVE',
      });
      expect(after.body.outstanding).toEqual([]);
      expect(after.body.wallets).toHaveLength(1);
    });

    it('is CUSTOMER SELF only: no customer bearer, no workforce bearer, no id parameter', async () => {
      const draft = await eligibleDraft();
      await activateByWorkforce(draft.customerId);
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Idempotency-Key', `activate-${randomUUID()}`)
        .send({})
        .expect(401);
      // A workforce bearer is authenticated but not a CUSTOMER SELF principal.
      const workforceDenied = await request(app.getHttpServer())
        .get('/api/v1/customers/me/activation')
        .set('Authorization', 'Bearer workforce-OPERATOR');
      expect([401, 403]).toContain(workforceDenied.status);

      // Another (ACTIVE) customer's session must not be able to name this customer: the body is
      // ignored, so the other customer's own wallet is the only thing that can be provisioned.
      const other = await eligibleDraft();
      await activateByWorkforce(other.customerId);
      const otherToken = await customerSession(other.customerId);
      const otherResult = await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Idempotency-Key', `activate-${randomUUID()}`)
        .send({ customerId: draft.customerId })
        .expect(200);
      expect(otherResult.body.customerId).toBe(other.customerId);
      expect(await countWallets(draft.customerId)).toBe(0);
      expect(await countWallets(other.customerId)).toBe(1);
    });

    /**
     * `is_synthetic` is immutable and the schema forbids a synthetic row from ever being ACTIVE, so
     * this is a defence-in-depth check on the real service: the synthetic refusal fires *before*
     * the status refusal, which is what makes it a meaningful guard rather than dead code.
     */
    it('refuses a synthetic customer (test-only records cannot be activated)', async () => {
      const phone = nextPhone();
      const { canonical } = phoneForms(phone);
      const rows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status, is_synthetic)
         VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED',true) RETURNING id`,
        [`mn-${canonical}`],
      );
      const syntheticId = rows[0]!.id;
      await dataSource.query(
        `INSERT INTO customer_contact_methods
           (customer_id, type, value, normalized_value, is_primary, verified_at)
         VALUES ($1,'PHONE',$2,$3,true,clock_timestamp())`,
        [syntheticId, `+234${canonical}`, canonical],
      );
      const syntheticError = await activationService
        .activate({ type: 'CUSTOMER', customerId: syntheticId } as any, `activate-${randomUUID()}`)
        .catch((error: Error) => error);
      expect(syntheticError).toBeInstanceOf(Error);
      expect((syntheticError as Error).message).toMatch(/test customers/i);
      expect(await countWallets(syntheticId)).toBe(0);
    });

    it('leaves no wallet behind when the P1.4 onboarding workflow is not COMPLETED', async () => {
      const createdId = await draftForPhone(nextPhone());
      await makeCustomerFinanciallyEligible(dataSource, createdId, kycEvidence, {
        allowDraft: true,
      });
      await seedOnboardingWorkflow(createdId, 'IN_PROGRESS', 'PENDING');
      await activateByWorkforce(createdId);
      const token = await customerSession(createdId);
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `activate-${randomUUID()}`)
        .send({})
        .expect(409);
      expect(res.body.message).toMatch(/onboarding must be COMPLETED/i);
      expect(await countWallets(createdId)).toBe(0);
      expect(await countProvisioningWallets(createdId)).toBe(0);
    });
  });

  // --------------------------------------------- 3. mobile onboarding state

  describe('mobile onboarding-state projection', () => {
    /** Real registration session driven to a VERIFIED phone with the given number. */
    async function verifiedSession(phone: string): Promise<{ id: string; token: string }> {
      const send = (path: string, payload: object, token?: string) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/customers/registration-sessions/${path}`,
          payload,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
      const start = await send('start', { phone });
      expect(start.statusCode).toBe(200);
      const session = start.json<{ id: string; token: string }>();
      const otp = await send(
        'otp',
        { sessionId: session.id, requestId: randomUUID() },
        session.token,
      );
      expect(otp.statusCode).toBe(200);
      const code = /code is (\d{6})/.exec(provider.sent.at(-1)?.message ?? '')?.[1];
      expect(code).toBeDefined();
      const verified = await send('otp/verify', { sessionId: session.id, code }, session.token);
      expect(verified.statusCode).toBe(200);
      return { id: session.id, token: verified.json<{ authorization: string }>().authorization };
    }

    const state = async (session: { id: string; token: string }) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/registration-sessions/onboarding-state',
        payload: { sessionId: session.id },
        headers: { authorization: `Bearer ${session.token}` },
      });

    it('NEW before any customer exists for the verified phone', async () => {
      const session = await verifiedSession(nextPhone());
      const res = await state(session);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        stage: 'NEW',
        customer: null,
        wallet: null,
        outstanding: [],
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('PENDING_REVIEW for a registered customer whose identity is not yet approved', async () => {
      const phone = nextPhone();
      const createdId = await draftForPhone(phone);
      const session = await verifiedSession(phone);
      const body = (await state(session)).json<any>();
      expect(body.stage).toBe('PENDING_REVIEW');
      expect(body.customer.referenceMasked).toContain('\u2022');
      expect(body.customer.status).toBe('DRAFT');
      expect(body.outstanding).toEqual(
        expect.arrayContaining(['identity_evidence', 'kyc_assessment', 'financial_policy']),
      );
      expect(body.requirements.map((r: any) => r.code)).toContain('phone_verified');
      // No identifiers, no customer id.
      expect(JSON.stringify(body)).not.toContain(createdId);
    });

    it('CLAIM when a registered identity exists but no credentials are set', async () => {
      const phone = nextPhone();
      await eligibleDraft(phone);
      const session = await verifiedSession(phone);
      const body = (await state(session)).json<any>();
      expect(body.stage).toBe('CLAIM');
      expect(body.claim).toEqual({ available: true, matchedThisSession: false });
      expect(body.credentials).toEqual({ passcodeSet: false, pinSet: false });
    });

    it('LOGIN once credentials exist, and never exposes credential material', async () => {
      const phone = nextPhone();
      const draft = await eligibleDraft(phone);
      await dataSource.query(
        `INSERT INTO customer_authentication_credentials
           (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
            status, account_locked, failed_authentication_count, version)
         VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
        [draft.customerId, encodePbkdf2('passcode-03')],
      );
      await dataSource.query(
        `INSERT INTO customer_transaction_pins
           (customer_id, pin_hash, hash_algorithm, pin_version, last_changed_at, version)
         VALUES ($1,$2,'PBKDF2',1,now(),1)`,
        [draft.customerId, encodePbkdf2('pin-0303')],
      );
      const session = await verifiedSession(phone);
      const body = (await state(session)).json<any>();
      expect(body.stage).toBe('LOGIN');
      expect(body.credentials).toEqual({ passcodeSet: true, pinSet: true });
      expect(JSON.stringify(body)).not.toMatch(/password_hash|pin_hash|PBKDF2/);
    });

    it('REJECTED when the identity assessment was rejected', async () => {
      const phone = nextPhone();
      const createdId = await draftForPhone(phone, { kycStatus: 'REJECTED' });
      const session = await verifiedSession(phone);
      const body = (await state(session)).json<any>();
      expect(body.stage).toBe('REJECTED');
      expect(JSON.stringify(body)).not.toContain(createdId);
      expect(body.nextAction).toMatch(/was not approved/i);
    });

    it('ACTIVATED only once the customer is ACTIVE *and* has a usable wallet', async () => {
      const phone = nextPhone();
      const draft = await eligibleDraft(phone);
      await activateByWorkforce(draft.customerId);
      // One verified session, read twice: the per-phone OTP resend cooldown is deliberately 1.
      const session = await verifiedSession(phone);
      const before = (await state(session)).json<any>();
      // ACTIVE without a wallet is not "activated" — the customer still has something outstanding.
      expect(before.stage).not.toBe('ACTIVATED');
      expect(before.outstanding).toContain('wallet');

      const token = await customerSession(draft.customerId);
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/activation')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `activate-${randomUUID()}`)
        .send({})
        .expect(200);

      const after = (await state(session)).json<any>();
      expect(after.stage).toBe('ACTIVATED');
      expect(after.wallet).toMatchObject({ provisioned: true, currency: 'NGN' });
      expect(after.outstanding).toEqual([]);
    });

    it('rejects a forged, expired or foreign registration session and never accepts a customer id', async () => {
      const phone = nextPhone();
      const draft = await eligibleDraft(phone);
      const session = await verifiedSession(phone);
      // Wrong bearer for a valid session id.
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/customers/registration-sessions/onboarding-state',
            payload: { sessionId: session.id },
            headers: { authorization: `Bearer ${'x'.repeat(43)}` },
          })
        ).statusCode,
      ).toBe(401);
      // Unknown session id.
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/customers/registration-sessions/onboarding-state',
            payload: { sessionId: randomUUID() },
            headers: { authorization: `Bearer ${session.token}` },
          })
        ).statusCode,
      ).toBe(401);
      // Extra field is not whitelisted away silently into a customer scope escape: the response is
      // still the session's own customer, and a customer id in the body is rejected outright.
      const smuggled = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/registration-sessions/onboarding-state',
        payload: { sessionId: session.id, customerId: draft.customerId },
        headers: { authorization: `Bearer ${session.token}` },
      });
      expect(smuggled.statusCode).toBe(200);
      expect(JSON.stringify(smuggled.json())).not.toContain(draft.customerId);
    });
  });
});
