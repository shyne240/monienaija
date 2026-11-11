import { KycRegistrationSyntheticProfile1785753600111 } from '../src/migrations/1785753600111-KycRegistrationSyntheticProfile';
import { RegistrationSyntheticProvider } from '../src/kyc-verification/kyc-registration-verification.service';
import { KycProviderGovernance1785753600109 } from '../src/migrations/1785753600109-KycProviderGovernance';
import { KycProviderGovernanceService } from '../src/kyc-verification/kyc-provider-governance.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { CustomerRegistrationModule } from '../src/customer-registration/customer-registration.module';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { REGISTRATION_SYNTHETIC_PROVIDER } from '../src/kyc-verification/kyc-registration-verification.service';
import { CustomerRegistrationService } from '../src/customer-registration/customer-registration.service';
import { ValidationPipe, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource, type EntityManager } from 'typeorm';
import { CustomerRegistrationPhoneChallenge } from '../src/customer-registration/customer-registration-phone-challenge.entity';
import { A2SecurityRateBucket } from '../src/authorization/workforce-authentication.entity';
import { A2SecurityRateLimitService } from '../src/authorization/security-rate-limit.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import type { AuditService } from '../src/operations/audit.service';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { KycRegistrationSessionController } from '../src/kyc-verification/kyc-registration-session.controller';
import { KycRegistrationSessionService } from '../src/kyc-verification/kyc-registration-session.service';
import { KycRegistrationVerificationService } from '../src/kyc-verification/kyc-registration-verification.service';
import type {
  KycProvider,
  ProviderResult,
  VerificationInput,
} from '../src/kyc-verification/kyc.types';
import { KycRegistrationSessions1785753600107 } from '../src/migrations/1785753600107-KycRegistrationSessions';
import { KycRegistrationAttempts1785753600108 } from '../src/migrations/1785753600108-KycRegistrationAttempts';
import { CUSTOMER_REGISTRATION_RATE_LIMITS } from '../src/customer-registration/customer-registration.constants';

