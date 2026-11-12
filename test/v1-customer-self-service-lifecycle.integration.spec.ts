/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports */
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

/** Legacy self-service completion remains closed until genuine KYC is available. */
describe('V1-CUSTOMER-01 Customer Self-Service Lifecycle (Real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let provider: TestNotificationProvider;

  const OTP_PATH = '/api/v1/customers/registration/otp';
  const VERIFY_PATH = '/api/v1/customers/registration/otp/verify';
  const REGISTER_PATH = '/api/v1/customers/registration';

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

  it('rejects legacy completion without consuming proof or creating customer, credential or wallet', async () => {
    const phone = nextPhone();
    const password = 'Password@2026';
    const displayName = 'Chinedu Eze';

    // 1. Request OTP
    const otpRes = await request(app.getHttpServer()).post(OTP_PATH).send({ phone }).expect(200);
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

    const counts = () =>
      dataSource.query(`SELECT (SELECT count(*) FROM customers) AS customers,
      (SELECT count(*) FROM customer_authentication_credentials) AS credentials,
      (SELECT count(*) FROM wallet_accounts) AS wallets`);
    const before = await counts();
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: token, password, displayName })
      .expect(503);
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: token })
      .expect(503);
    expect(await counts()).toEqual(before);
    const challenge = await dataSource.query(
      `SELECT status,consumed_at FROM customer_registration_phone_challenges WHERE normalized_phone=$1`,
      [canonicalPhone],
    );
    expect(challenge[0]).toMatchObject({ status: 'VERIFIED', consumed_at: null });
  });
});
