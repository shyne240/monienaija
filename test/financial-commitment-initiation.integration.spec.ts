import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { FinancialCommitmentRepository } from '../src/financial-commitment/financial-commitment.repository';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../src/kyc-verification/kyc-tier-evidence.reader';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { LimitReservationRecoveryService } from '../src/limit-catalog/limit-reservation-recovery.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
} from './support/pg-harness';

describe('financial commitment initiation (real PostgreSQL)', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  let service: FinancialCommitmentService;
  let repository: FinancialCommitmentRepository;
  let ledger: LedgerService;
  const snapshots = new Map<string, TierEvidenceSnapshot>();
  const context = {
    targetMappingReference: `a6-target:${'a'.repeat(64)}`,
    currency: 'NGN',
    pin: '1234',
  };

  beforeAll(async () => {
    db = await createIntegrationDataSource('fcinit');
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({
        read: (_manager: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null),
      })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    ledger = app.get(LedgerService);
    repository = new FinancialCommitmentRepository();
    service = new FinancialCommitmentService(
      db,
      app.get(AuthenticationSessionService),
      app.get(CustomerTransactionPinService),
      app.get(PasswordHashVerificationService),
      app.get(WalletFinancialBoundaryService),
      app.get(LimitEnforcementService),
      app.get(WithdrawalService),
      app.get(ExternalOperationService),
      ledger,
      repository,
    );
    const proposal = randomUUID();
    const requirements = { all: [], any: [] };
    const definition = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: requirements, LEVEL_2: requirements },
      operator: { LEVEL_1: requirements, LEVEL_2: requirements },
    };
    await db.query(
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state)
      VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
      [
        proposal,
        randomUUID(),
        JSON.stringify(definition),
        'a'.repeat(64),
        randomUUID(),
        randomUUID(),
      ],
    );
    await db.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
      [proposal, JSON.stringify(definition)],
    );
    await db.query('UPDATE kyc_tier_policy_head SET version=1');
  }, 180000);
  afterAll(async () => {
    if (app) await app.close();
    if (db) await destroyIntegrationDataSource(db);
  });

  function hashPassword(value: string): string {
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(value, salt, 10000, 32, 'sha256');
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }
  async function subject() {
    const suffix = randomUUID().slice(0, 8);
    const source = await ledger.createAccount({
      code: `FC-CUSTOMER-${suffix}`,
      name: 'Customer',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    const asset = (
      await db.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN'`,
      )
    )[0]!.id;
    await ledger.postJournal({
      idempotencyKey: `fund-${suffix}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: asset, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
        { accountId: source.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
      ],
    });
    const participant = await seedTransferParticipant(db, `fc${suffix}`, source.id);
    await db.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [participant.customerId, `phone-${randomUUID()}`],
    );
    await db.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at)
      VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [participant.customerId],
    );
    snapshots.set(participant.customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId: participant.customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
    await db.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required)
      VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',false)`,
      [randomUUID(), participant.customerId, hashPassword('password-123')],
    );
    await app.get(CustomerTransactionPinService).setTransactionPin(participant.customerId, {
      pinHash: hashPassword('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: participant.customerId,
    });
    const authentication = await app.get(AuthenticationExecutionService).authenticate({
      customerId: participant.customerId,
      password: 'password-123',
      actor: participant.customerId,
    });
    expect(authentication.authenticated).toBe(true);
    const session = await app
      .get(AuthenticationSessionService)
      .issue({ authentication, actor: participant.customerId });
    return { ...participant, token: session.accessToken, sourceId: source.id, assetId: asset };
  }
  function command(
    subject: { token: string; walletAccountId: string },
    key: string,
    amountMinor = '700',
  ) {
    return {
      ...context,
      token: subject.token,
      walletAccountId: subject.walletAccountId,
      amountMinor,
      idempotencyKey: key,
    };
  }
  async function balance(id: string): Promise<string> {
    return (await ledger.getAccountBalance(id)).balanceMinor;
  }

  it('binds real PIN and session authorization to an atomic ledger reservation, preventing re-spending', async () => {
    const s = await subject();
    const result = await service.initiate(command(s, randomUUID()));
    expect(result.commitment.state).toBe('RESERVED');
    expect(await balance(s.sourceId)).toBe('300');
    const rows = await db.query<
      Array<{
        customer_id: string;
        pin_audit_id: string;
        amount_minor: string;
        external_operation_id: string;
        reservation_journal_id: string;
      }>
    >(
      `SELECT a.customer_id,a.pin_audit_id,a.amount_minor::text,c.external_operation_id,c.reservation_journal_id
       FROM financial_commitments c JOIN financial_authorizations a ON a.id=c.authorization_id WHERE c.id=$1`,
      [result.commitment.id],
    );
    expect(rows[0]).toMatchObject({
      customer_id: s.customerId,
      amount_minor: '700',
      external_operation_id: result.commitment.external_operation_id,
      reservation_journal_id: result.commitment.reservation_journal_id,
    });
    expect(rows[0]?.pin_audit_id).toBeTruthy();
    await expect(
      ledger.postJournal({
        idempotencyKey: randomUUID(),
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          { accountId: s.sourceId, direction: LedgerEntryDirection.DEBIT, amountMinor: '301' },
          { accountId: s.assetId, direction: LedgerEntryDirection.CREDIT, amountMinor: '301' },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      ledger.postJournal({
        idempotencyKey: randomUUID(),
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: result.commitment.reserve_account_id,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1',
          },
          { accountId: s.assetId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1' },
        ],
      }),
    ).rejects.toThrow('reserve account is restricted');
  });

  it('rejects bad PIN and ineligible customers without financial records', async () => {
    const s = await subject();
    await expect(service.initiate({ ...command(s, randomUUID()), pin: '9999' })).rejects.toThrow();
    await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [s.customerId]);
    await expect(service.initiate(command(s, randomUUID()))).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM financial_authorizations WHERE customer_id=$1', [
        s.customerId,
      ]),
    ).toHaveLength(0);
  });

  it('serializes overspending and replays concurrent duplicates', async () => {
    const s = await subject();
    const outcomes = await Promise.allSettled([
      service.initiate(command(s, randomUUID())),
      service.initiate(command(s, randomUUID())),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(s.sourceId)).toBe('300');
    const other = await subject();
    const key = randomUUID();
    const duplicates = await Promise.all([
      service.initiate(command(other, key)),
      service.initiate(command(other, key)),
    ]);
    expect(duplicates.map((x) => x.commitment.id)[0]).toBe(duplicates[1].commitment.id);
    expect(duplicates.filter((x) => x.replayed)).toHaveLength(1);
    expect(await balance(other.sourceId)).toBe('300');
  });

  it('enforces the real withdrawal limit and preserves its window reservation', async () => {
    const s = await subject();
    const profile = `FC_${randomUUID().replace(/-/g, '').toUpperCase()}`;
    await db.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by)
      VALUES($1,'Withdrawal test','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await db.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by)
      VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, s.customerId],
    );
    await db.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by)
      VALUES($1,$2,'WITHDRAWAL','OUTGOING','NGN','DAILY_AMOUNT',800,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    await service.initiate(command(s, randomUUID(), '700'));
    const usage = await db.query<Array<{ reserved_amount_minor: string }>>(
      `SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1 AND product='WITHDRAWAL'`,
      [s.customerId],
    );
    expect(usage).toEqual([{ reserved_amount_minor: '700' }]);
    const reservation = await db.query<Array<{ id: string }>>(
      'SELECT id FROM limit_reservations WHERE principal_id=$1',
      [s.customerId],
    );
    await expect(
      app
        .get(LimitReservationRecoveryService)
        .releaseManually({
          reservationId: reservation[0]!.id,
          actor: 'test',
          reason: 'Attempted manual release',
        }),
    ).rejects.toThrow('active financial commitment');
    await expect(service.initiate(command(s, randomUUID(), '200'))).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('300');
  });

  it('rolls back the operation, authorization, limit and ledger reservation after an injected failure', async () => {
    const s = await subject();
    const key = randomUUID();
    const spy = jest
      .spyOn(repository, 'insertReserved')
      .mockRejectedValueOnce(new Error('injected failure'));
    await expect(service.initiate(command(s, key))).rejects.toThrow('injected failure');
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM financial_authorizations WHERE customer_id=$1', [
        s.customerId,
      ]),
    ).toHaveLength(0);
    expect(
      await db.query('SELECT id FROM external_operations WHERE customer_id=$1', [s.customerId]),
    ).toHaveLength(0);
    spy.mockRestore();
    expect((await service.initiate(command(s, key))).commitment.state).toBe('RESERVED');
    expect(await balance(s.sourceId)).toBe('300');
  });
});
