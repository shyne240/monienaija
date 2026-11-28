import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import type { Environment } from '../config/environment';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { LimitEnforcementService } from '../limit-catalog/limit-enforcement.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { OutboxService } from '../operations/outbox.service';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { SettlementAccountRole } from '../payment/payment.enums';
import { isRetryableTransactionError } from '../payment/payment-support';
import { WalletFinancialBoundaryService } from '../wallet/wallet-financial-boundary.service';

import type { InboundPaymentVerificationResult } from './banking-provider.types';
import { BankingInboundService } from './banking-inbound.service';
import { BankingProviderRegistry } from './banking-provider.registry';
import {
  BankToWalletExceptionService,
  type BankToWalletExceptionReason,
} from './bank-to-wallet-exception.service';

/** The one product code used for governed Bank → Wallet charges. No rate lives in code. */
const PRODUCT_CODE = 'BANK_TO_WALLET';
const PROVIDER_KEY = 'MONNIFY';
const REFERENCE_PATTERN = /^B2W-[0-9A-F]{32}$/;

export interface BankToWalletIntakeInput {
  institutionId: string;
  providerKey?: string;
  environment: 'sandbox' | 'production';
  providerTransactionReference: string;
  providerPaymentReference?: string | null;
  reservationId?: string | null;
  receivingAccountNumber?: string | null;
  receivingBankCode?: string | null;
  currency: string;
  grossAmountMinor: string;
  providerFeeMinor?: string;
  paidAt?: string | null;
}

export type BankToWalletOutcome =
  | {
      status: 'CREDITED';
      businessReference: string;
      journalId: string;
      amountMinor: string;
      replayed: boolean;
    }
  | {
      status: 'EXCEPTION';
      businessReference: string;
      exceptionId: string;
      reason: BankToWalletExceptionReason;
      permittedNextAction: string;
      replayed: boolean;
    }
  | { status: 'NOT_FOUND'; businessReference?: string }
  | { status: 'DISABLED' };

interface InboundRow {
  id: string;
  business_reference: string | null;
  institution_id: string;
  environment: string;
  provider_transaction_reference: string;
  provider_payment_reference: string | null;
  receiving_account_number: string | null;
  receiving_bank_code: string | null;
  currency: string;
  gross_amount_minor: string;
  provider_fee_minor: string;
  credited_amount_minor: string;
  settlement_amount_minor: string | null;
  verification_state: string;
  resolution_state: string;
  wallet_id: string | null;
}

interface DestinationRow {
  virtual_id: string;
  wallet_id: string;
  ledger_id: string;
  customer_id: string;
  institution_id: string | null;
  account_number: string;
  account_reference: string | null;
  wallet_status: string;
  wallet_currency: string;
  virtual_status: string;
}

/**
 * Bank → Wallet journey orchestration.
 *
 * Provider-specific details (reserved-account issuance, webhook signature, verification call,
 * settlement figures) stay behind the registered provider adapter. This service owns only the
 * platform invariants: one durable business reference, one correct wallet, one ledger credit,
 * provider deductions kept apart from platform charges, and a traceable exception when a verified
 * payment cannot be credited.
 *
 * Live enablement is an explicit, separate gate. Without BANK_TO_WALLET_ENABLED=true this service
 * refuses every operation, and production is refused unconditionally in this PR.
 */
@Injectable()
export class BankToWalletService {
  private readonly logger = new Logger(BankToWalletService.name);

