import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { KycRegistrationAttempts1785753600108 } from '../src/migrations/1785753600108-KycRegistrationAttempts';
import {
  KycRegistrationVerificationService,
  RegistrationSyntheticProvider,
} from '../src/kyc-verification/kyc-registration-verification.service';
import { KycRegistrationSessions1785753600107 } from '../src/migrations/1785753600107-KycRegistrationSessions';
import { KycRegistrationSessionService } from '../src/kyc-verification/kyc-registration-session.service';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const schema = `kyc_registration_test_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  logging: false,
  extra: { options: `-c search_path=${schema}` },
});
const sharedRateLimit = { consume: jest.fn().mockResolvedValue(undefined) };
let provider: TestNotificationProvider;
let service: KycRegistrationSessionService;
let verifier: KycRegistrationVerificationService;
const verifyRequest = (id: string, authorization: string, consentId: string, kind: 'BVN' | 'NIN') =>
  verifier.verify({
    sessionId: id,
    authorization,
    consentId,
    kind,
    requestId: randomUUID(),
    identifier: '00000000000',
  });
let created = false;
const phone = (n: number) => `080${String(n).padStart(8, '0')}`;
const ip = (n: number) => `192.0.2.${n}`;
async function issue(n: number) {
  const s = await service.create(phone(n), ip(n));
  await service.issueOtp(s.id, s.token, randomUUID(), ip(n));
  const sent = provider.sent[provider.sent.length - 1]!;
  const match = /code is (\d{6})/.exec(sent.message);
  if (!match) throw new Error('Synthetic OTP not captured');
  return { ...s, code: match[1]!, destination: sent.destination };
}
async function verified(n: number) {
  const s = await issue(n);
  const auth = await service.verifyOtp(s.id, s.token, s.code, ip(n));
  return { ...s, ...auth };
}
beforeAll(async () => {
  await db.initialize();
  const location = await db.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const listen = await db.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const version = await db.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(location[0]?.data_directory ?? '') ||
    listen[0]?.listen_addresses !== '' ||
    !version[0]?.server_version.startsWith('16.')
  )
    throw new Error('Not isolated PostgreSQL 16');
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  const runner = db.createQueryRunner();
  await new KycRegistrationSessions1785753600107().up(runner);
  await new KycRegistrationAttempts1785753600108().up(runner);
  await runner.release();
  verifier = new KycRegistrationVerificationService(db, new RegistrationSyntheticProvider());
  provider = new TestNotificationProvider();
  service = new KycRegistrationSessionService(db, provider, sharedRateLimit);
});
afterAll(async () => {
  if (db.isInitialized) {
    if (created) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.destroy();
  }
});

describe('isolated pre-customer registration sessions', () => {
  it('issues to the bound Nigerian phone, verifies once and survives a service restart', async () => {
    const s = await issue(1);
    expect(s.destination).toBe('+2348000000001');
    const restarted = new KycRegistrationSessionService(db, provider, sharedRateLimit);
    const { authorization } = await restarted.verifyOtp(s.id, s.token, s.code, ip(1));
    await expect(restarted.verifyOtp(s.id, s.token, s.code, ip(1))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(
      restarted.grantConsent(
        s.id,
        s.token,
        randomUUID(),
        'BVN',
        'synthetic-test-v1',
        new Date(Date.now() + 60000),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    const requestId = randomUUID(),
      expiry = new Date(Date.now() + 60000);
    const consent = await restarted.grantConsent(
      s.id,
      authorization,
      requestId,
      'BVN',
      'synthetic-test-v1',
      expiry,
    );
    expect(
      await restarted.grantConsent(
        s.id,
        authorization,
        requestId,
        'BVN',
        'synthetic-test-v1',
        expiry,
      ),
    ).toBe(consent);
    await expect(
      restarted.grantConsent(s.id, authorization, requestId, 'NIN', 'synthetic-test-v1', expiry),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await verifyRequest(s.id, authorization, consent, 'BVN');
    const rows = JSON.stringify(
      await db.query<unknown[]>('SELECT * FROM kyc_registration_sessions WHERE id=$1', [s.id]),
    );
    const otps = JSON.stringify(
      await db.query<unknown[]>('SELECT * FROM kyc_registration_otps WHERE session_id=$1', [s.id]),
    );
    expect(rows).not.toContain(s.token);
    expect(rows).not.toContain(authorization);
    expect(otps).not.toContain(`"${s.code}"`);
  });
  it('rejects wrong session or mismatched phone and generic proof', async () => {
    const a = await issue(2);
    const b = await service.create(phone(3), ip(3));
    await expect(service.verifyOtp(b.id, a.token, a.code, ip(3))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(service.verifyOtp(b.id, b.token, a.code, ip(3))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(service.verifyOtp(a.id, b.token, a.code, ip(2))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect(a.destination).toBe('+2348000000002');
  });
  it('does not accept the OTP from another session of the same phone', async () => {
    const a = await issue(15),
      b = await service.create(phone(15), ip(15));
    await db.query(
      "UPDATE kyc_registration_phone_locks SET last_issued_at=clock_timestamp()-interval '61 seconds' WHERE phone=$1",
      ['8000000015'],
    );
    await service.issueOtp(b.id, b.token, randomUUID(), ip(15));
    const bCode = /code is (\d{6})/.exec(provider.sent.at(-1)!.message)![1]!;
    expect(bCode).not.toBe(a.code);
    await expect(service.verifyOtp(b.id, b.token, a.code, ip(15))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect((await service.verifyOtp(b.id, b.token, bCode, ip(15))).authorization).toHaveLength(43);
  });
  it('does not emit provider exceptions containing synthetic OTPs or credentials', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined),
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = {
      name: 'synthetic',
      send: jest.fn().mockRejectedValue(new Error('sensitive synthetic provider error')),
    };
    try {
      const isolated = new KycRegistrationSessionService(db, failing, sharedRateLimit);
      const s = await isolated.create(phone(16), ip(16));
      await isolated.issueOtp(s.id, s.token, randomUUID(), ip(16));
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
  it('rejects expired OTP and expired and revoked sessions', async () => {
    const a = await issue(4);
    await db.query(
      "UPDATE kyc_registration_otps SET issued_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE session_id=$1",
      [a.id],
    );
    await expect(service.verifyOtp(a.id, a.token, a.code, ip(4))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const b = await issue(5);
    await db.query(
      "UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [b.id],
    );
    await expect(service.verifyOtp(b.id, b.token, b.code, ip(5))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const c = await issue(6);
    await service.revoke(c.id, c.token);
    await expect(service.verifyOtp(c.id, c.token, c.code, ip(6))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });
  it('allows only one winner for concurrent verification and rejects OTP replay', async () => {
    const a = await issue(7);
    const attempts = await Promise.allSettled([
      service.verifyOtp(a.id, a.token, a.code, ip(7)),
      service.verifyOtp(a.id, a.token, a.code, ip(7)),
    ]);
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(
      await db.query<Array<{ count: string }>>(
        'SELECT count(*) FROM kyc_registration_otps WHERE session_id=$1 AND used_at IS NOT NULL',
        [a.id],
      ),
    ).toEqual([{ count: '1' }]);
  });
  it('enforces consent ownership, purpose, withdrawal and revocation on identity request gate', async () => {
    const a = await verified(8),
      b = await verified(9),
      expiry = new Date(Date.now() + 60000);
    const c = await service.grantConsent(
      a.id,
      a.authorization,
      randomUUID(),
      'BVN',
      'synthetic-test-v1',
      expiry,
    );
    await expect(verifyRequest(a.id, a.authorization, randomUUID(), 'BVN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(verifyRequest(a.id, a.authorization, c, 'NIN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(verifyRequest(b.id, b.authorization, c, 'BVN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(verifyRequest(a.id, b.authorization, c, 'BVN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await service.withdrawConsent(a.id, a.authorization, c);
    await expect(verifyRequest(a.id, a.authorization, c, 'BVN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const c2 = await service.grantConsent(
      a.id,
      a.authorization,
      randomUUID(),
      'NIN',
      'synthetic-test-v1',
      expiry,
    );
    await service.revoke(a.id, a.authorization);
    await expect(verifyRequest(a.id, a.authorization, c2, 'NIN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });
  it('limits guesses and resend even across sessions for the same phone', async () => {
    const a = await issue(10),
      b = await service.create(phone(10), ip(10));
    await expect(service.issueOtp(b.id, b.token, randomUUID(), ip(10))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const wrong = a.code === '999999' ? '000000' : '999999';
    for (let i = 0; i < 5; i++)
      await expect(service.verifyOtp(a.id, a.token, wrong, ip(10))).rejects.toMatchObject({
        code: 'BLOCKED',
      });
    await expect(service.verifyOtp(a.id, a.token, a.code, ip(10))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const attempts = await db.query<Array<{ attempts: number }>>(
      'SELECT attempts FROM kyc_registration_otps WHERE session_id=$1',
      [a.id],
    );
    expect(attempts).toEqual([{ attempts: 5 }]);
  });
  it('makes OTP issuance idempotent and invalidates a superseded OTP on resend', async () => {
    const s = await service.create(phone(12), ip(12));
    const requestId = randomUUID();
    const before = provider.sent.length;
    await service.issueOtp(s.id, s.token, requestId, ip(12));
    const first = /code is (\d{6})/.exec(provider.sent.at(-1)!.message)![1]!;
    await service.issueOtp(s.id, s.token, requestId, ip(12));
    expect(provider.sent.length - before).toBe(1);
    await db.query(
      "UPDATE kyc_registration_phone_locks SET last_issued_at=clock_timestamp()-interval '61 seconds' WHERE phone=$1",
      ['8000000012'],
    );
    await service.issueOtp(s.id, s.token, randomUUID(), ip(12));
    const rows = await db.query<Array<{ superseded_at: Date | null }>>(
      'SELECT superseded_at FROM kyc_registration_otps WHERE session_id=$1 ORDER BY issued_at',
      [s.id],
    );
    expect(rows[0]?.superseded_at).not.toBeNull();
    expect(rows[1]?.superseded_at).toBeNull();
    const latest = /code is (\d{6})/.exec(provider.sent.at(-1)!.message)![1]!;
    expect(first).not.toBe(latest);
    await expect(service.verifyOtp(s.id, s.token, first, ip(12))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect((await service.verifyOtp(s.id, s.token, latest, ip(12))).authorization).toHaveLength(43);
  });
  it('rejects expired consent and expires verified authorization', async () => {
    const s = await verified(13);
    const c = await service.grantConsent(
      s.id,
      s.authorization,
      randomUUID(),
      'BVN',
      'synthetic-test-v1',
      new Date(Date.now() + 60000),
    );
    await db.query(
      "UPDATE kyc_registration_consents SET granted_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [c],
    );
    await expect(verifyRequest(s.id, s.authorization, c, 'BVN')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await db.query(
      "UPDATE kyc_registration_sessions SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [s.id],
    );
    await expect(
      service.grantConsent(
        s.id,
        s.authorization,
        randomUUID(),
        'NIN',
        'synthetic-test-v1',
        new Date(Date.now() + 60000),
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
  it('limits repeated OTP issuance per phone even when cooldown elapses', async () => {
    const s = await service.create(phone(14), ip(14));
    const start = provider.sent.length;
    for (let i = 0; i < 3; i++) {
      if (i > 0)
        await db.query(
          "UPDATE kyc_registration_phone_locks SET last_issued_at=clock_timestamp()-interval '61 seconds' WHERE phone=$1",
          ['8000000014'],
        );
      await service.issueOtp(s.id, s.token, randomUUID(), ip(14));
    }
    await db.query(
      "UPDATE kyc_registration_phone_locks SET last_issued_at=clock_timestamp()-interval '61 seconds' WHERE phone=$1",
      ['8000000014'],
    );
    await expect(service.issueOtp(s.id, s.token, randomUUID(), ip(14))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect(provider.sent.length - start).toBe(3);
  });
  it('rate-limits concurrent session creation per phone and preserves data against rollback', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.create(phone(11), ip(11))),
    );
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(5);
    expect(outcomes.filter((x) => x.status === 'rejected')).toHaveLength(3);
    const r = db.createQueryRunner();
    await expect(new KycRegistrationSessions1785753600107().down(r)).rejects.toThrow(
      'Refusing to remove registration session history',
    );
    await r.release();
  });
});
