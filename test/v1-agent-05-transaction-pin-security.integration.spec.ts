/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(secret: string): string {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(secret, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * V1-AGENT-05 — Secure Agent Transaction PIN change/reset.
 *
 * P0 fix under test: `POST agents/me/transaction-pin` used to let an
 * authenticated Agent session unconditionally overwrite an existing
 * Transaction PIN with no proof of knowledge of the old PIN. The PIN
 * authorizes Cash-In, Cash-Out and Cash-to-Cash (see
 * AgentTransactionAuthorizationService, consumed by AgentCashInService /
 * AgentCashOutService / AgentCashToCashService), so this was a financial
 * authorization bypass via a hijacked/stolen bearer token (and, in the
 * mobile app, via the LOCKED screen's former "Reset Transaction PIN" button
 * which silently re-created the PIN with no re-authentication at all).
 *
 * Fixed contract:
 *  - POST agents/me/transaction-pin         → CREATE-ONLY (409 if one exists)
 *  - POST agents/me/transaction-pin/change  → requires {currentPin,newPin},
 *    verifies currentPin via the existing verify/lockout path (same
 *    MAX_FAILED_PINS=5 counter used by Cash-In/Cash-Out/Cash-to-Cash)
 *  - GET  agents/me/transaction-pin         → status (NOT_SET/ACTIVE/LOCKED), unchanged
 *  - Locked PIN cannot be changed (no in-app recovery bypass — V1 has no
 *    secure out-of-band recovery channel; Agent must contact support)
 */
describe('V1-AGENT-05 Agent Transaction PIN security (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashOutService: AgentCashOutService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let agentPinService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let mfaService: MfaExecutionService;
  let walletService: WalletService;
  let ledgerService: LedgerService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1a05pin');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    cashOutService = moduleRef.get(AgentCashOutService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    agentPinService = moduleRef.get(AgentAuthenticationService);
    customerPinService = moduleRef.get(CustomerTransactionPinService);
    mfaService = moduleRef.get(MfaExecutionService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => dataSource.destroy().catch(() => undefined));
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function createActiveAgentWithCredential(services: unknown = [AgentService.CASH_OUT]) {
    const cls = await classService.create({
      reference: `cls-v1a05-${randomUUID().slice(0, 8)}`,
      code: `V1A05-${randomUUID().slice(0, 6)}`,
      name: 'V1-AGENT-05 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz V1A05 ${randomUUID().slice(0, 4)}`,
      contactEmail: `v1a05-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-v1a05',
    });
    await appService.submit(appEntity.id, 'applicant-v1a05');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);

    const password = 'Correct-Password-123';
    await agentPinService.createCredential(agent.id, {
      passwordHash: encodePbkdf2(password),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordVersion: 1,
      actor: 'test-actor',
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId: agent.id, password })
      .expect(200);
    const token = login.body.accessToken as string;

    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    return { agentId: agent.id, token, wallet };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  async function createCustomerWithPhoneAndPin(phoneCanonical: string, pin: string, displayName = 'Customer V1A05') {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-v1a05-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
    await customerPinService.setTransactionPin(customerId, {
      pinHash: encodePbkdf2(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    let enrollmentId: string;
    let methodId: string;
    const enrollRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    if (enrollRows[0]) {
      enrollmentId = enrollRows[0]!.id;
      const methodRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM mfa_methods WHERE enrollment_id=$1 AND customer_id=$2 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
        [enrollmentId, customerId],
      );
      if (methodRows[0]) {
        methodId = methodRows[0]!.id;
      } else {
        const mRows: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
          [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
        );
        methodId = mRows[0]!.id;
      }
    } else {
      const eRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
      );
      enrollmentId = eRows[0]!.id;
      const mRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
      );
      methodId = mRows[0]!.id;
    }
    const credentialRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 LIMIT 1`,
      [customerId],
    );
    let credentialId = credentialRows[0]?.id;
    if (!credentialId) {
      const cRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
        [randomUUID(), customerId],
      );
      credentialId = cRows[0]!.id;
    }
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    await dataSource
      .query(
        `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
        [sessionId, customerId, credentialId, tokenHash],
      )
      .catch(() => {});
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({
      principal,
      enrollmentId,
      methodId,
      challengeHash: otp,
      ttlSeconds,
      actor: customerId,
    } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId };
  }

  async function fundCustomer(customerWalletLedgerId: string, amount: string) {
    // Fresh system float account per call — `beforeEach` truncates all tables between tests,
    // so a `beforeAll`-created shared account would not survive to later tests.
    const sys = await ledgerService.createAccount({
      code: `SYS-FLOAT-NGN-${randomUUID().slice(0, 8)}`,
      name: 'System Float NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledgerService.postJournal({
      idempotencyKey: `fund-cust-${customerWalletLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: sys.id, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: customerWalletLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  /** One ready-to-use Cash-Out customer leg (PIN '1234', funded 100000 NGN). Each call to
   *  cashOutAs() below needs a FRESH MFA challenge (OTP is one-time) but the same customer/PIN. */
  async function setupCashOutCustomer() {
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(wallet.ledgerAccountId, '100000');
    return { customerId, wallet };
  }

  async function cashOutAs(agentId: string, agentPin: string, customerId: string, amountMinor: string) {
    const otp = String(100000 + Math.floor(Math.random() * 899999));
    const { challengeId } = await createMfaChallenge(customerId, otp);
    return cashOutService.execute({
      agentId,
      agentPrincipal: agentPrincipal(agentId) as any,
      agentPin,
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor,
      currency: 'NGN',
      idempotencyKey: `v1a05-cashout-${randomUUID()}`,
    });
  }

  function setPinViaHttp(token: string, pin: string) {
    return request(app.getHttpServer()).post('/api/v1/agents/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin });
  }

  function changePinViaHttp(token: string, currentPin: string, newPin: string) {
    return request(app.getHttpServer())
      .post('/api/v1/agents/me/transaction-pin/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPin, newPin });
  }

  function statusViaHttp(token: string) {
    return request(app.getHttpServer()).get('/api/v1/agents/me/transaction-pin').set('Authorization', `Bearer ${token}`);
  }

  function verifyViaHttp(token: string, pin: string) {
    return request(app.getHttpServer()).post('/api/v1/agents/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin });
  }

  // ── Tests ───────────────────────────────────────────────────────────────

  it('1. First-time creation — POST transaction-pin succeeds for an Agent with no PIN', async () => {
    const { token } = await createActiveAgentWithCredential();
    const res = await setPinViaHttp(token, '1234').expect(200);
    expect(res.body.pinVersion).toBe(1);
    expect(res.body.pin).toBeUndefined();
    expect(res.body.pinHash).toBeUndefined();
  });

  it('2. Create-only — second POST transaction-pin for same Agent is rejected (409), old PIN survives', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const res = await setPinViaHttp(token, '9999').expect(409);
    expect(res.body.message).toMatch(/already exists/i);
    // old PIN (1234) still verifies; the overwrite attempt (9999) did NOT take effect
    const v1 = await verifyViaHttp(token, '1234').expect(200);
    expect(v1.body.verified).toBe(true);
    const v2 = await verifyViaHttp(token, '9999').expect(200);
    expect(v2.body.verified).toBe(false);
  });

  it('3. Known-PIN change — succeeds with correct currentPin, pinVersion increments', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const res = await changePinViaHttp(token, '1234', '5678').expect(200);
    expect(res.body.pinVersion).toBe(2);
    const v = await verifyViaHttp(token, '5678').expect(200);
    expect(v.body.verified).toBe(true);
  });

  it('4. Known-PIN change — fails with incorrect currentPin (401), original PIN remains usable', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const res = await changePinViaHttp(token, '0000', '5678').expect(401);
    expect(res.body.message).toMatch(/incorrect/i);
    const v = await verifyViaHttp(token, '1234').expect(200);
    expect(v.body.verified).toBe(true);
  });

  it('5. Known-PIN change — incorrect currentPin increments failed_count (shared counter with financial authorization)', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    await changePinViaHttp(token, '0000', '5678').expect(401);
    const status = await statusViaHttp(token).expect(200);
    expect(status.body.failedCount).toBe(1);
  });

  it('6. Locked PIN — 5 failed change attempts lock the PIN; change is then rejected outright, no bypass', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    for (let i = 0; i < 4; i++) {
      await changePinViaHttp(token, '0000', '5678').expect(401);
    }
    // 5th failed attempt locks
    const res5 = await changePinViaHttp(token, '0000', '5678').expect(403);
    expect(res5.body.message).toMatch(/locked/i);
    const status = await statusViaHttp(token).expect(200);
    expect(status.body.status).toBe('LOCKED');
    // Even the CORRECT current PIN cannot change it now — lockout cannot be bypassed via change
    const res6 = await changePinViaHttp(token, '1234', '9999').expect(403);
    expect(res6.body.message).toMatch(/locked/i);
    // original PIN is still the one on file (no silent overwrite)
    const verify = await verifyViaHttp(token, '9999').expect(200);
    expect(verify.body.verified).toBe(false);
  });

  it('7. Ownership — Agent A changing their PIN never touches Agent B PIN; unauthenticated change is 401', async () => {
    const { token: tokenA } = await createActiveAgentWithCredential();
    const { token: tokenB } = await createActiveAgentWithCredential();
    await setPinViaHttp(tokenA, '1111').expect(200);
    await setPinViaHttp(tokenB, '2222').expect(200);

    await changePinViaHttp(tokenA, '1111', '3333').expect(200);

    // Agent B's PIN is completely unaffected
    const vB = await verifyViaHttp(tokenB, '2222').expect(200);
    expect(vB.body.verified).toBe(true);

    // Unauthenticated change attempt
    await request(app.getHttpServer())
      .post('/api/v1/agents/me/transaction-pin/change')
      .send({ currentPin: '1111', newPin: '4444' })
      .expect(401);
  });

  it('8/9. Cash-Out (Wallet→Cash) regression — after change, OLD Agent PIN fails and NEW Agent PIN succeeds', async () => {
    const { agentId, token, wallet: agentWallet } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const { customerId, wallet: custWallet } = await setupCashOutCustomer();

    // OLD PIN (1234) works before the change
    const before = await cashOutAs(agentId, '1234', customerId, '3000');
    expect(before.status).toBe('COMPLETED');

    // Change Agent PIN 1234 → 5678
    await changePinViaHttp(token, '1234', '5678').expect(200);

    // OLD PIN (1234) must now FAIL the financial operation
    await expect(cashOutAs(agentId, '1234', customerId, '1000')).rejects.toThrow();

    // NEW PIN (5678) must succeed
    const after = await cashOutAs(agentId, '5678', customerId, '2000');
    expect(after.status).toBe('COMPLETED');

    // exactly two successful credits to the agent wallet (3000 + 2000); the failed old-pin
    // attempt caused no money movement
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('5000');
  });

  it('10. Cash-Out regression — a failed change attempt does not alter the Agent PIN usable for the financial operation', async () => {
    const { agentId, token, wallet: agentWallet } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const { customerId } = await setupCashOutCustomer();

    // Attempt a change with the WRONG current PIN — must fail
    await changePinViaHttp(token, '9999', '5678').expect(401);

    // Original Agent PIN (1234) must still authorize the financial operation
    const res = await cashOutAs(agentId, '1234', customerId, '1500');
    expect(res.status).toBe('COMPLETED');
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('1500');
  });

  it('11. No PIN leakage — create, change and status responses never contain pin/pinHash', async () => {
    const { token } = await createActiveAgentWithCredential();
    const create = await setPinViaHttp(token, '1234').expect(200);
    expect(JSON.stringify(create.body)).not.toMatch(/1234/);
    expect(JSON.stringify(create.body)).not.toMatch(/PBKDF2\$/);
    const change = await changePinViaHttp(token, '1234', '5678').expect(200);
    expect(JSON.stringify(change.body)).not.toMatch(/1234|5678/);
    expect(JSON.stringify(change.body)).not.toMatch(/PBKDF2\$/);
    const status = await statusViaHttp(token).expect(200);
    expect(JSON.stringify(status.body)).not.toMatch(/1234|5678/);
    expect(JSON.stringify(status.body)).not.toMatch(/PBKDF2\$/);
  });

  it('12. Audit — PIN_ROTATED event recorded for a successful change, no plaintext pin or hash in audit', async () => {
    const { agentId, token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    await changePinViaHttp(token, '1234', '5678').expect(200);
    const audit = await dataSource.query(
      `SELECT action, previous_values, new_values FROM audit_events WHERE entity_type='AGENT_TRANSACTION_PIN' ORDER BY created_at`,
    );
    const actions = audit.map((a: any) => a.action);
    expect(actions).toContain('PIN_CREATED');
    expect(actions).toContain('PIN_VERIFIED');
    expect(actions).toContain('PIN_ROTATED');
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toMatch(/1234|5678/);
    expect(serialized).not.toMatch(/PBKDF2\$/);
  });

  it('13. Validation — newPin identical to currentPin is rejected (400), PIN unchanged', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    await changePinViaHttp(token, '1234', '1234').expect(400);
    const v = await verifyViaHttp(token, '1234').expect(200);
    expect(v.body.verified).toBe(true);
  });

  it('14. Separation — change endpoint rejects when no PIN has been created yet (400), directs to create', async () => {
    const { token } = await createActiveAgentWithCredential();
    const res = await changePinViaHttp(token, '1234', '5678').expect(400);
    expect(res.body.message).toMatch(/No Transaction PIN/i);
  });

  it('15. Status — GET transaction-pin reports NOT_SET, then ACTIVE, then LOCKED after 5 failed verifies', async () => {
    const { token } = await createActiveAgentWithCredential();
    const s1 = await statusViaHttp(token).expect(200);
    expect(s1.body.status).toBe('NOT_SET');
    await setPinViaHttp(token, '1234').expect(200);
    const s2 = await statusViaHttp(token).expect(200);
    expect(s2.body.status).toBe('ACTIVE');
    for (let i = 0; i < 5; i++) {
      await verifyViaHttp(token, '0000').expect(200);
    }
    const s3 = await statusViaHttp(token).expect(200);
    expect(s3.body.status).toBe('LOCKED');
  });

  it('16. Validation — change endpoint rejects malformed currentPin/newPin, no state mutated', async () => {
    const { token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    // non-digit but length-valid (4-32) → fails the controller's digit-only check (401)
    await changePinViaHttp(token, 'abcd', '5678').expect(401);
    await changePinViaHttp(token, '1234', 'abcd').expect(401);
    // below the DTO's length floor (4) → rejected by class-validator before the controller runs (400)
    await changePinViaHttp(token, '1234', 'ab').expect(400);
    const v = await verifyViaHttp(token, '1234').expect(200);
    expect(v.body.verified).toBe(true);
  });

  it('17. Locked Agent PIN cannot authorize the real financial operation either (lockout enforced at the financial layer too)', async () => {
    const { agentId, token } = await createActiveAgentWithCredential();
    await setPinViaHttp(token, '1234').expect(200);
    const { customerId } = await setupCashOutCustomer();
    // Lock the PIN via repeated failed verifies (same counter the change endpoint and
    // financial authorization both share)
    for (let i = 0; i < 5; i++) {
      await verifyViaHttp(token, '0000').expect(200);
    }
    const status = await statusViaHttp(token).expect(200);
    expect(status.body.status).toBe('LOCKED');
    // Even with the (still-technically-correct) PIN value, a locked PIN must not authorize money movement
    await expect(cashOutAs(agentId, '1234', customerId, '1000')).rejects.toThrow();
  });
});
