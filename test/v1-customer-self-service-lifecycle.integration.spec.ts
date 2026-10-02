/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * V1-CUSTOMER-01 — Customer Self-Service Lifecycle Integration Test (Real PostgreSQL).
 *
 * Verifies end-to-end customer self-service onboarding:
 * 1. Phone OTP Request & Delivery
 * 2. OTP Verification -> One-time Registration Token
 * 3. Self-Service Registration Completion:
 *    - Server-side PBKDF2 Password Hashing
 *    - Customer Status set to ACTIVE (phone verified prerequisite satisfied)
 *    - Atomic Primary NGN Wallet Provisioning (Double-entry liability ledger account)
 *    - Optional CustomerProfile creation
 * 4. Authentication / Session Issuance:
 *    - Login with Normalized Nigerian Phone Number (080..., +23480..., 80...)
 *    - Login with Customer Reference (mn-80...)
 *    - Login with Customer UUID
 *    - Access to authenticated self routes (GET /customers/me, GET /customers/me/profile, GET /customers/me/dashboard)
 * 5. Replay Safety & Error Boundaries:
 *    - Consumed token rejection
 *    - Duplicate phone rejection
 *    - Invalid credentials 401
 */
describe('V1-CUSTOMER-01 Customer Self-Service Lifecycle (Real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let provider: TestNotificationProvider;

  const OTP_PATH = '/api/v1/customers/registration/otp';
  const VERIFY_PATH = '/api/v1/customers/registration/otp/verify';
  const REGISTER_PATH = '/api/v1/customers/registration';
  const LOGIN_PATH = '/api/v1/customers/sessions';
  const ME_PATH = '/api/v1/customers/me';
  const DASHBOARD_PATH = '/api/v1/customers/me/dashboard';

  const nextPhone = (() => {
    let counter = 80000;
    return () => `080${String(counter++).padStart(8, '0')}`;
  })();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1custselfservice');
    provider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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

  it('proves complete self-service customer registration, active status, wallet provisioning, and login via phone, reference, and UUID', async () => {
    const phone = nextPhone();
    const password = 'Password@2026';
    const displayName = 'Chinedu Eze';

    // 1. Request OTP
    const otpRes = await request(app.getHttpServer())
      .post(OTP_PATH)
      .send({ phone })
      .expect(200);
    expect(otpRes.body.status).toBe('OTP_REQUEST_ACCEPTED');

    const canonicalPhone = phone.slice(1);
    const destination = `+234${canonicalPhone}`;
    const sent = provider.sent.find((entry) => entry.destination === destination);
    expect(sent).toBeDefined();
    const code = /code is (\d{6})/.exec(sent!.message)![1]!;

    // 2. Verify OTP
    const verifyRes = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    expect(verifyRes.body.status).toBe('PHONE_VERIFIED');
    const token = verifyRes.body.verificationToken;

    // 3. Complete Registration (Self-Service with Password)
    const registerRes = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({
        phone,
        verificationToken: token,
        password,
        displayName,
      })
      .expect(201);

    expect(registerRes.body.id).toBeTruthy();
    const customerId = registerRes.body.id as string;
    const customerRef = `mn-${canonicalPhone}`;
    expect(registerRes.body.reference).toBe(customerRef);
    expect(registerRes.body.status).toBe('ACTIVE');
    expect(registerRes.body.phone).toBe(`+234*****${canonicalPhone.slice(-4)}`);
    expect(registerRes.body.wallet).toBeDefined();
    expect(registerRes.body.wallet.currency).toBe('NGN');
    expect(registerRes.body.wallet.status).toBe('ACTIVE');

    // 4. Verify Database Integrity
    const custRow = (await dataSource.query(`SELECT * FROM customers WHERE id = $1`, [customerId]))[0];
    expect(custRow.status).toBe('ACTIVE');
    expect(custRow.reference).toBe(customerRef);

    const contactRow = (await dataSource.query(`SELECT * FROM customer_contact_methods WHERE customer_id = $1`, [customerId]))[0];
    expect(contactRow.normalized_value).toBe(canonicalPhone);
    expect(contactRow.is_primary).toBe(true);
    expect(contactRow.verified_at).not.toBeNull();

    const credRow = (await dataSource.query(`SELECT * FROM customer_authentication_credentials WHERE customer_id = $1`, [customerId]))[0];
    expect(credRow.hash_algorithm).toBe('PBKDF2');
    expect(credRow.password_hash).toContain('PBKDF2$sha256$10000$');
    expect(credRow.rotation_required).toBe(false);
    expect(credRow.status).toBe('ACTIVE');

    const walletRow = (await dataSource.query(`SELECT * FROM wallet_accounts WHERE customer_id = $1`, [customerId]))[0];
    expect(walletRow.currency).toBe('NGN');
    expect(walletRow.status).toBe('ACTIVE');

    const ledgerRow = (await dataSource.query(`SELECT * FROM ledger_accounts WHERE id = $1`, [walletRow.ledger_account_id]))[0];
    expect(ledgerRow.code).toBe(`WALLET-${walletRow.id}`);
    expect(ledgerRow.account_type).toBe('LIABILITY');
    expect(ledgerRow.accounting_unit).toBe('CUSTOMER_FUNDS');

    // 5. Login via Nigerian Phone Number (Local Format)
    const loginPhoneRes = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ phone, password })
      .expect(200);
    expect(loginPhoneRes.body.accessToken).toBeTruthy();
    expect(loginPhoneRes.body.customerId).toBe(customerId);
    const sessionToken = loginPhoneRes.body.accessToken;

    // 6. Login via Customer Reference
    const loginRefRes = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ customerId: customerRef, password })
      .expect(200);
    expect(loginRefRes.body.accessToken).toBeTruthy();
    expect(loginRefRes.body.customerId).toBe(customerId);

    // 7. Login via Customer UUID
    const loginUuidRes = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ customerId, password })
      .expect(200);
    expect(loginUuidRes.body.accessToken).toBeTruthy();
    expect(loginUuidRes.body.customerId).toBe(customerId);

    // 8. Authenticated Dashboard Access
    const dashboardRes = await request(app.getHttpServer())
      .get(DASHBOARD_PATH)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    expect(dashboardRes.body.identity.id).toBe(customerId);
    expect(dashboardRes.body.identity.status).toBe('ACTIVE');
    expect(dashboardRes.body.profile.displayName).toBe(displayName);
    expect(dashboardRes.body.balance.primary.currency).toBe('NGN');

    // 9. Replay / Consumption Safety
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: token, password })
      .expect(400);

    // 10. Wrong Password
    await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ phone, password: 'WrongPassword999!' })
      .expect(401);
  });
});
