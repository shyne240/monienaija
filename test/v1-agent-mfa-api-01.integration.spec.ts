/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, @typescript-eslint/await-thenable, no-empty */
/**
 * V1-AGENT-MFA-API-01 — agent-desk customer OTP challenge issuance (real PostgreSQL).
 *
 * Exposes the EXISTING canonical MFA challenge machinery over HTTP for the two already-live
 * agent money flows that consume mfaChallengeId+otp (Wallet→Cash, Cash→Cash claim).
 * Covers the task's mandatory cases A–M. No mocks: real DB (per-process database), real
 * HTTP, canonical services; only the SMS provider is the provider-neutral TEST adapter
 * (same pattern as sms-v1-01 / UAT suites) so the delivered OTP can be captured as the
 * customer's phone would receive it.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(secret, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('V1-AGENT-MFA-API-01 — agent desk OTP challenge issuance (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let agentAuthService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let mfaService: MfaExecutionService;
  let sms: TestNotificationProvider;
  let systemLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1mfa01');
    sms = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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
    agentAuthService = moduleRef.get(AgentAuthenticationService);
    customerPinService = moduleRef.get(CustomerTransactionPinService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    mfaService = moduleRef.get(MfaExecutionService);
    const sys = await ledgerService.createAccount({
      code: `SYS-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
      name: 'System Float NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    systemLedgerAccountId = sys.id;
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60000);

  beforeEach(() => {
    // No table truncation here: the system float account is created once in beforeAll,
    // and every fixture uses fresh UUIDs/phones (a1x precedent — cross-test isolation
    // comes from uniqueness, not truncation).
    sms.clear();
  });

  async function createAgent(services: string[], pin: string | null) {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-${randomUUID().slice(0, 8)}`,
        `MFA-${randomUUID().slice(0, 6)}`,
        'MFA Class',
        JSON.stringify(services),
        JSON.stringify({}),
      ],
    );
    const classId = classRows[0]!.id;
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-mfa-${randomUUID()}`, classId],
    );
    const agentId = agentRows[0]!.id;
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hashSecret('correct-password')],
    );
    if (pin !== null) {
      await agentAuthService.setTransactionPin(agentId, {
        pinHash: hashSecret(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agentId,
      });
    }
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'correct-password' })
      .expect(200);
    const token = login.body.accessToken as string;
    const wallet = await walletService.createWallet({
      customerId: agentId,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agentId}-${randomUUID()}`,
    });
    return { agentId, token, wallet };
  }

  async function createCustomer(phone: string, opts: { pin?: string; verified?: boolean } = {}) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-mfa-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, `Customer MFA ${randomUUID().slice(0, 4)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,$3)`,
      [customerId, phone, opts.verified === false ? null : new Date()],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD',$3,'PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
      [randomUUID(), customerId, hashSecret(`customer-pw-${randomUUID()}`)],
    );
    if (opts.pin) {
      await customerPinService.setTransactionPin(customerId, {
        pinHash: hashSecret(opts.pin),
        hashAlgorithm: 'PBKDF2',
        pinVersion: 1,
        actor: customerId,
      });
    }
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function fund(accountLedgerId: string, amount: string) {
    await ledgerService.postJournal({
      idempotencyKey: `fund-${accountLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: accountLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  async function issueDeskOtp(token: string, body: any, expectedStatus = 201) {
    return request(app.getHttpServer())
      .post('/api/v1/agents/me/mfa-challenges')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(expectedStatus);
  }

  function capturedOtp(): string {
    expect(sms.sent.length).toBeGreaterThan(0);
    const message = sms.sent[sms.sent.length - 1]!.message;
    const match = message.match(/code is (\d{6})\b/);
    expect(match).toBeTruthy();
    return match![1]!;
  }

  it('A. issuance succeeds: challenge row (purpose+hashed comparand), context rows, direct SMS, no OTP in response', async () => {
    const { token } = await createAgent([AgentService.CASH_OUT], null);
    const phone = '+2348000000001';
    const { customerId } = await createCustomer(phone);
    const res = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    const body = res.body;
    expect(body.challengeId).toBeTruthy();
    expect(body.customerId).toBe(customerId);
    expect(body.purpose).toBe('WALLET_TO_CASH');
    expect(body.deliveryChannel).toBe('SMS');
    expect(body.ttlSeconds).toBe(300);
    expect(body.destinationMasked).toBe('***0001');
    // response must never contain the OTP
    expect(JSON.stringify(body)).not.toMatch(/\b\d{6}\b/);
    // challenge row: purpose bound, hashed comparand (never plaintext)
    const rows: Array<{ purpose: string | null; challenge_hash: string; status: string; customer_id: string; session_id: string }> =
      await dataSource.query(`SELECT purpose, challenge_hash, status, customer_id, session_id FROM mfa_challenges WHERE id=$1`, [
        body.challengeId,
      ]);
    expect(rows[0]!.purpose).toBe('WALLET_TO_CASH');
    expect(rows[0]!.status).toBe('ACTIVE');
    expect(rows[0]!.customer_id).toBe(customerId);
    expect(rows[0]!.challenge_hash.startsWith('PBKDF2$sha256$100000$')).toBe(true);
    // delivery: direct send to customer phone with the code
    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0]!.destination).toBe(phone);
    expect(sms.sent[0]!.eventType).toBe('agent.desk.customer_otp');
    const code = capturedOtp();
    expect(rows[0]!.challenge_hash).not.toContain(code);
    // canonical context: ENABLED enrollment + SMS method + customer-plane session
    const ctx = await dataSource.query(
      `SELECT e.status AS estatus, m.method_type, m.status AS mstatus, s.audience, s.status AS sstatus, length(s.token_hash) AS hash_len
       FROM mfa_challenges c
       JOIN mfa_enrollments e ON e.id = c.enrollment_id
       JOIN mfa_methods m ON m.id = c.method_id
       JOIN authentication_sessions s ON s.id = c.session_id
       WHERE c.id = $1`,
      [body.challengeId],
    );
    expect(ctx[0].estatus).toBe('ENABLED');
    expect(ctx[0].method_type).toBe('SMS');
    expect(ctx[0].mstatus).toBe('ENABLED');
    expect(ctx[0].audience).toBe('customer-api');
    expect(ctx[0].sstatus).toBe('ACTIVE');
    expect(ctx[0].hash_len).toBe(64);
  });

  it('B. unauthorized actors rejected: no token → 401; garbage token → 401', async () => {
    const { customerId } = await createCustomer('+2348000000002');
    await request(app.getHttpServer())
      .post('/api/v1/agents/me/mfa-challenges')
      .send({ customerId, purpose: 'WALLET_TO_CASH' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/agents/me/mfa-challenges')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ customerId, purpose: 'WALLET_TO_CASH' })
      .expect(401);
    expect(sms.sent.length).toBe(0);
    const before = (await dataSource.query(`SELECT count(*)::int AS n FROM mfa_challenges`))[0].n;
    await request(app.getHttpServer())
      .post('/api/v1/agents/me/mfa-challenges')
      .send({ customerId: randomUUID(), purpose: 'WALLET_TO_CASH' })
      .expect(401);
    const after = (await dataSource.query(`SELECT count(*)::int AS n FROM mfa_challenges`))[0].n;
    expect(after).toBe(before); // unauthorized issuance creates no challenge rows
  });

  it('C. wrong session rejected: revoked agent session loses access (401); invalid purpose and unknown customer denied', async () => {
    const { token } = await createAgent([AgentService.CASH_OUT], null);
    const { customerId } = await createCustomer('+2348000000003');
    await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    await request(app.getHttpServer())
      .post('/api/v1/agents/sessions/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 401);
    // invalid purpose + unknown customer with a fresh session
    const second = await createAgent([AgentService.CASH_OUT], null);
    await issueDeskOtp(second.token, { customerId, purpose: 'CASH_IN_MAGIC' }, 400);
    await issueDeskOtp(second.token, { customerId: randomUUID(), purpose: 'WALLET_TO_CASH' }, 404);
  });

  it('D. challenge expiry: expired challenge is denied EXPIRED at consumption', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_OUT], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const { customerId, wallet: cw } = await createCustomer('+2348000000004', { pin: '1111' });
    await fund(cw.ledgerAccountId, '100000');
    const issued = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH', ttlSeconds: 60 }, 201);
    const otp = capturedOtp();
    await dataSource.query(`UPDATE mfa_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [
      issued.body.challengeId,
    ]);
    await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `co-expired-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(400);
  });

  it('E. existing attempt semantics preserved: repeated WRONG OTP denied with no invented lockout; correct OTP still verifies', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_OUT], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const { customerId, wallet: cw } = await createCustomer('+2348000000005', { pin: '1111' });
    await fund(cw.ledgerAccountId, '100000');
    const issued = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    const otp = capturedOtp();
    for (const wrong of ['000000', '999999', '123456']) {
      if (wrong === otp) continue;
      await request(app.getHttpServer())
        .post('/api/v1/agents/cash-out')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          customerPin: '1111',
          mfaChallengeId: issued.body.challengeId,
          otp: wrong,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `co-wrong-${randomUUID()}`,
          agentPin: '4321',
        })
        .expect(400);
      const st = await dataSource.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [issued.body.challengeId]);
      expect(st[0].status).toBe('ACTIVE'); // no lockout/deliberate state change on wrong code
    }
    const ok = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `co-right-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(201);
    expect(ok.body.status).toBe('COMPLETED');
  });

  it('F & K. replay prevention: consumed challenge cannot be replayed into a new financial operation', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_OUT], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const { customerId, wallet: cw } = await createCustomer('+2348000000006', { pin: '1111' });
    await fund(cw.ledgerAccountId, '100000');
    const issued = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    const otp = capturedOtp();
    const first = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `co-f1-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(201);
    expect(first.body.status).toBe('COMPLETED');
    // NEW operation (new idempotency key) with the consumed challenge → REPLAYED → denied
    const again = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `co-f2-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(400);
    expect(JSON.stringify(again.body).toLowerCase()).toContain('otp already used');
  });

  it('G. purpose binding: WALLET_TO_CASH challenge denied at claim (WRONG_PURPOSE); legacy purpose-NULL challenges stay generic', async () => {
    const initiator = await createAgent([AgentService.CASH_TO_CASH], '1234');
    await fund(initiator.wallet.ledgerAccountId, '100000');
    const beneficiaryPhone = '+2348000000007';
    const { customerId: beneficiaryId } = await createCustomer(beneficiaryPhone);
    // initiate a cash-to-cash transfer
    const init = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash')
      .set('Authorization', `Bearer ${initiator.token}`)
      .send({
        beneficiaryPhone,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: `c2c-g-${randomUUID()}`,
        agentPin: '1234',
      })
      .expect(201);
    const { transferId, transferCode } = init.body;
    expect(transferId).toBeTruthy();
    expect(transferCode).toBeTruthy();
    // issue a W2C-purpose challenge for the beneficiary, capture the code, use at CLAIM → denied
    const issuer = await createAgent([AgentService.CASH_OUT], null);
    const cross = await issueDeskOtp(issuer.token, { customerId: beneficiaryId, purpose: 'WALLET_TO_CASH' }, 201);
    const crossOtp = capturedOtp();
    const denied = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash/claim')
      .set('Authorization', `Bearer ${issuer.token}`)
      .send({
        transferId,
        beneficiaryPhone,
        transferCode,
        customerId: beneficiaryId,
        mfaChallengeId: cross.body.challengeId,
        otp: crossOtp,
        idempotencyKey: `claim-g1-${randomUUID()}`,
      })
      .expect(400);
    const tr = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(tr[0].status).toBe('UNCLAIMED');
    // legacy purpose-NULL challenge (pre-feature convention) remains generic and claims fine
    let enrollmentId: string;
    let methodId: string;
    const enrollRows = await dataSource.query(`SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' LIMIT 1`, [beneficiaryId]);
    if (enrollRows[0]) {
      enrollmentId = enrollRows[0].id;
      methodId = (await dataSource.query(`SELECT id FROM mfa_methods WHERE enrollment_id=$1 AND status='ENABLED' LIMIT 1`, [enrollmentId]))[0].id;
    } else {
      enrollmentId = (await dataSource.query(`INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`, [randomUUID(), beneficiaryId, `legacy-enroll-${randomUUID().slice(0,4)}`]))[0].id;
      methodId = (await dataSource.query(`INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP','legacy','ENABLED') RETURNING id`, [randomUUID(), beneficiaryId, enrollmentId]))[0].id;
    }
    const credentialId = (await dataSource.query(`SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 AND status='ACTIVE' LIMIT 1`, [beneficiaryId]))[0].id;
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
      [sessionId, beneficiaryId, credentialId, randomBytes(32).toString('hex')],
    );
    const legacy = await mfaService.issueChallenge({
      principal: { principalType: 'CUSTOMER', customerId: beneficiaryId, credentialId, sessionId },
      enrollmentId,
      methodId,
      challengeHash: '654321',
      actor: beneficiaryId,
    } as any);
    const claimed = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash/claim')
      .set('Authorization', `Bearer ${issuer.token}`)
      .send({
        transferId,
        beneficiaryPhone,
        transferCode,
        customerId: beneficiaryId,
        mfaChallengeId: (legacy as any).id,
        otp: '654321',
        idempotencyKey: `claim-g2-${randomUUID()}`,
      })
      .expect(200);
    expect(claimed.body.status).toBe('COMPLETED'); // established claim result status
    const tr2 = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(tr2[0].status).toBe('CLAIMED');
  });

  it('H. Wallet→Cash completes end-to-end with an endpoint-issued challenge (canonical verification, financial semantics unchanged)', async () => {
    const { token, wallet, agentId } = await createAgent([AgentService.CASH_OUT], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const { customerId, wallet: cw } = await createCustomer('+2348000000008', { pin: '1111' });
    await fund(cw.ledgerAccountId, '50000');
    const issued = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    const otp = capturedOtp();
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: `co-h-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.journalId).toBeTruthy();
    expect(res.body.agentId).toBe(agentId);
    expect(res.body.customerId).toBe(customerId);
    const ch = await dataSource.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [issued.body.challengeId]);
    expect(ch[0].status).toBe('VERIFIED');
  });

  it('I. Cash→Cash claim completes with an endpoint-issued CASH_TO_CASH_CLAIM challenge; duplicate claim impossible', async () => {
    const initiator = await createAgent([AgentService.CASH_TO_CASH], '1234');
    await fund(initiator.wallet.ledgerAccountId, '100000');
    const beneficiaryPhone = '+2348000000009';
    const { customerId: beneficiaryId } = await createCustomer(beneficiaryPhone);
    const init = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash')
      .set('Authorization', `Bearer ${initiator.token}`)
      .send({
        beneficiaryPhone,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `c2c-i-${randomUUID()}`,
        agentPin: '1234',
      })
      .expect(201);
    const { transferId, transferCode } = init.body;
    const issuer = await createAgent([AgentService.CASH_TO_CASH], null);
    const issued = await issueDeskOtp(
      issuer.token,
      { customerId: beneficiaryId, purpose: 'CASH_TO_CASH_CLAIM' },
      201,
    );
    const otp = capturedOtp();
    const claimKey = `claim-i1-${randomUUID()}`;
    const claimed = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash/claim')
      .set('Authorization', `Bearer ${issuer.token}`)
      .send({
        transferId,
        beneficiaryPhone,
        transferCode,
        customerId: beneficiaryId,
        mfaChallengeId: issued.body.challengeId,
        otp,
        idempotencyKey: claimKey,
      })
      .expect(200);
    expect(claimed.body.status).toBe('COMPLETED'); // established claim result status
    const tr2 = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(tr2[0].status).toBe('CLAIMED');
    // duplicate claim attempt (new key) must fail (transfer already CLAIMED / replay denied)
    await request(app.getHttpServer())
      .post('/api/v1/agents/cash-to-cash/claim')
      .set('Authorization', `Bearer ${issuer.token}`)
      .send({
        transferId,
        beneficiaryPhone,
        transferCode,
        customerId: beneficiaryId,
        mfaChallengeId: issued.body.challengeId,
        otp,
        idempotencyKey: `claim-i2-${randomUUID()}`,
      })
      .expect((r) => {
        if (r.status !== 400 && r.status !== 409) {
          throw new Error(`expected 400/409 on duplicate claim, got ${r.status}`);
        }
      });
  });

  it('J. wrong OTP rejected; challenge remains ACTIVE and unusable-by-wrong-code', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_OUT], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const { customerId, wallet: cw } = await createCustomer('+2348000000010', { pin: '1111' });
    await fund(cw.ledgerAccountId, '100000');
    const issued = await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    const otp = capturedOtp();
    const wrong = otp === '000000' ? '000001' : '000000';
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-out')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        customerPin: '1111',
        mfaChallengeId: issued.body.challengeId,
        otp: wrong,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `co-j-${randomUUID()}`,
        agentPin: '4321',
      })
      .expect(400);
    const st = await dataSource.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [issued.body.challengeId]);
    expect(st[0].status).toBe('ACTIVE');
  });

  it('L. challenge issuance has NO ledger/wallet side effects (audit/context rows only)', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_OUT], null);
    const { customerId, wallet: cw } = await createCustomer('+2348000000011');
    const beforeJournals = (
      await dataSource.query(`SELECT count(*)::int AS n FROM ledger_journals`)
    )[0].n;
    const balBefore = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    await issueDeskOtp(token, { customerId, purpose: 'WALLET_TO_CASH' }, 201);
    await issueDeskOtp(token, { customerId, purpose: 'CASH_TO_CASH_CLAIM' }, 201);
    const afterJournals = (
      await dataSource.query(`SELECT count(*)::int AS n FROM ledger_journals`)
    )[0].n;
    expect(afterJournals).toBe(beforeJournals);
    const balAfter = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(balAfter.toString()).toBe(balBefore.toString());
    // issuance wrote only audit + MFA-context rows — including the desk-OTP delivery audit
    const audit: Array<{ action: string; n: number }> = await dataSource.query(
      `SELECT action, count(*)::int AS n FROM audit_events WHERE entity_type='MFA_CHALLENGE' GROUP BY action`,
    );
    const actions = audit.map((r: { action: string }) => r.action);
    expect(actions).toContain('ISSUED');
    expect(actions).toContain('AGENT_DESK_OTP_DELIVERED');
  });

  it('M. existing financial invariants intact: legacy-cash-in (no OTP) unaffected; PIN-gated cash-in still enforces PIN', async () => {
    const { token, wallet } = await createAgent([AgentService.CASH_IN], '4321');
    await fund(wallet.ledgerAccountId, '100000');
    const recipientPhone = '+2348000000012';
    await createCustomer(recipientPhone);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/cash-in')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientIdentifier: recipientPhone,
        amountMinor: '2500',
        currency: 'NGN',
        idempotencyKey: `ci-m-${randomUUID()}`,
        pin: '4321',
      })
      .expect(201);
    expect(res.body.status).toBe('COMPLETED');
    // PIN still gated: wrong agent PIN → 401 regardless of MFA surface existing
    await request(app.getHttpServer())
      .post('/api/v1/agents/cash-in')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientIdentifier: recipientPhone,
        amountMinor: '2500',
        currency: 'NGN',
        idempotencyKey: `ci-m2-${randomUUID()}`,
        pin: '9999',
      })
      .expect(401);
  });
});
