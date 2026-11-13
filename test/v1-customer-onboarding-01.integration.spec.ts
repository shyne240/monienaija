/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash, randomUUID } from 'node:crypto';
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
import { CustomerService } from '../src/customer/customer.service';
import {
  createDraftCustomerWithPhone,
  phoneForms,
  type ControlledOnboardingContext,
} from './support/controlled-onboarding';

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
  let customerService: CustomerService;

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
    customerService = moduleRef.get(CustomerService);
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


  const onboardingContext = (): ControlledOnboardingContext => ({
    app,
    dataSource,
    provider,
    customerService,
  });

  /**
   * "A customer that just finished phone-verified onboarding", produced by the **implemented**
   * controlled flow instead of the closed legacy completion route.
   *
   * `POST /customers/registration` is fail-closed by design (Arena 1 `05a38f4`): it answers 503
   * and creates nothing until genuine KYC is integrated. This suite's security properties — the
   * customer is only ever `DRAFT`, its phone is only ever verified by an OTP the production
   * verifier accepted, and no credential/wallet/PIN is created — are all still provable, so the
   * setup is migrated to `test/support/controlled-onboarding.ts`, which performs the real OTP
   * request + verify and then consumes the one-time token through
   * `CustomerService.consumePhoneVerificationToken`. Nothing about the phone proof is faked.
   */
  async function registerFully(phone: string) {
    const created = await createDraftCustomerWithPhone(onboardingContext(), {
      phone,
      actor: 'customer-self-service',
    });
    const rows: Array<{ verified_at: Date }> = await dataSource.query(
      `SELECT verified_at FROM customer_contact_methods WHERE customer_id=$1 AND is_primary=true`,
      [created.customerId],
    );
    return {
      id: created.customerId,
      reference: `mn-${created.canonical}`,
      status: 'DRAFT',
      phone: created.e164,
      phoneVerifiedAt: new Date(rows[0]!.verified_at).toISOString(),
      contactId: created.contactId,
      canonical: created.canonical,
      verificationToken: created.verificationToken,
    };
  }

  /**
   * The OTP resend cooldown is now a governed rate-limit bucket
   * (`CUSTOMER_REGISTRATION_OTP_COOLDOWN_PER_PHONE`), not a timestamp on the challenge row, so
   * "the cooldown has elapsed" is expressed by clearing that bucket.
   */
  async function elapseResendCooldown(phone: string): Promise<void> {
    const { canonical } = phoneForms(phone);
    const key = createHash('sha256')
      .update(['CUSTOMER_REGISTRATION_OTP_COOLDOWN_PER_PHONE', canonical].join('\0'))
      .digest('hex');
    await dataSource.query(`DELETE FROM a2_security_rate_buckets WHERE bucket_key = $1`, [key]);
    // The resend gate is enforced twice — by that bucket and by the challenge row's own
    // `issued_at` — so moving the clock forward has to advance both.
    await dataSource.query(
      `UPDATE customer_registration_phone_challenges
          SET issued_at = now() - interval '2 minutes'
        WHERE normalized_phone = $1 AND status = 'ACTIVE'`,
      [canonical],
    );
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
    // The customer-facing response carries no secret material. (The fixture's own return value
    // does echo the token back to the *test*, so only the fields a client would receive are
    // checked — the same property the closed route had to satisfy.)
    const clientVisible = JSON.stringify({
      id: body.id,
      reference: body.reference,
      status: body.status,
      phone: body.phone,
      phoneVerifiedAt: body.phoneVerifiedAt,
    }).toLowerCase();
    expect(clientVisible).not.toContain('password');
    expect(clientVisible).not.toContain('verificationtoken');

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

  it('3: duplicate phone cannot create a second customer (request no-ops, completion refused, one customer remains)', async () => {
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

    // A second completion for the same phone is refused: the one-time token was already
    // consumed, and rebuilding the phone proof requires a fresh OTP that a registered phone
    // can no longer obtain (see the no-op assertion above). Both refusals are generic.
    const secondContactAttempt = await request(app.getHttpServer())
      .post(`/api/v1/customers/${first.id}/contact-method`)
      .send({ type: 'PHONE', value: `+2348${phone.slice(2)}`, isPrimary: true })
      .expect(401);
    expect(JSON.stringify(secondContactAttempt.body)).not.toContain('already');
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
    // PROOF 4 — a caller cannot inject the lifecycle status: the completion surface is
    // unauthenticated-but-closed (503) and the internal create surface refuses an anonymous
    // caller outright (401), so `status: 'ACTIVE'` never reaches a customer row.
    const closed = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({ phone, verificationToken: 'd'.repeat(43), status: 'ACTIVE' })
      .expect(503);
    expect(JSON.stringify(closed.body)).not.toContain('ACTIVE');
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .send({ reference: `mn-${phone.slice(2)}`, type: 'INDIVIDUAL', status: 'ACTIVE' })
      .expect(401);
    expect(await counts('customers')).toBe(0);

    // The controlled flow produces the state the closed route used to produce: DRAFT only.
    const body = await registerFully(phone);
    expect(body.status).toBe('DRAFT');

    const customerId = body.id;
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

    // PROOF 18b — the verification token is single-use. The implemented consumer is
    // `CustomerService.consumePhoneVerificationToken` (the closed completion route called the
    // same primitive), so consuming it once succeeds and a replay is refused.
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-token-once-${phone.slice(2)}`],
    );
    const customerId = rows[0]!.id;
    const contacts: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [customerId, `+2348${phone.slice(2)}`, `8${phone.slice(2)}`],
    );
    await customerService.updateContactMethod(customerId, contacts[0]!.id, {
      verificationToken: verify.body.verificationToken,
      actor: 'customer-self-service',
    });
    await expect(
      customerService.updateContactMethod(customerId, contacts[0]!.id, {
        verificationToken: verify.body.verificationToken,
        actor: 'customer-self-service',
      }),
    ).rejects.toThrow('Phone verification token is invalid or expired');
    // PROOF 18b — no duplicate customer can be produced by replaying the token.
    expect(await counts('customers')).toBe(1);
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
    // V1-CUSTOMER-06 — walk each of the 5 permitted wrong attempts individually: the
    // persisted counter must advance exactly 1-for-1 (1,2,3,4,5) and the challenge must
    // stay ACTIVE throughout (lockout is expressed by attempt_count reaching the cap, not
    // by a status transition — REVOKED is reserved for resend supersession, see proof 20).
    for (let i = 1; i <= 5; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }).expect(400);
      const row = (
        await dataSource.query(
          `SELECT attempt_count, status FROM customer_registration_phone_challenges`,
        )
      )[0];
      expect(row.attempt_count).toBe(i);
      expect(row.status).toBe('ACTIVE');
    }
    // 6th attempt — even with the CORRECT code — must be rejected as locked, and must NOT
    // push the persisted counter past the 5-attempt cap (the original off-by-one: a
    // pre-fix build recorded attempt_count = 6 here).
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    const rows: Array<any> = await dataSource.query(
      `SELECT attempt_count, status, verified_at FROM customer_registration_phone_challenges`,
    );
    expect(rows[0].attempt_count).toBe(5); // not incremented past the cap
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].verified_at).toBeNull();

    // A 7th, 8th... probe against the already-locked challenge must never move the
    // counter either — the cap is a hard ceiling, not merely "one past" the intended max.
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }).expect(400);
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    const finalRows: Array<any> = await dataSource.query(
      `SELECT attempt_count, status FROM customer_registration_phone_challenges`,
    );
    expect(finalRows[0].attempt_count).toBe(5);
    expect(finalRows[0].status).toBe('ACTIVE');
  });

  it('19a: correct code on exactly the 5th attempt still succeeds (lockout boundary is not off-by-one in the safe direction either)', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }).expect(400);
    }
    const midRow = (
      await dataSource.query(`SELECT attempt_count FROM customer_registration_phone_challenges`)
    )[0];
    expect(midRow.attempt_count).toBe(4);
    // The 5th attempt, with the correct code, must still be accepted — the guard only
    // rejects when attempt_count is ALREADY at the cap on entry, never on the attempt that
    // reaches it.
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    expect(verify.body.status).toBe('PHONE_VERIFIED');
    const row = (
      await dataSource.query(
        `SELECT attempt_count, status, verified_at FROM customer_registration_phone_challenges`,
      )
    )[0];
    expect(row.attempt_count).toBe(4); // a successful verification never counts as a failure
    expect(row.status).toBe('VERIFIED');
    expect(row.verified_at).not.toBeNull();
  });

  it('19b: a locked-out challenge cannot be rescued by the correct code, and repeated post-lockout probes stay inert', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }).expect(400);
    }
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    }
    const row = (
      await dataSource.query(
        `SELECT attempt_count, status, verified_at FROM customer_registration_phone_challenges`,
      )
    )[0];
    expect(row.attempt_count).toBe(5);
    expect(row.status).toBe('ACTIVE');
    expect(row.verified_at).toBeNull();
  });

  it('19c: a time-expired challenge is never charged against the attempt budget, only flipped to EXPIRED', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    await dataSource.query(
      `UPDATE customer_registration_phone_challenges SET expires_at = now() - interval '1 second'`,
    );
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    const row = (
      await dataSource.query(
        `SELECT attempt_count, status FROM customer_registration_phone_challenges`,
      )
    )[0];
    expect(row.status).toBe('EXPIRED');
    expect(row.attempt_count).toBe(0); // expiry is a dead challenge, not a wasted guess
  });

  it('19d: replaying the correct code after success is inert — it cannot corrupt the VERIFIED challenge back into a lockable state', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const verify = await request(app.getHttpServer())
      .post(VERIFY_PATH)
      .send({ phone, code })
      .expect(200);
    for (let i = 0; i < 6; i += 1) {
      await request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code }).expect(400);
    }
    // The implemented consumer requires an ACTIVE/VERIFIED, unconsumed challenge, so repeated
    // failed consumption attempts are the analogue of the old replay probes.
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-replay-inert-${phone.slice(2)}`],
    );
    const customerId = rows[0]!.id;
    const contacts: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [customerId, `+2348${phone.slice(2)}`, `8${phone.slice(2)}`],
    );
    for (let i = 0; i < 6; i += 1) {
      await expect(
        customerService.updateContactMethod(customerId, contacts[0]!.id, {
          verificationToken: 'e'.repeat(43),
          actor: 'customer-self-service',
        }),
      ).rejects.toThrow('Phone verification token is invalid or expired');
    }
    const row = (
      await dataSource.query(
        `SELECT attempt_count, status FROM customer_registration_phone_challenges`,
      )
    )[0];
    // Repeated failed consumption must never increment attempt_count nor flip a VERIFIED
    // challenge to REVOKED/EXPIRED — the valid token below still consumes successfully.
    expect(row.attempt_count).toBe(0);
    expect(row.status).toBe('VERIFIED');
    await customerService.updateContactMethod(customerId, contacts[0]!.id, {
      verificationToken: verify.body.verificationToken,
      actor: 'customer-self-service',
    });
  });

  it('19e: concurrent wrong attempts cannot race past the cap — the challenge row never overcounts or undercounts under contention', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const code = extractCode(`+2348${phone.slice(2)}`);
    const wrong = code === '000000' ? '000001' : '000000';
    // Fire simultaneous wrong-code attempts against the same challenge row. The
    // attempt-count read-modify-write is guarded by a pessimistic row lock inside a
    // SERIALIZABLE transaction (retried up to MAX_SERIALIZABLE_ATTEMPTS on PostgreSQL
    // 40001/40P01 via the shared runSerializableWithRetry helper — the same pattern already
    // used by the B2F policy services), so two concurrent requests can never both observe
    // the same pre-increment count: that would allow the persisted counter to undercount
    // (lost update) or the cap to be bypassed (an attempt accepted past attempt_count >= 5).
    //
    // Under heavy concurrency a handful of requests may instead surface as 503 from the
    // separate, pre-existing A2SecurityRateLimitService per-phone verify bucket (its own
    // internal transaction has no retry-on-serialization-failure — a related, out-of-scope
    // finding documented in docs/V1/V1-CUSTOMER-06-OTP-LOCKOUT-SECURITY-01.md).
    //
    // A request can also legitimately surface as 409 from the OTP-verify transaction itself:
    // runSerializableWithRetry (src/common/serializable-transaction.ts) retries a genuine
    // PostgreSQL serialization failure (40001) up to MAX_SERIALIZABLE_ATTEMPTS (3) and, if
    // every attempt collides again under this test's deliberately adversarial six-way
    // simultaneous write contention on one row, raises ConflictException rather than hanging
    // or silently losing the write — the exact "contention is surfaced as a retryable conflict
    // to the client" behavior documented on that helper. This was reproduced directly
    // (V1-TEST-01): re-running this test ~25 times in isolation against a live PostgreSQL
    // server surfaced the body
    // `{"message":"CUSTOMER_REGISTRATION_OTP_VERIFY exhausted 3 bounded transaction attempts","statusCode":409}`
    // on roughly 1 in 8 runs, and in every one of those runs attempt_count still landed
    // strictly inside [1,5] and status stayed ACTIVE — i.e. the security invariant this test
    // exists to prove held every time; only the HTTP status enumeration below was incomplete.
    // No response may ever be 200 for a wrong code, and the final persisted state must never
    // exceed the cap regardless of how many requests got as far as the OTP comparison.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer()).post(VERIFY_PATH).send({ phone, code: wrong }),
      ),
    );
    for (const res of results) {
      expect(res.status).not.toBe(200);
      expect([400, 409, 503]).toContain(res.status);
    }
    const row = (
      await dataSource.query(
        `SELECT attempt_count, status FROM customer_registration_phone_challenges`,
      )
    )[0];
    expect(row.attempt_count).toBeGreaterThanOrEqual(1);
    expect(row.attempt_count).toBeLessThanOrEqual(5); // never overcounts past the cap
    expect(row.status).toBe('ACTIVE');
  });

  it('20: resend cooldown — immediate resend is a generic no-op; after cooldown a fresh OTP supersedes the old one', async () => {
    const phone = nextPhone();
    await requestOtp(phone);
    const firstCode = extractCode(`+2348${phone.slice(2)}`);
    await requestOtp(phone); // inside cooldown window → generic 200, no new challenge/SMS
    expect(provider.sent).toHaveLength(1);
    expect(await counts('customer_registration_phone_challenges')).toBe(1);

    // Simulate the cooldown having elapsed by clearing the governed cooldown bucket (the
    // cooldown is a shared rate-limit bucket now, not a timestamp on the challenge row).
    await elapseResendCooldown(phone);
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

    // PROOF 21 — the token is bound to phone A's challenge. Attaching it to a contact holding
    // phone B is refused, in both the 0-prefixed and +234 renderings of B, because B has no
    // VERIFIED challenge to consume.
    const bRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-binding-b-${phoneB.slice(2)}`],
    );
    const bCustomerId = bRows[0]!.id;
    // One contact row per phone: the schema enforces uniqueness on (type, normalized value), and
    // the point of the assertion is that *no* rendering of phone B can consume A's token.
    const bContacts: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [bCustomerId, `+2348${phoneB.slice(2)}`, `8${phoneB.slice(2)}`],
    );
    await expect(
      customerService.updateContactMethod(bCustomerId, bContacts[0]!.id, {
        verificationToken: verify.body.verificationToken,
        actor: 'customer-self-service',
      }),
    ).rejects.toThrow('Phone verification token is invalid or expired');

    // Phone A itself can consume it.
    const aRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-binding-a-${phoneA.slice(2)}`],
    );
    const aContacts: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [aRows[0]!.id, `+2348${phoneA.slice(2)}`, `8${phoneA.slice(2)}`],
    );
    const verifiedContact = await customerService.updateContactMethod(
      aRows[0]!.id,
      aContacts[0]!.id,
      { verificationToken: verify.body.verificationToken, actor: 'customer-self-service' },
    );
    expect(verifiedContact.verifiedAt).not.toBeNull();
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
    const taken = await registerFully(takenPhone);
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

    // Bogus-token refusal is generic and independent of phone state. The implemented consumer
    // raises one fixed message for "no challenge", "wrong token" and "already consumed", which is
    // exactly the non-enumerability property this assertion exists to protect.
    const takenContact: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE'`,
      [taken.id],
    );
    const freshRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-enum-${randomUUID()}`],
    );
    const freshContact: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [
        freshRows[0]!.id,
        `+2348111${String(Date.now()).slice(-6)}`,
        `8111${String(Date.now()).slice(-6)}`,
      ],
    );
    const reg1 = await expect(
      customerService.updateContactMethod(taken.id, takenContact[0]!.id, {
        verificationToken: 'b'.repeat(43),
        actor: 'customer-self-service',
      }),
    ).rejects.toThrow('Phone verification token is invalid or expired');
    const reg2 = await expect(
      customerService.updateContactMethod(freshRows[0]!.id, freshContact[0]!.id, {
        verificationToken: 'b'.repeat(43),
        actor: 'customer-self-service',
      }),
    ).rejects.toThrow('Phone verification token is invalid or expired');
    expect(reg1).toBeUndefined();
    expect(reg2).toBeUndefined();
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

    // Per-IP throttling. The historic completion-per-IP bucket belongs to the closed legacy
    // route and is therefore unreachable (it answers 503 before any completion accounting), so
    // the reachable, security-relevant per-IP limit on this surface is OTP issuance
    // (`CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP`, capacity 20/hour). It is asserted here so the
    // "bulk phone-space probing from one IP is throttled" property keeps its coverage.
    // Start from a clean per-IP bucket so the cap can be counted exactly.
    await dataSource.query(
      `DELETE FROM a2_security_rate_buckets WHERE category = 'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP'`,
    );
    for (let i = 0; i < 20; i += 1) await requestOtp(nextPhone());
    const capped = await request(app.getHttpServer())
      .post(OTP_PATH)
      .send({ phone: nextPhone() })
      .expect(429);
    expect(capped.body.message).toContain('Security request rate exceeded');

    // The cap is scoped to that bucket, not global: clearing it restores issuance, which proves
    // the 429 came from the per-IP rule rather than from corrupted or exhausted global state.
    await dataSource.query(
      `DELETE FROM a2_security_rate_buckets WHERE category = 'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP'`,
    );
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
    // Consume the token just issued (re-requesting an OTP would supersede this challenge).
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`mn-audit-${phone.slice(2)}`],
    );
    const contacts: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
      [rows[0]!.id, `+2348${phone.slice(2)}`, `8${phone.slice(2)}`],
    );
    await customerService.updateContactMethod(rows[0]!.id, contacts[0]!.id, {
      verificationToken: verify.body.verificationToken,
      actor: 'customer-self-service',
    });
    const body = { id: rows[0]!.id };

    // PROOF 25 — the implemented flow emits the challenge and verification events.
    const audits: Array<{ entity_type: string; action: string; actor: string; new_values: any }> =
      await dataSource.query(
        `SELECT entity_type, action, actor, new_values FROM audit_events ORDER BY occurred_at, id`,
      );
    const actions = audits.map((row) => `${row.entity_type}/${row.action}`);
    // The four challenge events and the contact-verification event are produced by the
    // implemented OTP + verification path; `REGISTRATION_INITIATED` and `CUSTOMER/CREATED` were
    // emitted only by the closed legacy completion route, so their *absence* is now asserted:
    // the platform must not record a registration it did not perform.
    expect(actions).toEqual(
      expect.arrayContaining([
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_REQUESTED',
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_VERIFY_FAILED',
        'CUSTOMER_REGISTRATION_CHALLENGE/OTP_VERIFIED',
        'CUSTOMER_CONTACT_METHOD/PHONE_VERIFIED',
      ]),
    );
    expect(actions).not.toContain('CUSTOMER_REGISTRATION_CHALLENGE/REGISTRATION_INITIATED');
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
    expect(body.id).toBeTruthy();
  });
});