const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const schema = `kyc_api_test_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  installExtensions: false,
  logging: false,
  entities: [A2SecurityRateBucket],
  extra: { options: `-c search_path=${schema}` },
});
let app: NestFastifyApplication;
let created = false;
let limiter: A2SecurityRateLimitService;
const sms = new TestNotificationProvider();
const call = jest
  .fn<Promise<ProviderResult>, [VerificationInput, AbortSignal]>()
  .mockResolvedValue({ outcome: 'MATCH' });
const provider: KycProvider = { code: 'SYNTHETIC', verify: call };
const url = '/api/v1/customers/registration-sessions/';
const phone = (n: number) => `080${String(n).padStart(8, '0')}`;
async function post(path: string, payload: Record<string, unknown>, token?: string) {
  return app.inject({
    method: 'POST',
    url: url + path,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
async function setup(n: number) {
  const res = await post('start', { phone: phone(n) });
  expect(res.statusCode).toBe(200);
  const s = res.json<{ id: string; token: string }>();
  const otp = await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token);
  expect(otp.statusCode).toBe(200);
  const code = /code is (\d{6})/.exec(sms.sent.at(-1)!.message)?.[1];
  if (!code) throw new Error('No synthetic OTP');
  const verify = await post('otp/verify', { sessionId: s.id, code }, s.token);
  expect(verify.statusCode).toBe(200);
  const { authorization } = verify.json<{ authorization: string }>();
  return { ...s, authorization, code };
}
async function consent(s: { id: string; authorization: string }, kind: 'BVN' | 'NIN' = 'BVN') {
  const r = await post(
    'consent',
    {
      sessionId: s.id,
      requestId: randomUUID(),
      kind,
      accepted: true,
      noticeVersion: 'synthetic-test-v1',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    s.authorization,
  );
  expect(r.statusCode).toBe(200);
  return r.json<{ id: string }>().id;
}
const verification = (
  sessionId: string,
  consentId: string,
  requestId = randomUUID(),
  kind: 'BVN' | 'NIN' = 'BVN',
) => ({ sessionId, consentId, requestId, kind, identifier: '00000000000' });
beforeAll(async () => {
  await db.initialize();
  const loc = await db.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const listen = await db.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const version = await db.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(loc[0]?.data_directory ?? '') ||
    listen[0]?.listen_addresses !== '' ||
    !version[0]?.server_version.startsWith('16.')
  )
    throw new Error('Not isolated PostgreSQL 16');
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  await db.query(
    `CREATE TABLE a2_security_rate_buckets(id uuid PRIMARY KEY,bucket_key char(64) NOT NULL UNIQUE,category varchar(80) NOT NULL,tokens double precision NOT NULL,last_refill_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  const runner = db.createQueryRunner();
  await new KycRegistrationSessions1785753600107().up(runner);
  await new KycRegistrationAttempts1785753600108().up(runner);
  await new KycProviderGovernance1785753600109().up(runner);
  await new KycRegistrationSyntheticProfile1785753600111().up(runner);
  await db.query(
    `UPDATE kyc_provider_configuration SET version=1, configuration='{"providers":{"MONNIFY":{"enabled":false,"capabilities":[]},"SYNTHETIC":{"enabled":true,"capabilities":["BVN","NIN"]}},"routes":{"BVN":{"primary":"SYNTHETIC","fallback":null},"NIN":{"primary":"SYNTHETIC","fallback":null}}}'::jsonb WHERE singleton=true`,
  );
  await runner.release();
  limiter = new A2SecurityRateLimitService(db, {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService);
  const wired = (
    Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CustomerRegistrationModule) as Provider[]
  ).filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'provide' in entry &&
      [
        KycRegistrationSessionService,
        KycRegistrationVerificationService,
        KycProviderGovernanceService,
      ].includes(entry.provide as typeof KycRegistrationSessionService),
  );
  expect(wired).toHaveLength(3);
  expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CustomerRegistrationModule)).toContain(
    KycRegistrationSessionController,
  );
  const guard = new RuntimeAccessGuard(
    undefined as never,
    undefined as never,
    new RoutePolicyRegistry(),
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const mod = await Test.createTestingModule({
    controllers: [KycRegistrationSessionController],
    providers: [
      ...wired,
      { provide: DataSource, useValue: db },
      {
        provide: AuthorizationService,
        useValue: new AuthorizationService(db, {
          record: jest.fn().mockResolvedValue(undefined),
        } as never),
      },
      { provide: NOTIFICATION_PROVIDER_TOKEN, useValue: sms },
      { provide: A2SecurityRateLimitService, useValue: limiter },
      { provide: REGISTRATION_SYNTHETIC_PROVIDER, useValue: provider },
      { provide: APP_GUARD, useValue: guard },
    ],
  }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  if (app) await app.close();
  if (db.isInitialized) {
    if (created) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.destroy();
  }
});
beforeEach(async () => {
  await db.query('DELETE FROM a2_security_rate_buckets');
  await db.query('DELETE FROM kyc_registration_rate_buckets');
  call.mockReset().mockResolvedValue({ outcome: 'MATCH' });
});