  constructor(
    private readonly db: DataSource,
    private readonly inbound: BankingInboundService,
    private readonly registry: BankingProviderRegistry,
    private readonly exceptions: BankToWalletExceptionService,
    private readonly feeResolver: FeeRuleResolverService,
    private readonly feeCalculator: FeeRuleCalculatorService,
    private readonly limits: LimitEnforcementService,
    private readonly boundary: WalletFinancialBoundaryService,
    private readonly ledger: LedgerService,
    private readonly settlementAccounts: SettlementAccountService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  /** Stable reference derived from the provider's own identity and the receiving account. */
  businessReferenceFor(input: {
    providerKey: string;
    environment: string;
    providerTransactionReference: string;
    institutionId?: string | null;
    receivingAccountNumber?: string | null;
  }): string {
    const material = [
      input.providerKey.trim().toUpperCase(),
      input.environment.trim().toLowerCase(),
      input.providerTransactionReference.trim(),
      input.institutionId?.trim().toLowerCase() ?? 'UNATTRIBUTED',
      input.receivingAccountNumber?.trim() ?? 'UNKNOWN_ACCOUNT',
    ].join('|');
    return `B2W-${createHash('sha256').update(material).digest('hex').slice(0, 32).toUpperCase()}`;
  }

  /** Called by the verified webhook ingress. Records an unverified claim; never credits. */
  async intake(input: BankToWalletIntakeInput): Promise<{
    id: string;
    businessReference: string;
    alreadyRecorded: boolean;
  }> {
    const providerKey = (input.providerKey ?? PROVIDER_KEY).trim().toUpperCase();
    const reference = input.providerTransactionReference.trim();
    if (!reference || reference.length > 128) {
      throw new BadRequestException('providerTransactionReference is invalid');
    }
    const businessReference = this.businessReferenceFor({
      providerKey,
      environment: input.environment,
      providerTransactionReference: reference,
      institutionId: input.institutionId,
      receivingAccountNumber: input.receivingAccountNumber,
    });
    const gross = this.positiveMinor(input.grossAmountMinor, 'grossAmountMinor');
    const fee = this.nonNegativeMinor(input.providerFeeMinor ?? '0', 'providerFeeMinor');
    if (BigInt(fee) > BigInt(gross)) {
      throw new BadRequestException('providerFeeMinor cannot exceed grossAmountMinor');
    }
    const recorded = await this.inbound.record({
      institutionId: input.institutionId,
      providerKey,
      environment: input.environment,
      providerTransactionReference: reference,
      providerPaymentReference: input.providerPaymentReference ?? null,
      reservationId: input.reservationId ?? null,
      receivingAccountNumber: input.receivingAccountNumber ?? null,
      receivingBankCode: input.receivingBankCode ?? null,
      currency: input.currency,
      grossAmountMinor: gross,
      providerFeeMinor: fee,
      creditedAmountMinor: (BigInt(gross) - BigInt(fee)).toString(),
      paidAt: input.paidAt ?? null,
      businessReference,
    });
    return { ...recorded, businessReference };
  }

  /** Records a payment whose receiving account identifies no institution. No credit, no guess. */
  async recordUnattributed(input: {
    environment: 'sandbox' | 'production';
    providerTransactionReference: string;
    providerPaymentReference?: string | null;
    receivingAccountNumber?: string | null;
    receivingBankCode?: string | null;
    currency: string;
    grossAmountMinor: string;
    providerFeeMinor?: string;
  }): Promise<{ businessReference: string; exceptionId: string }> {
    const businessReference = this.businessReferenceFor({
      providerKey: PROVIDER_KEY,
      environment: input.environment,
      providerTransactionReference: input.providerTransactionReference,
      receivingAccountNumber: input.receivingAccountNumber,
    });
    const recorded = await this.exceptions.record({
      businessReference,
      institutionId: null,
      providerKey: PROVIDER_KEY,
      environment: input.environment,
      providerTransactionReference: input.providerTransactionReference,
      providerPaymentReference: input.providerPaymentReference ?? null,
      receivingAccountNumber: input.receivingAccountNumber ?? null,
      currency: input.currency,
      grossAmountMinor: this.positiveMinor(input.grossAmountMinor, 'grossAmountMinor'),
      providerFeeMinor: this.nonNegativeMinor(input.providerFeeMinor ?? '0', 'providerFeeMinor'),
      reason: 'UNMATCHED_RECEIVING_ACCOUNT',
      evidence: {
        receivingBankCode: input.receivingBankCode ?? null,
        note: 'Receiving account is not one this platform issued; no institution was invented.',
      },
    });
    return { businessReference, exceptionId: recorded.id };
  }

  /**
   * Verifies with the provider and, only if every identity and control matches, posts one credit.
   * Duplicate delivery returns the original credit instead of posting again.
   */
  async verifyAndPost(input: {
    businessReference?: string;
    providerTransactionReference?: string;
    correlationId: string;
  }): Promise<BankToWalletOutcome> {
    if (!this.enabled()) return { status: 'DISABLED' };
    const reference = (input.businessReference ?? '').trim().toUpperCase();
    if (reference && !REFERENCE_PATTERN.test(reference)) {
      throw new BadRequestException('businessReference is invalid');
    }
    const providerReference = (input.providerTransactionReference ?? '').trim();
    if (!reference && !providerReference) {
      throw new BadRequestException(
        'businessReference or providerTransactionReference is required',
      );
    }
    const located = await this.db.query<Array<{ id: string; business_reference: string }>>(
      `SELECT id,business_reference FROM banking_inbound_payments
        WHERE ($1::text IS NOT NULL AND business_reference=$1)
           OR ($2::text IS NOT NULL AND provider_transaction_reference=$2)
        ORDER BY recorded_at DESC LIMIT 2`,
      [reference || null, providerReference || null],
    );
    if (!located[0]) return { status: 'NOT_FOUND', businessReference: reference || undefined };
    if (located.length > 1) {
      throw new ConflictException('Business reference is ambiguous');
    }
    const row = located[0];
    const businessReference = row.business_reference;
    if (!businessReference || !REFERENCE_PATTERN.test(businessReference)) {
      throw new ConflictException('Inbound record has no durable business reference');
    }

    // A replay of an already decided payment must not depend on the provider being available and
    // must never re-post. Return the original decision before making any provider call.
    const priorCredit = await this.db.query<Array<{ journal_id: string; amount_minor: string }>>(
      `SELECT journal_id,amount_minor::text AS amount_minor
         FROM bank_to_wallet_credits WHERE business_reference=$1`,
      [businessReference],
    );
    if (priorCredit[0]) {
      return {
        status: 'CREDITED',
        businessReference,
        journalId: priorCredit[0].journal_id,
        amountMinor: priorCredit[0].amount_minor,
        replayed: true,
      };
    }
    const priorException = await this.db.query<
      Array<{ id: string; reason: string; permitted_next_action: string }>
    >(
      `SELECT id,reason,permitted_next_action FROM bank_to_wallet_exceptions WHERE business_reference=$1`,
      [businessReference],
    );
    if (priorException[0]) {
      return {
        status: 'EXCEPTION',
        businessReference,
        exceptionId: priorException[0].id,
        reason: priorException[0].reason as BankToWalletExceptionReason,
        permittedNextAction: priorException[0].permitted_next_action,
        replayed: true,
      };
    }

    // Provider verification is server-to-server and happens before the posting transaction. Force
    // fresh evidence even when a previous verification marked the row VERIFIED: the identity and
    // amount assertions below need the provider's answer, not just a cached state.
    const verification = await this.inbound.verify(row.id, input.correlationId, true);
    const verificationDetail: InboundPaymentVerificationResult | undefined =
      verification.verification;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction('SERIALIZABLE', (manager) =>
          this.processInTransaction(
            manager,
            row.id,
            businessReference,
            verification.state,
            verificationDetail,
          ),
        );
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }
    throw new ServiceUnavailableException('Bank to Wallet posting could not be completed');
  }

