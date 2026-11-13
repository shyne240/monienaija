import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
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
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    ledger = app.get(LedgerService);
    repository = new FinancialCommitmentRepository();
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
    await db.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status)
      VALUES($1,'FCBANK','Financial Commitment Test Bank','FC Bank',true,'ACTIVE')`,
      [randomUUID()],
    );
  }, 180000);
  beforeEach(() => {
    verificationState = 'VERIFIED_SETTLED';
    verificationHashOverride = null;
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