describe('registration session Nest/Fastify API on synthetic PostgreSQL', () => {
  it.each(['BVN', 'NIN'] as const)(
    'uses session-owned profile and consent for %s synthetic identity matching',
    async (kind) => {
      const s = await setup(kind === 'BVN' ? 27 : 28);
      const body = {
        sessionId: s.id,
        firstName: 'Synthetic',
        lastName: 'Person',
        dateOfBirth: '2000-01-01',
        email: 'fixture@example.test',
      };
      expect((await post('synthetic-profile', body, s.token)).statusCode).toBe(401);
      expect((await post('synthetic-profile', body, s.authorization)).statusCode).toBe(200);
      expect(
        (await post('synthetic-profile/status', { sessionId: s.id }, s.authorization)).json(),
      ).toEqual({
        firstName: 'Synthetic',
        lastName: 'Person',
        dateOfBirth: '2000-01-01',
        email: 'fixture@example.test',
      });
      const c = await consent(s, kind);
      const command = verification(s.id, c, randomUUID(), kind);
      call.mockImplementation((input) => new RegistrationSyntheticProvider().verify(input));
      const r = await post('synthetic-verification', command, s.authorization);
      expect(r.json()).toMatchObject({ status: 'MATCH', simulated: true });
      expect(call.mock.calls[0]![0].identity).toEqual({
        firstName: 'Synthetic',
        lastName: 'Person',
        dateOfBirth: '2000-01-01',
        phone: `+234${phone(kind === 'BVN' ? 27 : 28).slice(1)}`,
      });
      expect(
        (await post('synthetic-profile', { ...body, lastName: 'Changed' }, s.authorization))
          .statusCode,
      ).toBe(409);
      expect((await post('synthetic-verification', command, s.authorization)).json()).toMatchObject(
        { status: 'MATCH', simulated: true },
      );
      expect(call).toHaveBeenCalledTimes(1);
    },
  );
  it('returns review for synthetic mismatch and cannot dispatch without consent', async () => {
    const s = await setup(29);
    expect(
      (
        await post(
          'synthetic-profile',
          { sessionId: s.id, firstName: 'Wrong', lastName: 'Person', dateOfBirth: '2000-01-01' },
          s.authorization,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await post('synthetic-verification', verification(s.id, randomUUID()), s.authorization))
        .statusCode,
    ).not.toBe(200);
    expect(call).not.toHaveBeenCalled();
    const c = await consent(s);
    call.mockImplementation((input) => new RegistrationSyntheticProvider().verify(input));
    expect(
      (await post('synthetic-verification', verification(s.id, c), s.authorization)).json(),
    ).toMatchObject({ status: 'REVIEW', simulated: true });
  });
  it('quarantines a timed-out profile-bound verification and never dispatches it twice', async () => {
    const s = await setup(31);
    expect(
      (
        await post(
          'synthetic-profile',
          {
            sessionId: s.id,
            firstName: 'Synthetic',
            lastName: 'Person',
            dateOfBirth: '2000-01-01',
          },
          s.authorization,
        )
      ).statusCode,
    ).toBe(200);
    const c = await consent(s);
    const command = verification(s.id, c);
    call.mockImplementation(() => new Promise<ProviderResult>(() => undefined));
    const responses = await Promise.all([
      post('synthetic-verification', command, s.authorization),
      post('synthetic-verification', command, s.authorization),
    ]);
    expect(responses.map((r) => r.json<{ status: string }>().status)).toContain('UNKNOWN');
    expect(call).toHaveBeenCalledTimes(1);
    expect((await post('synthetic-verification', command, s.authorization)).json()).toMatchObject({
      status: 'UNKNOWN',
      simulated: true,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('advertises simulation only with a test SMS sink in test runtime', async () => {
    expect((await post('simulation-availability', {})).json()).toEqual({
      available: true,
      simulated: true,
    });
    const configuredLiveLikeSink = { name: 'not-a-test-provider', send: jest.fn() };
    const alternate = new KycRegistrationSessionService(
      db,
      configuredLiveLikeSink as never,
      limiter,
    );
    expect(alternate.simulationAvailable()).toBe(false);
  });
  it('synthetic profile fails closed outside test runtime', async () => {
    const s = await setup(30);
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect((await post('simulation-availability', {})).json()).toEqual({
        available: false,
        simulated: true,
      });
      expect(
        (
          await post(
            'synthetic-profile',
            {
              sessionId: s.id,
              firstName: 'Synthetic',
              lastName: 'Person',
              dateOfBirth: '2000-01-01',
            },
            s.authorization,
          )
        ).statusCode,
      ).toBe(503);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('completes phone, consent and synthetic verification through the API; replay cannot dispatch twice', async () => {
    const s = await setup(1);
    const status = await post('status', { sessionId: s.id }, s.authorization);
    expect(status.statusCode).toBe(200);
    expect(status.json<{ status: string }>().status).toBe('VERIFIED');
    const c = await consent(s);
    const command = verification(s.id, c);
    const result = await post('verification', command, s.authorization);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toMatchObject({ status: 'MATCH', simulated: true });
    expect(
      (await post('verification', { ...command, identifier: '12345678901' }, s.authorization))
        .statusCode,
    ).toBe(400);
    expect((await post('verification', command, s.authorization)).json()).toMatchObject({
      status: 'MATCH',
      simulated: true,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(
      (await post('verification', { ...command, kind: 'NIN' }, s.authorization)).statusCode,
    ).not.toBe(200);
    expect(
      await db.query<Array<{ state: string }>>(
        'SELECT state FROM kyc_registration_attempts WHERE session_id=$1',
        [s.id],
      ),
    ).toEqual([{ state: 'MATCH' }]);
  });
  it('persists authorization across an independent restarted process', async () => {
    const s = await setup(11);
    const worker = spawnSync(
      process.execPath,
      [
        '-r',
        './test/support/mission-25c-network-guard.cjs',
        '-r',
        'ts-node/register/transpile-only',
        'test/support/kyc-session-restart-worker.cjs',
      ],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? '', TS_NODE_PROJECT: 'tsconfig.json' },
        input: JSON.stringify({ socket, schema, id: s.id, token: s.authorization }),
        encoding: 'utf8',
        timeout: 20000,
      },
    );
    expect(worker.status).toBe(0);
    expect(worker.stdout).toBe('VERIFIED');
  }, 30000);
  it('blocks invalid OTP, wrong session and missing or wrong consent before dispatch', async () => {
    const a = await post('start', { phone: phone(2) });
    const s = a.json<{ id: string; token: string }>();
    await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token);
    const code = /code is (\d{6})/.exec(sms.sent.at(-1)!.message)![1]!;
    const wrong = code === '999999' ? '000000' : '999999';
    expect(
      (await post('otp/verify', { sessionId: s.id, code: wrong }, s.token)).statusCode,
    ).not.toBe(200);
    expect(
      (await post('otp/verify', { sessionId: randomUUID(), code }, s.token)).statusCode,
    ).not.toBe(200);
    expect(
      (await post('verification', verification(s.id, randomUUID()), s.token)).statusCode,
    ).not.toBe(200);
    const v = await post('otp/verify', { sessionId: s.id, code }, s.token);
    const auth = v.json<{ authorization: string }>().authorization;
    expect(
      (await post('verification', verification(s.id, randomUUID()), auth)).statusCode,
    ).not.toBe(200);
    const c = await consent({ id: s.id, authorization: auth });
    expect(
      (await post('verification', verification(s.id, c, randomUUID(), 'NIN'), auth)).statusCode,
    ).not.toBe(200);
    expect((await post('verification', verification(s.id, c), s.token)).statusCode).not.toBe(200);
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects expired or revoked sessions and withdrawn consent', async () => {
    const a = await setup(3);
    const c = await consent(a);
    await post('consent/withdraw', { sessionId: a.id, consentId: c }, a.authorization);
    expect(
      (await post('verification', verification(a.id, c), a.authorization)).statusCode,
    ).not.toBe(200);
    const b = await setup(4);
    const bc = await consent(b);
    await post('revoke', { sessionId: b.id }, b.authorization);
    expect(
      (await post('verification', verification(b.id, bc), b.authorization)).statusCode,
    ).not.toBe(200);
    const d = await setup(5);
    const dc = await consent(d);
    await db.query(
      "UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [d.id],
    );
    expect(
      (await post('verification', verification(d.id, dc), d.authorization)).statusCode,
    ).not.toBe(200);
    expect(call).not.toHaveBeenCalled();
  });
  it('concurrent replays never dispatch a second provider request', async () => {
    const s = await setup(6);
    const c = await consent(s);
    const cmd = verification(s.id, c);
    let release!: (r: ProviderResult) => void;
    let started!: () => void;
    const began = new Promise<void>((r) => {
      started = r;
    });
    call.mockImplementation(() => {
      started();
      return new Promise<ProviderResult>((r) => {
        release = r;
      });
    });
    const first = post('verification', cmd, s.authorization);
    await began;
    const replay = await post('verification', cmd, s.authorization);
    expect(replay.json()).toMatchObject({ status: 'DISPATCHING', simulated: true });
    expect(
      (await post('verification', verification(s.id, c), s.authorization)).statusCode,
    ).not.toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
    release({ outcome: 'MATCH' });
    expect((await first).statusCode).toBe(200);
  });
  it('keeps a timeout UNKNOWN and replay does not call again', async () => {
    const s = await setup(7);
    const c = await consent(s, 'NIN');
    const cmd = verification(s.id, c, randomUUID(), 'NIN');
    call.mockImplementation(() => new Promise(() => {}));
    const result = await post('verification', cmd, s.authorization);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ status: 'UNKNOWN', simulated: true });
    expect((await post('verification', cmd, s.authorization)).json()).toMatchObject({
      status: 'UNKNOWN',
    });
    expect(call).toHaveBeenCalledTimes(1);
    await db.query(
      `UPDATE kyc_registration_attempts SET created_at=clock_timestamp()-interval '2 minutes' WHERE session_id=$1`,
      [s.id],
    );
    const newConsent = await consent(s, 'NIN');
    expect(
      (
        await post(
          'verification',
          verification(s.id, newConsent, randomUUID(), 'NIN'),
          s.authorization,
        )
      ).statusCode,
    ).not.toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
    expect(
      (await post('availability', { sessionId: s.id, kind: 'NIN' }, s.authorization)).json(),
    ).toEqual({ status: 'PENDING_RECONCILIATION' });
  });
  it('fails closed if session expires between reservation and dispatch', async () => {
    const s = await setup(8);
    const c = await consent(s);
    await db.query(
      `CREATE FUNCTION expire_reserved_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=NEW.session_id; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER expire_reserved_session AFTER INSERT ON kyc_registration_attempts FOR EACH ROW EXECUTE FUNCTION expire_reserved_session()',
    );
    try {
      const r = await post('verification', verification(s.id, c), s.authorization);
      expect(r.statusCode).not.toBe(200);
      expect(call).not.toHaveBeenCalled();
      expect(
        await db.query<Array<{ state: string }>>(
          'SELECT state FROM kyc_registration_attempts WHERE session_id=$1',
          [s.id],
        ),
      ).toEqual([{ state: 'CANCELLED' }]);
    } finally {
      await db.query('DROP TRIGGER expire_reserved_session ON kyc_registration_attempts');
      await db.query('DROP FUNCTION expire_reserved_session()');
    }
  });
  it('does not persist a match if authorization expires while provider is in flight', async () => {
    const s = await setup(9);
    const c = await consent(s);
    let release!: (r: ProviderResult) => void;
    let started!: () => void;
    const began = new Promise<void>((r) => {
      started = r;
    });
    call.mockImplementation(() => {
      started();
      return new Promise<ProviderResult>((r) => {
        release = r;
      });
    });
    const response = post('verification', verification(s.id, c), s.authorization);
    await began;
    await db.query(
      "UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [s.id],
    );
    release({ outcome: 'MATCH' });
    expect((await response).json()).toMatchObject({ status: 'CONSENT_WITHDRAWN', simulated: true });
  });
  it('blocks a legacy resend using the shared cooldown after a session OTP', async () => {
    const s = (await post('start', { phone: phone(12) })).json<{ id: string; token: string }>();
    expect(
      (await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
    ).toBe(200);
    const legacy = new CustomerRegistrationService(
      db,
      limiter,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      sms,
    );
    const before = sms.sent.length;
    const result = await legacy.requestOtp(phone(12), '127.0.0.1');
    expect(result.status).toBe('OTP_REQUEST_ACCEPTED');
    expect(sms.sent).toHaveLength(before);
  });
  it('rejects an idempotency key reused with different consent and does not dispatch', async () => {
    const s = await setup(13),
      c1 = await consent(s),
      c2 = await consent(s);
    const command = verification(s.id, c1);
    expect((await post('verification', command, s.authorization)).statusCode).toBe(200);
    expect(
      (await post('verification', { ...command, consentId: c2 }, s.authorization)).statusCode,
    ).toBe(409);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch if consent is withdrawn after reservation', async () => {
    const s = await setup(14),
      c = await consent(s);
    await db.query(
      `CREATE FUNCTION withdraw_reserved_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE kyc_registration_consents SET withdrawn_at=clock_timestamp() WHERE id=NEW.consent_id; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER withdraw_reserved_consent AFTER INSERT ON kyc_registration_attempts FOR EACH ROW EXECUTE FUNCTION withdraw_reserved_consent()',
    );
    try {
      expect(
        (await post('verification', verification(s.id, c), s.authorization)).statusCode,
      ).not.toBe(200);
      expect(call).not.toHaveBeenCalled();
    } finally {
      await db.query('DROP TRIGGER withdraw_reserved_consent ON kyc_registration_attempts');
      await db.query('DROP FUNCTION withdraw_reserved_consent()');
    }
  });
  it('honors legacy phone verification attempt budget before comparing session OTP', async () => {
    const n = 15;
    const s = (await post('start', { phone: phone(n) })).json<{ id: string; token: string }>();
    expect(
      (await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
    ).toBe(200);
    const code = /code is (\d{6})/.exec(sms.sent.at(-1)!.message)![1]!;
    const rule = CUSTOMER_REGISTRATION_RATE_LIMITS.find(
      (r) => r.category === 'CUSTOMER_REGISTRATION_OTP_VERIFY_PER_PHONE',
    )!;
    for (let i = 0; i < 10; i++)
      await limiter.consume(rule, [`8${String(n).padStart(9, '0')}`], randomUUID());
    expect((await post('otp/verify', { sessionId: s.id, code }, s.token)).statusCode).toBe(429);
    expect(
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM kyc_registration_sessions WHERE id=$1',
        [s.id],
      ),
    ).toEqual([{ status: 'PENDING' }]);
  });
  it('blocks session issuance when the real legacy OTP method already consumed the shared cooldown', async () => {
    const n = 16,
      s = (await post('start', { phone: phone(n) })).json<{ id: string; token: string }>();
    const builder = {
      where: () => builder,
      andWhere: () => builder,
      orderBy: () => builder,
      setLock: () => builder,
      getMany: () => Promise.resolve([]),
    };
    const repository = {
      createQueryBuilder: () => builder,
      create: (data: unknown) => data,
      save: (data: unknown) => Promise.resolve(data),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === CustomerRegistrationPhoneChallenge
          ? repository
          : { findOne: () => Promise.resolve(null) },
    } as unknown as EntityManager;
    const legacyDb = {
      transaction: (_level: string, fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
    } as unknown as DataSource;
    const legacy = new CustomerRegistrationService(
      legacyDb,
      limiter,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      sms,
    );
    const before = sms.sent.length;
    expect((await legacy.requestOtp(phone(n), '127.0.0.1')).status).toBe('OTP_REQUEST_ACCEPTED');
    expect(sms.sent).toHaveLength(before + 1);
    expect(
      (await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token)).statusCode,
    ).toBe(429);
    expect(sms.sent).toHaveLength(before + 1);
  });
  it('exposes session-scoped availability and prevents dispatch after configuration changes', async () => {
    const s = await setup(21),
      c = await consent(s);
    expect(
      (await post('availability', { sessionId: s.id, kind: 'BVN' }, s.authorization)).json(),
    ).toEqual({ status: 'AVAILABLE' });
    expect(
      (await post('availability', { sessionId: s.id, kind: 'BVN' }, 'x'.repeat(43))).statusCode,
    ).not.toBe(200);
    await db.query(
      `CREATE FUNCTION change_route_after_reserve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE kyc_provider_configuration SET version=version+1,configuration=jsonb_set(configuration,'{providers,SYNTHETIC,enabled}','false'::jsonb) WHERE singleton=true; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER change_route_after_reserve AFTER INSERT ON kyc_registration_attempts FOR EACH ROW EXECUTE FUNCTION change_route_after_reserve()',
    );
    try {
      await post('verification', verification(s.id, c), s.authorization);
      expect(call).not.toHaveBeenCalled();
      expect(
        (await post('availability', { sessionId: s.id, kind: 'BVN' }, s.authorization)).json(),
      ).toEqual({ status: 'CONFIGURATION_INCOMPLETE' });
    } finally {
      await db.query('DROP TRIGGER change_route_after_reserve ON kyc_registration_attempts');
      await db.query('DROP FUNCTION change_route_after_reserve()');
      await db.query(
        `UPDATE kyc_provider_configuration SET version=1,configuration=jsonb_set(configuration,'{providers,SYNTHETIC,enabled}','true'::jsonb) WHERE singleton=true`,
      );
    }
  });
  it('rechecks consent after consumption and before provider invocation', async () => {
    const s = await setup(18),
      c = await consent(s);
    await db.query(
      `CREATE FUNCTION withdraw_after_consume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='DISPATCHING' AND OLD.state='RESERVED' THEN UPDATE kyc_registration_consents SET withdrawn_at=clock_timestamp() WHERE id=NEW.consent_id; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER withdraw_after_consume AFTER UPDATE ON kyc_registration_attempts FOR EACH ROW EXECUTE FUNCTION withdraw_after_consume()',
    );
    try {
      const response = await post('verification', verification(s.id, c), s.authorization);
      expect(response.json()).toMatchObject({ status: 'CONSENT_WITHDRAWN', simulated: true });
      expect(call).not.toHaveBeenCalled();
    } finally {
      await db.query('DROP TRIGGER withdraw_after_consume ON kyc_registration_attempts');
      await db.query('DROP FUNCTION withdraw_after_consume()');
    }
  });
  it('rejects session revocation between reservation and dispatch', async () => {
    const s = await setup(17),
      c = await consent(s);
    await db.query(
      `CREATE FUNCTION revoke_reserved_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE kyc_registration_sessions SET status='REVOKED',pending_token_hash=NULL,authorization_hash=NULL,revoked_at=clock_timestamp() WHERE id=NEW.session_id; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER revoke_reserved_session AFTER INSERT ON kyc_registration_attempts FOR EACH ROW EXECUTE FUNCTION revoke_reserved_session()',
    );
    try {
      expect(
        (await post('verification', verification(s.id, c), s.authorization)).statusCode,
      ).not.toBe(200);
      expect(call).not.toHaveBeenCalled();
    } finally {
      await db.query('DROP TRIGGER revoke_reserved_session ON kyc_registration_attempts');
      await db.query('DROP FUNCTION revoke_reserved_session()');
    }
  });
  it('uses the same issue-phone rate bucket as the legacy registration service', async () => {
    const n = 10;
    const s = (await post('start', { phone: phone(n) })).json<{ id: string; token: string }>();
    const rule = CUSTOMER_REGISTRATION_RATE_LIMITS.find(
      (r) => r.category === 'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_PHONE',
    )!;
    await limiter.consume(rule, [`8${String(n).padStart(9, '0')}`], randomUUID());
    await limiter.consume(rule, [`8${String(n).padStart(9, '0')}`], randomUUID());
    await limiter.consume(rule, [`8${String(n).padStart(9, '0')}`], randomUUID());
    const before = sms.sent.length;
    const result = await post('otp', { sessionId: s.id, requestId: randomUUID() }, s.token);
    expect(result.statusCode).toBe(429);
    expect(sms.sent).toHaveLength(before);
  });
});
