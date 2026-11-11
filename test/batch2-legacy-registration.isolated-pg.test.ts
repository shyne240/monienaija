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
  'full AppModule matches a session-bound %s synthetic profile without creating financial records',
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
    expect(
      (await send('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
    ).toBe(200);
    const code = /code is (\d{6})/.exec(sms.sent.at(-1)?.message ?? '')?.[1];
    expect(code).toBeDefined();
    const verified = await send('otp/verify', { sessionId: s.id, code }, s.token);
    expect(verified.statusCode).toBe(200);
    const { authorization } = verified.json<{ authorization: string }>();
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
    expect(
      await db.query(
        'SELECT (SELECT count(*) FROM customers) AS customers,(SELECT count(*) FROM wallet_accounts) AS wallets,(SELECT count(*) FROM customer_authentication_credentials) AS credentials',
      ),
    ).toEqual(before);
  },
);
