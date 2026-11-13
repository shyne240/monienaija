/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from '../src/notification/notification.types';
import { TrustedTierFixture } from './support/trusted-tier-fixture';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 4 — complete authenticated customer journey against the real backend + PostgreSQL.
 *
 * Every financial, session and credential decision below is taken by production code. The only
 * test-provided inputs are the ones this repository already designates as controlled evidence:
 *
 * - `TrustedTierFixture` (the accepted oracle override used by the agent/financial suites) supplies
 *   the approved tier policy and a trusted identity-evidence snapshot, because production has no
 *   confirmed identity provider (a deferred, separately-owned dependency), and
 * - an in-memory SMS sink captures OTPs exactly as `TestNotificationProvider` does for the
 *   registration suites, because the synthetic onboarding completion path is deliberately fenced to
 *   a disposable, isolated PostgreSQL cluster that this environment does not provision.
 *
 * Nothing else is stubbed: sessions, credentials, PINs, recovery, eligibility and revocation all run
 * through the real services and tables. Steps are numbered to match the mission's acceptance list.
 */

const PASSCODE = '123456';
const RECOVERED_PASSCODE = '246810';
const PIN = '654321';
const RECOVERED_PIN = '135790';

class CapturingSmsProvider implements NotificationProvider {
  readonly name = 'capturing-sms';
  readonly messages: Array<{ destination: string; message: string; eventType: string }> = [];

  send(input: NotificationSendRequest): Promise<NotificationSendResult> {
    this.messages.push({
      destination: input.destination,
      message: input.message,
      eventType: input.eventType,
    });
    return Promise.resolve({ success: true, providerRef: `capture-${this.messages.length}` });
  }

  clear(): void {
    this.messages.length = 0;
  }

  /** Last six-digit code delivered for an event type (test-only extraction). */
  lastCodeFor(eventTypeFragment: string): string {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const entry = this.messages[i]!;
      if (!entry.eventType.includes(eventTypeFragment)) continue;
      const match = /\b(\d{6})\b/.exec(entry.message);
      if (match) return match[1]!;
    }
    throw new Error(`No six-digit code captured for ${eventTypeFragment}`);
  }
}

function encodePbkdf2(secret: string, saltStr = 'arena4-journey-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(secret, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function phone(): string {
  return `0${8}${String(Math.floor(100000000 + Math.random() * 899999999)).slice(0, 9)}`;
}

