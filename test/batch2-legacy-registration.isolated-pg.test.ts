import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { PasswordHashAlgorithm } from '../src/customer-authentication/customer-authentication.enums';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const name = `kyc_batch2_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
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

beforeAll(async () => {
  await admin.initialize();
  const [location] = await admin.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const [listen] = await admin.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const [version] = await admin.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(location?.data_directory ?? '') ||
    listen?.listen_addresses !== '' ||
    !version?.server_version.startsWith('16.')
  )
    throw new Error('Not an independently isolated PostgreSQL 16 cluster');
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: socket,
    port: 55461,
    username: 'kyc_synthetic',
    database: name,
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
    .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 180_000);
afterAll(async () => {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin.isInitialized) {
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.destroy();
  }
});

test('legacy HTTP completion cannot consume phone proof, create a customer, credential or wallet', async () => {
  const phone = '08012345678';
  const requestOtp = await app.inject({
    method: 'POST',
    url: '/api/v1/customers/registration/otp',
    payload: { phone },
  });
  expect(requestOtp.statusCode).toBe(200);
  const code = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
  expect(code).toBeDefined();
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/customers/registration/otp/verify',
    payload: { phone, code },
  });
  expect(verify.statusCode).toBe(200);
  const { verificationToken } = verify.json<{ verificationToken: string }>();
  const counts = async () =>
    db.query<Array<{ customers: string; wallets: string; credentials: string }>>(
      `SELECT (SELECT count(*) FROM customers) AS customers,(SELECT count(*) FROM wallet_accounts) AS wallets,(SELECT count(*) FROM customer_authentication_credentials) AS credentials`,
    );
  const before = await counts();
  const responses = await Promise.all(
    [true, false, true].map((withPassword) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/customers/registration',
        payload: {
          phone,
          verificationToken,
          ...(withPassword ? { password: 'SyntheticPassword123!' } : {}),
        },
      }),
    ),
  );
  expect(responses.map((r) => r.statusCode)).toEqual([503, 503, 503]);
  expect(await counts()).toEqual(before);
  const [challenge] = await db.query<Array<{ status: string; consumed_at: Date | null }>>(
    'SELECT status,consumed_at FROM customer_registration_phone_challenges WHERE normalized_phone=$1',
    ['8012345678'],
  );
  expect(challenge).toEqual({ status: 'VERIFIED', consumed_at: null });
});

test.each(['BVN', 'NIN'] as const)(
  'full AppModule creates one isolated %s synthetic draft with idempotent completion',
  async (kind) => {
    await db.query(
      `UPDATE kyc_provider_configuration SET version=1, configuration='{"providers":{"MONNIFY":{"enabled":false,"capabilities":[]},"SYNTHETIC":{"enabled":true,"capabilities":["BVN","NIN"]}},"routes":{"BVN":{"primary":"SYNTHETIC","fallback":null},"NIN":{"primary":"SYNTHETIC","fallback":null}}}'::jsonb WHERE singleton=true`,
    );
    const send = (path: string, payload: object, token?: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/customers/registration-sessions/${path}`,
        payload,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    const before = await db.query<
      Array<{ customers: string; wallets: string; credentials: string }>
    >(
      'SELECT (SELECT count(*) FROM customers) AS customers,(SELECT count(*) FROM wallet_accounts) AS wallets,(SELECT count(*) FROM customer_authentication_credentials) AS credentials',
    );
    const start = await send('start', { phone: kind === 'BVN' ? '08022223331' : '08022223332' });
    expect(start.statusCode).toBe(200);
    const s = start.json<{ id: string; token: string }>();
    expect((await send('onboarding-route', { sessionId: s.id }, s.token)).statusCode).toBe(401);
    expect(
      (await send('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
    ).toBe(200);
    const code = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
    expect(code).toBeDefined();
    const verified = await send('otp/verify', { sessionId: s.id, code }, s.token);
    expect(verified.statusCode).toBe(200);
    const { authorization } = verified.json<{ authorization: string }>();
    expect((await send('onboarding-route', { sessionId: s.id }, authorization)).json()).toEqual({
      next: 'NEW',
    });
    expect(
      (
        await send(
          'synthetic-profile',
          {
            sessionId: s.id,
            firstName: 'Synthetic',
            lastName: 'Person',
            dateOfBirth: '2000-01-01',
          },
          authorization,
        )
      ).statusCode,
    ).toBe(200);
    const consent = await send(
      'consent',
      {
        sessionId: s.id,
        requestId: randomUUID(),
        kind,
        accepted: true,
        noticeVersion: 'synthetic-test-v1',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
      authorization,
    );
    expect(consent.statusCode).toBe(200);
    const response = await send(
      'synthetic-verification',
      {
        sessionId: s.id,
        requestId: randomUUID(),
        consentId: consent.json<{ id: string }>().id,
        kind,
        identifier: '00000000000',
      },
      authorization,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'MATCH', simulated: true });
    const attemptId = response.json<{ id: string }>().id;
    const complete = () =>
      send('synthetic-complete', { sessionId: s.id, attemptId }, authorization);
    const replies = await Promise.all([complete(), complete(), complete()]);
    expect(replies.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const oldEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect((await complete()).statusCode).toBe(503);
      const isolatedOnly = {
        sessionId: s.id,
        passcode: '112233',
        passcodeConfirmation: '112233',
        pin: '334455',
        pinConfirmation: '334455',
      };
      expect((await send('synthetic-credentials', isolatedOnly, authorization)).statusCode).toBe(
        503,
      );
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
    const customerId = replies[0].json<{ customerId: string }>().customerId;
    expect(replies.map((r) => r.json<{ customerId: string }>().customerId)).toEqual([
      customerId,
      customerId,
      customerId,
    ]);
    expect((await complete()).json()).toMatchObject({
      customerId,
      status: 'DRAFT',
      kind,
      simulated: true,
    });
    expect(
      await db.query('SELECT status,is_synthetic,kyc_level,kyc_status FROM customers WHERE id=$1', [
        customerId,
      ]),
    ).toEqual([
      { status: 'DRAFT', is_synthetic: true, kyc_level: 'NONE', kyc_status: 'NOT_STARTED' },
    ]);
    expect(
      await db.query(
        'SELECT session_id,attempt_id,customer_id,kind,provider,match_outcome FROM kyc_registration_synthetic_customer_links WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([
      {
        session_id: s.id,
        attempt_id: attemptId,
        customer_id: customerId,
        kind,
        provider: 'SYNTHETIC',
        match_outcome: 'MATCH',
      },
    ]);
    expect(
      (await send('synthetic-complete', { sessionId: s.id, attemptId }, 'x'.repeat(43))).statusCode,
    ).toBe(401);
    expect(
      (
        await send(
          'synthetic-complete',
          { sessionId: s.id, attemptId: randomUUID() },
          authorization,
        )
      ).statusCode,
    ).toBe(401);
    await expect(
      db.query("UPDATE customers SET status='ACTIVE' WHERE id=$1", [customerId]),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE customers SET is_synthetic=false WHERE id=$1', [customerId]),
    ).rejects.toThrow();
    await expect(
      db.query(
        "INSERT INTO customer_operating_permissions(id,customer_id,type) VALUES($1,$2,'TEST')",
        [randomUUID(), customerId],
      ),
    ).rejects.toThrow();
    const after = await db.query<
      Array<{ customers: string; wallets: string; credentials: string }>
    >(
      'SELECT (SELECT count(*) FROM customers) AS customers,(SELECT count(*) FROM wallet_accounts) AS wallets,(SELECT count(*) FROM customer_authentication_credentials) AS credentials',
    );
    expect(Number(after[0]!.customers)).toBe(Number(before[0]!.customers) + 1);
    expect(after[0]!.wallets).toBe(before[0]!.wallets);
    expect(after[0]!.credentials).toBe(before[0]!.credentials);
    await db.query("UPDATE kyc_registration_attempts SET state='REVIEW' WHERE id=$1", [attemptId]);
    expect((await complete()).statusCode).toBe(401);
    await db.query("UPDATE kyc_registration_attempts SET state='MATCH' WHERE id=$1", [attemptId]);
    const contact = await db.query<Array<{ normalized_value: string; verified_at: Date }>>(
      "SELECT normalized_value,verified_at FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE'",
      [customerId],
    );
    expect(contact[0]?.normalized_value).toBe(kind === 'BVN' ? '8022223331' : '8022223332');
    expect(contact[0]?.verified_at).toBeTruthy();
    await expect(
      db.query('INSERT INTO wallet_accounts(id,customer_id) VALUES($1,$2)', [
        randomUUID(),
        customerId,
      ]),
    ).rejects.toThrow('Synthetic customer cannot hold financial privileges');
    await expect(
      db.query('INSERT INTO customer_wallets(id,customer_id) VALUES($1,$2)', [
        randomUUID(),
        customerId,
      ]),
    ).rejects.toThrow('Synthetic customer cannot hold financial privileges');

    const setupBody = {
      sessionId: s.id,
      passcode: '112233',
      passcodeConfirmation: '112233',
      pin: '334455',
      pinConfirmation: '334455',
    };
    expect((await send('synthetic-credentials', setupBody, 'x'.repeat(43))).statusCode).toBe(401);
    expect(
      (
        await send(
          'synthetic-credentials',
          { ...setupBody, pin: '112233', pinConfirmation: '112233' },
          authorization,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await send(
          'synthetic-credentials',
          { ...setupBody, passcodeConfirmation: '999999' },
          authorization,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await send('synthetic-credentials/status', { sessionId: s.id }, authorization)).json(),
    ).toMatchObject({ status: 'NOT_SET' });
    const setupReplies = await Promise.all([
      send('synthetic-credentials', setupBody, authorization),
      send('synthetic-credentials', setupBody, authorization),
    ]);
    expect(setupReplies.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await send('synthetic-credentials/status', { sessionId: s.id }, authorization)).json(),
    ).toMatchObject({ status: 'SET_UP' });
    expect((await send('synthetic-credentials', setupBody, authorization)).statusCode).toBe(409);
    const stored = await db.query<Array<{ password_hash: string; pin_hash: string }>>(
      `SELECT a.password_hash,p.pin_hash FROM customer_authentication_credentials a JOIN customer_transaction_pins p ON p.customer_id=a.customer_id WHERE a.customer_id=$1`,
      [customerId],
    );
    expect(stored).toHaveLength(1);
    const verify = new PasswordHashVerificationService();
    expect(
      verify.verify('112233', PasswordHashAlgorithm.PBKDF2, stored[0]!.password_hash).verified,
    ).toBe(true);
    expect(
      verify.verify('334455', PasswordHashAlgorithm.PBKDF2, stored[0]!.pin_hash).verified,
    ).toBe(true);
    expect(
      verify.verify('112233', PasswordHashAlgorithm.PBKDF2, stored[0]!.pin_hash).verified,
    ).toBe(false);
    expect(stored[0]!.password_hash).not.toContain('112233');
    expect(stored[0]!.pin_hash).not.toContain('334455');
    const pinService = app.get(CustomerTransactionPinService);
    const overwrites = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        pinService.setTransactionPin(customerId, {
          pinHash: stored[0]!.pin_hash,
          hashAlgorithm: 'PBKDF2',
          pinVersion: 1,
          actor: 'synthetic-test',
          createOnly: true,
        }),
      ),
    );
    expect(overwrites.map((r) => r.status)).toEqual(['rejected', 'rejected']);

    const pinVerifier = {
      verify: (value: string, _algorithm: string, encoded: string) =>
        verify.verify(value, PasswordHashAlgorithm.PBKDF2, encoded),
    };
    expect(
      (
        await pinService.verifyTransactionPin(
          customerId,
          { pin: '334455', actor: 'synthetic-test' },
          pinVerifier,
        )
      ).verified,
    ).toBe(true);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        pinService.verifyTransactionPin(
          customerId,
          { pin: '000001', actor: 'synthetic-test' },
          pinVerifier,
        ),
      ),
    );
    expect(
      await db.query(
        'SELECT failed_count,account_locked FROM customer_transaction_pins WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ failed_count: 5, account_locked: true }]);
    expect(
      await pinService.verifyTransactionPin(
        customerId,
        { pin: '334455', actor: 'synthetic-test' },
        pinVerifier,
      ),
    ).toMatchObject({ verified: false, locked: true });
    expect(
      verify.verify('112233', PasswordHashAlgorithm.PBKDF2, stored[0]!.password_hash).verified,
    ).toBe(true);
    // Existing full customer sessions must not authenticate an inactive DRAFT.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/sessions',
      payload: { phone: kind === 'BVN' ? '08022223331' : '08022223332', password: '112233' },
    });
    expect(login.statusCode).toBe(401);
    expect(
      await db.query('SELECT count(*)::int AS count FROM wallet_accounts WHERE customer_id=$1', [
        customerId,
      ]),
    ).toEqual([{ count: 0 }]);
    await db.query(
      'UPDATE kyc_registration_consents SET withdrawn_at=clock_timestamp() WHERE id=$1',
      [consent.json<{ id: string }>().id],
    );
    expect((await send('synthetic-credentials', setupBody, authorization)).statusCode).toBe(401);
    // Restore the test fixture for the remaining session-lifecycle assertions.
    await db.query('UPDATE kyc_registration_consents SET withdrawn_at=NULL WHERE id=$1', [
      consent.json<{ id: string }>().id,
    ]);
    // A second verified phone can match the same fake fixture but cannot claim it.
    const s2 = (
      await send('start', { phone: kind === 'BVN' ? '08022223341' : '08022223342' })
    ).json<{ id: string; token: string }>();
    expect(
      (await send('otp', { sessionId: s2.id, requestId: randomUUID() }, s2.token)).statusCode,
    ).toBe(200);
    const code2 = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
    const auth2 = (await send('otp/verify', { sessionId: s2.id, code: code2 }, s2.token)).json<{
      authorization: string;
    }>().authorization;
    expect(
      (
        await send(
          'synthetic-profile',
          {
            sessionId: s2.id,
            firstName: 'Synthetic',
            lastName: 'Person',
            dateOfBirth: '2000-01-01',
          },
          auth2,
        )
      ).statusCode,
    ).toBe(200);
    const c2 = await send(
      'consent',
      {
        sessionId: s2.id,
        requestId: randomUUID(),
        kind,
        accepted: true,
        noticeVersion: 'synthetic-test-v1',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
      auth2,
    );
    const c2id = c2.json<{ id: string }>().id;
    const a2 = await send(
      'synthetic-verification',
      {
        sessionId: s2.id,
        requestId: randomUUID(),
        consentId: c2id,
        kind,
        identifier: '00000000000',
      },
      auth2,
    );
    expect(a2.json()).toMatchObject({ status: 'MATCH' });
    const a2id = a2.json<{ id: string }>().id;
    expect(
      (await send('synthetic-complete', { sessionId: s2.id, attemptId }, auth2)).statusCode,
    ).toBe(401);
    expect(
      (await send('synthetic-complete', { sessionId: s2.id, attemptId: a2id }, auth2)).statusCode,
    ).toBe(409);
    expect(
      (await send('consent/withdraw', { sessionId: s2.id, consentId: c2id }, auth2)).statusCode,
    ).toBe(200);
    expect(
      (await send('synthetic-complete', { sessionId: s2.id, attemptId: a2id }, auth2)).statusCode,
    ).toBe(401);
    expect(
      await db.query(
        'SELECT count(*)::int AS count FROM kyc_registration_synthetic_customer_links WHERE session_id=$1',
        [s2.id],
      ),
    ).toEqual([{ count: 0 }]);
    // OTP-bound passcode login issues an onboarding-only bearer, never customer-api access.
    expect((await send('onboarding-route', { sessionId: s.id }, 'x'.repeat(43))).statusCode).toBe(
      401,
    );
    expect((await send('onboarding-route', { sessionId: s.id }, authorization)).json()).toEqual({
      next: 'LOGIN',
    });
    const failed = await Promise.all(
      Array.from({ length: 5 }, () =>
        send('onboarding-login', { sessionId: s.id, passcode: '000001' }, authorization),
      ),
    );
    expect(failed.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect(
      (await send('onboarding-login', { sessionId: s.id, passcode: '112233' }, authorization))
        .statusCode,
    ).toBe(401);
    expect(
      await db.query(
        'SELECT failed_authentication_count,account_locked FROM customer_authentication_credentials WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ failed_authentication_count: 5, account_locked: true }]);
    await db.query(
      "UPDATE customer_authentication_credentials SET locked_at=clock_timestamp()-interval '16 minutes' WHERE customer_id=$1",
      [customerId],
    );
    const exchanges = await Promise.all([
      send('onboarding-login', { sessionId: s.id, passcode: '112233' }, authorization),
      send('onboarding-login', { sessionId: s.id, passcode: '112233' }, authorization),
    ]);
    expect(exchanges.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    const bearer = exchanges
      .find((r) => r.statusCode === 200)!
      .json<{ accessToken: string; sessionId: string; audience: string }>();
    expect(bearer.audience).toBe('customer-onboarding');
    expect((await send('onboarding-session', {}, bearer.accessToken)).json()).toMatchObject({
      customerId,
      status: 'ACTIVE',
      audience: 'customer-onboarding',
    });
    await db.query(
      "UPDATE authentication_sessions SET issued_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [bearer.sessionId],
    );
    expect((await send('onboarding-session', {}, bearer.accessToken)).statusCode).toBe(401);
    await db.query(
      "UPDATE authentication_sessions SET issued_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
      [bearer.sessionId],
    );
    await db.query(
      'UPDATE customer_authentication_credentials SET password_version=password_version+1 WHERE customer_id=$1',
      [customerId],
    );
    expect((await send('onboarding-session', {}, bearer.accessToken)).statusCode).toBe(401);
    await db.query(
      'UPDATE customer_authentication_credentials SET password_version=password_version-1 WHERE customer_id=$1',
      [customerId],
    );
    const financial = await app.inject({
      method: 'GET',
      url: '/api/v1/customers/me/wallets',
      headers: { authorization: `Bearer ${bearer.accessToken}` },
    });
    expect(financial.statusCode).not.toBe(200);
    expect((await send('onboarding-logout', {}, bearer.accessToken)).statusCode).toBe(200);
    expect((await send('onboarding-session', {}, bearer.accessToken)).statusCode).toBe(401);
    await db.query(
      "UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [s.id],
    );
    expect((await complete()).statusCode).toBe(401);
    expect((await send('synthetic-credentials', setupBody, authorization)).statusCode).toBe(401);
    expect(
      (await send('synthetic-credentials/status', { sessionId: s.id }, authorization)).statusCode,
    ).toBe(401);
  },
);

test('a real synthetic REVIEW and a missing consent cannot complete a draft', async () => {
  const send = (path: string, payload: object, token?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/customers/registration-sessions/${path}`,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const s = (await send('start', { phone: '08022223359' })).json<{ id: string; token: string }>();
  expect(
    (await send('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
  ).toBe(200);
  const code = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
  const auth = (await send('otp/verify', { sessionId: s.id, code }, s.token)).json<{
    authorization: string;
  }>().authorization;
  expect(
    (
      await send(
        'synthetic-profile',
        { sessionId: s.id, firstName: 'Mismatch', lastName: 'Person', dateOfBirth: '2000-01-01' },
        auth,
      )
    ).statusCode,
  ).toBe(200);
  const command = {
    sessionId: s.id,
    requestId: randomUUID(),
    consentId: randomUUID(),
    kind: 'BVN',
    identifier: '00000000009',
  };
  expect((await send('synthetic-verification', command, auth)).statusCode).not.toBe(200);
  const consent = await send(
    'consent',
    {
      sessionId: s.id,
      requestId: randomUUID(),
      kind: 'BVN',
      accepted: true,
      noticeVersion: 'synthetic-test-v1',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
    auth,
  );
  const verification = await send(
    'synthetic-verification',
    { ...command, requestId: randomUUID(), consentId: consent.json<{ id: string }>().id },
    auth,
  );
  expect(verification.json()).toMatchObject({ status: 'REVIEW', simulated: true });
  expect(
    (
      await send(
        'synthetic-complete',
        { sessionId: s.id, attemptId: verification.json<{ id: string }>().id },
        auth,
      )
    ).statusCode,
  ).toBe(401);
  expect(
    await db.query(
      'SELECT count(*)::int AS count FROM kyc_registration_synthetic_customer_links WHERE session_id=$1',
      [s.id],
    ),
  ).toEqual([{ count: 0 }]);
});

test('existing non-synthetic customer permissions remain compatible', async () => {
  const customerId = randomUUID();
  await db.query(
    "INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status) VALUES($1,$2,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED')",
    [customerId, `existing-${customerId}`],
  );
  await db.query(
    "INSERT INTO customer_eligibilities(customer_id,status,reviewed_by) VALUES($1,'PENDING','test')",
    [customerId],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(id,customer_id,type,value,normalized_value,is_primary) VALUES($1,$2,'PHONE','+2348022223369','8022223369',true)`,
    [randomUUID(), customerId],
  );
  const send = (path: string, payload: object, token?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/customers/registration-sessions/${path}`,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const session = (await send('start', { phone: '08022223369' })).json<{
    id: string;
    token: string;
  }>();
  expect(
    (await send('onboarding-route', { sessionId: session.id }, session.token)).statusCode,
  ).toBe(401);
  expect(
    (await send('otp', { sessionId: session.id, requestId: randomUUID() }, session.token))
      .statusCode,
  ).toBe(200);
  const code = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
  const authorization = (
    await send('otp/verify', { sessionId: session.id, code }, session.token)
  ).json<{ authorization: string }>().authorization;
  expect((await send('onboarding-route', { sessionId: session.id }, authorization)).json()).toEqual(
    { next: 'PENDING' },
  );
  expect(
    (await send('onboarding-login', { sessionId: session.id, passcode: '112233' }, authorization))
      .statusCode,
  ).toBe(401);
  expect(await db.query('SELECT is_synthetic FROM customers WHERE id=$1', [customerId])).toEqual([
    { is_synthetic: false },
  ]);
  expect(
    await db.query('SELECT status FROM customer_eligibilities WHERE customer_id=$1', [customerId]),
  ).toEqual([{ status: 'PENDING' }]);
});
