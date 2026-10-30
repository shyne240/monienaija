import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { LedgerService } from '../ledger/ledger.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import type { PostJournalLineCommand } from '../ledger/ledger.types';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';

import { CommercialAccountingConfigService } from './commercial-accounting-config.service';
import {
  CommercialAccountingBlockedError,
  CommercialAccountingRegistryService,
} from './commercial-accounting-registry.service';
import {
  CommercialAccountingFamilyRole,
  CommercialVatTreatment,
  CommissionAccountingTreatment,
  CommissionRecognitionTiming,
} from './commercial-accounting.enums';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — commercial accounting strategy boundary.
 *
 * Implements ONLY what the approved human decisions authorize:
 *
 *   DP-01=B   one pooled fee-revenue account; product identity travels in journal metadata and
 *             in the decision-record posting evidence (never separate per-product accounts).
 *   DP-02=A   recognition at transaction completion: this service is invoked INSIDE the flow's
 *             existing SERIALIZABLE transaction (same atomic operation — never a worker, never
 *             a second commit).
 *   DP-03=B   VAT-bearing shape with the treatment configurable and the rate taken ONLY from the
 *             authoritative fee decision's rule evidence (rule.vat_bps / calculator vatRateBps).
 *             No rate is hard-coded; an unset treatment or unset rate aborts the transaction
 *             (fail-closed) rather than calculating an invented amount.
 *   DP-05     configurable commission treatment (EXPENSE_PAYABLE / AGENT_WALLET_NETTING / the
 *             configuration model of CONTRA_REVENUE). Families resolve through the governance
 *             registry only; the unavailable treatment fails closed with the precise blocker
 *             (contra is not sanctioned/creatable under the existing normal-balance contract —
 *             no contra account is invented).
 *   DP-07     the timing required by the selected treatment, validated as an explicit combo:
 *             EXPENSE_PAYABLE ⇒ ACCRUE_NOW_SETTLE_LATER; AGENT_WALLET_NETTING ⇒ AT_COMPLETION.
 *             No other timing model is representable.
 *   DP-15=A   any blocker here throws inside the flow transaction: journal, snapshot and legs
 *             roll back atomically — the financial transaction never commits successfully with
 *             missing required accounting.
 *
 * The fee amount comes from the authoritative FeeRuleCalculatorService decision (never
 * recomputed here, never from a hard-coded value); commission amounts come from the authoritative
 * CommissionEngine decision allocations. Principal journals are untouched: accounting legs live
 * in a dedicated linked journal (idempotency key `<flow-ledger-key>:commercial-accounting`),
 * keeping principal legs byte-identical and reversals of principal flows unaffected.
 */

export interface CommissionAccountingAllocationInput {
  beneficiaryType: string;
  beneficiaryId: string | null;
  amountMinor: string;
  currency: string;
  basis?: string;
  ruleId?: string;
  ruleVersion?: number;
}

export interface AccountingCompletionInput {
  productCode: string;
  currency: string;
  /** The flow's EXISTING ledger idempotency key (e.g. `transfer:<id>`, `agent:<agentId>:<key>`). */
  baseIdempotencyKey: string;
  correlationId: string | null;
  reference: string | null;
  /** Snapshot idempotency key — links the accounting journal to the decision record. */
  snapshotIdempotencyKey: string;
  metadata: Record<string, unknown>;
  /** Ledger account of the fee payer (sender/initiator wallet) when known to the flow. */
  feePayerLedgerAccountId?: string | null;
  /** Payer identity; when no explicit payer account is supplied, the wallet is resolved. */
  feePayerCustomerId: string;
  feeDecision: Record<string, unknown>;
  commissionDecision: Record<string, unknown>;
}

export interface AccountingLegEvidence {
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
}

export interface AccountingOutcome {
  accountingJournalId: string | null;
  accountingJournalIdempotencyKey: string | null;
  feePosting: Record<string, unknown>;
  commissionPosting: Record<string, unknown>;
  feeCollected: boolean;
  /** Evidence legs actually posted (empty when nothing posted). */
  legs: AccountingLegEvidence[];
}

const ACCOUNTING_UNIT = 'CUSTOMER_FUNDS';
const ACCOUNTING_CURRENCY = 'NGN';

/** Fee accounting is enabled only for the fee-bearing V1 products (funding products excluded). */
const FEE_ACCOUNTING_PRODUCTS = new Set([
  'WALLET_TRANSFER',
  'WALLET_TO_CASH',
  'CASH_TO_WALLET',
  'CASH_TO_CASH',
]);

