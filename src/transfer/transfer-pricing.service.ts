import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MAX_POSTGRES_BIGINT, normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { CommercialAccountingService } from '../commercial-accounting/commercial-accounting.service';
import type { FeeDecisionSnapshot } from '../commercial-decision/commercial-decision-snapshot.entity';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { paymentRequestHash } from '../payment/payment-support';

export interface TransferPricing {
  amountMinor: string;
  currency: string;
  feeMinor: string;
  vatMinor: string;
  totalDebitMinor: string;
  feeDecision: FeeDecisionSnapshot;
  pricingHash: string;
}

/** Server-derived fee evidence and actual payer debit, shared by confirmation and execution. */
@Injectable()
export class TransferPricingService {
  constructor(
    private readonly resolver: FeeRuleResolverService,
    private readonly calculator: FeeRuleCalculatorService,
    private readonly accounting: CommercialAccountingService,
  ) {}

  async priceWithManager(
    manager: EntityManager,
    input: { amountMinor: string | number | bigint; currency: string; at?: Date },
  ): Promise<TransferPricing> {
    const amountMinor = parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString();
    const currency = normalizeCurrency(input.currency);
    const resolution = await this.resolver.resolveWithManager(manager, {
      productCode: 'WALLET_TRANSFER',
      currency,
      at: input.at ?? new Date(),
    });
    const feeDecision = this.calculator.compute({
      resolution,
      principalAmountMinor: amountMinor,
      currency,
    });
    const debit = this.accounting.quoteFeeDebit(feeDecision);
    const total = BigInt(amountMinor) + BigInt(debit.debitMinor);
    if (total > MAX_POSTGRES_BIGINT)
      throw new BadRequestException('Transfer total must fit in a PostgreSQL BIGINT');
    const facts = {
      amountMinor,
      currency,
      feeMinor: debit.feeMinor,
      vatMinor: debit.vatMinor,
      totalDebitMinor: total.toString(),
      feeDecision,
    };
    return { ...facts, pricingHash: paymentRequestHash(facts) };
  }
}
