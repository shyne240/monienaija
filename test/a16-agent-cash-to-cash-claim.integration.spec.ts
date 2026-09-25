/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, @typescript-eslint/await-thenable, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { CustomerService } from '../src/customer/customer.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('A16 Agent Cash→Cash CLAIM (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let mfaService: MfaExecutionService;
  let customerService: CustomerService;

  let systemLedgerAccountId: string;
  let unclaimedLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a16claim');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashToCashService = moduleRef.get(AgentCashToCashService);
    claimService = moduleRef.get(AgentCashToCashClaimService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    mfaService = moduleRef.get(MfaExecutionService);
    customerService = moduleRef.get(CustomerService);

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
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`);
    if (unclaimedRows[0]) unclaimedLedgerAccountId = unclaimedRows[0]!.id;
    else {
      const acc = await ledgerService.createAccount({
        code: 'CASH_TO_CASH-UNCLAIMED-NGN',
        name: 'Cash-to-Cash Unclaimed NGN',
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
      });
      unclaimedLedgerAccountId = acc.id;
    }
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try { if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined); } catch { void 0; }
      }
    }
  }, 60000);

  async function createActiveAgentWithServicesAndPin(services: unknown, pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-a16-${randomUUID().slice(0, 8)}`,
      code: `A16-${randomUUID().slice(0, 6)}`,
      name: 'A16 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A16 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a16-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a16',
    });
    await appService.submit(appEntity.id, 'applicant-a16');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    return { cls, agent, appEntity, wallet };
  }

  function agentPrincipal(agentId: string) {
    return { type: 'AGENT' as const, agentId, principalId: agentId, roles: [], scopes: [], customerAccess: 'NONE' as const, agentAccess: 'SELF' as const };
  }

  async function createBeneficiaryCustomer(phoneCanonical: string, withKyc = true, withDoc = false) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE',$2,$3) RETURNING id`,
      [`cust-a16-${randomUUID().slice(0, 8)}`, withKyc ? 'LEVEL_1' : 'NONE', withKyc ? 'APPROVED' : 'NOT_STARTED'],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, `Customer A16 ${randomUUID().slice(0,4)}`]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
    if (withDoc) {
      await customerService.createIdentityDocument(customerId, {
        type: 'NIN' as any,
        documentNumber: `NIN${randomUUID().slice(0,8)}`,
        issuingCountry: 'NG',
        actor: customerId,
      } as any);
    }
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
      if (methodRows[0]) methodId = methodRows[0]!.id;
      else {
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
    const credentialRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 LIMIT 1`, [customerId]);
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
    await dataSource.query(
      `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
      [sessionId, customerId, credentialId, tokenHash],
    ).catch(() => {});
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({ principal, enrollmentId, methodId, challengeHash: otp, ttlSeconds, actor: customerId } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId, otp, enrollmentId, methodId, sessionId, credentialId };
  }

  async function fundAgent(agentWalletLedgerId: string, amount: string) {
    await ledgerService.postJournal({
      idempotencyKey: `fund-agent-${agentWalletLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: agentWalletLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  async function initiateTransfer(amount = '4000') {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '10000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: amount,
      currency: 'NGN',
      idempotencyKey: `init-${randomUUID()}`,
    });
    return { agent, wallet, phone, transferId: res.transferId, transferCode: res.transferCode!, amount };
  }

  // 1. valid claim succeeds
  it('1. valid claim succeeds', async () => {
    const { phone, transferId, transferCode, amount } = await initiateTransfer('3000');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, '123456');
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const beforeBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: '123456',
      idempotencyKey: `claim-1-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    expect(res.transferId).toBe(transferId);
    expect(res.journalId).toBeDefined();
    expect(res.beneficiaryPhone).toBe(phone);
    expect(res.principalMinor).toBe(amount);
    expect(res.replayed).toBe(false);
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(BigInt(afterUnclaimed.balanceMinor)).toBe(BigInt(beforeUnclaimed.balanceMinor) - BigInt(amount));
    const afterBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(afterBenef.balanceMinor)).toBe(BigInt(beforeBenef.balanceMinor) + BigInt(amount));
  });

  // 2. phone exact canonical success with variants
  it('2. phone canonical variants succeed', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('1500');
    // Wrong phone fails for this transfer (new customer for wrong phone case, avoid duplicate)
    const wrongPhone = `81${Math.floor(10000000 + Math.random()*89999999)}`;
    const { customerId: cidWrong } = await createBeneficiaryCustomer(wrongPhone, true);
    const { challengeId: chWrong } = await createMfaChallenge(cidWrong, 'wrong-phone-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: wrongPhone,
      transferCode,
      customerId: cidWrong,
      mfaChallengeId: chWrong,
      otp: 'wrong-phone-otp',
      idempotencyKey: `claim-2-wrong-${randomUUID()}`,
    })).rejects.toThrow(/Beneficiary phone/i);

    // Canonical variants succeed: 0, +234, 234 should all resolve to same 10-digit
    for (let i = 0; i < 3; i++) {
      const { phone: p2, transferId: tid2, transferCode: code2 } = await initiateTransfer('1200');
      const { customerId: cid2 } = await createBeneficiaryCustomer(p2, true);
      const otp = `variant-otp-${i}-${randomUUID().slice(0,4)}`;
      const { challengeId } = await createMfaChallenge(cid2, otp);
      const variants = [`0${p2}`, `+234${p2}`, `234${p2}`];
      const variant = variants[i]!;
      const res = await claimService.execute({
        transferId: tid2,
        beneficiaryPhone: variant,
        transferCode: code2,
        customerId: cid2,
        mfaChallengeId: challengeId,
        otp,
        idempotencyKey: `claim-2-${randomUUID()}`,
      });
      expect(res.status).toBe('COMPLETED');
      expect(res.beneficiaryPhone).toBe(p2);
    }
  });

  // 3. transfer code correct succeeds
  it('3. transfer code correct succeeds', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2000');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'code-ok');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'code-ok',
      idempotencyKey: `claim-3-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    const row: Array<{ transfer_code_hash: string }> = await dataSource.query(`SELECT transfer_code_hash FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(row[0]!.transfer_code_hash).not.toContain(transferCode);
  });

  // 4. wrong transfer code fails and not exposed
  it('4. wrong transfer code fails without exposure', async () => {
    const { phone, transferId } = await initiateTransfer('1800');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'wrong-code-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '99999999',
      customerId,
      mfaChallengeId: challengeId,
      otp: 'wrong-code-otp',
      idempotencyKey: `claim-4-${randomUUID()}`,
    })).rejects.toThrow(/Transfer code invalid/i);
    const audit: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGENT_CASH_TO_CASH_CLAIM'`);
    const serial = JSON.stringify(audit.map(a => a.new_values)).toLowerCase();
    expect(serial).not.toContain('99999999');
    const idem: Array<{ response_body: any }> = await dataSource.query(`SELECT response_body FROM idempotency_records WHERE scope LIKE 'cash-to-cash-claim%'`);
    expect(JSON.stringify(idem).toLowerCase()).not.toContain('99999999');
  });

  // 5. transfer code hash persisted securely
  it('5. transfer code hash persisted securely', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('1300');
    const rows: Array<{ transfer_code_hash: string; hash_algorithm: string }> = await dataSource.query(`SELECT transfer_code_hash, hash_algorithm FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(rows[0]!.transfer_code_hash).toMatch(/^PBKDF2\$sha256\$\d+\$.+\$.+/);
    expect(rows[0]!.hash_algorithm).toBe('PBKDF2');
    expect(rows[0]!.transfer_code_hash).not.toContain(transferCode);
  });

  // 6. response never contains hash or plaintext on replay
  it('6. response never contains hash', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('1400');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'hash-resp-otp');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'hash-resp-otp',
      idempotencyKey: `claim-6-${randomUUID()}`,
    });
    // Response must not contain PBKDF2 hash or transfer_code_hash, but requestHash field is allowed to contain 'hash' substring
    expect(JSON.stringify(res).toLowerCase()).not.toContain('pbkdf2');
    expect(JSON.stringify(res).toLowerCase()).not.toContain('transfer_code_hash');
    expect(JSON.stringify(res)).not.toContain(transferCode);
    // Create new challenge for replay with same idempotency
    // Reset challenge to ACTIVE for replay (since previous is VERIFIED)
    await dataSource.query(`UPDATE mfa_challenges SET status='ACTIVE', verified_at=NULL WHERE id=$1`, [challengeId]);
    const replay = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'hash-resp-otp',
      idempotencyKey: res.idempotencyKey,
    });
    expect(replay.status).toBe('REPLAYED');
    expect(JSON.stringify(replay).toLowerCase()).not.toContain('pbkdf2');
    expect(JSON.stringify(replay).toLowerCase()).not.toContain('transfer_code_hash');
  });

  // 7. failed attempts counter increments
  it('7. failed attempts counter increments', async () => {
    const { phone, transferId } = await initiateTransfer('1600');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const before: Array<{ failed_attempts: number }> = await dataSource.query(`SELECT failed_attempts FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(before[0]!.failed_attempts).toBe(0);
    const { challengeId } = await createMfaChallenge(customerId, 'counter-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '00000000',
      customerId,
      mfaChallengeId: challengeId,
      otp: 'counter-otp',
      idempotencyKey: `claim-7-${randomUUID()}`,
    })).rejects.toThrow();
    const after: Array<{ failed_attempts: number }> = await dataSource.query(`SELECT failed_attempts FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(after[0]!.failed_attempts).toBe(1);
  });

  // 8. lockout after 5 failed attempts
  it('8. lockout after 5 failed attempts', async () => {
    const { phone, transferId } = await initiateTransfer('1700');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    for (let i = 0; i < 5; i++) {
      const { challengeId } = await createMfaChallenge(customerId, `lock-otp-${i}`);
      try {
        await claimService.execute({
          transferId,
          beneficiaryPhone: phone,
          transferCode: '11111111',
          customerId,
          mfaChallengeId: challengeId,
          otp: `lock-otp-${i}`,
          idempotencyKey: `claim-8-${i}-${randomUUID()}`,
        });
      } catch {}
    }
    const row: Array<{ is_locked: boolean; failed_attempts: number }> = await dataSource.query(`SELECT is_locked, failed_attempts FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(row[0]!.is_locked).toBe(true);
    expect(row[0]!.failed_attempts).toBe(5);
    const { challengeId: chAfter } = await createMfaChallenge(customerId, 'after-lock-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '11111111',
      customerId,
      mfaChallengeId: chAfter,
      otp: 'after-lock-otp',
      idempotencyKey: `claim-8-after-${randomUUID()}`,
    })).rejects.toThrow(/locked/i);
  });

  // 9. locked transfer rejects even with correct code
  it('9. locked transfer rejects correct code', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('1800');
    await dataSource.query(`UPDATE cash_to_cash_transfers SET is_locked=TRUE, failed_attempts=5 WHERE id=$1`, [transferId]);
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'locked-correct-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'locked-correct-otp',
      idempotencyKey: `claim-9-${randomUUID()}`,
    })).rejects.toThrow(/locked/i);
  });

  // 10. success resets failed_attempts
  it('10. success resets failed_attempts', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('1900');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    // 2 failed attempts
    for (let i = 0; i < 2; i++) {
      const { challengeId } = await createMfaChallenge(customerId, `reset-fail-${i}`);
      try {
        await claimService.execute({
          transferId,
          beneficiaryPhone: phone,
          transferCode: '00000000',
          customerId,
          mfaChallengeId: challengeId,
          otp: `reset-fail-${i}`,
          idempotencyKey: `claim-10-fail-${i}-${randomUUID()}`,
        });
      } catch {}
    }
    let row: Array<{ failed_attempts: number }> = await dataSource.query(`SELECT failed_attempts FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(row[0]!.failed_attempts).toBe(2);
    const { challengeId } = await createMfaChallenge(customerId, 'reset-success-otp');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'reset-success-otp',
      idempotencyKey: `claim-10-success-${randomUUID()}`,
    });
    row = await dataSource.query(`SELECT failed_attempts FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(row[0]!.failed_attempts).toBe(0);
    const locked: Array<{ is_locked: boolean }> = await dataSource.query(`SELECT is_locked FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(locked[0]!.is_locked).toBe(false);
  });

  // 11. OTP canonical success
  it('11. OTP canonical success', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2000');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'otp-canonical');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'otp-canonical',
      idempotencyKey: `claim-11-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
  });

  // 12. wrong OTP fails
  it('12. wrong OTP fails', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2100');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'correct-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'wrong-otp',
      idempotencyKey: `claim-12-${randomUUID()}`,
    })).rejects.toThrow(/OTP invalid/i);
  });

  // 13. OTP binding to correct customer
  it('13. OTP binding to correct customer', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2200');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const otherPhone = `82${Math.floor(10000000 + Math.random()*89999999)}`;
    const { customerId: otherId } = await createBeneficiaryCustomer(otherPhone, true);
    const { challengeId } = await createMfaChallenge(otherId, 'other-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'other-otp',
      idempotencyKey: `claim-13-${randomUUID()}`,
    })).rejects.toThrow(/belong|OTP/i);
  });

  // 14. expired OTP fails
  it('14. expired OTP fails', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2300');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'expired-otp', 30);
    await dataSource.query(`UPDATE mfa_challenges SET expires_at=NOW() - INTERVAL '1 hour' WHERE id=$1`, [challengeId]);
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'expired-otp',
      idempotencyKey: `claim-14-${randomUUID()}`,
    })).rejects.toThrow(/expired/i);
  });

  // 15. replayed OTP fails for new operation
  it('15. replayed OTP fails for new operation', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2400');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'replay-otp');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'replay-otp',
      idempotencyKey: `claim-15-1-${randomUUID()}`,
    });
    const { phone: p2, transferId: tid2, transferCode: code2 } = await initiateTransfer('2400');
    const { customerId: cid2 } = await createBeneficiaryCustomer(p2, true);
    // Try to reuse same challengeId/otp for different transfer (should fail as already VERIFIED)
    await expect(claimService.execute({
      transferId: tid2,
      beneficiaryPhone: p2,
      transferCode: code2,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'replay-otp',
      idempotencyKey: `claim-15-2-${randomUUID()}`,
    })).rejects.toThrow(/already used|OTP/i);
  });

  // 16. identity verification fails when not APPROVED and no doc
  it('16. identity fails when not verified', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2500');
    const { customerId } = await createBeneficiaryCustomer(phone, false, false);
    const { challengeId } = await createMfaChallenge(customerId, 'no-kyc-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'no-kyc-otp',
      idempotencyKey: `claim-16-${randomUUID()}`,
    })).rejects.toThrow(/identity not verified/i);
  });

  // 17. identity succeeds with NIN document even if KYC not APPROVED
  it('17. identity succeeds with document', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2600');
    const { customerId } = await createBeneficiaryCustomer(phone, false, true);
    const { challengeId } = await createMfaChallenge(customerId, 'doc-ok-otp');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'doc-ok-otp',
      idempotencyKey: `claim-17-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
  });

  // 18. no mutation on invalid phone
  it('18. no mutation on invalid phone', async () => {
    const { phone, transferId, transferCode, amount } = await initiateTransfer('2700');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const beforeStatus: Array<{ status: string }> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    const { challengeId } = await createMfaChallenge(customerId, 'no-mut-phone-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: `81${Math.floor(10000000 + Math.random()*89999999)}`,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'no-mut-phone-otp',
      idempotencyKey: `claim-18-${randomUUID()}`,
    })).rejects.toThrow();
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(afterUnclaimed.balanceMinor).toBe(beforeUnclaimed.balanceMinor);
    const afterStatus: Array<{ status: string }> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(afterStatus[0]!.status).toBe(beforeStatus[0]!.status);
  });

  // 19. no mutation on invalid code
  it('19. no mutation on invalid code', async () => {
    const { phone, transferId } = await initiateTransfer('2800');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const beforeBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const { challengeId } = await createMfaChallenge(customerId, 'no-mut-code-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '00000000',
      customerId,
      mfaChallengeId: challengeId,
      otp: 'no-mut-code-otp',
      idempotencyKey: `claim-19-${randomUUID()}`,
    })).rejects.toThrow();
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const afterBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterUnclaimed.balanceMinor).toBe(beforeUnclaimed.balanceMinor);
    expect(afterBenef.balanceMinor).toBe(beforeBenef.balanceMinor);
  });

  // 20. no mutation on invalid OTP
  it('20. no mutation on invalid OTP', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('2900');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const beforeBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const { challengeId } = await createMfaChallenge(customerId, 'correct-otp-20');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'wrong-otp-20',
      idempotencyKey: `claim-20-${randomUUID()}`,
    })).rejects.toThrow();
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const afterBenef = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterUnclaimed.balanceMinor).toBe(beforeUnclaimed.balanceMinor);
    expect(afterBenef.balanceMinor).toBe(beforeBenef.balanceMinor);
  });

  // 21. UNCLAIMED→CLAIMED transition
  it('21. UNCLAIMED→CLAIMED transition', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3000');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'status-otp');
    const before: Array<{ status: string }> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(before[0]!.status).toBe('UNCLAIMED');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'status-otp',
      idempotencyKey: `claim-21-${randomUUID()}`,
    });
    const after: Array<{ status: string; claimed_at: string; claimant_customer_id: string }> = await dataSource.query(`SELECT status, claimed_at, claimant_customer_id FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(after[0]!.status).toBe('CLAIMED');
    expect(after[0]!.claimed_at).toBeDefined();
    expect(after[0]!.claimant_customer_id).toBe(customerId);
  });

  // 22. unclaimed decreases by principal
  it('22. unclaimed decreases by principal', async () => {
    const { phone, transferId, transferCode, amount } = await initiateTransfer('3100');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const before = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const { challengeId } = await createMfaChallenge(customerId, 'unclaimed-dec-otp');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'unclaimed-dec-otp',
      idempotencyKey: `claim-22-${randomUUID()}`,
    });
    const after = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) - BigInt(amount));
  });

  // 23. beneficiary increases by principal
  it('23. beneficiary increases by principal', async () => {
    const { phone, transferId, transferCode, amount } = await initiateTransfer('3200');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const before = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const { challengeId } = await createMfaChallenge(customerId, 'benef-inc-otp');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'benef-inc-otp',
      idempotencyKey: `claim-23-${randomUUID()}`,
    });
    const after = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) + BigInt(amount));
  });

  // 24. journal is balanced
  it('24. journal is balanced', async () => {
    const { phone, transferId, transferCode, amount } = await initiateTransfer('3300');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'balanced-otp');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'balanced-otp',
      idempotencyKey: `claim-24-${randomUUID()}`,
    });
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal).toBeDefined();
    const debit = journal!.lines.filter(l => l.direction === LedgerEntryDirection.DEBIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const credit = journal!.lines.filter(l => l.direction === LedgerEntryDirection.CREDIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(debit).toBe(credit);
    expect(debit.toString()).toBe(amount);
    expect(journal!.lines.length).toBe(2);
    const debitLine = journal!.lines.find(l => l.direction === LedgerEntryDirection.DEBIT)!;
    const creditLine = journal!.lines.find(l => l.direction === LedgerEntryDirection.CREDIT)!;
    expect(debitLine.accountId).toBe(unclaimedLedgerAccountId);
    expect(creditLine.amountMinor).toBe(amount);
  });

  // 25. only one financial effect (no double credit)
  it('25. only one financial effect', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3400');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'one-effect-otp');
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'one-effect-otp',
      idempotencyKey: `claim-25-${randomUUID()}`,
    });
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal!.lines.length).toBe(2);
  });

  // 26. already-claimed rejects second claim
  it('26. already-claimed rejects second claim', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3500');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'first-claim-otp');
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'first-claim-otp',
      idempotencyKey: `claim-26-1-${randomUUID()}`,
    });
    const otherPhone = `81${Math.floor(10000000 + Math.random()*89999999)}`;
    const { customerId: otherId } = await createBeneficiaryCustomer(otherPhone, true);
    const { challengeId: ch2 } = await createMfaChallenge(otherId, 'second-claim-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId: otherId,
      mfaChallengeId: ch2,
      otp: 'second-claim-otp',
      idempotencyKey: `claim-26-2-${randomUUID()}`,
    })).rejects.toThrow(/already claimed/i);
  });

  // 27. concurrent claims → exactly one success, one journal
  it('27. concurrent claims converge to one success', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3600');
    // Use single claimant to avoid unique phone constraint duplicate
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId: ch1 } = await createMfaChallenge(customerId, 'concurrent-otp-1');
    const { challengeId: ch2 } = await createMfaChallenge(customerId, 'concurrent-otp-2');
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const results = await Promise.allSettled([
      claimService.execute({
        transferId,
        beneficiaryPhone: phone,
        transferCode,
        customerId,
        mfaChallengeId: ch1,
        otp: 'concurrent-otp-1',
        idempotencyKey: `concurrent-${randomUUID()}`,
      }),
      claimService.execute({
        transferId,
        beneficiaryPhone: phone,
        transferCode,
        customerId,
        mfaChallengeId: ch2,
        otp: 'concurrent-otp-2',
        idempotencyKey: `concurrent2-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0]!.reason as Error).message).toMatch(/already claimed|locked|conflict/i);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
  });

  // 28. idempotent converge with same key
  it('28. idempotent converge with same key', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3700');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'idem-otp');
    const key = `claim-28-${randomUUID()}`;
    const r1 = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'idem-otp',
      idempotencyKey: key,
    });
    expect(r1.status).toBe('COMPLETED');
    // Reset OTP to ACTIVE for replay (since first consumed it)
    await dataSource.query(`UPDATE mfa_challenges SET status='ACTIVE', verified_at=NULL WHERE id=$1`, [challengeId]);
    const r2 = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'idem-otp',
      idempotencyKey: key,
    });
    expect(r2.status).toBe('REPLAYED');
    expect(r2.journalId).toBe(r1.journalId);
    expect(r2.replayed).toBe(true);
  });

  // 29. idempotent mismatch with same key but different financial params rejected
  it('29. idempotent mismatch rejected', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3800');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'mismatch-otp');
    const key = `claim-29-${randomUUID()}`;
    await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'mismatch-otp',
      idempotencyKey: key,
    });
    // Try same key but different claimant (different customer with different phone) -> hash differs due to claimantCustomerId, should be rejected as already claimed
    const otherPhone = `82${Math.floor(10000000 + Math.random()*89999999)}`;
    const { customerId: otherId } = await createBeneficiaryCustomer(otherPhone, true);
    const { challengeId: chOther } = await createMfaChallenge(otherId, 'other-mismatch-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId: otherId,
      mfaChallengeId: chOther,
      otp: 'other-mismatch-otp',
      idempotencyKey: key,
    })).rejects.toThrow(/already claimed|already used|different/i);
  });

  // 30. audit contains no secrets
  it('30. audit contains no secrets', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('3900');
    const { customerId } = await createBeneficiaryCustomer(phone, true);
    const { challengeId } = await createMfaChallenge(customerId, 'audit-otp');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'audit-otp',
      idempotencyKey: `claim-30-${randomUUID()}`,
    });
    const audits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGENT_CASH_TO_CASH_CLAIM' AND entity_id=$1`, [res.journalId]);
    expect(audits.length).toBe(1);
    const serial = JSON.stringify(audits[0]!.new_values).toLowerCase();
    expect(serial).toContain(phone);
    expect(serial).not.toContain('otp');
    expect(serial).not.toContain('transfercode');
    expect(serial).not.toContain('pbkdf2');
    expect(serial).not.toContain(transferCode.toLowerCase());
    expect(serial).not.toContain('pinhash');
  });

  // 31. no accidental Customer/Wallet creation for failed claim
  it('31. no accidental Customer/Wallet creation for failed claim', async () => {
    const { phone, transferId } = await initiateTransfer('4000');
    const beforeCust: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    const beforeWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const fakeCustomerId = randomUUID();
    // Try claim with non-existent customer -> should fail without creating customer/wallet
    const { challengeId } = await createMfaChallenge((await createBeneficiaryCustomer(phone, true)).customerId, 'fail-no-create-otp');
    // Use a random customerId that doesn't exist
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '00000000',
      customerId: fakeCustomerId,
      mfaChallengeId: challengeId,
      otp: 'fail-no-create-otp',
      idempotencyKey: `claim-31-${randomUUID()}`,
    })).rejects.toThrow();
    const afterCust: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    const afterWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    expect(BigInt(afterCust[0]!.cnt)).toBe(BigInt(beforeCust[0]!.cnt) + 1n); // +1 for the beneficiary we created for challenge, but no extra for fakeCustomerId
    // Ensure no wallet for fakeCustomerId
    const fakeWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts WHERE customer_id=$1`, [fakeCustomerId]);
    expect(fakeWallets[0]!.cnt).toBe('0');
  });

  // 32. atomic: failed claim leaves no partial journal or claim
  it('32. atomic: failed claim leaves no partial', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('4100');
    const { customerId, wallet } = await createBeneficiaryCustomer(phone, true);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeStatus: Array<{ status: string }> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    const { challengeId } = await createMfaChallenge(customerId, 'atomic-otp');
    await expect(claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode: '00000000',
      customerId,
      mfaChallengeId: challengeId,
      otp: 'atomic-otp',
      idempotencyKey: `claim-32-${randomUUID()}`,
    })).rejects.toThrow();
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    const afterStatus: Array<{ status: string }> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    expect(afterStatus[0]!.status).toBe(beforeStatus[0]!.status);
    expect(afterStatus[0]!.status).toBe('UNCLAIMED');
  });

  // Additional: ensure no Customer wallet auto-created on initiation already tested, but also ensure claim does not create extra wallet for unregistered? Actually claim should create wallet for beneficiary if not exists
  it('33. beneficiary wallet creation on claim if not exists', async () => {
    const { phone, transferId, transferCode } = await initiateTransfer('4200');
    // Create customer without wallet
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-no-wallet-${randomUUID().slice(0,8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'NoWallet']);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phone]);
    // No wallet yet
    const beforeWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts WHERE customer_id=$1`, [customerId]);
    expect(beforeWallets[0]!.cnt).toBe('0');
    const { challengeId } = await createMfaChallenge(customerId, 'wallet-create-otp');
    const res = await claimService.execute({
      transferId,
      beneficiaryPhone: phone,
      transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'wallet-create-otp',
      idempotencyKey: `claim-33-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    const afterWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts WHERE customer_id=$1`, [customerId]);
    expect(afterWallets[0]!.cnt).toBe('1');
  });
});
