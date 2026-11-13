import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { OutboxService } from '../operations/outbox.service';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { SettlementAccountRole } from '../payment/payment.enums';
import { isRetryableTransactionError } from '../payment/payment-support';
import { WalletFinancialBoundaryService } from '../wallet/wallet-financial-boundary.service';
import { INBOUND_FUNDING_VERIFIER, type InboundFundingVerifier } from './inbound-funding-verifier';
import {
  INBOUND_INSTITUTION_AUTHORITY,
  type InboundInstitutionAuthority,
} from './inbound-institution-authority';
import { INBOUND_SUSPENSE_POLICY, type InboundSuspensePolicy } from './inbound-suspense-policy';

export type InboundFundingResult =
  | { status: 'CREDITED' | 'SUSPENSE'; receiptId: string; journalId: string; replayed: boolean }
  | { status: 'REVIEW'; reason: 'OUTCOME_UNKNOWN' | 'EVIDENCE_CONFLICT'; replayed: boolean };

/** Internal verified inbound boundary. No HTTP entry point or live provider is supplied. */
@Injectable()
export class InboundFundingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly boundary: WalletFinancialBoundaryService,
    private readonly accounts: SettlementAccountService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(INBOUND_FUNDING_VERIFIER) private readonly verifier: InboundFundingVerifier,
    @Inject(INBOUND_INSTITUTION_AUTHORITY)
    private readonly institution: InboundInstitutionAuthority,
    @Inject(INBOUND_SUSPENSE_POLICY) private readonly suspensePolicy: InboundSuspensePolicy,
  ) {}

  /** Standalone intake; product lifecycle callers must use the transaction-bound method. */
  async receive(input: {
    providerKey: string;
    providerReference: string;
    correlationId: string;
  }): Promise<InboundFundingResult> {
    for (let i = 0; i < 3; i++) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.processInTransaction(manager, input),
        );
      } catch (error) {
        if (!isRetryableTransactionError(error) || i === 2) throw error;
      }
    }
    throw new ConflictException('Inbound funding could not be completed');
  }

  /** Caller supplies its existing transaction and authoritative product binding; the caller
   * must commit its lifecycle effect in that same transaction. This method does not itself
   * authenticate the caller or establish a product lifecycle. */
  async receiveInTransaction(
    manager: EntityManager,
    input: {
      providerKey: string;
      providerReference: string;
      correlationId: string;
      expectedWalletAccountId: string;
      expectedAmountMinor: string;
      expectedCurrency: string;
    },
  ): Promise<InboundFundingResult> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new ConflictException('Inbound funding requires an active serializable transaction');
    const isolation = await manager.query<Array<{ transaction_isolation: string }>>(
      'SHOW transaction_isolation',
    );
    if (isolation[0]?.transaction_isolation !== 'serializable')
      throw new ConflictException('Inbound funding requires an active serializable transaction');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.expectedWalletAccountId ?? '',
      )
    )
      throw new BadRequestException('Expected wallet must be a UUID');
    const expected = {
      walletAccountId: input.expectedWalletAccountId.toLowerCase(),
      amountMinor: parsePositiveMinorUnits(input.expectedAmountMinor).toString(),
      currency: normalizeCurrency(input.expectedCurrency),
    };
    return this.processInTransaction(manager, input, expected);
  }

  private async processInTransaction(
    manager: EntityManager,
    input: { providerKey: string; providerReference: string; correlationId: string },
    expected?: { walletAccountId: string; amountMinor: string; currency: string },
  ): Promise<InboundFundingResult> {
    const providerKey = (input.providerKey ?? '').trim().toUpperCase();
    const providerReference = (input.providerReference ?? '').trim();
    const correlationId = (input.correlationId ?? '').trim();
    if (
      !/^[A-Z0-9_.:-]{2,80}$/.test(providerKey) ||
      !/^[\x21-\x7e]{1,160}$/.test(providerReference) ||
      !/^[\x20-\x7e]{1,160}$/.test(correlationId)
    )
      throw new BadRequestException('Invalid inbound evidence request');
    let verification;
    try {
      verification = await this.verifier.verify({ providerKey, providerReference });
    } catch {
      throw new ServiceUnavailableException('Inbound provider verification is unavailable');
    }
    if (verification.state === 'UNAVAILABLE')
      throw new ServiceUnavailableException('Inbound provider verification is unavailable');
    const referenceHash = this.hash(providerReference);
    if (verification.state === 'UNKNOWN') {
      return this.recordReview(
        manager,
        providerKey,
        referenceHash,
        this.hash('unknown'),
        'OUTCOME_UNKNOWN',
        correlationId,
      );
    }
    if (
      verification.providerKey !== providerKey ||
      verification.providerReference !== providerReference ||
      !/^[A-Z0-9]{3,20}$/.test(verification.bankCode) ||
      !/^\d{4,32}$/.test(verification.accountNumber) ||
      !Number.isFinite(Date.parse(verification.observedAt))
    )
      throw new ConflictException('Verified inbound evidence does not match the requested payment');
    const currency = normalizeCurrency(verification.currency);
    if (currency !== 'NGN') throw new ConflictException('Inbound currency is not supported');
    const amountMinor = parsePositiveMinorUnits(verification.amountMinor).toString();
    const evidenceHash = this.hash(
      JSON.stringify({
        providerKey,
        referenceHash,
        bankCode: verification.bankCode,
        accountNumber: verification.accountNumber,
        amountMinor,
        currency,
      }),
    );
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `inbound:${providerKey}:${referenceHash}`,
    ]);
    const receipts = await manager.query<
      Array<{
        id: string;
        journal_id: string;
        status: 'CREDITED' | 'SUSPENSE';
        evidence_hash: string;
        wallet_account_id: string | null;
      }>
    >(
      'SELECT id,journal_id,status,evidence_hash,wallet_account_id FROM inbound_funding_receipts WHERE provider_key=$1 AND provider_reference_hash=$2 FOR UPDATE',
      [providerKey, referenceHash],
    );
    const existing = receipts[0];
    if (existing) {
      if (
        existing.evidence_hash !== evidenceHash ||
        (expected &&
          (expected.amountMinor !== amountMinor ||
            expected.currency !== currency ||
            existing.wallet_account_id !== expected.walletAccountId))
      )
        return this.recordReview(
          manager,
          providerKey,
          referenceHash,
          evidenceHash,
          'EVIDENCE_CONFLICT',
          correlationId,
        );
      return {
        status: existing.status,
        receiptId: existing.id,
        journalId: existing.journal_id,
        replayed: true,
      };
    }
    const destinations = await manager.query<
      Array<{
        virtual_id: string;
        wallet_id: string;
        ledger_id: string;
        customer_id: string;
        wallet_status: string;
        wallet_currency: string;
        virtual_status: string;
      }>
    >(
      `SELECT v.id AS virtual_id,w.id AS wallet_id,w.ledger_account_id AS ledger_id,w.customer_id,
                    w.status AS wallet_status,w.currency AS wallet_currency,v.status AS virtual_status
             FROM virtual_accounts v JOIN wallet_accounts w ON w.id=v.wallet_id
             WHERE v.provider=$1 AND v.bank_code=$2 AND v.account_number=$3 FOR UPDATE OF v,w`,
      [providerKey, verification.bankCode, verification.accountNumber],
    );
    const destination = destinations[0];
    if (
      expected &&
      (expected.amountMinor !== amountMinor ||
        expected.currency !== currency ||
        destinations.length !== 1 ||
        destination?.wallet_id !== expected.walletAccountId)
    ) {
      return this.recordReview(
        manager,
        providerKey,
        referenceHash,
        evidenceHash,
        'EVIDENCE_CONFLICT',
        correlationId,
      );
    }
    let authorization;
    try {
      authorization = await this.institution.authorize(manager, {
        providerKey,
        bankCode: verification.bankCode,
        accountNumber: verification.accountNumber,
        currency,
        amountMinor,
        providerReferenceHash: referenceHash,
        virtualAccountId: destination?.virtual_id ?? null,
        walletAccountId: destination?.wallet_id ?? null,
      });
    } catch {
      throw new ServiceUnavailableException('Inbound institutional authority is unavailable');
    }
    if (authorization === 'UNAVAILABLE')
      throw new ServiceUnavailableException('Inbound institutional authority is unavailable');
    if (authorization !== 'AUTHORIZED')
      throw new ConflictException('Inbound institution does not authorize this payment');
    let eligible = false;
    if (
      destinations.length === 1 &&
      destination &&
      destination.virtual_status === 'ACTIVE' &&
      destination.wallet_status === 'ACTIVE' &&
      destination.wallet_currency === currency
    ) {
      try {
        await this.boundary.requireCustomerWallet(
          manager,
          destination.customer_id,
          destination.wallet_id,
          destination.ledger_id,
        );
        eligible = true;
      } catch (error) {
        // A confirmed receipt remains accounted for even if customer eligibility or its
        // trusted dependencies are unavailable. Unexpected failures still roll back.
        if (
          !(error instanceof ConflictException) &&
          !(error instanceof ServiceUnavailableException)
        )
          throw error;
      }
    }
    if (!eligible) {
      let policy;
      try {
        policy = await this.suspensePolicy.authorize(manager, {
          providerKey,
          providerReferenceHash: referenceHash,
          amountMinor,
          currency,
          virtualAccountId: destination?.virtual_id ?? null,
          walletAccountId: destination?.wallet_id ?? null,
        });
      } catch {
        throw new ServiceUnavailableException('Inbound suspense policy is unavailable');
      }
      if (policy === 'UNAVAILABLE')
        throw new ServiceUnavailableException('Inbound suspense policy is unavailable');
      if (policy !== 'AUTHORIZED')
        throw new ConflictException('Inbound suspense policy does not authorize this payment');
    }
    const asset = await this.accounts.getAccountId(
      manager,
      currency,
      SettlementAccountRole.SETTLEMENT_ASSET,
    );
    const credit = eligible
      ? destination!.ledger_id
      : await this.accounts.getAccountId(manager, currency, SettlementAccountRole.SYSTEM_SUSPENSE);
    const id = randomUUID();
    const status = eligible ? ('CREDITED' as const) : ('SUSPENSE' as const);
    const journalId = await this.ledger.postJournalInTransaction(manager, {
      idempotencyKey: `inbound:${this.hash(`${providerKey}:${referenceHash}`)}`,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: id,
      description: eligible
        ? 'Verified inbound funding'
        : 'Verified inbound funding pending review',
      correlationId,
      metadata: {
        inboundReceiptId: id,
        providerKey,
        providerReferenceHash: referenceHash,
        evidenceHash,
        status,
      },
      lines: [
        { accountId: asset, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: credit, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
    await manager.query(
      `INSERT INTO inbound_funding_receipts
            (id,provider_key,provider_reference_hash,evidence_hash,virtual_account_id,wallet_account_id,amount_minor,currency,status,
             asset_account_id,credit_account_id,journal_id,provider_observed_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        providerKey,
        referenceHash,
        evidenceHash,
        destination?.virtual_id ?? null,
        destination?.wallet_id ?? null,
        amountMinor,
        currency,
        status,
        asset,
        credit,
        journalId,
        verification.observedAt,
      ],
    );
    await this.audit.record(manager, {
      entityType: 'INBOUND_FUNDING_RECEIPT',
      entityId: id,
      action: status,
      actor: 'internal-inbound-funding',
      correlationId,
      newValues: {
        providerKey,
        providerReferenceHash: referenceHash,
        evidenceHash,
        amountMinor,
        currency,
        status,
        journalId,
      },
    });
    await this.outbox.enqueue(manager, {
      eventType: `INBOUND_FUNDING_${status}`,
      aggregateType: 'INBOUND_FUNDING_RECEIPT',
      aggregateId: id,
      eventKey: `inbound-funding:${id}`,
      correlationId,
      payload: { receiptId: id, journalId, amountMinor, currency, status },
    });
    return { status, receiptId: id, journalId, replayed: false };
  }

  private async recordReview(
    manager: EntityManager,
    providerKey: string,
    referenceHash: string,
    evidenceHash: string,
    reason: 'OUTCOME_UNKNOWN' | 'EVIDENCE_CONFLICT',
    correlationId: string,
  ): Promise<InboundFundingResult> {
    const rows = await manager.query<Array<{ id: string }>>(
      `INSERT INTO inbound_funding_reviews(id,provider_key,provider_reference_hash,evidence_hash,reason)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider_key,provider_reference_hash,evidence_hash,reason) DO NOTHING RETURNING id`,
      [randomUUID(), providerKey, referenceHash, evidenceHash, reason],
    );
    if (rows[0])
      await this.audit.record(manager, {
        entityType: 'INBOUND_FUNDING_REVIEW',
        entityId: rows[0].id,
        action: reason,
        actor: 'internal-inbound-funding',
        correlationId,
        newValues: { providerKey, providerReferenceHash: referenceHash, evidenceHash, reason },
      });
    return { status: 'REVIEW', reason, replayed: !rows.length };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
