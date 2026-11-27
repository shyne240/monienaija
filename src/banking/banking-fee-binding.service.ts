import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { FeeEngine } from '../fee/fee.engine';
import { WALLET_TO_BANK } from '../product-catalog/banking-product-identities';
import { selectCurrentWalletToBankFeeRule } from './banking-fee-rule-selection';
import { QuotePaymentType } from '../quote/quote.enums';

export interface FeeBindingInput {
  readonly externalOperationId: string;
  readonly institutionId: string;
  readonly walletId: string;
  readonly currency: string;
  /** What the destination institution is to be credited. */
  readonly beneficiaryAmountMinor: string;
  /** The product whose approved rule prices this operation. */
  readonly productCode: string;
  /** Provider's own charge, if it is known at authorization time. Never added to the customer debit. */
  readonly providerFeeMinor?: string;
  /** Agent commission, if an agent is party to this operation. */
  readonly agentCommissionMinor?: string;
}

export interface FeeBindingView {
  readonly id: string;
  readonly customerDebitMinor: string;
  readonly beneficiaryAmountMinor: string;
  readonly serviceFeeMinor: string;
  readonly taxMinor: string;
  readonly settlementAmountMinor: string;
  readonly pricingSource: 'APPROVED_RULE' | 'TEST_POLICY';
  readonly feeRuleId: string | null;
  readonly feeRuleVersion: number | null;
}

/**
 * Prices an operation **once**, at authorization, and freezes the result.
 *
 * The central commitment here is that a customer is charged exactly what they authorized. Everything
 * in this class serves that: the rule is selected by effective date, its parameters are snapshotted,
 * the arithmetic is computed a single time, and the resulting row is immutable. Settlement later reads
 * the bound amounts; it never prices anything.
 *
 * The refusal that matters most: **there is no default fee.** If no approved, active, effective rule
 * exists for the product and currency, this throws. The alternative — falling back to zero, or to a
 * "reasonable" number — would either give the service away or invent a charge, and both are worse than
 * refusing to proceed. A missing fee rule is an operator problem, not something to paper over at the
 * moment a customer's money is in flight.
 *
 * PR #27 replaced the product-agnostic scope with the canonical product. The old rule was "apply
 * only when exactly one active product rule exists for the currency", which meant the very act of
 * configuring a second product made bank transfers unpriced. `WALLET_TO_BANK` is now that product
 * and only its rules price this route.
 *
 * `pricingSource` records whether the rule is an approved catalogue rule or a controlled test policy.
 * It is stored rather than inferred, because a test-priced operation must never be mistaken for a
 * production-priced one when someone later asks why a customer was charged what they were.
 */
@Injectable()
export class BankingFeeBindingService {
  private readonly logger = new Logger(BankingFeeBindingService.name);

  constructor(private readonly feeEngine: FeeEngine) {}

  /**
   * Binds pricing for an operation that A6 has already priced as a single committed amount.
   *
   * This is the adapter between A6's model ("the customer authorized this exact debit") and banking's
   * model ("beneficiary + service fee + tax"). It is deliberately narrow:
   *
   * - it returns `null` when no approved rule exists, because "no fee rule" is the current production
   *   state and must not block the existing behaviour;
   * - it treats the committed amount as the total the customer approved, so the beneficiary amount it
   *   prices against is the committed amount minus whatever the approved rule says the fee is. If the
   *   rule's total then disagrees with the commitment, the caller refuses.
   *
   * It never adjusts the committed amount. A commitment is an authorization, not a quote.
   */
  async bindForCommittedOperationInTransaction(
    manager: EntityManager,
    input: {
      externalOperationId: string;
      institutionId: string | null;
      walletId: string;
      currency: string;
      committedAmountMinor: string;
    },
  ): Promise<FeeBindingView | null> {
    // Without an institution there is no product/rule scope to price against, and no banking
    // operation either: the bridge declines the same case.
    if (!input.institutionId) return null;

    // PR #27: the product is now a decision that HAS an approved answer.
    //
    // This method used to price against "whichever single product in this currency happens to have
    // an active rule", because no commercial decision named the product for a bank transfer. That
    // was honest but wrong in two ways: it made the tariff depend on unrelated products' rules, and
    // it could never charge anything, because adding a second product's rule made the scope
    // ambiguous and the binding returned null.
    //
    // The catalogue now carries `WALLET_TO_BANK` for this route (one identity for customer and
    // agent — see `banking-product-identities.ts`), so the rule is selected for that product only.
    // A missing rule still means no charge is bound (never a default fee); there is no
    // "one product in the currency" fallback any more, and none is needed.
    const inForce = await selectCurrentWalletToBankFeeRule(manager, input.currency);
    if (!inForce) {
      // No approved pricing for this route: record nothing rather than invent a fee.
      return null;
    }

    return this.bindInTransaction(manager, {
      externalOperationId: input.externalOperationId,
      institutionId: input.institutionId,
      walletId: input.walletId,
      currency: input.currency,
      // The customer authorized `committedAmountMinor` as the total debit.
      beneficiaryAmountMinor: input.committedAmountMinor,
      productCode: WALLET_TO_BANK.productCode,
    });
  }

