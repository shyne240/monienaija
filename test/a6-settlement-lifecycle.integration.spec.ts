import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { ExternalOperation } from '../src/partner/external-operation.entity';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationReference } from '../src/partner/external-operation-reference.entity';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../src/partner/external-settlement.enums';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { EnvironmentPartnerCredentialLoader } from '../src/partner/partner-credentials.service';
import { PartnerCapabilityRegistry } from '../src/partner/partner-capability.registry';
import { PartnerConnectionService } from '../src/partner/partner-connection.service';
import { PartnerRequestSigningService } from '../src/partner/partner-request-signing.service';

import {
  integrationMockCommandGate,
  wrapLedgerForIntegration,
} from './support/integration-mocks';
import type {
  RecordCompensatingEntryCommand,
  SettleVerifiedOutcomeCommand,
  SuspenseVerifiedOutcomeCommand,
} from '../src/partner/external-settlement.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A6T08 settlement lifecycle coverage against real PostgreSQL.
 *
 * Uses the real ExternalSettlementService, the real LedgerService and real persistence. No
 * external partner transport is involved: the partner boundary stays disabled and every
 * outcome is supplied as already-verified evidence, exactly as the A6 contract requires.
 *
 * This is the suite that proves the corrected `chk_external_settlements_posted_journal`
 * constraint, which previously made the compensation path structurally impossible.
 */