@Injectable()
export class CommercialAccountingService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly configService: CommercialAccountingConfigService,
    private readonly registryService: CommercialAccountingRegistryService,
  ) {}

  /**
   * Post fee + commission accounting (configured treatments) inside the flow's transaction.
   * Returns the posting evidence to merge into the snapshot decision objects.
   */
  async postForCompletion(
    manager: EntityManager,
    input: AccountingCompletionInput,
  ): Promise<AccountingOutcome> {
    const config = this.configService.read();
    if (!config.enabled) {
      // Defence in depth: flows call this only when enabled; never post while disabled.
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_NOT_ENABLED',
        'commercial accounting invoked while COMMERCIAL_ACCOUNTING_ENABLED is not true',
      );
    }
    if (input.currency !== ACCOUNTING_CURRENCY) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_CURRENCY_UNSUPPORTED',
        `commercial accounting supports ${ACCOUNTING_CURRENCY} only (got ${input.currency})`,
      );
    }

    const legs: PostJournalLineCommand[] = [];
    const legsEvidence: AccountingLegEvidence[] = [];
    const codeByAccountId = new Map<string, string>();
    const registerLeg = (
      account: LedgerAccount,
      accountCode: string,
      direction: LedgerEntryDirection,
      amountMinor: bigint,
    ): void => {
      codeByAccountId.set(account.id, accountCode);
      legs.push({ accountId: account.id, direction, amountMinor: amountMinor.toString() });
      legsEvidence.push({
        accountCode,
        direction: direction === LedgerEntryDirection.DEBIT ? 'DEBIT' : 'CREDIT',
        amountMinor: amountMinor.toString(),
      });
    };

    // ————————————————— FEE REVENUE (+VAT) — DP-01=B / DP-02=A / DP-03=B —————————————————
    const feeStatus = typeof input.feeDecision.status === 'string' ? input.feeDecision.status : 'NOT_CONFIGURED';
    const feeMinorRaw = (input.feeDecision as { feeMinor?: unknown }).feeMinor;
    const feeMinor = typeof feeMinorRaw === 'string' || typeof feeMinorRaw === 'number'
      ? BigInt(feeMinorRaw)
      : 0n;

    let feePosting: Record<string, unknown> = {
      journalLegsPosted: false,
      reason: 'ZERO_FEE_NO_LEGS_POSTED',
    };
    let feeCollected = false;

    if (feeStatus === 'APPLIED' && feeMinor > 0n) {
      if (!FEE_ACCOUNTING_PRODUCTS.has(input.productCode)) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED',
          `product ${input.productCode} is not in the approved fee-accounting scope (funding products never acquire fees by engine side-effect)`,
        );
      }

      // VAT rate: ONLY from the authoritative fee decision's rule evidence. Never hard-coded.
      const vatRateBps = this.extractVatRateBps(input.feeDecision);
      if (config.vatTreatment === null) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED',
          'a fee-bearing decision exists but COMMERCIAL_ACCOUNTING_VAT_TREATMENT is unset — the VAT treatment must be formally supplied before any fee accounting can post (DP-03=B: fail closed, never treat unconfigured VAT as zero)',
        );
      }
      if (vatRateBps === null) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_VAT_RATE_NOT_CONFIGURED',
          'the authoritative fee rule carries no vat_bps (null) — the applicable VAT rate is not formally supplied; refusing to silently treat it as zero (DP-03=B)',
        );
      }

      const feeRevenue = await this.registryService.resolveRequiredAccountInTransaction(
        manager,
        CommercialAccountingFamilyRole.FEE_REVENUE,
      );

      const payerAccountId =
        input.feePayerLedgerAccountId ??
        (await this.resolveWalletLedgerAccountId(manager, input.feePayerCustomerId, 'FEE_PAYER'));

      let revenueMinor: bigint;
      let vatLegMinor: bigint;
      let payerDebitMinor: bigint;
      const vatMinorRawDecision = (input.feeDecision as { vatMinor?: unknown }).vatMinor;
      const decisionVatMinor =
        typeof vatMinorRawDecision === 'string' && /^\d+$/.test(vatMinorRawDecision)
          ? BigInt(vatMinorRawDecision)
          : 0n;

      if (config.vatTreatment === CommercialVatTreatment.EXCLUSIVE_ADD_ON) {
        // Use the calculator's authoritative VAT amount (fee * vat_bps / 10000, floored).
        vatLegMinor = decisionVatMinor;
        // Cross-check the decision math deterministically — fail closed on any drift.
        const expected = vatRateBps === 0 ? 0n : (feeMinor * BigInt(vatRateBps)) / 10_000n;
        if (expected !== vatLegMinor) {
          throw new CommercialAccountingBlockedError(
            'COMMERCIAL_VAT_DECISION_MISMATCH',
            `authoritative fee decision vatMinor ${vatLegMinor} != deterministic recomputation ${expected} — refusing to post`,
          );
        }
        revenueMinor = feeMinor;
        payerDebitMinor = feeMinor + vatLegMinor;
      } else {
        // INCLUSIVE_IN_FEE — VAT carved out of the fee: vat = fee * bps / (10000+bps), floored.
        vatLegMinor =
          vatRateBps === 0 ? 0n : (feeMinor * BigInt(vatRateBps)) / (10_000n + BigInt(vatRateBps));
        revenueMinor = feeMinor - vatLegMinor;
        payerDebitMinor = feeMinor;
        if (revenueMinor <= 0n) {
          throw new CommercialAccountingBlockedError(
            'COMMERCIAL_VAT_MISCALIBRATED',
            `INCLUSIVE_IN_FEE would zero-out fee revenue at vat_bps ${vatRateBps} on fee ${feeMinor} — refusing to post degenerate accounting`,
          );
        }
      }

      const payerAccount = await manager
        .getRepository(LedgerAccount)
        .findOne({ where: { id: payerAccountId } });
      if (!payerAccount || !payerAccount.isActive) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_FEE_PAYER_ACCOUNT_UNAVAILABLE',
          'fee payer ledger account not found or inactive — required DR side of the fee accounting legs (DP-15=A)',
        );
      }
      registerLeg(payerAccount, `WALLET:${input.feePayerCustomerId}`, LedgerEntryDirection.DEBIT, payerDebitMinor);
      registerLeg(
        feeRevenue,
        feeRevenue.code,
        LedgerEntryDirection.CREDIT,
        revenueMinor,
      );

      if (vatLegMinor > 0n) {
        const vatPayable = await this.registryService.resolveRequiredAccountInTransaction(
          manager,
          CommercialAccountingFamilyRole.VAT_PAYABLE,
        );
        registerLeg(vatPayable, vatPayable.code, LedgerEntryDirection.CREDIT, vatLegMinor);
      }

      feeCollected = true;
      feePosting = {
        journalLegsPosted: true,
        vatTreatment: config.vatTreatment,
        vatRateBps,
        vatBasis: config.vatTreatment === CommercialVatTreatment.INCLUSIVE_IN_FEE ? 'INCLUSIVE' : 'EXCLUSIVE',
        revenueMinor: revenueMinor.toString(),
        vatMinorPosted: vatLegMinor.toString(),
        vatMinorFromDecision: decisionVatMinor.toString(),
        payerDebitMinor: payerDebitMinor.toString(),
      };
    }

    // ————————————————— COMMISSION — DP-05 configurable / DP-07 timing —————————————————
    const commissionStatus =
      typeof input.commissionDecision.status === 'string' ? input.commissionDecision.status : 'NONE';
    const allocations = Array.isArray(
      (input.commissionDecision as { allocations?: unknown }).allocations,
    )
      ? ((input.commissionDecision as { allocations: CommissionAccountingAllocationInput[] })
          .allocations)
      : [];

    const nonzeroAllocations = allocations.filter((a) => {
      try {
        return BigInt(String(a.amountMinor ?? '0')) > 0n;
      } catch {
        return false;
      }
    });

    let commissionPosting: Record<string, unknown> = {
      journalLegsPosted: false,
      reason: 'COMMISSION_NONE',
    };

    if (commissionStatus === 'ALLOCATED' && nonzeroAllocations.length > 0) {
      for (const allocation of nonzeroAllocations) {
        if (allocation.beneficiaryType === 'AGGREGATOR') {
          throw new CommercialAccountingBlockedError(
            'COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED',
            'aggregator commission accounting is out of approved V1 scope (D-C-009 lane, V2 rails) — refusing to fake posting',
          );
        }
        if (allocation.beneficiaryType === 'PLATFORM') {
          throw new CommercialAccountingBlockedError(
            'COMMERCIAL_PLATFORM_ALLOCATION_POSTING_NOT_PROVISIONED',
            'PLATFORM-retained allocation posting has no approved account family in V1 (D-C-010 open) — refusing to fake posting',
          );
        }
        if (allocation.beneficiaryType !== 'AGENT') {
          throw new CommercialAccountingBlockedError(
            'COMMERCIAL_ALLOCATION_BENEFICIARY_UNSUPPORTED',
            `commission allocation beneficiaryType ${allocation.beneficiaryType} is not supportable by the approved treatments`,
          );
        }
      }

      if (config.commissionTreatment === null) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT_NOT_CONFIGURED',
          'a non-zero ALLOCATED commission decision exists but COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT is unset (DP-05: treatment is explicit configuration, never a default)',
        );
      }
      if (config.commissionTiming === null) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_COMMISSION_TIMING_NOT_CONFIGURED',
          'COMMERCIAL_COMMISSION_RECOGNITION_TIMING is unset (DP-07: timing must be explicit and auditable)',
        );
      }

      if (config.commissionTreatment === CommissionAccountingTreatment.CONTRA_REVENUE) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_CONTRA_REVENUE_ACCOUNTING_NOT_SUPPORTED',
          'CONTRA_REVENUE (D-GL-004 option C) is not technically supportable in V1: normal-balance enforcement forbids creating a contra-capable family (B2F contra NOT VERIFIED) and none is provisioned — configuration model recorded, posting fails closed instead of inventing accounting',
        );
      }
      if (
        config.commissionTreatment === CommissionAccountingTreatment.EXPENSE_PAYABLE &&
        config.commissionTiming !== CommissionRecognitionTiming.ACCRUE_NOW_SETTLE_LATER
      ) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_COMMISSION_ACCOUNTING_CONFIG_INCONSISTENT',
          'EXPENSE_PAYABLE requires ACCRUE_NOW_SETTLE_LATER timing (the documented pairing): a standing payable cannot be immediate-settled',
        );
      }
      if (
        config.commissionTreatment === CommissionAccountingTreatment.AGENT_WALLET_NETTING &&
        config.commissionTiming !== CommissionRecognitionTiming.AT_COMPLETION
      ) {
        throw new CommercialAccountingBlockedError(
          'COMMERCIAL_COMMISSION_ACCOUNTING_CONFIG_INCONSISTENT',
          'AGENT_WALLET_NETTING requires AT_COMPLETION timing (netting IS immediate settlement)',
        );
      }

      const expense = await this.registryService.resolveRequiredAccountInTransaction(
        manager,
        CommercialAccountingFamilyRole.COMMISSION_EXPENSE,
      );
      const total = nonzeroAllocations.reduce(
        (sum, a) => sum + BigInt(String(a.amountMinor)),
        0n,
      );

      if (config.commissionTreatment === CommissionAccountingTreatment.EXPENSE_PAYABLE) {
        const payable = await this.registryService.resolveRequiredAccountInTransaction(
          manager,
          CommercialAccountingFamilyRole.COMMISSION_PAYABLE,
        );
        registerLeg(expense, expense.code, LedgerEntryDirection.DEBIT, total);
        registerLeg(payable, payable.code, LedgerEntryDirection.CREDIT, total);
        commissionPosting = {
          journalLegsPosted: true,
          treatment: config.commissionTreatment,
          timing: config.commissionTiming,
          expenseMinor: total.toString(),
          payableMinor: total.toString(),
          settlementState: 'ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED',
          allocationCount: nonzeroAllocations.length,
        };
      } else {
        // AGENT_WALLET_NETTING — per-beneficiary credit into the agent's wallet liability.
        registerLeg(expense, expense.code, LedgerEntryDirection.DEBIT, total);
        const credits: Array<{ beneficiaryId: string; amountMinor: string }> = [];
        for (const allocation of nonzeroAllocations) {
          if (!allocation.beneficiaryId) {
            throw new CommercialAccountingBlockedError(
              'COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE',
              'ALLOCATED commission beneficiaryId is null — cannot net to an unidentified wallet; refusing to fake the credit',
            );
          }
          const walletAccountId = await this.resolveWalletLedgerAccountId(
            manager,
            allocation.beneficiaryId,
            'COMMISSION_BENEFICIARY',
          );
          const walletAccount = await manager
            .getRepository(LedgerAccount)
            .findOne({ where: { id: walletAccountId } });
          if (!walletAccount || !walletAccount.isActive) {
            throw new CommercialAccountingBlockedError(
              'COMMERCIAL_BENEFICIARY_ACCOUNT_UNAVAILABLE',
              `commission beneficiary wallet ledger account unavailable for ${allocation.beneficiaryId} — refusing to fake the credit`,
            );
          }
          const amount = BigInt(String(allocation.amountMinor));
          registerLeg(walletAccount, `WALLET:${allocation.beneficiaryId}`, LedgerEntryDirection.CREDIT, amount);
          credits.push({ beneficiaryId: allocation.beneficiaryId, amountMinor: amount.toString() });
        }
        commissionPosting = {
          journalLegsPosted: true,
          treatment: config.commissionTreatment,
          timing: config.commissionTiming,
          expenseMinor: total.toString(),
          credits,
        };
      }
    } else if (commissionStatus === 'ALLOCATED') {
      commissionPosting = { journalLegsPosted: false, reason: 'ZERO_AMOUNT_NO_LEGS_POSTED' };
    }

    if (legs.length === 0) {
      return {
        accountingJournalId: null,
        accountingJournalIdempotencyKey: null,
        feePosting,
        commissionPosting,
        feeCollected,
        legs: [],
      };
    }

    if (legs.length === 1) {
      // The ledger requires at least 2 balanced lines; a single leg means a construction bug —
      // fail closed rather than post something unbalanced.
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_UNBALANCED_COMPOSITION',
        'commercial accounting composed a single leg — a double-entry bug; transaction aborted (DP-15=A)',
      );
    }

    const accountingIdempotencyKey = `${input.baseIdempotencyKey}:commercial-accounting`;
    const accountingJournalId = await this.ledgerService.postJournalInTransaction(manager, {
      idempotencyKey: accountingIdempotencyKey,
      currency: input.currency,
      accountingUnit: ACCOUNTING_UNIT,
      reference: input.reference ?? undefined,
      description: input.productCode
        ? `Commercial accounting for ${input.productCode}`
        : 'Commercial accounting',
      correlationId: input.correlationId ?? undefined,
      metadata: {
        ...input.metadata,
        productCode: input.productCode,
        accountingPurpose: 'FEE_REVENUE_AND_COMMISSION',
        snapshotIdempotencyKey: input.snapshotIdempotencyKey,
        baseJournalIdempotencyKey: input.baseIdempotencyKey,
        vatTreatment: config.vatTreatment,
        commissionTreatment: config.commissionTreatment,
        commissionTiming: config.commissionTiming,
        legs: legsEvidence,
      },
      lines: legs,
    });

    return {
      accountingJournalId,
      accountingJournalIdempotencyKey: accountingIdempotencyKey,
      feePosting:
        feePosting.journalLegsPosted === true
          ? { ...feePosting, accountingJournalId, accountingJournalIdempotencyKey: accountingIdempotencyKey }
          : feePosting,
      commissionPosting:
        commissionPosting.journalLegsPosted === true
          ? {
              ...commissionPosting,
              accountingJournalId,
              accountingJournalIdempotencyKey: accountingIdempotencyKey,
            }
          : commissionPosting,
      feeCollected,
      legs: legsEvidence,
    };
  }

  isEnabled(): boolean {
    return this.configService.isEnabled();
  }

  /**
   * The rate comes ONLY from rule-carried evidence. NOTE: the calculator's `vatRateBps` coerces a
   * null rule value to 0 (its document convention), so the raw `ruleRefs[].vatBps` value (null
   * preserved) is authoritative for the "rate unset → fail closed" test.
   */
  private extractVatRateBps(feeDecision: Record<string, unknown>): number | null {
    const ruleRefs = (feeDecision as { ruleRefs?: unknown }).ruleRefs;
    if (Array.isArray(ruleRefs) && ruleRefs.length > 0) {
      const first = ruleRefs[0] as { vatBps?: unknown } | undefined;
      if (first && typeof first.vatBps === 'number') return first.vatBps;
      if (first && first.vatBps === null) return null;
    }
    const direct = (feeDecision as { vatRateBps?: unknown }).vatRateBps;
    if (typeof direct === 'number') return direct;
    return null;
  }

  /** Resolve an actor's wallet ledger account (same wallet_accounts table the flows bind to). */
  private async resolveWalletLedgerAccountId(
    manager: EntityManager,
    customerId: string,
    role: 'FEE_PAYER' | 'COMMISSION_BENEFICIARY',
  ): Promise<string> {
    const wallet = await manager
      .getRepository(WalletAccount)
      .findOne({ where: { customerId, currency: ACCOUNTING_CURRENCY } });
    if (!wallet) {
      throw new CommercialAccountingBlockedError(
        role === 'FEE_PAYER'
          ? 'COMMERCIAL_FEE_PAYER_WALLET_NOT_RESOLVABLE'
          : 'COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE',
        `no ${ACCOUNTING_CURRENCY} wallet account found for ${role.toLowerCase()} ${customerId} — refusing to invent a payer/payee`,
      );
    }
    return wallet.ledgerAccountId;
  }
}
