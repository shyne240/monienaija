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
 * V1-CUSTOMER-ONBOARDING-01 — customer registration front door + phone verification
 * (real PostgreSQL). Covers the task's PROOFS 1–26 (proofs 27–29 are validated by the
 * still-green a23 / a24 / s-fix-01 suites run alongside this one). No mocking of
 * PostgreSQL; the notification provider uses the existing test-adapter convention.
 */
describe('V1-CUSTOMER-ONBOARDING-01 registration + phone verification (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let provider: TestNotificationProvider;

  const OTP_PATH = '/api/v1/customers/registration/otp';
  const VERIFY_PATH = '/api/v1/customers/registration/otp/verify';
  const REGISTER_PATH = '/api/v1/customers/registration';

  const nextPhone = (() => {
    let counter = 0;
    return () => `0${8}${String(100000000 + counter++).slice(0, 9)}`; // 080xxxxxxxx, unique canonical
  })();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1custregister');
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

  // ---------------------------------------------------------------- helpers

  async function requestOtp(phone: string, expected = 200) {
    return request(app.getHttpServer()).post(OTP_PATH).send({ phone }).expect(expected);
  }

  function extractCode(destination: string): string {
    const sent = provider.sent.find((entry) => entry.destination === destination);
    expect(sent).toBeDefined();
    const match = /code is (\d{6})/.exec(sent!.message);
    expect(match).not.toBeNull();
    return match![1]!;
  }

  async function requestAndVerify(phone: string): Promise<{ token: string; code: string }> {
    await requestOtp(phone);
    const code = extractCode(`+234${phone.slice(1)}`);
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    expect(verify.body.status).toBe('PHONE_VERIFIED');
    return { token: verify.body.verificationToken as string, code };
  }

  async function registerFully(phone: string) {
    const { token } = await requestAndVerify(phone);
    const response = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: token })
      .expect(201);
    return response.body as {
      id: string;
      reference: string;
      status: string;
      phone: string;
      phoneVerifiedAt: string;
    };
  }

  const counts = async (table: string, where = ''): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM ${table} ${where}`,
    );
    return Number(rows[0]!.count);
  };

  // ---------------------------------------------------------------- proofs 1–2, 11 (registration + normalization + verified_at)

  it('1,2,11: full flow — OTP → verify → register creates DRAFT with canonical normalized phone, verified primary contact, authoritative verified_at', async () => {
    const phone = nextPhone(); // 08xxxxxxxxx
    const body = await registerFully(phone);

    // PROOF 1 — DRAFT customer created (+ response shape is safe/minimal).
    expect(body.status).toBe('DRAFT');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.reference).toBe(`mn-8${phone.slice(2)}`);
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('verificationtoken');

    const customers: Array<any> = await dataSource.query(`SELECT * FROM customers WHERE id = $1`, [
      body.id,
    ]);
    expect(customers).toHaveLength(1);
    expect(customers[0].status).toBe('DRAFT');
    expect(customers[0].kyc_level).toBe('NONE');
    expect(customers[0].kyc_status).toBe('NOT_STARTED');

    // PROOF 2 — Nigerian normalization: 0-prefixed input canonicalized to the 10-digit
    // national form used by the whole platform; e164 stored as the SMS-rendering value.
    const contacts: Array<any> = await dataSource.query(
      `SELECT * FROM customer_contact_methods WHERE customer_id = $1`,
      [body.id],
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0].type).toBe('PHONE');
    expect(contacts[0].normalized_value).toBe(`8${phone.slice(2)}`);
    expect(contacts[0].value).toBe(`+2348${phone.slice(2)}`);
    expect(contacts[0].is_primary).toBe(true);

    // PROOF 11 — authoritative verified_at was written and matches the response.
    expect(contacts[0].verified_at).not.toBeNull();
    expect(new Date(contacts[0].verified_at).toISOString()).toBe(body.phoneVerifiedAt);

    // +234 variant of the same phone resolves to the same canonical form (normalization proof).
    const plus = `+2348${phone.slice(2)}`;
    await requestOtp(plus);
    const challengeByPlus: Array<any> = await dataSource.query(
      `SELECT normalized_phone FROM customer_registration_phone_challenges WHERE normalized_phone = $1`,
      [`8${phone.slice(2)}`],
    );
    expect(challengeByPlus.length).toBeGreaterThan(0);
  });

  it('3: duplicate phone cannot create a second customer (request no-ops, register refused, one customer remains)', async () => {
    const phone = nextPhone();
    const first = await registerFully(phone);
    const customerCount = await counts('customers');
    const challengeCount = await counts('customer_registration_phone_challenges');
    const smsCount = provider.sent.length;

    // Re-request OTP for the taken phone → generic accepted, no state change, no SMS.
    const reRequest = await requestOtp(phone);
    expect(reRequest.body).toEqual({
      status: 'OTP_REQUEST_ACCEPTED',
      resendAfterSeconds: expect.any(Number),
      expiresInSeconds: expect.any(Number),
    });
    expect(await counts('customer_registration_phone_challenges')).toBe(challengeCount);
    expect(provider.sent.length).toBe(smsCount);

    // Direct completion with a fabricated token → generic 400, no second customer.
    const bogus = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: 'a'.repeat(43) })
      .expect(400);
    expect(bogus.body.message).toContain('Registration verification is invalid or expired');
    expect(await counts('customers')).toBe(customerCount);

    // Internal fail-closed POST /customers also cannot create the second customer.
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .send({ reference: `mn-8${phone.slice(2)}`, type: 'INDIVIDUAL', actor: 'x' })
      .expect(401);
    expect(await counts('customers')).toBe(customerCount);
    expect(first.id).toBeTruthy();
  });

  it('4,5,6,12,13,14,15: registration/verification create DRAFT-only — never ACTIVE, wallet, credential, or PIN; brute status injection is ignored', async () => {
    const phone = nextPhone();
    const { token } = await requestAndVerify(phone);
    // PROOF 4 — even a caller-injected status stays stripped (whitelist) / irrelevant.
    const body = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: token, status: 'ACTIVE' })
      .expect(201);
    expect(body.body.status).toBe('DRAFT');

    const customerId = body.body.id;
    const custRows: Array<any> = await dataSource.query(
      `SELECT status FROM customers WHERE id=$1`,
      [customerId],
    );
    expect(custRows[0].status).toBe('DRAFT'); // PROOF 12 — verification/registration do not activate
    // PROOF 5/14 — no password/credential row exists.
    expect(
      await counts('customer_authentication_credentials', `WHERE customer_id='${customerId}'`),
    ).toBe(0);
    // PROOF 6/15 — no transaction PIN row exists.
    expect(await counts('customer_transaction_pins', `WHERE customer_id='${customerId}'`)).toBe(0);
    // PROOF 13 — no wallet/financial binding exists.
    expect(await counts('wallet_accounts', `WHERE customer_id='${customerId}'`)).toBe(0);
    expect(
      await counts('customer_financial_account_bindings', `WHERE customer_id='${customerId}'`),
    ).toBe(0);
  });

  it('7: registration does not bypass workforce activation — PATCH activation unauthenticated 401 and DRAFT persists', async () => {
    const phone = nextPhone();
    const body = await registerFully(phone);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${body.id}`)
      .send({ status: 'ACTIVE', actor: 'self-hack' })
      .expect(401);
    const rows: Array<any> = await dataSource.query(`SELECT status FROM customers WHERE id=$1`, [
      body.id,
    ]);
    expect(rows[0].status).toBe('DRAFT');
  });

  it('8,9: OTP delivered through the existing SMS provider adapter; OTP/token never stored plaintext anywhere', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    // PROOF 8 — delivery used the NOTIFICATION_PROVIDER_TOKEN abstraction.
    const destination = `+2348${phone.slice(2)}`;
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.channel).toBe('SMS');
    expect(provider.sent[0]!.destination).toBe(destination);
    const code = extractCode(destination);

    // Response must not contain the code.
    const reRequest = await request(app.getHttpServer()).post(OTP_PATH).send({ phone }).expect(200);
    expect(JSON.stringify(reRequest.body)).not.toContain(code);

    // PROOF 9 — OTP/token plaintext appears nowhere in challenge rows.
    const challenge: Array<any> = await dataSource.query(
      `SELECT * FROM customer_registration_phone_challenges WHERE normalized_phone=$1`,
      [`8${phone.slice(2)}`],
    );
    expect(challenge).toHaveLength(1);
    expect(JSON.stringify(challenge[0])).not.toContain(code);
    expect(challenge[0].code_hash).not.toBe(code);
    expect(challenge[0].verification_token_hash).toBeNull();

    // OTP/token plaintext appears nowhere in audit trail either.
    const audits: Array<any> = await dataSource.query(
      `SELECT entity_type, action, new_values, previous_values FROM audit_events`,
    );
    const auditDump = JSON.stringify(audits);
    expect(auditDump).not.toContain(code);
  });

  it('10,18: correct OTP verifies; replay of the same code and of the verification token both fail', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    expect(verify.body.status).toBe('PHONE_VERIFIED');
    expect(verify.body.verificationToken).toBeTruthy();
    expect(verify.body.expiresInSeconds).toBeGreaterThan(0);

    const challenge: Array<any> = await dataSource.query(
      `SELECT * FROM customer_registration_phone_challenges`,
    );
    expect(challenge[0].status).toBe('VERIFIED');
    expect(challenge[0].verified_at).not.toBeNull();

    // PROOF 18a — OTP replay after success fails (generic).
    const replay = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(400);
    expect(replay.body.message).toContain('OTP verification failed');

    // Token works exactly once, then replay fails.
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: verify.body.verificationToken })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: verify.body.verificationToken })
      .expect(400);
    expect(second.body.message).toContain('Registration verification is invalid or expired');
    expect(await counts('customers')).toBe(1); // PROOF 18b — no duplicate via token replay
  });

  it('16: wrong OTP fails generically and increments bounded attempts', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const wrong = code === '000000' ? '000001' : '000000';
    const response = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code: wrong })
      .expect(400);
    expect(response.body.message).toContain('OTP verification failed');
    const rows: Array<any> = await dataSource.query(
      `SELECT attempt_count, status, verified_at FROM customer_registration_phone_challenges`,
    );
    expect(rows[0].attempt_count).toBe(1);
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].verified_at).toBeNull();
  });

  it('17: expired OTP fails and flips the challenge EXPIRED', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    await dataSource.query(
      `UPDATE customer_registration_phone_challenges SET expires_at = now() - interval '1 second'`,
    );
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    const rows: Array<any> = await dataSource.query(
      `SELECT status, verified_at FROM customer_registration_phone_challenges`,
    );
    expect(rows[0].status).toBe('EXPIRED');
    expect(rows[0].verified_at).toBeNull();
  });

  it('19: failed-attempt lockout — after 5 wrong attempts even the correct code is refused', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }).expect(400);
    }
    const midRows: Array<any> = await dataSource.query(
      `SELECT attempt_count FROM customer_registration_phone_challenges`,
    );
    expect(midRows[0].attempt_count).toBe(5);
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400); // locked
    const rows: Array<any> = await dataSource.query(
      `SELECT attempt_count, status, verified_at FROM customer_registration_phone_challenges`,
    );
    expect(rows[0].attempt_count).toBe(5); // not incremented past the cap
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].verified_at).toBeNull();
  });

  it('20: resend cooldown — immediate resend is a generic no-op; after cooldown a fresh OTP supersedes the old one', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const firstCode = extractCode(`+2348${phone.slice(2)}`);
    await requestOtp(phone); // inside cooldown window → generic 200, no new challenge/SMS
    expect(provider.sent).toHaveLength(1);
    expect(await counts('customer_registration_phone_challenges')).toBe(1);

    // Simulate the cooldown having elapsed.
    await dataSource.query(
      `UPDATE customer_registration_phone_challenges SET issued_at = now() - interval '2 minutes'`,
    );
    await requestOtp(phone);
    expect(provider.sent).toHaveLength(2);
    const rows: Array<any> = await dataSource.query(
      `SELECT status FROM customer_registration_phone_challenges ORDER BY created_at`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('REVOKED'); // superseded, old code dead
    expect(rows[1].status).toBe('ACTIVE');
    await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code: firstCode })
      .expect(400);
  });

  it('21: challenge is bound to the normalized phone/customer context — token cannot register a different phone', async () => {
    const phoneA = nextPhone();
    const phoneB = nextPhone();
    await requestOtp(phoneA);
    const code = extractCode(`+2348${phoneA.slice(2)}`);
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone: phoneA, code })
      .expect(200);

    const rows: Array<any> = await dataSource.query(
      `SELECT normalized_phone, destination_phone FROM customer_registration_phone_challenges`,
    );
    expect(rows[0].normalized_phone).toBe(`8${phoneA.slice(2)}`);
    expect(rows[0].destination_phone).toBe(`+2348${phoneA.slice(2)}`);

    // PROOF 21 — the token is bound to phone A's challenge; phone B has no challenge.
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: phoneB, verificationToken: verify.body.verificationToken })
      .expect(400);

    // Replying with a plus-form of B still cannot bind (normalized to B, no challenge).
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: `+2348${phoneB.slice(2)}`, verificationToken: verify.body.verificationToken })
      .expect(400);

    // Phone A itself completes.
    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: phoneA, verificationToken: verify.body.verificationToken })
      .expect(201);
  });

  it('22: cross-phone verification fails — code issued for one phone verifies no other phone', async () => {
    const phoneA = nextPhone();
    const phoneB = nextPhone();
    await requestOtp(phoneA);
    await requestOtp(phoneB);
    const codeA = extractCode(`+2348${phoneA.slice(2)}`);
    await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone: phoneB, code: codeA })
      .expect(400);
    const rows: Array<any> = await dataSource.query(
      `SELECT attempt_count, status FROM customer_registration_phone_challenges ORDER BY created_at`,
    );
    expect(rows[0].attempt_count).toBe(0); // phone A's challenge untouched
    expect(rows[1].attempt_count).toBe(1); // phone B's challenge counted the failure
    expect(rows[1].status).toBe('ACTIVE');
  });

  it('23: enumeration-safe — identical responses for taken/new phone on request; identical generic failure for unknown/wrong verify and bogus-token register', async () => {
    const takenPhone = nextPhone();
    const freshPhone = nextPhone();
    await registerFully(takenPhone);
    provider.clear();

    const smsBefore = provider.sent.length;
    const respTaken = await requestOtp(takenPhone);
    const respFresh = await requestOtp(freshPhone);
    expect(respTaken.body).toEqual(respFresh.body); // cannot tell taken apart from new

    // Verification failure wording identical for "no challenge" vs "wrong code".
    const neverChallenged = nextPhone();
    await requestOtp(neverChallenged);
    const wrongCode = '123456';
    const failNoChallenge = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone: freshPhone.replace('08', '09'), code: wrongCode })
      .expect(400);
    const failWrongCode = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({
        phone: neverChallenged,
        code: wrongCode === extractCode(`+2348${neverChallenged.slice(2)}`) ? '654321' : wrongCode,
      })
      .expect(400);
    expect(failNoChallenge.body.message).toBe(failWrongCode.body.message);

    // Registration with bogus token: same generic message independent of phone state.
    const reg1 = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: takenPhone, verificationToken: 'b'.repeat(43) })
      .expect(400);
    const reg2 = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: nextPhone(), verificationToken: 'b'.repeat(43) })
      .expect(400);
    expect(reg1.body.message).toBe(reg2.body.message);
    // taken → no SMS; fresh and neverChallenged → 1 SMS each. The taken phone produced nothing.
    expect(provider.sent.length - smsBefore).toBe(2);
    expect(provider.sent.some((entry) => entry.destination === `+2348${takenPhone.slice(2)}`)).toBe(
      false,
    );
  });

  it('24: rate limits — OTP issue per-phone 429 after cap; OTP verify per-phone 429 after cap; registration per-IP 429 after cap', async () => {
    const phone = nextPhone();
    // Issue per-phone: capacity 3/hour → 4th request within the hour is rejected.
    await requestOtp(phone);
    await requestOtp(phone); // cooldown no-op, but still a counted request
    await requestOtp(phone);
    const fourth = await request(app.getHttpServer()).post(OTP_PATH).send({ phone }).expect(429);
    expect(fourth.body.message).toContain('Security request rate exceeded');

    // Verify per-phone: capacity 10/hour → 11th verify attempt rejected.
    const otherPhone = nextPhone();
    await requestOtp(otherPhone);
    const wrong = '999998';
    const verifyCode = extractCode(`+2348${otherPhone.slice(2)}`);
    const wrongCode = wrong === verifyCode ? '999997' : wrong;
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post(VERIFY_PATH)
        .send({ phone: otherPhone, code: wrongCode })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone: otherPhone, code: wrongCode })
      .expect(429);

    // Registration per-IP: capacity 10/hour → 11th completion attempt rejected.
    let lastStatus = 0;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app.getHttpServer())
        .post(REGISTER_PATH)
        .send({ phone: nextPhone(), verificationToken: 'c'.repeat(43) });
      expect(res.status).toBe(400);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(400);
    const eleventh = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone: nextPhone(), verificationToken: 'c'.repeat(43) });
    expect(eleventh.status).toBe(429);

    // …while a different phone's OTP issuance is unaffected (limits are not global).
    await requestOtp(nextPhone());
  });

  it('25,26: full audit trail without OTP/token leakage, and no financial ledger artifacts', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code: code === '111111' ? '111112' : '111111' })
      .expect(400);
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    const body = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: verify.body.verificationToken })
      .expect(201);

    // PROOF 25 — all six minimum events exist with self-service actor semantics.
    const audits: Array<{ entity_type: string; action: string; actor: string; new_values: any }> =
      await dataSource.query(
        `SELECT entity_type, action, actor, new_values FROM audit_events ORDER BY occurred_at, id`,
      );
    const actions = audits.map((row) => `${row.entity_type}/${row.action}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_REQUESTED',
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_VERIFY_FAILED',
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_VERIFIED',
        'CUSTOMER_REGISTRATION_CHALLENGE/REGISTRATION_INITIATED',
        'CUSTOMER/CREATED',
        'CUSTOMER_CONTACT_METHOD/PHONE_VERIFIED',
      ]),
    );
    for (const row of audits) {
      expect(['customer-self-service']).toContain(row.actor);
    }
    // …and no OTP/token material anywhere in the trail.
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(verify.body.verificationToken);
    expect(dump.toLowerCase()).not.toContain('codehash');

    // PROOF 26 — no financial ledger artifacts of any kind.
    expect(await counts('ledger_journals')).toBe(0);
    expect(await counts('ledger_lines')).toBe(0);
    expect(await counts('wallet_accounts')).toBe(0);
    expect(body.body.id).toBeTruthy();
  });
});
