import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource, type DeepPartial } from 'typeorm';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');

import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
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
import { LimitReservationRecoveryService } from '../src/limit-catalog/limit-reservation-recovery.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
  ExternalOperationResourceType,
} from '../src/partner/external-operation.enums';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import type { ExternalOperationStatusVerifier } from '../src/partner/external-operation-status-verifier';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxService } from '../src/operations/outbox.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import { CustomerBeneficiaryService } from '../src/customer-beneficiary/customer-beneficiary.service';
import { InboundFundingService } from '../src/virtual-account/inbound-funding.service';
import {
  UnavailableInboundFundingVerifier,
  type InboundVerification,
} from '../src/virtual-account/inbound-funding-verifier';
import { UnavailableInboundInstitutionAuthority } from '../src/virtual-account/inbound-institution-authority';
import { UnavailableInboundSuspensePolicy } from '../src/virtual-account/inbound-suspense-policy';
import { VirtualAccountService } from '../src/virtual-account/virtual-account.service';
import {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
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
  let settlement: ExternalSettlementService;
  let inbound: InboundFundingService;
  let withdrawalAuthority: 'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE' = 'AUTHORIZED';
  const inboundEvidence = new Map<string, InboundVerification>();
  let verificationState:
    | 'VERIFIED_SETTLED'
    | 'VERIFIED_REJECTED'
    | 'UNKNOWN'
    | 'UNAVAILABLE'
    | 'RACE' = 'VERIFIED_SETTLED';
  let verificationHashOverride: string | null = null;
  const requestContext = {
    requestId: 'commitment-test',
    correlationId: 'commitment-test',
    traceId: 'commitment-test',
  };
  const snapshots = new Map<string, TierEvidenceSnapshot>();
  const context = {
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
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({ authorize: () => Promise.resolve(withdrawalAuthority) })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ledger = app.get(LedgerService);
    repository = app.get(FinancialCommitmentRepository);
    const verifier: ExternalOperationStatusVerifier = {
      verify: ({ operation, correlationId }) =>
        Promise.resolve({
          state:
            verificationState === 'RACE'
              ? correlationId === 'settle-race'
                ? 'VERIFIED_SETTLED'
                : 'VERIFIED_REJECTED'
              : verificationState,
          providerStatus: 'controlled-test',
          providerReferenceHash:
            verificationHashOverride ??
            createHash('sha256')
              .update(
                operation.providerReferences.find(
                  (r) => r.source === ExternalOperationReferenceSource.STATUS_QUERY,
                )?.referenceValue ?? '',
              )
              .digest('hex'),
          observedAt: new Date().toISOString(),
          reasonCode: null,
        }),
    };
    settlement = new ExternalSettlementService(
      db.getRepository(ExternalSettlement),
      db.getRepository(ExternalSuspenseEntry),
      db,
      ledger,
      app.get(SettlementAccountService),
      app.get(ExternalOperationService),
      app.get(IdempotencyService),
      app.get(AuditService),
      { getProfile: () => ({ enabled: true }) } as never,
      app.get(OutboxService),
      verifier,
      app.get(LimitUsageService),
    );
    inbound = new InboundFundingService(
      db,
      ledger,
      app.get(WalletFinancialBoundaryService),
      app.get(SettlementAccountService),
      app.get(AuditService),
      app.get(OutboxService),
      {
        verify: ({ providerReference }) =>
          Promise.resolve(inboundEvidence.get(providerReference) ?? { state: 'UNKNOWN' }),
      },
      { authorize: () => Promise.resolve('AUTHORIZED') },
      { authorize: () => Promise.resolve('AUTHORIZED') },
    );
    service = app.get(FinancialCommitmentService);
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
    await db.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status)
      VALUES($1,'FCBANK','Financial Commitment Test Bank','FC Bank',true,'ACTIVE')`,
      [randomUUID()],
    );
  }, 180000);
  beforeEach(() => {
    verificationState = 'VERIFIED_SETTLED';
    verificationHashOverride = null;
    withdrawalAuthority = 'AUTHORIZED';
  });
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
    const beneficiaryService = app.get(CustomerBeneficiaryService);
    const beneficiary = await beneficiaryService.createBeneficiary(participant.customerId, {
      type: CustomerBeneficiaryType.BANK_ACCOUNT,
      displayName: 'Test beneficiary',
      reference: `fc-${randomUUID()}`,
      destinationIdentifier: '1234567890',
      destinationInstitution: 'FCBANK',
      actor: participant.customerId,
    });
    await beneficiaryService.verifyBeneficiary(participant.customerId, beneficiary.id, {
      verifiedBy: 'test',
      verificationMethod: 'controlled-test',
    });
    await beneficiaryService.updateBeneficiary(participant.customerId, beneficiary.id, {
      status: CustomerBeneficiaryStatus.ACTIVE,
      actor: participant.customerId,
    });
    return {
      ...participant,
      beneficiaryId: beneficiary.id,
      token: session.accessToken,
      sourceId: source.id,
      assetId: asset,
    };
  }
  function command(
    subject: { token: string; walletAccountId: string; beneficiaryId: string },
    key: string,
    amountMinor = '700',
  ) {
    return {
      ...context,
      token: subject.token,
      walletAccountId: subject.walletAccountId,
      beneficiaryId: subject.beneficiaryId,
      amountMinor,
      idempotencyKey: key,
    };
  }
  async function balance(id: string): Promise<string> {
    return (await ledger.getAccountBalance(id)).balanceMinor;
  }

  async function configureLimit(s: { customerId: string }) {
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
  }

  async function pending(
    s: { token: string; walletAccountId: string; beneficiaryId: string },
    key = randomUUID(),
  ) {
    const initiated = await service.initiate(command(s, key));
    const id = initiated.commitment.external_operation_id;
    const lifecycle = app.get(ExternalOperationLifecycleService);
    const attempt = await lifecycle.beginAttempt(id, `attempt-${randomUUID()}`, requestContext, 1);
    const verified = await lifecycle.transition({
      externalOperationId: id,
      expectedVersion: attempt.version,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: `pending-${randomUUID()}`,
      requestContext,
    });
    const referenceValue = `test-provider-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({
      externalOperationId: id,
      partnerKey: 'NIBSS_NIP',
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    return {
      commitment: initiated.commitment,
      version: verified.version,
      evidence: {
        referenceType: 'TRANSACTION' as const,
        referenceValue,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
    };
  }
  function settleCommand(op: Awaited<ReturnType<typeof pending>>, context = requestContext) {
    return {
      externalOperationId: op.commitment.external_operation_id,
      decision: ExternalSettlementDecision.SETTLE,
      expectedVersion: op.version,
      evidence: op.evidence,
      requestContext: context,
    };
  }
  function releaseCommand(op: Awaited<ReturnType<typeof pending>>, context = requestContext) {
    return {
      externalOperationId: op.commitment.external_operation_id,
      expectedVersion: op.version,
      requestContext: context,
    };
  }

  async function incoming(s: { walletAccountId: string }, reference = randomUUID()) {
    const accountNumber = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 10000000000n)
      .toString()
      .padStart(10, '0');
    const va = await app.get(VirtualAccountService).assign({
      walletId: s.walletAccountId,
      bankCode: 'FCBANK',
      accountNumber,
      accountName: 'Test account',
      provider: 'TESTPROVIDER',
    });
    inboundEvidence.set(reference, {
      state: 'RECEIVED',
      providerKey: 'TESTPROVIDER',
      providerReference: reference,
      bankCode: 'FCBANK',
      accountNumber,
      amountMinor: '700',
      currency: 'NGN',
      observedAt: new Date().toISOString(),
    });
    return {
      va,
      reference,
      request: {
        providerKey: 'TESTPROVIDER',
        providerReference: reference,
        correlationId: `inbound-${reference}`,
      },
    };
  }

  it('composes bound inbound funding atomically with its caller transaction', async () => {
    const s = await subject();
    const item = await incoming(s);
    const input = {
      ...item.request,
      expectedWalletAccountId: s.walletAccountId,
      expectedAmountMinor: '700',
      expectedCurrency: 'NGN',
    };
    await expect(inbound.receiveInTransaction(db.manager, input)).rejects.toThrow(
      'active serializable transaction',
    );
    await expect(
      db.transaction('READ COMMITTED', (manager) => inbound.receiveInTransaction(manager, input)),
    ).rejects.toThrow('active serializable transaction');
    await expect(
      db.transaction('SERIALIZABLE', (manager) => inbound.receiveInTransaction(manager, input)),
    ).rejects.toThrow('must be observed before the transaction');
    await inbound.observe(item.request);
    await expect(
      db.transaction('SERIALIZABLE', async (manager) => {
        const received = await inbound.receiveInTransaction(manager, input);
        expect(received.status).toBe('CREDITED');
        throw new Error('injected lifecycle failure');
      }),
    ).rejects.toThrow('injected lifecycle failure');
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query(
        'SELECT id FROM inbound_funding_observations WHERE provider_reference_hash=$1',
        [createHash('sha256').update(item.reference).digest('hex')],
      ),
    ).toHaveLength(1);
    expect(
      await db.query('SELECT id FROM inbound_funding_receipts WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(0);
    const received = await db.transaction('SERIALIZABLE', (manager) =>
      inbound.receiveInTransaction(manager, input),
    );
    expect(received.status).toBe('CREDITED');
    expect(await balance(s.sourceId)).toBe('1700');
  });

  it('uses retained independently verified evidence within the product transaction without re-querying the provider', async () => {
    const s = await subject();
    const item = await incoming(s);
    await inbound.observe(item.request);
    inboundEvidence.set(item.reference, { state: 'UNAVAILABLE' });
    const result = await db.transaction('SERIALIZABLE', (manager) =>
      inbound.receiveInTransaction(manager, {
        ...item.request,
        expectedWalletAccountId: s.walletAccountId,
        expectedAmountMinor: '700',
        expectedCurrency: 'NGN',
      }),
    );
    expect(result.status).toBe('CREDITED');
    expect(await balance(s.sourceId)).toBe('1700');
  });

  it('rejects product wallet and amount substitutions for verified inbound funds, including replay', async () => {
    const s = await subject();
    const other = await subject();
    const item = await incoming(s);
    const expected = {
      ...item.request,
      expectedWalletAccountId: s.walletAccountId,
      expectedAmountMinor: '700',
      expectedCurrency: 'NGN',
    };
    await inbound.observe(item.request);
    for (const altered of [
      { ...expected, expectedWalletAccountId: other.walletAccountId },
      { ...expected, expectedAmountMinor: '701' },
    ]) {
      const result = await db.transaction('SERIALIZABLE', (manager) =>
        inbound.receiveInTransaction(manager, altered),
      );
      expect(result).toMatchObject({ status: 'REVIEW', reason: 'EVIDENCE_CONFLICT' });
    }
    expect(await balance(s.sourceId)).toBe('1000');
    expect(await balance(other.sourceId)).toBe('1000');
    expect(
      (
        await db.transaction('SERIALIZABLE', (manager) =>
          inbound.receiveInTransaction(manager, expected),
        )
      ).status,
    ).toBe('CREDITED');
    const mismatchedReplay = await db.transaction('SERIALIZABLE', (manager) =>
      inbound.receiveInTransaction(manager, {
        ...expected,
        expectedWalletAccountId: other.walletAccountId,
      }),
    );
    expect(mismatchedReplay).toMatchObject({ status: 'REVIEW', reason: 'EVIDENCE_CONFLICT' });
    expect(await balance(s.sourceId)).toBe('1700');
    expect(await balance(other.sourceId)).toBe('1000');
  });

  it('credits verified inbound funds exactly once with debit asset and credit recipient wallet', async () => {
    const s = await subject();
    const receipt = await incoming(s);
    const assetBefore = BigInt(await balance(s.assetId));
    const results = await Promise.all([
      inbound.receive(receipt.request),
      inbound.receive(receipt.request),
    ]);
    expect(results.map((r) => r.status)).toEqual(['CREDITED', 'CREDITED']);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balance(s.sourceId)).toBe('1700');
    expect(BigInt(await balance(s.assetId))).toBe(assetBefore + 700n);
    const record = (
      await db.query<Array<{ id: string; journal_id: string; status: string }>>(
        'SELECT id,journal_id,status FROM inbound_funding_receipts WHERE provider_reference_hash=$1',
        [createHash('sha256').update(receipt.reference).digest('hex')],
      )
    )[0]!;
    expect(record.status).toBe('CREDITED');
    await expect(
      db.query(
        `INSERT INTO ledger_journals
      (id,idempotency_key,request_hash,currency,accounting_unit,status,reversal_of_journal_id,total_minor,posted_at)
      VALUES ($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',$4,700,clock_timestamp())`,
        [randomUUID(), randomUUID(), 'a'.repeat(64), record.journal_id],
      ),
    ).rejects.toThrow('Inbound funding reversal requires a governed receipt recovery');
    expect(await balance(s.sourceId)).toBe('1700');
    const journal = await ledger.getJournal(record.journal_id);
    expect(journal.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: s.assetId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '700',
        }),
        expect.objectContaining({
          accountId: s.sourceId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '700',
        }),
      ]),
    );
    expect(
      await db.query('SELECT id FROM financial_commitments WHERE withdrawal_id=$1', [randomUUID()]),
    ).toHaveLength(0);
  });

  it('routes uncertain or conflicting inbound evidence to review without duplicate credit', async () => {
    const s = await subject();
    const item = await incoming(s);
    const original = inboundEvidence.get(item.reference)!;
    inboundEvidence.set(item.reference, { state: 'UNKNOWN' });
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'REVIEW',
      reason: 'OUTCOME_UNKNOWN',
    });
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query(
        'SELECT id FROM inbound_funding_observations WHERE provider_reference_hash=$1',
        [createHash('sha256').update(item.reference).digest('hex')],
      ),
    ).toHaveLength(0);
    inboundEvidence.set(item.reference, original);
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'CREDITED',
      replayed: false,
    });
    if (original.state !== 'RECEIVED') throw new Error('test evidence missing');
    inboundEvidence.set(item.reference, { ...original, amountMinor: '701' });
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'REVIEW',
      reason: 'EVIDENCE_CONFLICT',
    });
    expect(await balance(s.sourceId)).toBe('1700');
    expect(
      await db.query('SELECT id FROM inbound_funding_reviews WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(2);
  });

  it('retains contradictory verified observations and blocks credit before any receipt', async () => {
    const s = await subject();
    const item = await incoming(s);
    const original = inboundEvidence.get(item.reference)!;
    if (original.state !== 'RECEIVED') throw new Error('test evidence missing');
    await inbound.observe(item.request);
    inboundEvidence.set(item.reference, { ...original, amountMinor: '701' });
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'REVIEW',
      reason: 'EVIDENCE_CONFLICT',
    });
    inboundEvidence.set(item.reference, original);
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'REVIEW',
      reason: 'EVIDENCE_CONFLICT',
    });
    const rows = await db.query<Array<{ id: string }>>(
      'SELECT id FROM inbound_funding_observations WHERE provider_reference_hash=$1',
      [createHash('sha256').update(item.reference).digest('hex')],
    );
    expect(rows).toHaveLength(2);
    await expect(
      db.query('DELETE FROM inbound_funding_observations WHERE id=$1', [rows[0]!.id]),
    ).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('preserves independently verified unsupported currency without credit', async () => {
    const s = await subject();
    const item = await incoming(s);
    const original = inboundEvidence.get(item.reference)!;
    if (original.state !== 'RECEIVED') throw new Error('test evidence missing');
    inboundEvidence.set(item.reference, { ...original, currency: 'USD' });
    await expect(inbound.receive(item.request)).rejects.toThrow('currency is not supported');
    const queue = await app.get(ReconciliationService).getUnresolvedInboundObservations();
    expect(
      queue.find(
        (row) =>
          row.provider_reference_hash === createHash('sha256').update(item.reference).digest('hex'),
      ),
    ).toMatchObject({ currency: 'USD', amount_minor: '700' });
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('books received funds to suspense when the customer is on compliance hold', async () => {
    const s = await subject();
    const item = await incoming(s);
    const suspense = (
      await db.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SYSTEM_SUSPENSE-NGN'`,
      )
    )[0]!.id;
    const before = BigInt(await balance(suspense));
    await db.query(
      `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
      [s.customerId],
    );
    const result = await inbound.receive(item.request);
    expect(result.status).toBe('SUSPENSE');
    const queue = await app.get(ReconciliationService).getUnresolvedInboundObservations();
    expect(
      queue.find(
        (row) =>
          row.provider_reference_hash === createHash('sha256').update(item.reference).digest('hex'),
      ),
    ).toMatchObject({ receipt_status: 'SUSPENSE' });
    expect(await balance(s.sourceId)).toBe('1000');
    expect(BigInt(await balance(suspense))).toBe(before + 700n);
    await db.query('DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1', [s.customerId]);
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'SUSPENSE',
      replayed: true,
    });
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('fails closed with the default unavailable provider verifier', async () => {
    const s = await subject();
    const item = await incoming(s);
    const noVerifier = new InboundFundingService(
      db,
      ledger,
      app.get(WalletFinancialBoundaryService),
      app.get(SettlementAccountService),
      app.get(AuditService),
      app.get(OutboxService),
      new UnavailableInboundFundingVerifier(),
      { authorize: () => Promise.resolve('AUTHORIZED') },
      { authorize: () => Promise.resolve('AUTHORIZED') },
    );
    await expect(noVerifier.receive(item.request)).rejects.toThrow('verification is unavailable');
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM inbound_funding_receipts WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(0);
  });

  it('fails closed without institutional authority even for confirmed receipt evidence', async () => {
    const s = await subject();
    const item = await incoming(s);
    const noInstitution = new InboundFundingService(
      db,
      ledger,
      app.get(WalletFinancialBoundaryService),
      app.get(SettlementAccountService),
      app.get(AuditService),
      app.get(OutboxService),
      { verify: () => Promise.resolve(inboundEvidence.get(item.reference)!) },
      new UnavailableInboundInstitutionAuthority(),
      { authorize: () => Promise.resolve('AUTHORIZED') },
    );
    await expect(noInstitution.receive(item.request)).rejects.toThrow(
      'institutional authority is unavailable',
    );
    const observations = await db.query<
      Array<{ provider_reference: string; amount_minor: string; currency: string }>
    >(
      'SELECT provider_reference, amount_minor, currency FROM inbound_funding_observations WHERE provider_reference_hash=$1',
      [createHash('sha256').update(item.reference).digest('hex')],
    );
    expect(observations).toMatchObject([
      { provider_reference: item.reference, amount_minor: '700', currency: 'NGN' },
    ]);
    const report = await app.get(ReconciliationService).runReconciliation();
    expect(
      report.checks.find((check) => check.name === 'verified_inbound_unresolved'),
    ).toMatchObject({ status: 'WARNING' });
    const queue = await app.get(ReconciliationService).getUnresolvedInboundObservations();
    const observation = queue.find(
      (row) =>
        row.provider_reference_hash === createHash('sha256').update(item.reference).digest('hex'),
    );
    expect(observation).toMatchObject({ amount_minor: '700', currency: 'NGN' });
    expect(observation).not.toHaveProperty('account_number');
    expect(observation).not.toHaveProperty('provider_reference');
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM inbound_funding_receipts WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(0);
  });

  it('does not book uncreditable funds without an approved suspense policy', async () => {
    const s = await subject();
    const item = await incoming(s);
    await db.query(
      `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
      [s.customerId],
    );
    const noPolicy = new InboundFundingService(
      db,
      ledger,
      app.get(WalletFinancialBoundaryService),
      app.get(SettlementAccountService),
      app.get(AuditService),
      app.get(OutboxService),
      { verify: () => Promise.resolve(inboundEvidence.get(item.reference)!) },
      { authorize: () => Promise.resolve('AUTHORIZED') },
      new UnavailableInboundSuspensePolicy(),
    );
    await expect(noPolicy.receive(item.request)).rejects.toThrow('suspense policy is unavailable');
    expect(
      await db.query(
        'SELECT id FROM inbound_funding_observations WHERE provider_reference_hash=$1',
        [createHash('sha256').update(item.reference).digest('hex')],
      ),
    ).toHaveLength(1);
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM inbound_funding_receipts WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(0);
  });

  it('records verified funds for an unknown recipient in suspense without inventing a wallet', async () => {
    const reference = randomUUID();
    inboundEvidence.set(reference, {
      state: 'RECEIVED',
      providerKey: 'TESTPROVIDER',
      providerReference: reference,
      bankCode: 'FCBANK',
      accountNumber: '8888888888',
      amountMinor: '200',
      currency: 'NGN',
      observedAt: new Date().toISOString(),
    });
    const suspense = (
      await db.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SYSTEM_SUSPENSE-NGN'`,
      )
    )[0]!.id;
    const before = BigInt(await balance(suspense));
    const result = await inbound.receive({
      providerKey: 'TESTPROVIDER',
      providerReference: reference,
      correlationId: 'unknown-recipient',
    });
    expect(result.status).toBe('SUSPENSE');
    expect(BigInt(await balance(suspense))).toBe(before + 200n);
    const rows = await db.query<Array<{ wallet_account_id: string | null }>>(
      'SELECT wallet_account_id FROM inbound_funding_receipts WHERE provider_reference_hash=$1',
      [createHash('sha256').update(reference).digest('hex')],
    );
    expect(rows).toEqual([{ wallet_account_id: null }]);
  });

  it('fails closed on unavailable or mismatched provider proof and rolls back an interrupted credit', async () => {
    const s = await subject();
    const item = await incoming(s);
    const original = inboundEvidence.get(item.reference)!;
    inboundEvidence.set(item.reference, { state: 'UNAVAILABLE' });
    await expect(inbound.receive(item.request)).rejects.toThrow('verification is unavailable');
    if (original.state !== 'RECEIVED') throw new Error('test evidence missing');
    inboundEvidence.set(item.reference, { ...original, providerReference: 'other-reference' });
    await expect(inbound.receive(item.request)).rejects.toThrow('does not match');
    inboundEvidence.set(item.reference, original);
    const outbox = jest
      .spyOn(app.get(OutboxService), 'enqueue')
      .mockRejectedValueOnce(new Error('injected inbound failure'));
    try {
      await expect(inbound.receive(item.request)).rejects.toThrow('injected inbound failure');
    } finally {
      outbox.mockRestore();
    }
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM inbound_funding_receipts WHERE provider_reference_hash=$1', [
        createHash('sha256').update(item.reference).digest('hex'),
      ]),
    ).toHaveLength(0);
    expect(await inbound.receive(item.request)).toMatchObject({
      status: 'CREDITED',
      replayed: false,
    });
    expect(await balance(s.sourceId)).toBe('1700');
  });

  it('wires customer-self initiation through real authorization and reservation, with unavailable authority fail closed', async () => {
    const s = await subject();
    const payload = {
      walletAccountId: s.walletAccountId,
      beneficiaryId: s.beneficiaryId,
      amountMinor: '700',
      currency: 'NGN',
      pin: '1234',
    };
    const headers = { authorization: `Bearer ${s.token}`, 'idempotency-key': randomUUID() };
    const url = '/api/v1/customers/me/withdrawal-commitments';
    const unauthenticated = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(unauthenticated.statusCode).toBe(401);
    withdrawalAuthority = 'UNAVAILABLE';
    const unavailable = await app.inject({ method: 'POST', url, payload, headers });
    expect(unavailable.statusCode).toBe(503);
    expect(await balance(s.sourceId)).toBe('1000');
    expect(
      await db.query('SELECT id FROM financial_authorizations WHERE customer_id=$1', [
        s.customerId,
      ]),
    ).toHaveLength(0);
    withdrawalAuthority = 'AUTHORIZED';
    const first = await app.inject({ method: 'POST', url, payload, headers });
    expect(first.statusCode).toBe(201);
    const body = first.json<{
      commitmentId: string;
      withdrawalId: string;
      externalOperationId: string;
      state: string;
      replayed: boolean;
    }>();
    expect(body).toMatchObject({ state: 'RESERVED', replayed: false });
    expect(await balance(s.sourceId)).toBe('300');
    const replay = await app.inject({ method: 'POST', url, payload, headers });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ commitmentId: body.commitmentId, replayed: true });
    expect(await balance(s.sourceId)).toBe('300');
    const other = await subject();
    const substituted = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, walletAccountId: other.walletAccountId },
      headers: { ...headers, 'idempotency-key': randomUUID() },
    });
    expect(substituted.statusCode).toBeGreaterThanOrEqual(400);
    expect(await balance(other.sourceId)).toBe('1000');
  });

  it('registers the product route with the real default unavailable withdrawal authority', async () => {
    const s = await subject();
    const { AppModule } = await import('../src/app.module');
    const isolatedConnection = new DataSource({ ...db.options, migrationsRun: false });
    await isolatedConnection.initialize();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(isolatedConnection)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({
        read: (_manager: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null),
      })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    const defaultApp = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    defaultApp.setGlobalPrefix('api/v1');
    defaultApp.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await defaultApp.init();
    await defaultApp.getHttpAdapter().getInstance().ready();
    try {
      const result = await defaultApp.inject({
        method: 'POST',
        url: '/api/v1/customers/me/withdrawal-commitments',
        headers: { authorization: `Bearer ${s.token}`, 'idempotency-key': randomUUID() },
        payload: {
          walletAccountId: s.walletAccountId,
          beneficiaryId: s.beneficiaryId,
          amountMinor: '700',
          currency: 'NGN',
          pin: '1234',
        },
      });
      expect(result.statusCode).toBe(503);
      expect(await balance(s.sourceId)).toBe('1000');
      expect(
        await db.query('SELECT id FROM financial_authorizations WHERE customer_id=$1', [
          s.customerId,
        ]),
      ).toHaveLength(0);
      expect(
        await db.query('SELECT id FROM external_operations WHERE customer_id=$1', [s.customerId]),
      ).toHaveLength(0);
    } finally {
      await defaultApp.close();
    }
  });

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

  it('binds an owned bank beneficiary to the authenticated request and immutable operation', async () => {
    const s = await subject();
    const other = await subject();
    await expect(
      service.initiate({ ...command(s, randomUUID()), beneficiaryId: other.beneficiaryId }),
    ).rejects.toThrow('beneficiary is not available');
    const key = randomUUID();
    const result = await service.initiate(command(s, key));
    const rows = await db.query<
      Array<{
        beneficiary_id: string;
        target_reference: string;
        target_mapping_reference: string;
        institution: string | null;
      }>
    >(
      `SELECT d.beneficiary_id,d.target_reference,o.target_mapping_reference,a.institution
       FROM financial_commitment_destinations d JOIN financial_commitments c ON c.id=d.commitment_id
       JOIN financial_authorizations a ON a.id=c.authorization_id JOIN external_operations o ON o.id=c.external_operation_id
       WHERE c.id=$1`,
      [result.commitment.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ beneficiary_id: s.beneficiaryId, institution: null });
    expect(rows[0]!.target_reference).toBe(rows[0]!.target_mapping_reference);
    await expect(
      db.query('UPDATE financial_commitment_destinations SET bank_code=$2 WHERE commitment_id=$1', [
        result.commitment.id,
        'OTHER',
      ]),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE external_operations SET target_mapping_reference=$2 WHERE id=$1', [
        result.commitment.external_operation_id,
        `a6-target:${'b'.repeat(64)}`,
      ]),
    ).rejects.toThrow();
    await expect(
      service.initiate({ ...command(s, key), beneficiaryId: other.beneficiaryId }),
    ).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('300');
  });

  it('rejects a destination changed between customer PIN authorization and reservation', async () => {
    const s = await subject();
    const pins = app.get(CustomerTransactionPinService);
    const original = pins.verifyTransactionPin.bind(pins);
    const spy = jest.spyOn(pins, 'verifyTransactionPin').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await db.query(
        `UPDATE customer_beneficiaries SET destination_identifier='9999999999', version=version+1 WHERE id=$1`,
        [s.beneficiaryId],
      );
      return result;
    });
    try {
      await expect(service.initiate(command(s, randomUUID()))).rejects.toThrow(
        'Beneficiary changed after customer authorization',
      );
      expect(await balance(s.sourceId)).toBe('1000');
      expect(
        await db.query('SELECT id FROM financial_authorizations WHERE customer_id=$1', [
          s.customerId,
        ]),
      ).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the original obligation bound after a beneficiary changes', async () => {
    const s = await subject();
    const op = await pending(s);
    await db.query(
      `UPDATE customer_beneficiaries SET destination_identifier='9999999999', version=version+1 WHERE id=$1`,
      [s.beneficiaryId],
    );
    expect((await settlement.settleVerifiedOutcome(settleCommand(op))).settlement.status).toBe(
      'POSTED',
    );
    expect(await balance(s.sourceId)).toBe('300');
  });

  it('settles the reserved obligation exactly once after ordinary eligibility withdrawal', async () => {
    const s = await subject();
    const op = await pending(s);
    const reserveBefore = BigInt(await balance(op.commitment.reserve_account_id));
    await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [s.customerId]);
    await expect(service.initiate(command(s, randomUUID(), '1'))).rejects.toThrow();
    const result = await settlement.settleVerifiedOutcome(settleCommand(op));
    expect(result.settlement.status).toBe('POSTED');
    expect((await settlement.settleVerifiedOutcome(settleCommand(op))).replayed).toBe(true);
    expect(await balance(s.sourceId)).toBe('300');
    expect(BigInt(await balance(op.commitment.reserve_account_id))).toBe(reserveBefore - 700n);
    const rows = await db.query<Array<{ state: string; resolution_journal_id: string }>>(
      'SELECT state,resolution_journal_id FROM financial_commitments WHERE id=$1',
      [op.commitment.id],
    );
    expect(rows).toEqual([
      { state: 'SETTLED', resolution_journal_id: result.settlement.journalId },
    ]);
  });

  it('releases a genuine reservation exactly once only after verified provider rejection', async () => {
    const s = await subject();
    const op = await pending(s);
    verificationState = 'UNKNOWN';
    await expect(settlement.releaseReservedWithdrawal(releaseCommand(op))).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('300');
    verificationState = 'VERIFIED_REJECTED';
    const released = await settlement.releaseReservedWithdrawal(releaseCommand(op));
    expect(released.replayed).toBe(false);
    expect((await settlement.releaseReservedWithdrawal(releaseCommand(op))).replayed).toBe(true);
    expect(await balance(s.sourceId)).toBe('1000');
    const row = await db.query<Array<{ state: string; resolution_journal_id: string }>>(
      'SELECT state,resolution_journal_id FROM financial_commitments WHERE id=$1',
      [op.commitment.id],
    );
    expect(row).toEqual([{ state: 'RELEASED', resolution_journal_id: released.journalId }]);
  });

  it('reverses the genuine reservation exactly, only after verified rejection and after a rolled-back outbox failure', async () => {
    const s = await subject();
    const op = await pending(s);
    const command = releaseCommand(op);
    await db.query(
      `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
      [s.customerId],
    );
    verificationState = 'VERIFIED_REJECTED';
    await expect(settlement.releaseReservedWithdrawal(command)).rejects.toThrow(
      'restricted pending compliance review',
    );
    await db.query('DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1', [s.customerId]);
    for (const state of ['UNKNOWN', 'UNAVAILABLE'] as const) {
      verificationState = state;
      await expect(settlement.releaseReservedWithdrawal(command)).rejects.toThrow();
    }
    verificationState = 'VERIFIED_REJECTED';
    verificationHashOverride = createHash('sha256').update('another-operation').digest('hex');
    await expect(settlement.releaseReservedWithdrawal(command)).rejects.toThrow('not verified');
    verificationHashOverride = null;
    const outbox = jest
      .spyOn(app.get(OutboxService), 'enqueue')
      .mockRejectedValueOnce(new Error('injected release outbox outage'));
    try {
      await expect(settlement.releaseReservedWithdrawal(command)).rejects.toThrow(
        'injected release outbox outage',
      );
    } finally {
      outbox.mockRestore();
    }
    expect(await balance(s.sourceId)).toBe('300');
    expect(
      await db.query('SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1', [
        op.commitment.reservation_journal_id,
      ]),
    ).toHaveLength(0);
    expect(
      await db.query('SELECT state FROM financial_commitments WHERE id=$1', [op.commitment.id]),
    ).toEqual([{ state: 'RESERVED' }]);
    const result = await settlement.releaseReservedWithdrawal(command);
    expect(await balance(s.sourceId)).toBe('1000');
    const lines = await db.query<
      Array<{ ledger_account_id: string; direction: string; amount_minor: string }>
    >(
      'SELECT ledger_account_id,direction,amount_minor::text FROM ledger_lines WHERE journal_id=$1 ORDER BY ledger_account_id',
      [op.commitment.reservation_journal_id],
    );
    const reversed = await db.query<
      Array<{ ledger_account_id: string; direction: string; amount_minor: string }>
    >(
      'SELECT ledger_account_id,direction,amount_minor::text FROM ledger_lines WHERE journal_id=$1 ORDER BY ledger_account_id',
      [result.journalId],
    );
    expect(reversed).toEqual(
      lines.map((x) => ({ ...x, direction: x.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' })),
    );
    expect(
      await db.query('SELECT reversal_of_journal_id FROM ledger_journals WHERE id=$1', [
        result.journalId,
      ]),
    ).toEqual([{ reversal_of_journal_id: op.commitment.reservation_journal_id }]);
  });
  it('serializes concurrent authorized reservation release and recovers exactly one result', async () => {
    const s = await subject();
    const op = await pending(s);
    verificationState = 'VERIFIED_REJECTED';
    const command = releaseCommand(op);
    const attempts = await Promise.allSettled([
      settlement.releaseReservedWithdrawal(command),
      settlement.releaseReservedWithdrawal(command),
    ]);
    expect(attempts.some((x) => x.status === 'fulfilled')).toBe(true);
    const replay = await settlement.releaseReservedWithdrawal(command);
    expect(replay.replayed).toBe(true);
    expect(
      await db.query('SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1', [
        op.commitment.reservation_journal_id,
      ]),
    ).toEqual([{ id: replay.journalId }]);
    expect(await balance(s.sourceId)).toBe('1000');
  });
  it('preserves a settled commitment despite unknown or rejected outcomes without proof of returned funds', async () => {
    const s = await subject();
    const op = await pending(s);
    const settled = await settlement.settleVerifiedOutcome(settleCommand(op));
    const suspense = await settlement.recordSuspense({
      externalOperationId: op.commitment.external_operation_id,
      expectedVersion: op.version,
      reason: 'MANUAL_REVIEW',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: op.evidence,
      requestContext,
    });
    const command = {
      externalOperationId: op.commitment.external_operation_id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: op.version,
      requestContext,
    };
    for (const state of ['UNKNOWN', 'UNAVAILABLE', 'VERIFIED_REJECTED'] as const) {
      verificationState = state;
      await expect(settlement.recordCompensatingEntry(command)).rejects.toThrow(
        'governed commitment recovery',
      );
    }
    expect((await settlement.getByOperation(op.commitment.external_operation_id))?.status).toBe(
      'POSTED',
    );
    expect(await balance(s.sourceId)).toBe('300');
    expect(
      await db.query('SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1', [
        settled.settlement.journalId,
      ]),
    ).toHaveLength(0);
  });
  it('prevents duplicate reservation reversals and recovers the first authorized release', async () => {
    const s = await subject();
    const op = await pending(s);
    verificationState = 'VERIFIED_REJECTED';
    const command = releaseCommand(op);
    const first = await settlement.releaseReservedWithdrawal(command);
    const replay = await settlement.releaseReservedWithdrawal(command);
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);
    expect(
      await db.query('SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1', [
        op.commitment.reservation_journal_id,
      ]),
    ).toEqual([{ id: first.journalId }]);
    await expect(
      ledger.reverseJournal(op.commitment.reservation_journal_id, randomUUID()),
    ).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('1000');
  });
  it('rejects missing, unverified and fabricated provider evidence without losing the reservation', async () => {
    const s = await subject();
    const op = await pending(s);
    for (const state of ['UNKNOWN', 'UNAVAILABLE', 'VERIFIED_REJECTED'] as const) {
      verificationState = state;
      await expect(settlement.settleVerifiedOutcome(settleCommand(op))).rejects.toThrow();
      expect(await balance(s.sourceId)).toBe('300');
    }
    verificationState = 'VERIFIED_SETTLED';
    verificationHashOverride = createHash('sha256').update('fabricated').digest('hex');
    await expect(settlement.settleVerifiedOutcome(settleCommand(op))).rejects.toThrow();
    verificationHashOverride = null;
    await expect(
      settlement.settleVerifiedOutcome({
        ...settleCommand(op),
        evidence: { ...op.evidence, referenceValue: 'missing-provider-reference' },
      }),
    ).rejects.toThrow();
    const rows = await db.query<Array<{ state: string }>>(
      'SELECT state FROM financial_commitments WHERE id=$1',
      [op.commitment.id],
    );
    expect(rows).toEqual([{ state: 'RESERVED' }]);
    expect(await settlement.getByOperation(op.commitment.external_operation_id)).toBeNull();
    expect((await settlement.settleVerifiedOutcome(settleCommand(op))).settlement.status).toBe(
      'POSTED',
    );
  });

  it('does not settle an actual uncommitted withdrawal operation, even when eligible', async () => {
    const s = await subject();
    const withdrawal = await app.get(WithdrawalService).createWithdrawal({
      walletId: s.walletAccountId,
      ownership: { kind: 'CUSTOMER_SELF', customerId: s.customerId },
      amountMinor: '100',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const operation = await app.get(ExternalOperationService).create({
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      resourceType: ExternalOperationResourceType.WITHDRAWAL,
      resourceId: withdrawal.id,
      internalCommandId: randomUUID(),
      customerId: s.customerId,
      walletAccountId: s.walletAccountId,
      ledgerAccountId: s.sourceId,
      targetMappingReference: `a6-target:${'a'.repeat(64)}`,
      amountMinor: '100',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: randomUUID(),
      requestContext,
    });
    const lifecycle = app.get(ExternalOperationLifecycleService);
    const attempt = await lifecycle.beginAttempt(
      operation.externalOperationId,
      randomUUID(),
      requestContext,
      operation.version,
    );
    const pendingStatus = await lifecycle.transition({
      externalOperationId: operation.externalOperationId,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: randomUUID(),
      requestContext,
      expectedVersion: attempt.version,
    });
    const ref = `test-provider-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({
      externalOperationId: operation.externalOperationId,
      partnerKey: 'NIBSS_NIP',
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue: ref,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    const cmd = {
      externalOperationId: operation.externalOperationId,
      expectedVersion: pendingStatus.version,
      decision: ExternalSettlementDecision.SETTLE,
      evidence: {
        referenceType: 'TRANSACTION' as const,
        referenceValue: ref,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
      requestContext,
    };
    await expect(settlement.settleVerifiedOutcome(cmd)).rejects.toThrow(
      'reserved financial commitment',
    );
    await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [s.customerId]);
    await expect(settlement.settleVerifiedOutcome(cmd)).rejects.toThrow(
      'reserved financial commitment',
    );
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('preserves funds after actual retry exhaustion until independently verified rejection', async () => {
    const s = await subject();
    const op = await pending(s);
    const lifecycle = app.get(ExternalOperationLifecycleService);
    let version = op.version;
    for (let i = 0; i < 2; i++) {
      const attempt = await lifecycle.beginAttempt(
        op.commitment.external_operation_id,
        randomUUID(),
        requestContext,
        version,
      );
      const status = await lifecycle.transition({
        externalOperationId: op.commitment.external_operation_id,
        nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
        idempotencyKey: randomUUID(),
        requestContext,
        expectedVersion: attempt.version,
      });
      version = status.version;
    }
    const exhausted = await lifecycle.beginAttempt(
      op.commitment.external_operation_id,
      randomUUID(),
      requestContext,
      version,
    );
    expect(exhausted.lifecycleState).toBe(ExternalOperationLifecycleState.FAILED);
    expect(exhausted.failureCode).toBe('RETRY_EXHAUSTED');
    op.version = exhausted.version;
    verificationState = 'UNKNOWN';
    await expect(settlement.releaseReservedWithdrawal(releaseCommand(op))).rejects.toThrow();
    expect(await balance(s.sourceId)).toBe('300');
    expect(
      (
        await db.query<Array<{ state: string }>>(
          'SELECT state FROM financial_commitments WHERE id=$1',
          [op.commitment.id],
        )
      )[0]?.state,
    ).toBe('RESERVED');
    verificationState = 'VERIFIED_REJECTED';
    await settlement.releaseReservedWithdrawal(releaseCommand(op));
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('serializes concurrent settlement and rejection release without conflicting journals', async () => {
    const s = await subject();
    const op = await pending(s);
    verificationState = 'RACE';
    const settleContext = { ...requestContext, correlationId: 'settle-race' };
    const releaseContext = { ...requestContext, correlationId: 'release-race' };
    const results = await Promise.allSettled([
      settlement.settleVerifiedOutcome(settleCommand(op, settleContext)),
      settlement.releaseReservedWithdrawal(releaseCommand(op, releaseContext)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const row = (
      await db.query<Array<{ state: string; resolution_journal_id: string }>>(
        'SELECT state,resolution_journal_id FROM financial_commitments WHERE id=$1',
        [op.commitment.id],
      )
    )[0]!;
    expect(['SETTLED', 'RELEASED']).toContain(row.state);
    expect(await balance(s.sourceId)).toBe(row.state === 'SETTLED' ? '300' : '1000');
    const journals = await db.query<Array<{ n: number }>>(
      'SELECT count(*)::int AS n FROM ledger_journals WHERE id=$1',
      [row.resolution_journal_id],
    );
    expect(journals).toEqual([{ n: 1 }]);
  });

  it('honors compliance holds for settlement and release and succeeds after review', async () => {
    const s = await subject();
    const op = await pending(s);
    await db.query(
      `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
      [s.customerId],
    );
    await expect(settlement.settleVerifiedOutcome(settleCommand(op))).rejects.toThrow();
    verificationState = 'VERIFIED_REJECTED';
    await expect(settlement.releaseReservedWithdrawal(releaseCommand(op))).rejects.toThrow(
      'restricted pending compliance review',
    );
    expect(await balance(s.sourceId)).toBe('300');
    await db.query('DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1', [s.customerId]);
    await settlement.releaseReservedWithdrawal(releaseCommand(op));
    expect(await balance(s.sourceId)).toBe('1000');
  });

  it('keeps reserved funds on hold when an identity ownership conflict exists', async () => {
    const s = await subject();
    const other = await subject();
    const op = await pending(s);
    const consent = randomUUID();
    const attempt = randomUUID();
    const claim = randomUUID();
    await db.query(
      `INSERT INTO kyc_consents(id,customer_id,kind,notice_version,actor_id,expires_at)
      VALUES($1,$2,'BVN','test',$2,clock_timestamp()+interval '1 day')`,
      [consent, other.customerId],
    );
    await db.query(
      `INSERT INTO kyc_verification_attempts(id,customer_id,consent_id,request_id,kind,provider,policy_version,request_mac,identity_mac,mac_key_version,outcome,completed_at,expires_at)
      VALUES($1,$2,$3,$4,'BVN','TEST','test',$5,$5,'test','MATCH',clock_timestamp(),clock_timestamp()+interval '1 day')`,
      [attempt, other.customerId, consent, randomUUID(), 'a'.repeat(64)],
    );
    await db.query(
      `INSERT INTO kyc_identity_claims(id,kind,identifier_mac,customer_id,attempt_id,status) VALUES($1,'BVN',$2,$3,$4,'VERIFIED')`,
      [claim, createHash('sha256').update(claim).digest('hex'), other.customerId, attempt],
    );
    await db.query(
      `INSERT INTO kyc_identity_conflicts(id,requester_customer_id,claim_id,claimed_customer_id,kind) VALUES($1,$2,$3,$4,'BVN')`,
      [randomUUID(), s.customerId, claim, other.customerId],
    );
    await expect(settlement.settleVerifiedOutcome(settleCommand(op))).rejects.toThrow();
    verificationState = 'VERIFIED_REJECTED';
    await expect(settlement.releaseReservedWithdrawal(releaseCommand(op))).rejects.toThrow(
      'restricted pending compliance review',
    );
    expect(await balance(s.sourceId)).toBe('300');
    expect(
      (
        await db.query<Array<{ state: string }>>(
          'SELECT state FROM financial_commitments WHERE id=$1',
          [op.commitment.id],
        )
      )[0]?.state,
    ).toBe('RESERVED');
  });

  it('rolls back a settlement interrupted after posting and safely retries', async () => {
    const s = await subject();
    const op = await pending(s);
    const outbox = jest
      .spyOn(app.get(OutboxService), 'enqueue')
      .mockRejectedValueOnce(new Error('injected settlement outbox failure'));
    await expect(settlement.settleVerifiedOutcome(settleCommand(op))).rejects.toThrow(
      'injected settlement outbox failure',
    );
    outbox.mockRestore();
    expect(await settlement.getByOperation(op.commitment.external_operation_id)).toBeNull();
    expect(
      (
        await db.query<Array<{ state: string }>>(
          'SELECT state FROM financial_commitments WHERE id=$1',
          [op.commitment.id],
        )
      )[0]?.state,
    ).toBe('RESERVED');
    const posted = await settlement.settleVerifiedOutcome(settleCommand(op));
    expect(posted.settlement.status).toBe('POSTED');
    expect((await settlement.settleVerifiedOutcome(settleCommand(op))).replayed).toBe(true);
    expect(await balance(s.sourceId)).toBe('300');
  });

  it.each(['SETTLE', 'RELEASE'] as const)(
    'resolves actual limit usage atomically with %s',
    async (outcome) => {
      const s = await subject();
      await configureLimit(s);
      const op = await pending(s);
      if (outcome === 'SETTLE') await settlement.settleVerifiedOutcome(settleCommand(op));
      else {
        verificationState = 'VERIFIED_REJECTED';
        await settlement.releaseReservedWithdrawal(releaseCommand(op));
      }
      const rows = await db.query<Array<{ status: string }>>(
        'SELECT status FROM limit_reservations WHERE principal_id=$1',
        [s.customerId],
      );
      expect(rows).toEqual([{ status: outcome === 'SETTLE' ? 'COMMITTED' : 'RELEASED' }]);
      const usage = await db.query<
        Array<{ reserved_amount_minor: string; used_amount_minor: string }>
      >(
        `SELECT reserved_amount_minor::text, used_amount_minor::text FROM limit_usages WHERE principal_id=$1 AND product='WITHDRAWAL'`,
        [s.customerId],
      );
      expect(usage).toEqual([
        { reserved_amount_minor: '0', used_amount_minor: outcome === 'SETTLE' ? '700' : '0' },
      ]);
    },
  );

  it('blocks generic journal reversal and legacy compensation from bypassing commitment recovery', async () => {
    const s = await subject();
    const op = await pending(s);
    await expect(
      ledger.reverseJournal(op.commitment.reservation_journal_id, randomUUID()),
    ).rejects.toThrow('reserve account is restricted');
    const posted = await settlement.settleVerifiedOutcome(settleCommand(op));
    await expect(ledger.reverseJournal(posted.settlement.journalId!, randomUUID())).rejects.toThrow(
      'reserve account is restricted',
    );
    const suspense = await settlement.recordSuspense({
      externalOperationId: op.commitment.external_operation_id,
      expectedVersion: op.version,
      reason: 'MANUAL_REVIEW',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: op.evidence,
      requestContext,
    });
    await expect(
      settlement.recordCompensatingEntry({
        externalOperationId: op.commitment.external_operation_id,
        settlementId: posted.settlement.settlementId,
        suspenseEntryId: suspense.suspenseId,
        expectedVersion: op.version,
        requestContext,
      }),
    ).rejects.toThrow('governed commitment recovery');
    expect(await balance(s.sourceId)).toBe('300');
  });

  it('does not permit generic maker-checker approval to reverse a genuine committed outbound settlement', async () => {
    const s = await subject();
    const op = await pending(s);
    const settled = await settlement.settleVerifiedOutcome(settleCommand(op));
    const journalId = settled.settlement.journalId!;
    const provision = async (roleKey: string) => {
      const principalId = `a6-commitment-recovery-test:${roleKey}:${randomUUID()}`;
      const now = new Date();
      await db
        .getRepository(A2FinanceRoleAssignment)
        .save({
          id: randomUUID(),
          assignmentReference: `a6-commitment-test:${principalId}`,
          assignmentVersion: 1,
          principalId,
          roleKey,
          scopes: [],
          status: 'ACTIVE',
          initiatedScope: 'SUPER_ADMIN_SCOPE',
          interim: true,
          effectiveFrom: new Date(now.getTime() - 60000),
          effectiveTo: new Date(now.getTime() + 3600000),
          assignedBy: 'test-harness',
          assignedAt: now,
          revokedBy: null,
          revokedAt: null,
          bootstrapReference: null,
          approvalIds: [],
          auditReferences: [],
        } as DeepPartial<A2FinanceRoleAssignment>);
      const session = await app
        .get(A2WorkforceSessionService)
        .establish({
          issuer: 'https://local-dev-identity.monienaija.invalid',
          subject: principalId,
          principalId,
          audience: ['workforce-admin'],
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 3600000).toISOString(),
          authenticatedAt: now.toISOString(),
          assuranceLevel: 'MFA',
          amr: ['pwd', 'otp'],
          acr: null,
          signingKeyId: 'test-harness-key',
        });
      return session.accessToken;
    };
    const maker = await provision('FINANCE_PREPARER');
    const checker = await provision('FINANCE_CONTROLLER');
    const reason = 'Controlled settlement recovery test';
    const created = await request(app.getHttpServer())
      .post(`/api/v1/ledger/journals/${journalId}/reversal-request`)
      .set('Authorization', `Bearer ${maker}`)
      .send({ reason });
    expect(created.status).toBe(201);
    const approvalId = (created.body as { approvalId: string }).approvalId;
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set('Authorization', `Bearer ${checker}`)
      .send({ comment: 'controlled test' });
    expect(approved.status).toBe(201);
    const reversal = await request(app.getHttpServer())
      .post(`/api/v1/ledger/journals/${journalId}/reversal`)
      .set('Authorization', `Bearer ${checker}`)
      .send({ reason, approvalId, idempotencyKey: 'blocked-commitment-reversal' });
    expect(reversal.status).toBe(409);
    expect((reversal.body as { message: string }).message).toContain(
      'reserve account is restricted',
    );
    expect(
      await db.query('SELECT status FROM privileged_action_approvals WHERE id=$1', [approvalId]),
    ).toEqual([{ status: 'APPROVED' }]);
    expect(
      await db.query('SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1', [journalId]),
    ).toHaveLength(0);
    expect((await settlement.getByOperation(op.commitment.external_operation_id))?.status).toBe(
      'POSTED',
    );
    expect(await balance(s.sourceId)).toBe('300');
  });
  it('cannot bypass reserved recovery via generic rejection', async () => {
    const s = await subject();
    const op = await pending(s);
    await expect(
      settlement.settleVerifiedOutcome({
        ...settleCommand(op),
        decision: ExternalSettlementDecision.REJECT,
      }),
    ).rejects.toThrow('independently verified rejection');
    expect(await settlement.getByOperation(op.commitment.external_operation_id)).toBeNull();
    expect(await balance(s.sourceId)).toBe('300');
    verificationState = 'VERIFIED_REJECTED';
    await settlement.releaseReservedWithdrawal(releaseCommand(op));
    expect(await balance(s.sourceId)).toBe('1000');
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
    await configureLimit(s);
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
      app.get(LimitReservationRecoveryService).releaseManually({
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