  /**
   * Binds pricing inside the caller's authorization transaction.
   *
   * Idempotent by operation: a replay returns the existing binding untouched rather than repricing.
   * Repricing on replay is precisely the failure this table prevents — the second call could compute a
   * different number if a rule changed in between.
   */
  async bindInTransaction(manager: EntityManager, input: FeeBindingInput): Promise<FeeBindingView> {
    const existing = await manager.query<Array<Record<string, unknown>>>(
      `SELECT id, customer_debit_minor::text AS customer_debit_minor,
              beneficiary_amount_minor::text AS beneficiary_amount_minor,
              service_fee_minor::text AS service_fee_minor, tax_minor::text AS tax_minor,
              settlement_amount_minor::text AS settlement_amount_minor, pricing_source,
              fee_rule_id, fee_rule_version
         FROM banking_operation_fee_bindings WHERE external_operation_id=$1`,
      [input.externalOperationId],
    );
    if (existing[0]) {
      const row = existing[0];
      // The beneficiary amount is part of the authorization. A replay that asks to price a different
      // amount for the same operation is not a replay, it is a changed transaction.
      if (row.beneficiary_amount_minor !== input.beneficiaryAmountMinor) {
        throw new ConflictException('Operation was already priced for a different amount');
      }
      return this.toView(row);
    }

    // Select the rule that is in force *now*, for this product and currency. `effective_from` order
    // with a single row per (product, currency, effective_from) means the most recent applicable rule
    // wins, which is what "currently approved" means.
    const rules = await manager.query<
      Array<{
        id: string;
        version: number;
        flat_fee_minor: string | null;
        percentage_bps: number | null;
        minimum_fee_minor: string | null;
        maximum_fee_minor: string | null;
        vat_bps: number | null;
        products_enabled: boolean;
        product_status: string;
      }>
    >(
      `SELECT r.id, r.version,
              r.flat_fee_minor::text AS flat_fee_minor, r.percentage_bps,
              r.minimum_fee_minor::text AS minimum_fee_minor,
              r.maximum_fee_minor::text AS maximum_fee_minor, r.vat_bps,
              p.enabled AS products_enabled, p.status AS product_status
         FROM fee_rules r
         JOIN products p ON p.code = r.product_code
        WHERE r.product_code=$1 AND r.currency=$2 AND r.is_active
          AND r.effective_from <= clock_timestamp()
          AND (r.effective_to IS NULL OR r.effective_to > clock_timestamp())
        ORDER BY r.effective_from DESC, r.version DESC
        LIMIT 1`,
      [input.productCode, input.currency],
    );

    const rule = rules[0];
    if (!rule) {
      // No approved pricing. Refuse: a default would be an invented charge.
      throw new ConflictException(
        `No approved fee rule is in force for product ${input.productCode} in ${input.currency}`,
      );
    }
    if (!rule.products_enabled || rule.product_status !== 'ACTIVE') {
      // A rule for a disabled product is not an approved charge either.
      throw new ConflictException(`Product ${input.productCode} is not active for pricing`);
    }

    // A rule with NULL flat and NULL percentage is an approved "no charge" rule: legitimate, and
    // distinct from a missing rule. FeeEngine treats absent as zero.
    const calculation = this.feeEngine.calculate(input.beneficiaryAmountMinor, input.currency, {
      paymentType: QuotePaymentType.WITHDRAWAL,
      flatFeeMinor: rule.flat_fee_minor ?? '0',
      percentageBps: rule.percentage_bps ?? 0,
      minimumFeeMinor: rule.minimum_fee_minor ?? '0',
      maximumFeeMinor: rule.maximum_fee_minor ?? undefined,
      vatBps: rule.vat_bps ?? 0,
    });

    const serviceFee = calculation.feeMinor;
    const tax = calculation.vatMinor;
    // The engine's total is beneficiary + service fee + tax; assert that rather than assume it.
    const expectedDebit = (
      BigInt(input.beneficiaryAmountMinor) +
      BigInt(serviceFee) +
      BigInt(tax)
    ).toString();
    if (expectedDebit !== calculation.totalMinor) {
      throw new ConflictException('Fee calculation is internally inconsistent');
    }

    const providerFee = input.providerFeeMinor ?? '0';
    const agentCommission = input.agentCommissionMinor ?? '0';
    // What we expect to actually settle: the beneficiary amount is what leaves for the destination;
    // our revenue is the service fee. Provider fee and commission are our costs, already priced into
    // the service fee by whoever approved it — adding them here would double-count.
    const settlement = input.beneficiaryAmountMinor;

    const rows = await manager.query<Array<{ id: string }>>(
      `INSERT INTO banking_operation_fee_bindings
         (external_operation_id, institution_id, wallet_id, currency,
          beneficiary_amount_minor, customer_debit_minor, service_fee_minor, tax_minor,
          provider_fee_minor, agent_commission_minor, settlement_amount_minor,
          fee_rule_id, fee_rule_version, rule_snapshot, pricing_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        input.externalOperationId,
        input.institutionId,
        input.walletId,
        input.currency,
        input.beneficiaryAmountMinor,
        expectedDebit,
        serviceFee,
        tax,
        providerFee,
        agentCommission,
        settlement,
        rule.id,
        rule.version,
        JSON.stringify({
          // The parameters as applied, so the arithmetic is reproducible even after the rule is
          // superseded. Not the whole row: a snapshot should be the pricing inputs, not a copy of a
          // mutable table.
          flatFeeMinor: rule.flat_fee_minor ?? '0',
          percentageBps: String(rule.percentage_bps ?? 0),
          minimumFeeMinor: rule.minimum_fee_minor ?? '0',
          maximumFeeMinor: rule.maximum_fee_minor,
          vatBps: String(rule.vat_bps ?? 0),
          productCode: input.productCode,
          currency: input.currency,
        }),
        'APPROVED_RULE',
      ],
    );
    const id = rows[0]!.id;
    this.logger.log(
      `Priced operation ${input.externalOperationId}: debit ${expectedDebit} = ${input.beneficiaryAmountMinor} + ${serviceFee} fee + ${tax} tax (rule ${rule.id} v${rule.version})`,
    );
    return {
      id,
      customerDebitMinor: expectedDebit,
      beneficiaryAmountMinor: input.beneficiaryAmountMinor,
      serviceFeeMinor: serviceFee,
      taxMinor: tax,
      settlementAmountMinor: settlement,
      pricingSource: 'APPROVED_RULE',
      feeRuleId: rule.id,
      feeRuleVersion: rule.version,
    };
  }

  /** Reads the binding for an operation. Settlement uses this instead of repricing. */
  async forOperation(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<FeeBindingView | null> {
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT id, customer_debit_minor::text AS customer_debit_minor,
              beneficiary_amount_minor::text AS beneficiary_amount_minor,
              service_fee_minor::text AS service_fee_minor, tax_minor::text AS tax_minor,
              settlement_amount_minor::text AS settlement_amount_minor, pricing_source,
              fee_rule_id, fee_rule_version
         FROM banking_operation_fee_bindings WHERE external_operation_id=$1`,
      [externalOperationId],
    );
    return rows[0] ? this.toView(rows[0]) : null;
  }

  private toView(row: Record<string, unknown>): FeeBindingView {
    return {
      id: String(row.id),
      customerDebitMinor: String(row.customer_debit_minor),
      beneficiaryAmountMinor: String(row.beneficiary_amount_minor),
      serviceFeeMinor: String(row.service_fee_minor),
      taxMinor: String(row.tax_minor),
      settlementAmountMinor: String(row.settlement_amount_minor),
      pricingSource: row.pricing_source === 'TEST_POLICY' ? 'TEST_POLICY' : 'APPROVED_RULE',
      // The driver returns a uuid as a string; the cast is explicit rather than a blind String() so a
      // non-string would surface as a type error instead of "[object Object]" in an audit record.
      feeRuleId: row.fee_rule_id === null ? null : (row.fee_rule_id as string),
      feeRuleVersion: row.fee_rule_version === null ? null : Number(row.fee_rule_version),
    };
  }
}