  private async processInTransaction(
    manager: EntityManager,
    inboundId: string,
    businessReference: string,
    verificationState: string,
    verification: InboundPaymentVerificationResult | undefined,
  ): Promise<BankToWalletOutcome> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `b2w:${businessReference}`,
    ]);
    const rows = await manager.query<InboundRow[]>(
      `SELECT id,business_reference,institution_id,environment,provider_transaction_reference,
              provider_payment_reference,receiving_account_number,receiving_bank_code,currency,
              gross_amount_minor::text AS gross_amount_minor,
              provider_fee_minor::text AS provider_fee_minor,
              credited_amount_minor::text AS credited_amount_minor,
              settlement_amount_minor::text AS settlement_amount_minor,
              verification_state,resolution_state,wallet_id
         FROM banking_inbound_payments WHERE id=$1 FOR UPDATE`,
      [inboundId],
    );
    const inbound = rows[0];
    if (!inbound) throw new NotFoundException('Inbound payment not found');

    const existing = await manager.query<Array<{ journal_id: string; amount_minor: string }>>(
      `SELECT journal_id,amount_minor::text AS amount_minor
         FROM bank_to_wallet_credits WHERE business_reference=$1`,
      [businessReference],
    );
    if (existing[0]) {
      return {
        status: 'CREDITED',
        businessReference,
        journalId: existing[0].journal_id,
        amountMinor: existing[0].amount_minor,
        replayed: true,
      };
    }
    const prior = await manager.query<
      Array<{ id: string; reason: string; permitted_next_action: string }>
    >(
      `SELECT id,reason,permitted_next_action FROM bank_to_wallet_exceptions WHERE business_reference=$1`,
      [businessReference],
    );
    if (prior[0]) {
      return {
        status: 'EXCEPTION',
        businessReference,
        exceptionId: prior[0].id,
        reason: prior[0].reason as BankToWalletExceptionReason,
        permittedNextAction: prior[0].permitted_next_action,
        replayed: true,
      };
    }

    const gross = BigInt(inbound.gross_amount_minor);
    const providerFee = BigInt(inbound.provider_fee_minor);
    const settlement =
      verification?.settlementAmountMinor !== undefined
        ? BigInt(verification.settlementAmountMinor)
        : inbound.settlement_amount_minor !== null
          ? BigInt(inbound.settlement_amount_minor)
          : gross - providerFee;
    if (settlement < 0n || settlement > gross - providerFee) {
      return this.openException(manager, inbound, businessReference, 'AMOUNT_MISMATCH', {
        providerSettlementMinor: verification?.settlementAmountMinor ?? null,
        grossMinor: inbound.gross_amount_minor,
      });
    }

    if (verificationState !== 'VERIFIED' || verification?.outcome !== 'VERIFIED') {
      const reason: BankToWalletExceptionReason =
        verificationState === 'REJECTED' || verification?.outcome === 'CONFLICT'
          ? 'REFERENCE_MISMATCH'
          : 'UNVERIFIABLE_PAYMENT';
      return this.openException(manager, inbound, businessReference, reason, {
        providerOutcome: verification?.outcome ?? verificationState,
        providerStatus: verification?.providerStatus ?? null,
      });
    }

    // Identity checks: the provider's own answer, not the webhook claim, decides the wallet.
    const providerReference = verification.paymentReference;
    const receivingAccount =
      verification.receivingAccountNumber ?? inbound.receiving_account_number;
    if (!providerReference || !receivingAccount) {
      return this.openException(manager, inbound, businessReference, 'REFERENCE_MISMATCH', {
        note: 'Provider verification did not return both a payment reference and a destination account',
      });
    }
    if (
      providerReference !== inbound.provider_payment_reference ||
      (inbound.provider_payment_reference === null &&
        providerReference !== (await this.accountReferenceFor(manager, receivingAccount)))
    ) {
      return this.openException(manager, inbound, businessReference, 'REFERENCE_MISMATCH', {
        providerPaymentReference: providerReference,
        storedPaymentReference: inbound.provider_payment_reference,
      });
    }
    if (
      receivingAccount !== inbound.receiving_account_number ||
      verification.currency?.toUpperCase() !== inbound.currency ||
      (verification.grossAmountMinor !== undefined &&
        BigInt(verification.grossAmountMinor) !== gross)
    ) {
      return this.openException(manager, inbound, businessReference, 'AMOUNT_MISMATCH', {
        providerAccount: receivingAccount,
        storedAccount: inbound.receiving_account_number,
        providerCurrency: verification.currency ?? null,
        providerAmount: verification.grossAmountMinor ?? null,
      });
    }

    const destinations = await manager.query<DestinationRow[]>(
      `SELECT v.id AS virtual_id,w.id AS wallet_id,w.ledger_account_id AS ledger_id,
              w.customer_id,w.institution_id,v.account_number,
              v.reference AS account_reference,w.status AS wallet_status,
              w.currency AS wallet_currency,v.status AS virtual_status
         FROM virtual_accounts v JOIN wallet_accounts w ON w.id=v.wallet_id
        WHERE v.provider=$1 AND v.account_number=$2 AND v.status='ACTIVE'
        FOR UPDATE OF v,w`,
      [PROVIDER_KEY, receivingAccount],
    );
    const destination = destinations[0];
    if (
      destinations.length !== 1 ||
      !destination ||
      destination.account_reference !== providerReference ||
      destination.wallet_status !== 'ACTIVE' ||
      destination.wallet_currency !== inbound.currency ||
      !destination.customer_id ||
      destination.institution_id !== inbound.institution_id
    ) {
      return this.openException(
        manager,
        inbound,
        businessReference,
        'UNMATCHED_RECEIVING_ACCOUNT',
        {
          destinationCount: destinations.length,
          matchedReference: destination?.account_reference ?? null,
          matchedInstitution: destination?.institution_id ?? null,
        },
      );
    }

    // Governed charge resolution. An explicit zero rule resolves to fee 0; no rule is NOT_CONFIGURED
    // and also credits the gross settling amount, with that distinction preserved in evidence.
    const classRows = await manager.query<Array<{ code: string }>>(
      `SELECT cc.code FROM customer_class_assignments a
         JOIN customer_classes cc ON cc.id=a.class_id AND cc.deleted_at IS NULL
        WHERE a.customer_id=$1 AND a.is_active=true AND a.deleted_at IS NULL
          AND a.effective_from <= clock_timestamp()
          AND (a.effective_to IS NULL OR clock_timestamp() < a.effective_to)
        ORDER BY a.precedence DESC,a.created_at DESC LIMIT 1`,
      [destination.customer_id],
    );
    const resolution = await this.feeResolver.resolveWithManager(manager, {
      productCode: PRODUCT_CODE,
      currency: inbound.currency,
      institutionId: inbound.institution_id,
      customerClassCode: classRows[0]?.code,
      at: new Date(),
    });
    if (resolution.status === 'AMBIGUOUS') {
      return this.openException(manager, inbound, businessReference, 'POSTING_RESTRICTION', {
        note: 'Conflicting fee rules; no commercial policy was selected',
        ambiguousRuleIds: resolution.ambiguousRuleIds ?? [],
      });
    }
    const decision = this.feeCalculator.compute({
      resolution,
      principalAmountMinor: settlement.toString(),
      currency: inbound.currency,
    });
    const platformFee = BigInt(decision.feeMinor ?? '0');
    if (platformFee > settlement) {
      return this.openException(manager, inbound, businessReference, 'POSTING_RESTRICTION', {
        note: 'Resolved platform charge exceeds the merchant settlement amount',
      });
    }
    const customerCredit = settlement - platformFee;
    if (customerCredit <= 0n) {
      return this.openException(manager, inbound, businessReference, 'LIMIT_BLOCKED', {
        note: 'Net customer credit is not positive; no wallet journal was posted',
      });
    }

    const requestHash = createHash('sha256')
      .update(`${businessReference}|${customerCredit}|${platformFee}`)
      .digest('hex');
    let limitRef: Record<string, unknown>;
    try {
      const enforcement = await this.limits.enforceWithManager(manager, {
        principalType: 'CUSTOMER',
        principalId: destination.customer_id,
        product: PRODUCT_CODE,
        currency: inbound.currency,
        direction: 'INCOMING',
        channel: 'BANK_TRANSFER',
        amountMinor: customerCredit.toString(),
        idempotencyKey: businessReference,
        requestHash,
        correlationId: businessReference,
        walletLedgerAccountId: destination.ledger_id,
        institutionId: inbound.institution_id,
      });
      if (!enforcement.allowed) {
        return this.openException(manager, inbound, businessReference, 'LIMIT_BLOCKED', {
          limitProfileCode: enforcement.limitProfileCode,
        });
      }
      limitRef = {
        allowed: enforcement.allowed,
        limitProfileCode: enforcement.limitProfileCode,
        evaluatedDimensions: enforcement.evaluatedDimensions,
        ruleRefs: enforcement.ruleRefs ?? [],
      };
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return this.openException(manager, inbound, businessReference, 'LIMIT_BLOCKED', {
        code: (error.getResponse() as { code?: string })?.code ?? error.message,
        status: error.getStatus(),
      });
    }

    try {
      await this.boundary.requireCustomerWallet(
        manager,
        destination.customer_id,
        destination.wallet_id,
        destination.ledger_id,
      );
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return this.openException(manager, inbound, businessReference, 'ELIGIBILITY_BLOCKED', {
        status: error.getStatus(),
      });
    }

    const asset = await this.settlementAccounts.getAccountId(
      manager,
      inbound.currency,
      SettlementAccountRole.SETTLEMENT_ASSET,
    );
    const journalId = await this.ledger.postJournalInTransaction(manager, {
      idempotencyKey: `b2w:${businessReference}`,
      currency: inbound.currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: businessReference,
      description: 'Verified Monnify bank transfer credited to customer wallet',
      correlationId: businessReference,
      metadata: {
        businessReference,
        // PR #23's Admin Web BANK_TO_WALLET history key is the immutable bank intake UUID.
        bankIntakeId: inbound.id,
        providerKey: PROVIDER_KEY,
        providerTransactionReference: inbound.provider_transaction_reference,
        grossAmountMinor: inbound.gross_amount_minor,
        providerFeeMinor: inbound.provider_fee_minor,
        settlementAmountMinor: settlement.toString(),
        monienaijaFeeMinor: platformFee.toString(),
        status: 'CREDITED',
      },
      lines: [
        {
          accountId: asset,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: customerCredit.toString(),
        },
        {
          accountId: destination.ledger_id,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: customerCredit.toString(),
        },
      ],
    });

    const feeRef = {
      status: decision.status,
      ruleRefs: decision.ruleRefs,
      feeMinor: decision.feeMinor,
      vatMinor: decision.vatMinor,
      posting: decision.posting,
      productCode: PRODUCT_CODE,
    };
    const creditId = randomUUID();
    await manager.query(
      `INSERT INTO bank_to_wallet_credits
        (id,business_reference,inbound_payment_id,institution_id,provider_key,environment,
         provider_transaction_reference,provider_payment_reference,wallet_id,virtual_account_id,
         currency,gross_amount_minor,provider_fee_minor,settlement_amount_minor,
         monienaija_fee_minor,amount_minor,journal_id,fee_ref,limit_ref)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb)`,
      [
        creditId,
        businessReference,
        inbound.id,
        inbound.institution_id,
        PROVIDER_KEY,
        inbound.environment,
        inbound.provider_transaction_reference,
        providerReference,
        destination.wallet_id,
        destination.virtual_id,
        inbound.currency,
        inbound.gross_amount_minor,
        inbound.provider_fee_minor,
        settlement.toString(),
        platformFee.toString(),
        customerCredit.toString(),
        journalId,
        JSON.stringify(feeRef),
        JSON.stringify(limitRef),
      ],
    );
    await manager.query(
      `UPDATE banking_inbound_payments
          SET settlement_amount_minor=$2,monienaija_fee_minor=$3,customer_credit_minor=$4,
              fee_rule_ref=$5::jsonb,limit_ref=$6::jsonb,wallet_id=$7,virtual_account_id=$8,
              credit_journal_id=$9,ledger_transaction_id=$9,resolution_state='CREDITED',processed_at=clock_timestamp()
        WHERE id=$1`,
      [
        inbound.id,
        settlement.toString(),
        platformFee.toString(),
        customerCredit.toString(),
        JSON.stringify(feeRef),
        JSON.stringify(limitRef),
        destination.wallet_id,
        destination.virtual_id,
        journalId,
      ],
    );
    await manager.query(
      `INSERT INTO bank_to_wallet_settlements
        (business_reference,institution_id,provider_key,environment,provider_transaction_reference,
         currency,gross_amount_minor,provider_deduction_minor,settlement_amount_minor,
         monienaija_charge_minor,customer_credit_minor,settlement_state,evidence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING_PROVIDER_SETTLEMENT',$12::jsonb)
       ON CONFLICT (business_reference) DO NOTHING`,
      [
        businessReference,
        inbound.institution_id,
        PROVIDER_KEY,
        inbound.environment,
        inbound.provider_transaction_reference,
        inbound.currency,
        inbound.gross_amount_minor,
        inbound.provider_fee_minor,
        settlement.toString(),
        platformFee.toString(),
        customerCredit.toString(),
        JSON.stringify({ source: 'provider-verified-transaction', settlementReference: null }),
      ],
    );
    await this.audit.record(manager, {
      entityType: 'BANK_TO_WALLET_CREDIT',
      entityId: creditId,
      action: 'CREDITED',
      actor: 'internal-bank-to-wallet',
      correlationId: businessReference,
      newValues: {
        journalId,
        amountMinor: customerCredit.toString(),
        providerFeeMinor: inbound.provider_fee_minor,
        monienaijaFeeMinor: platformFee.toString(),
      },
    });
    await this.outbox.enqueue(manager, {
      eventType: 'BANK_TO_WALLET_CREDITED',
      aggregateType: 'BANK_TO_WALLET_CREDIT',
      aggregateId: creditId,
      eventKey: `bank-to-wallet:${businessReference}`,
      correlationId: businessReference,
      payload: { businessReference, journalId, amountMinor: customerCredit.toString() },
    });
    return {
      status: 'CREDITED',
      businessReference,
      journalId,
      amountMinor: customerCredit.toString(),
      replayed: false,
    };
  }

  private async openException(
    manager: EntityManager,
    inbound: InboundRow,
    businessReference: string,
    reason: BankToWalletExceptionReason,
    evidence: Record<string, unknown>,
  ): Promise<Extract<BankToWalletOutcome, { status: 'EXCEPTION' }>> {
    const recorded = await this.exceptions.record(
      {
        businessReference,
        institutionId: inbound.institution_id,
        providerKey: PROVIDER_KEY,
        environment: inbound.environment as 'sandbox' | 'production',
        providerTransactionReference: inbound.provider_transaction_reference,
        providerPaymentReference: inbound.provider_payment_reference,
        receivingAccountNumber: inbound.receiving_account_number,
        walletId: inbound.wallet_id ?? null,
        currency: inbound.currency,
        grossAmountMinor: inbound.gross_amount_minor,
        providerFeeMinor: inbound.provider_fee_minor,
        settlementAmountMinor: inbound.settlement_amount_minor,
        reason,
        evidence: { ...evidence, businessReference },
      },
      manager,
    );
    const view = await this.exceptions.view(recorded.id, manager);
    await manager.query(
      `UPDATE banking_inbound_payments
          SET exception_id=$2,resolution_state='EXCEPTION',processed_at=clock_timestamp()
        WHERE id=$1`,
      [inbound.id, recorded.id],
    );
    await this.audit.record(manager, {
      entityType: 'BANK_TO_WALLET_EXCEPTION',
      entityId: recorded.id,
      action: reason,
      actor: 'internal-bank-to-wallet',
      correlationId: businessReference,
      newValues: { businessReference, reason },
    });
    return {
      status: 'EXCEPTION',
      businessReference,
      exceptionId: recorded.id,
      reason,
      permittedNextAction: String(view.permitted_next_action),
      replayed: !recorded.created,
    };
  }

  private async accountReferenceFor(
    manager: EntityManager,
    accountNumber: string,
  ): Promise<string | null> {
    const rows = await manager.query<Array<{ reference: string }>>(
      `SELECT reference FROM virtual_accounts WHERE provider=$1 AND account_number=$2 AND status='ACTIVE'`,
      [PROVIDER_KEY, accountNumber],
    );
    return rows[0]?.reference ?? null;
  }

  private enabled(): boolean {
    const enabled = this.config.get('BANK_TO_WALLET_ENABLED', { infer: true }) === true;
    const environment = this.config.get('BANKING_ENVIRONMENT', { infer: true });
    const productionEnabled =
      this.config.get('BANK_TO_WALLET_PRODUCTION_ENABLED', { infer: true }) === true;
    if (!enabled) return false;
    return environment !== 'production' || productionEnabled;
  }

  private positiveMinor(value: string, field: string): string {
    if (!/^[0-9]{1,19}$/.test(value ?? '') || BigInt(value) <= 0n) {
      throw new BadRequestException(`${field} must be a positive integer string`);
    }
    return value;
  }

  private nonNegativeMinor(value: string, field: string): string {
    if (!/^[0-9]{1,19}$/.test(value ?? '')) {
      throw new BadRequestException(`${field} must be a non-negative integer string`);
    }
    return value;
  }

  /** Read-only reference search for staff, with institution scope enforced by SQL. */
  async adminLookup(input: {
    businessReference?: string;
    institutionIds: readonly string[] | null;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    if (input.businessReference) {
      const reference = input.businessReference.trim().toUpperCase();
      if (!REFERENCE_PATTERN.test(reference)) {
        throw new BadRequestException('businessReference is invalid');
      }
    }
    const rows = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT p.business_reference,p.provider_transaction_reference,p.provider_payment_reference,
              p.institution_id,p.receiving_account_number,p.currency,
              p.gross_amount_minor::text AS gross_amount_minor,
              p.provider_fee_minor::text AS provider_fee_minor,
              p.settlement_amount_minor::text AS settlement_amount_minor,
              p.monienaija_fee_minor::text AS monienaija_fee_minor,
              p.customer_credit_minor::text AS customer_credit_minor,
              p.resolution_state,p.credit_journal_id,p.processed_at,
              c.amount_minor::text AS credited_amount_minor,
              e.id AS exception_id,e.reason AS exception_reason,e.state AS exception_state,
              e.permitted_next_action
         FROM banking_inbound_payments p
         LEFT JOIN bank_to_wallet_credits c ON c.business_reference=p.business_reference
         LEFT JOIN bank_to_wallet_exceptions e ON e.business_reference=p.business_reference
        WHERE ($1::text IS NULL OR p.business_reference=$1)
          AND ($2::uuid[] IS NULL OR p.institution_id = ANY($2::uuid[]))
        ORDER BY p.recorded_at DESC LIMIT $3`,
      [
        input.businessReference?.trim().toUpperCase() ?? null,
        input.institutionIds ? [...input.institutionIds] : null,
        limit,
      ],
    );
    return rows;
  }

  /** Customer-safe projection of one inbound credit, addressed by our durable reference. */
  async customerView(customerId: string, businessReference: string) {
    const rows = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT p.business_reference,p.provider_transaction_reference,p.currency,
              p.gross_amount_minor::text AS gross_amount_minor,
              p.provider_fee_minor::text AS provider_fee_minor,
              p.customer_credit_minor::text AS customer_credit_minor,
              p.resolution_state,p.processed_at,c.journal_id,e.reason AS exception_reason,
              e.permitted_next_action
         FROM banking_inbound_payments p
         JOIN wallet_accounts w ON w.id=p.wallet_id
         LEFT JOIN bank_to_wallet_credits c ON c.business_reference=p.business_reference
         LEFT JOIN bank_to_wallet_exceptions e ON e.business_reference=p.business_reference
        WHERE p.business_reference=$1 AND w.customer_id=$2::text AND w.owner_class='CUSTOMER'`,
      [businessReference, customerId],
    );
    if (!rows[0]) throw new NotFoundException('Transfer not found');
    return rows[0];
  }
}
