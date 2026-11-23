import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MAX_POSTGRES_BIGINT, normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { CommercialAccountingService } from '../commercial-accounting/commercial-accounting.service';
import type { FeeDecisionSnapshot } from '../commercial-decision/commercial-decision-snapshot.entity';
import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { paymentRequestHash } from '../payment/payment-support';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    @Optional() private readonly customerClassResolver?: CustomerClassResolverService,
  ) {}

  async priceWithManager(
    manager: EntityManager,
    input: {
      amountMinor: string | number | bigint;
      currency: string;
      at?: Date;
      customerId?: string | null;
      customerClassCode?: string | null;
      agentClassId?: string | null;
      institutionId?: string | null;
    },
  ): Promise<TransferPricing> {
    const amountMinor = parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString();
    const currency = normalizeCurrency(input.currency);
    const at = input.at ?? new Date();
    const customerClassCode =
      input.customerClassCode ??
      (input.customerId && this.customerClassResolver && UUID_PATTERN.test(input.customerId.trim())
        ? await this.customerClassResolver.resolveClassCodeInManager(
            manager,
            input.customerId.trim(),
            at,
          )
        : null);
    const resolution = await this.resolver.resolveWithManager(manager, {
      productCode: 'WALLET_TRANSFER',
      currency,
      at,
      ...(customerClassCode ? { customerClassCode } : {}),
      ...(input.agentClassId ? { agentClassId: input.agentClassId } : {}),
      ...(input.institutionId ? { institutionId: input.institutionId } : {}),
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