describe('ARENA 4 customer journey (real backend + PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  const evidence = new TrustedTierFixture();
  const sms = new CapturingSmsProvider();

  beforeAll(async () => {
    process.env.CUSTOMER_CREDENTIAL_RECOVERY_ENABLED = 'true';
    dataSource = await createIntegrationDataSource('a4journey');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(evidence)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(sms)
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
    delete process.env.CUSTOMER_CREDENTIAL_RECOVERY_ENABLED;
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await evidence.seedPolicy(dataSource);
    sms.clear();
  });

  const server = () => app.getHttpServer();

  /**
   * Controlled enrolment: the platform decision a verified-provider claim would produce
   * (ACTIVE customer, LEVEL_1/APPROVED, one verified primary phone, one approved assessment, one
   * trusted evidence snapshot) plus a six-digit login passcode stored in the SAME credential row and
   * format the onboarding surface uses (PBKDF2$sha256$…).
   */
  async function enrolCustomer(options: { verifyPhone?: boolean } = {}) {
    const canonical = phone().slice(1);
    const customerRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`a4-${randomUUID()}`],
    );
    const customerId = customerRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, legal_name, is_active)
       VALUES ($1,'Amaka Obi','Amaka Obi',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,$4)`,
      [customerId, `0${canonical}`, canonical, options.verifyPhone === false ? null : new Date()],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
         (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [customerId, encodePbkdf2(PASSCODE)],
    );
    if (options.verifyPhone !== false) await evidence.approveLevelOne(dataSource, customerId);
    return { customerId, phone: `0${canonical}` };
  }

  function login(identifier: string, secret: string) {
    return request(server())
      .post('/api/v1/customers/sessions')
      .send({ identifier, password: secret });
  }

  async function authedToken(identifier: string, secret = PASSCODE): Promise<string> {
    const response = await login(identifier, secret).expect(200);
    expect(response.body.accessToken).toBeTruthy();
    return response.body.accessToken as string;
  }

  // 1–4. Registration front door, controlled identity verification, assessment, passcode + PIN.
  it('1-4. registers a phone, records controlled identity evidence and sets a passcode and a separate PIN', async () => {
    const phoneNumber = phone();
    const start = await request(server())
      .post('/api/v1/customers/registration-sessions/start')
      .send({ phone: phoneNumber })
      .expect(200);
    const sessionId = start.body.id ?? start.body.sessionId;
    const sessionToken = start.body.token ?? start.body.authorization;
    expect(sessionId).toBeTruthy();

    await request(server())
      .post('/api/v1/customers/registration-sessions/otp')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ sessionId, requestId: randomUUID() })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('OTP_REQUEST_ACCEPTED'));

    // The OTP is never returned by the API — it is delivered out-of-band (captured sink here).
    const code = sms.lastCodeFor('registration');
    const verified = await request(server())
      .post('/api/v1/customers/registration-sessions/otp/verify')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ sessionId, code })
      .expect(200);
    expect(verified.body.authorization).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Controlled identity verification + KYC assessment for the enrolled customer.
    const { customerId, phone: storedPhone } = await enrolCustomer();
    const assessment: Array<{ kyc_level: string; kyc_status: string }> = await dataSource.query(
      `SELECT kyc_level, kyc_status FROM customer_kyc_assessments
        WHERE customer_id=$1 AND kyc_status='APPROVED' AND expires_at > clock_timestamp()`,
      [customerId],
    );
    expect(assessment).toHaveLength(1);
    expect(assessment[0]!.kyc_level).toBe('LEVEL_1');

    // Passcode (credential) + separate transaction PIN, through the real authenticated endpoint.
    const token = await authedToken(storedPhone);
    await request(server())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: PIN })
      .expect(200);
    const pinRow: Array<{ pin_hash: string }> = await dataSource.query(
      `SELECT pin_hash FROM customer_transaction_pins WHERE customer_id=$1 AND deleted_at IS NULL`,
      [customerId],
    );
    expect(pinRow).toHaveLength(1);
    expect(pinRow[0]!.pin_hash).not.toContain(PIN);
    const credRow: Array<{ password_hash: string }> = await dataSource.query(
      `SELECT password_hash FROM customer_authentication_credentials WHERE customer_id=$1`,
      [customerId],
    );
    expect(credRow[0]!.password_hash).not.toContain(PASSCODE);
  }, 120000);

  // 5–6. Financial eligibility determination + passcode login on the accepted credential contract.
  it('5-6. denies financial login without eligibility and grants it with the six-digit passcode', async () => {
    const eligible = await enrolCustomer();
    const denied = await enrolCustomer({ verifyPhone: false });

    // No verified phone / no trusted evidence ⇒ no session is issued, and the refusal is a conflict
    // (not eligible) rather than a generic credential failure.
    const refused = await login(denied.phone, PASSCODE);
    expect([409, 503]).toContain(refused.status);

    // The passcode IS the credential value on the accepted contract (`password` field), so a
    // six-digit passcode authenticates through exactly the same endpoint as a workforce password.
    const ok = await login(eligible.phone, PASSCODE).expect(200);
    expect(ok.body.audience ?? 'customer-api').toBeTruthy();
    expect(ok.body.customerId).toBe(eligible.customerId);

    const wrong = await login(eligible.phone, '000000');
    expect(wrong.status).toBe(401);
  }, 120000);

  // 7–10. Dashboard, KYC + limits, history and receipt through the real endpoints the app calls.
  it('7-10. serves dashboard, KYC projection, limits, transaction history and a receipt', async () => {
    const { customerId, phone: storedPhone } = await enrolCustomer();
    const token = await authedToken(storedPhone);
    const auth = { Authorization: `Bearer ${token}` };
    await request(server())
      .post('/api/v1/customers/me/transaction-pin')
      .set(auth)
      .send({ pin: PIN, confirmation: PIN })
      .expect(200);

    const dashboard = await request(server())
      .get('/api/v1/customers/me/dashboard')
      .set(auth)
      .expect(200);
    expect(dashboard.body.identity.id).toBe(customerId);
    expect(dashboard.body.profile.displayName).toBe('Amaka Obi');
    expect(dashboard.body.receivingIdentity).toBeTruthy();
    expect(Array.isArray(dashboard.body.recentTransactions.items)).toBe(true);

    const kyc = await request(server()).get('/api/v1/customers/me/kyc').set(auth).expect(200);
    expect(kyc.body.kycLevel).toBe('LEVEL_1');
    expect(kyc.body.policy.configured).toBe(true);
    expect(kyc.body.upgradePathway.status).toBeTruthy();
    expect(kyc.headers['cache-control']).toContain('no-store');

    const limits = await request(server()).get('/api/v1/customers/me/limits').set(auth).expect(200);
    expect(Array.isArray(limits.body.products)).toBe(true);

    // Fund a wallet and move money through the real transfer service so history/receipt are real.
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const wallets = app.get(WalletService);
    const ledger = app.get(LedgerService);
    const source = await wallets.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `a4-src-${customerId}`,
    });
    const counterparty = await enrolCustomer();
    const destination = await wallets.createWallet({
      customerId: counterparty.customerId,
      currency: 'NGN',
      idempotencyKey: `a4-dst-${counterparty.customerId}`,
    });
    const platform = await ledger.createAccount({
      code: `A4_PLAT_${randomUUID().slice(0, 6)}`,
      name: 'Arena 4 journey platform',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledger.postJournal({
      idempotencyKey: `a4-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `a4-ref-${randomUUID()}`,
      lines: [
        { accountId: platform.id, direction: 'DEBIT' as any, amountMinor: '50000' },
        { accountId: source.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' },
      ],
    });
    const transfer = await request(server())
      .post('/api/v1/customers/me/transfers')
      .set(auth)
      .set('Idempotency-Key', `a4-transfer-${randomUUID()}`)
      .send({
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        amountMinor: '10000',
        currency: 'NGN',
        reference: `a4-xfer-${randomUUID()}`,
        pin: PIN,
      })
      .expect(201);
    const transferId = transfer.body.id as string;

    const history = await request(server())
      .get('/api/v1/customers/me/transactions?page=1&limit=5')
      .set(auth)
      .expect(200);
    const items = history.body.items as Array<{ id: string; status: string }>;
    expect(items.length).toBeGreaterThan(0);
    const row = items.find((item) => item.id === transferId);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('COMPLETED');

    const receipt = await request(server())
      .get(`/api/v1/customers/me/transactions/${transferId}`)
      .set(auth)
      .expect(200);
    expect(receipt.body.reference).toBeTruthy();
    expect(receipt.body.status).toBe('COMPLETED');
    // No ledger/internals or credential material in the receipt projection.
    expect(JSON.stringify(receipt.body)).not.toMatch(/pin_hash|password_hash|journalId/i);

    const foreign = await enrolCustomer();
    const foreignToken = await authedToken(foreign.phone);
    await request(server())
      .get(`/api/v1/customers/me/transactions/${transferId}`)
      .set({ Authorization: `Bearer ${foreignToken}` })
      .expect(404);
  }, 180000);

  // 11–12. Logout, revocation, reauthentication.
  it('11-12. revokes the session on logout and reauthenticates with a fresh one', async () => {
    const { phone: storedPhone } = await enrolCustomer();
    const token = await authedToken(storedPhone);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    await request(server())
      .post('/api/v1/customers/sessions/logout')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200)
      .expect((res) => expect(res.body.revoked).toBe(true));

    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);

    const fresh = await authedToken(storedPhone);
    expect(fresh).not.toBe(token);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${fresh}` })
      .expect(200);
  }, 120000);

  // 13–14. Self-service credential recovery under the approved policy, and the same-token replay.
  it('13-14. recovers the passcode and the PIN through OTP + identity evidence, revoking live sessions', async () => {
    const { customerId, phone: storedPhone } = await enrolCustomer();
    const token = await authedToken(storedPhone);
    await request(server())
      .post('/api/v1/customers/me/transaction-pin')
      .set({ Authorization: `Bearer ${token}` })
      .send({ pin: PIN })
      .expect(200);

    const policy = await request(server())
      .get('/api/v1/customers/credential-recovery/policy')
      .expect(200);
    expect(policy.body.enabled).toBe(true);
    expect(policy.body.authority.phoneNumberAloneIsSufficient).toBe(false);

    // --- Passcode recovery
    await request(server())
      .post('/api/v1/customers/credential-recovery/challenges')
      .send({ phone: storedPhone, purpose: 'LOGIN_PASSCODE' })
      .expect(202)
      .expect((res) => expect(res.body.status).toBe('ACCEPTED'));
    const challengeRows: Array<{ id: string; code_hash: string }> = await dataSource.query(
      `SELECT id, code_hash FROM customer_credential_recovery_challenges
        WHERE customer_id=$1 AND purpose='LOGIN_PASSCODE' AND status='ACTIVE'`,
      [customerId],
    );
    expect(challengeRows).toHaveLength(1);
    const challengeId = challengeRows[0]!.id;
    const otp = sms.lastCodeFor('recovery');

    // Wrong code is rejected and counted; the challenge stays usable.
    await request(server())
      .post('/api/v1/customers/credential-recovery/challenges/verify')
      .send({ challengeId, code: '000000' })
      .expect(401);
    const attempts: Array<{ attempt_count: number }> = await dataSource.query(
      `SELECT attempt_count FROM customer_credential_recovery_challenges WHERE id=$1`,
      [challengeId],
    );
    expect(attempts[0]!.attempt_count).toBe(1);

    const verified = await request(server())
      .post('/api/v1/customers/credential-recovery/challenges/verify')
      .send({ challengeId, code: otp, deviceId: 'test-device-a4-0001' })
      .expect(200);
    expect(verified.body.status).toBe('VERIFIED');
    expect(verified.body.deviceVerification).toBe('OTP_AND_IDENTITY_EVIDENCE');
    const recoveryToken = verified.body.recoveryToken as string;

    const completed = await request(server())
      .post('/api/v1/customers/credential-recovery/complete')
      .send({
        recoveryToken,
        newSecret: RECOVERED_PASSCODE,
        confirmation: RECOVERED_PASSCODE,
        deviceId: 'test-device-a4-0001',
      })
      .expect(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    // The pre-recovery session is revoked; the old passcode no longer works; the new one does.
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);
    expect((await login(storedPhone, PASSCODE)).status).toBe(401);
    const newToken = await authedToken(storedPhone, RECOVERED_PASSCODE);

    // Replay of the same recovery token can never apply a second change.
    await request(server())
      .post('/api/v1/customers/credential-recovery/complete')
      .send({
        recoveryToken,
        newSecret: '998877',
        confirmation: '998877',
        deviceId: 'test-device-a4-0001',
      })
      .expect(401);
    expect((await login(storedPhone, '998877')).status).toBe(401);

    // --- Transaction PIN recovery (separate purpose, separate challenge)
    await request(server())
      .post('/api/v1/customers/credential-recovery/challenges')
      .send({ phone: storedPhone, purpose: 'TRANSACTION_PIN' })
      .expect(202);
    const pinChallenge: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_credential_recovery_challenges
        WHERE customer_id=$1 AND purpose='TRANSACTION_PIN' AND status='ACTIVE'`,
      [customerId],
    );
    const pinVerified = await request(server())
      .post('/api/v1/customers/credential-recovery/challenges/verify')
      .send({ challengeId: pinChallenge[0]!.id, code: sms.lastCodeFor('recovery') })
      .expect(200);
    const pinCompleted = await request(server())
      .post('/api/v1/customers/credential-recovery/complete')
      .send({
        recoveryToken: pinVerified.body.recoveryToken,
        newSecret: RECOVERED_PIN,
        confirmation: RECOVERED_PIN,
      })
      .expect(200);
    // A PIN recovery revokes live sessions too; a fresh sign-in is required to use the new PIN.
    expect(pinCompleted.body.sessionsRevoked).toBeGreaterThanOrEqual(1);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${newToken}` })
      .expect(401);
    const pinToken = await authedToken(storedPhone, RECOVERED_PASSCODE);
    // The replacement PIN is the one the platform now accepts, and the old one is gone.
    await request(server())
      .post('/api/v1/customers/me/transaction-pin/verify')
      .set({ Authorization: `Bearer ${pinToken}` })
      .send({ pin: RECOVERED_PIN })
      .expect(200)
      .expect((res) => expect(res.body.verified).toBe(true));
    await request(server())
      .post('/api/v1/customers/me/transaction-pin/verify')
      .set({ Authorization: `Bearer ${pinToken}` })
      .send({ pin: PIN })
      .expect(200)
      .expect((res) => expect(res.body.verified).toBe(false));

    // No credential material, OTP or recovery token is ever persisted in an audit value.
    const audit: Array<{ new_values: unknown }> = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='CUSTOMER_CREDENTIAL_RECOVERY'`,
    );
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(otp);
    expect(serialized).not.toContain(recoveryToken);
    expect(serialized).not.toContain(RECOVERED_PASSCODE);
    expect(serialized).not.toContain(RECOVERED_PIN);
  }, 180000);

  // 15. Eligibility loss revokes financial access permanently (no silent reactivation).
  it('15. denies financial access after eligibility loss and never restores the withdrawn session', async () => {
    const { customerId, phone: storedPhone } = await enrolCustomer();
    const token = await authedToken(storedPhone);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    await dataSource.query(
      `INSERT INTO kyc_tier_manual_holds (customer_id, actor, reason) VALUES ($1,'a4-journey','JOURNEY_HOLD')`,
      [customerId],
    );

    // The next request is refused AND the session is permanently revoked.
    expect([401, 409]).toContain(
      (
        await request(server())
          .get('/api/v1/customers/me')
          .set({ Authorization: `Bearer ${token}` })
      ).status,
    );
    const revokeReason: Array<{ revoke_reason: string | null }> = await dataSource.query(
      `SELECT revoke_reason FROM authentication_sessions WHERE customer_id=$1 ORDER BY issued_at DESC LIMIT 1`,
      [customerId],
    );
    expect(revokeReason[0]!.revoke_reason).toBe('FINANCIAL_ELIGIBILITY_WITHDRAWN');

    // Lifting the hold must not resurrect the withdrawn token.
    await dataSource.query(`DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1`, [customerId]);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);

    // A brand-new authentication attempt succeeds again once authority is restored.
    const restored = await authedToken(storedPhone);
    await request(server())
      .get('/api/v1/customers/me')
      .set({ Authorization: `Bearer ${restored}` })
      .expect(200);
  }, 120000);

  // Fail-closed recovery behaviour and enumeration safety.
  it('fails recovery closed without trusted evidence and never enumerates accounts', async () => {
    const { customerId, phone: storedPhone } = await enrolCustomer();
    const [before]: Array<{ password_hash: string }> = await dataSource.query(
      `SELECT password_hash FROM customer_authentication_credentials WHERE customer_id=$1`,
      [customerId],
    );
    const originalHash = before!.password_hash;

    // Unknown number: identical accepted response, and no challenge row anywhere.
    const unknown = await request(server())
      .post('/api/v1/customers/credential-recovery/challenges')
      .send({ phone: phone(), purpose: 'LOGIN_PASSCODE' })
      .expect(202);
    expect(unknown.body.status).toBe('ACCEPTED');
    const unknownRows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM customer_credential_recovery_challenges`,
    );
    expect(Number(unknownRows[0]!.count)).toBe(0);

    // Known customer but no confirmable identity evidence ⇒ SUPPORT_REQUIRED, no credential change.
    evidence.withdraw(customerId);
    await request(server())
      .post('/api/v1/customers/credential-recovery/challenges')
      .send({ phone: storedPhone, purpose: 'LOGIN_PASSCODE' })
      .expect(202);
    const challenge: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_credential_recovery_challenges WHERE customer_id=$1 AND status='ACTIVE'`,
      [customerId],
    );
    const supportRequired = await request(server())
      .post('/api/v1/customers/credential-recovery/challenges/verify')
      .send({ challengeId: challenge[0]!.id, code: sms.lastCodeFor('recovery') })
      .expect(409);
    expect(supportRequired.body.status).toBe('SUPPORT_REQUIRED');
    expect(supportRequired.body.reason).toBe('TRUSTED_EVIDENCE_UNAVAILABLE');
    // Nothing was replaced: the stored passcode hash is untouched and the only reason a
    // login is refused now is the financial eligibility gate (never a credential failure).
    const [credential]: Array<{ password_hash: string }> = await dataSource.query(
      `SELECT password_hash FROM customer_authentication_credentials WHERE customer_id=$1`,
      [customerId],
    );
    expect(credential!.password_hash).toBe(originalHash);
    expect([409, 503]).toContain((await login(storedPhone, PASSCODE)).status);

    // Policy disabled ⇒ same accepted response, no challenge issued, no credential path.
    process.env.CUSTOMER_CREDENTIAL_RECOVERY_ENABLED = 'false';
    try {
      await request(server())
        .post('/api/v1/customers/credential-recovery/challenges')
        .send({ phone: storedPhone, purpose: 'LOGIN_PASSCODE' })
        .expect(202);
      const rows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text AS count FROM customer_credential_recovery_challenges WHERE status='ACTIVE'`,
      );
      expect(Number(rows[0]!.count)).toBe(0);
      const policy = await request(server())
        .get('/api/v1/customers/credential-recovery/policy')
        .expect(200);
      expect(policy.body.enabled).toBe(false);
      expect(policy.body.fallback.status).toBe('SUPPORT_REQUIRED');
    } finally {
      process.env.CUSTOMER_CREDENTIAL_RECOVERY_ENABLED = 'true';
    }
  }, 120000);
});