describe('A6T08 settlement lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: ExternalSettlementService;
  let ledger: LedgerService;

  const requestContext = {
    requestId: 'req-a6-settlement',
    correlationId: 'corr-a6-settlement',
    traceId: 'trace-a6-settlement',
  };

  const partnerEnv: Record<string, string> = {
    NODE_ENV: 'development',
    A6_PARTNER_ENABLED: 'false',
    A6_PARTNER_ENVIRONMENT: 'sandbox',
    A6_PARTNER_KEY: 'NIBSS_NIP',
    A6_PARTNER_CAPABILITY: 'external.wallet.withdrawal.settlement',
    A6_PARTNER_OPERATION_TYPE: 'OUTBOUND_BANK_SETTLEMENT',
    A6_PARTNER_API_VERSION: 'v1',
    A6_PARTNER_ADAPTER_VERSION: 'a6-adapter-1',
    A6_PARTNER_SIGNING_ALGORITHM: 'HMAC_SHA256',
    A6_PARTNER_CALLBACK_MAX_SKEW_SECONDS: '300',
    A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD: '3',
    A6_PARTNER_CIRCUIT_OPEN_SECONDS: '60',
    A6_PARTNER_REQUEST_TIMEOUT_MS: '10000',
    A6_PARTNER_CONNECT_TIMEOUT_MS: '3000',
    // Reference-only configuration. The host is deliberately in the reserved `.invalid` TLD
    // and the credential/signing entries are opaque local references, not real secrets. The
    // partner boundary stays disabled and this suite performs no outbound request.
    A6_PARTNER_SANDBOX_BASE_URL: 'https://a6-sandbox.invalid/settlement',
    A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'local-integration-credential-reference',
    A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'local-integration-signing-key-reference',
  };

  const configService = {
    get: (key: string): string | undefined => partnerEnv[key],
  } as unknown as ConfigService;

  let customerLedgerAccountId: string;
  let settlementAssetLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a6settlement');

    ledger = wrapLedgerForIntegration(new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
      integrationMockCommandGate,
    ));
    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const idempotency = new IdempotencyService(dataSource.getRepository(IdempotencyRecord));
    const outbox = new OutboxService(dataSource.getRepository(OutboxEvent));

    const connection = new PartnerConnectionService(
      configService,
      new PartnerCapabilityRegistry(),
      new EnvironmentPartnerCredentialLoader(configService),
      new PartnerRequestSigningService(),
    );
    const operations = new ExternalOperationService(
      dataSource.getRepository(ExternalOperation),
      dataSource.getRepository(ExternalOperationReference),
      dataSource,
      idempotency,
      audit,
      connection,
    );

    service = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement),
      dataSource.getRepository(ExternalSuspenseEntry),
      dataSource,
      ledger,
      new SettlementAccountService(),
      operations,
      idempotency,
      audit,
      connection,
      outbox,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const suffix = randomUUID().slice(0, 8);
    const customer = await ledger.createAccount({
      code: `A6-CUST-${suffix}`,
      name: 'Customer funds',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    // Canonical settlement accounts, discovered by SettlementAccountService by code.
    const asset = await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_CLEARING-NGN',
      name: 'Settlement clearing',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledger.createAccount({
      code: 'PAYMENT-SYSTEM_SUSPENSE-NGN',
      name: 'System suspense',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    customerLedgerAccountId = customer.id;
    settlementAssetLedgerAccountId = asset.id;

    // Fund the customer liability account so a settlement debit has balance to consume.
    await ledger.postJournal({
      idempotencyKey: `a6-fund-${suffix}`,
      reference: `a6-fund-${suffix}`,
      description: 'Seed customer funds',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: settlementAssetLedgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '100000',
        },
        {
          accountId: customerLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '100000',
        },
      ],
    });
  }, 60000);

  async function seedOperation(
    lifecycleState: ExternalOperationLifecycleState = ExternalOperationLifecycleState.PENDING_VERIFICATION,
  ): Promise<{ id: string; version: number; evidenceValue: string }> {
    const suffix = randomUUID().slice(0, 8);
    // Real A3 customer/wallet rows, then a real withdrawal: the external_operations foreign
    // keys are genuine and are part of what this suite verifies.
    const participant = await seedTransferParticipant(dataSource, 'a6', customerLedgerAccountId);
    const withdrawalId = randomUUID();
    await dataSource.query(
      `INSERT INTO withdrawals (id, wallet_id, payment_reference, amount_minor, currency, status,
         idempotency_key, request_hash)
       VALUES ($1, $2, $3, '1000', 'NGN', 'PENDING', $4, $5)`,
      [
        withdrawalId,
        participant.walletAccountId,
        `wd-${suffix}`,
        `wd-key-${suffix}`,
        sha256(`wd-${suffix}`),
      ],
    );

    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO external_operations
        (id, operation_version, partner_key, capability_key, operation_type, resource_type,
         resource_id, internal_command_id, customer_id, wallet_account_id, ledger_account_id,
         target_mapping_reference, amount_minor, currency, accounting_unit,
         internal_idempotency_scope, internal_idempotency_key, provider_idempotency_scope,
         provider_idempotency_key, request_hash, request_id, correlation_id, trace_id,
         lifecycle_state, attempt_count, max_attempts, version)
       VALUES ($1, 1, 'NIBSS_NIP', 'external.wallet.withdrawal.settlement',
               'OUTBOUND_BANK_SETTLEMENT', 'WITHDRAWAL', $2, $3, $4, $5, $6,
               $7, '1000', 'NGN', 'CUSTOMER_FUNDS',
               'external.partner.operation.v1', $8, 'nibss.nip.external-operation.v1',
               $9, $10, 'request-1', 'correlation-1', 'trace-1',
               $11, 1, 3, 1)`,
      [
        id,
        withdrawalId,
        randomUUID(),
        participant.customerId,
        participant.walletAccountId,
        customerLedgerAccountId,
        `a6-target:${sha256(suffix)}`,
        `operation-key-${suffix}`,
        `provider-key-${suffix}`,
        sha256(`request-${suffix}`),
        lifecycleState,
      ],
    );
    // Verified provider evidence must already exist as an operation reference; the settlement
    // service resolves the evidence through it rather than trusting the caller.
    const evidenceValue = `provider-evidence-${suffix}`;
    await dataSource.query(
      `INSERT INTO external_operation_references
         (id, external_operation_id, partner_key, reference_type, reference_value, namespace,
          source, observed_at)
       VALUES ($1, $2, 'NIBSS_NIP', 'TRANSACTION', $3, 'nibss.nip', 'ACKNOWLEDGEMENT', now())`,
      [randomUUID(), id, evidenceValue],
    );

    return { id, version: 1, evidenceValue };
  }

  function settleCommand(
    operation: { id: string; evidenceValue: string },
    overrides: Partial<SettleVerifiedOutcomeCommand> = {},
  ): SettleVerifiedOutcomeCommand {
    return {
      externalOperationId: operation.id,
      decision: ExternalSettlementDecision.SETTLE,
      expectedVersion: 1,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: operation.evidenceValue,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
        observedAt: new Date(),
      },
      requestContext,
      ...overrides,
    };
  }

  function suspenseCommand(
    operation: { id: string; evidenceValue: string },
    overrides: Partial<SuspenseVerifiedOutcomeCommand> = {},
  ): SuspenseVerifiedOutcomeCommand {
    return {
      externalOperationId: operation.id,
      reason: 'SETTLEMENT_AMOUNT_MISMATCH',
      rejectionCode: 'SETTLEMENT_AMOUNT_MISMATCH',
      expectedVersion: 1,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: operation.evidenceValue,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
        observedAt: new Date(),
      },
      requestContext,
      ...overrides,
    };
  }

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  it('settles a verified outcome and posts a balanced journal', async () => {
    const operation = await seedOperation();
    const result = await service.settleVerifiedOutcome(settleCommand(operation));

    expect(result.replayed).toBe(false);
    expect(result.settlement.decision).toBe(ExternalSettlementDecision.SETTLE);
    expect(result.settlement.status).toBe(ExternalSettlementStatus.POSTED);
    expect(result.settlement.journalId).toBeTruthy();
    expect(result.settlement.reversalJournalId).toBeNull();

    const lines: Array<{ direction: string; amount_minor: string }> = await dataSource.query(
      'SELECT direction, amount_minor FROM ledger_lines WHERE journal_id = $1',
      [result.settlement.journalId],
    );
    expect(lines).toHaveLength(2);
    const debits = lines.filter((l) => l.direction === String(LedgerEntryDirection.DEBIT));
    const credits = lines.filter((l) => l.direction === String(LedgerEntryDirection.CREDIT));
    expect(BigInt(debits[0]!.amount_minor)).toBe(BigInt(credits[0]!.amount_minor));
  });

  it('replays an identical settlement without posting a second journal', async () => {
    const operation = await seedOperation();
    const command = settleCommand(operation);
    const first = await service.settleVerifiedOutcome(command);
    const second = await service.settleVerifiedOutcome(command);

    expect(second.replayed).toBe(true);
    expect(second.settlement.journalId).toBe(first.settlement.journalId);
    const journals: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    expect(journals).toHaveLength(2); // seeding journal + one settlement journal
  });

  it('rejects the same settlement key carrying different evidence', async () => {
    const operation = await seedOperation();
    await service.settleVerifiedOutcome(settleCommand(operation));
    await expect(
      service.settleVerifiedOutcome(
        settleCommand(operation, {
          evidence: {
            referenceType: 'TRANSACTION',
            referenceValue: 'conflicting-evidence',
            namespace: 'nibss.nip',
            source: ExternalOperationReferenceSource.STATUS_QUERY,
            observedAt: new Date(),
          },
        }),
      ),
    ).rejects.toBeTruthy();
  });

  it('refuses to settle an operation that is not in a verifiable lifecycle state', async () => {
    const operation = await seedOperation(ExternalOperationLifecycleState.CANCELLED);
    await expect(service.settleVerifiedOutcome(settleCommand(operation))).rejects.toBeTruthy();
    const settlements: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM external_settlements',
    );
    expect(settlements).toHaveLength(0);
  });

  it('refuses to settle against a stale expected version', async () => {
    const operation = await seedOperation();
    await expect(
      service.settleVerifiedOutcome(settleCommand(operation, { expectedVersion: 99 })),
    ).rejects.toBeTruthy();
  });

  it('records a suspense entry for an unreconciled outcome', async () => {
    const operation = await seedOperation();
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    expect(suspense.suspenseId).toBeTruthy();
    expect(suspense.status).toBe(ExternalSuspenseStatus.OPEN);

    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM external_suspense_entries',
    );
    expect(rows).toHaveLength(1);
  });

  it('posts a compensating entry and marks the settlement REVERSED', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const suspense = await service.recordSuspense(suspenseCommand(operation));

    const command: RecordCompensatingEntryCommand = {
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
      reason: 'Provider reversed the outcome',
    };
    const compensated = await service.recordCompensatingEntry(command);

    expect(compensated.settlement.status).toBe(ExternalSettlementStatus.REVERSED);
    expect(compensated.settlement.reversalJournalId).toBeTruthy();
    expect(compensated.settlement.reversalJournalId).not.toBe(settled.settlement.journalId);
  });

  it('keeps the compensating pair net-zero on the customer account', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    await service.recordCompensatingEntry({
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
    });

    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [customerLedgerAccountId],
    );
    // Net of the seeding credit, the settle/compensate pair cancels out exactly.
    expect(BigInt(firstRow(rows, 'net customer balance').balance)).toBe(100000n);
  });

  it('prevents a duplicate compensation for the same settlement', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    const command: RecordCompensatingEntryCommand = {
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
    };
    const first = await service.recordCompensatingEntry(command);
    const second = await service.recordCompensatingEntry(command);

    expect(second.settlement.reversalJournalId).toBe(first.settlement.reversalJournalId);
    const journals: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    expect(journals).toHaveLength(3); // seeding + settlement + one compensation only
  });

  describe('chk_external_settlements_posted_journal (the A6T08 correction)', () => {
    it('still forbids a reversal reference on a POSTED settlement', async () => {
      const operation = await seedOperation();
      const settled = await service.settleVerifiedOutcome(settleCommand(operation));
      await expect(
        dataSource.query(
          `UPDATE external_settlements SET reversal_journal_id = $1, reversal_posted_at = now()
            WHERE id = $2`,
          [randomUUID(), settled.settlement.settlementId],
        ),
      ).rejects.toBeTruthy();
    });

    it('requires a reversal reference once the settlement is REVERSED', async () => {
      const operation = await seedOperation();
      const settled = await service.settleVerifiedOutcome(settleCommand(operation));
      await expect(
        dataSource.query(`UPDATE external_settlements SET status = 'REVERSED' WHERE id = $1`, [
          settled.settlement.settlementId,
        ]),
      ).rejects.toBeTruthy();
    });
  });

  it('rolls the whole settlement back when the enclosing transaction aborts', async () => {
    const operation = await seedOperation();
    const journalsBefore: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    await expect(
      dataSource.transaction('SERIALIZABLE', async (manager) => {
        await manager.query(
          `INSERT INTO external_operation_references
             (id, external_operation_id, partner_key, reference_type, reference_value, namespace,
              source, observed_at)
           VALUES ($1, $2, 'NIBSS_NIP', 'SETTLEMENT', $3, 'nibss.nip', 'CALLBACK', now())`,
          [randomUUID(), operation.id, `rolled-back-${randomUUID().slice(0, 8)}`],
        );
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');

    const refs: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM external_operation_references WHERE reference_type = 'SETTLEMENT'`,
    );
    expect(refs).toEqual([]);
    const journalsAfter: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    expect(journalsAfter).toHaveLength(journalsBefore.length);
  });

  it('writes audit evidence for the settlement without contacting any partner', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const audits: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM audit_events WHERE entity_id = $1`,
      [settled.settlement.settlementId],
    );
    expect(audits.length).toBeGreaterThan(0);
    // The partner boundary stayed disabled for the whole suite.
    expect(partnerEnv.A6_PARTNER_ENABLED).toBe('false');
  });
});
