import { BadRequestException, Injectable } from '@nestjs/common';

import {
  MAX_POSTGRES_BIGINT,
  normalizeCurrency,
  parseMinorUnits,
  parsePositiveMinorUnits,
} from '../common/money';
import { QuotePaymentType } from '../quote/quote.enums';
import type { FeeCalculation, FeeRule } from './fee.types';

const BASIS_POINTS = 10_000n;

@Injectable()
export class FeeEngine {
  calculate(
    amountMinorInput: string | number | bigint,
    currencyInput: string,
    rule: FeeRule,
  ): FeeCalculation {
    const amountMinor = parsePositiveMinorUnits(amountMinorInput, 'amountMinor');
    const currency = normalizeCurrency(currencyInput);
    if (!Object.values(QuotePaymentType).includes(rule.paymentType)) {
      throw new BadRequestException('Unsupported fee payment type');
    }

    const flatFeeMinor = parseMinorUnits(rule.flatFeeMinor, 'flatFeeMinor');
    const percentageBps = parseMinorUnits(rule.percentageBps, 'percentageBps');
    const minimumFeeMinor =
      rule.minimumFeeMinor === undefined
        ? 0n
        : parseMinorUnits(rule.minimumFeeMinor, 'minimumFeeMinor');
    const maximumFeeMinor =
      rule.maximumFeeMinor === undefined
        ? undefined
        : parseMinorUnits(rule.maximumFeeMinor, 'maximumFeeMinor');
    const vatBps = parseMinorUnits(rule.vatBps, 'vatBps');

    if (maximumFeeMinor !== undefined && maximumFeeMinor < minimumFeeMinor) {
      throw new BadRequestException('maximumFeeMinor cannot be less than minimumFeeMinor');
    }

    let feeMinor = flatFeeMinor + (amountMinor * percentageBps) / BASIS_POINTS;
    if (feeMinor < minimumFeeMinor) {
      feeMinor = minimumFeeMinor;
    }
    if (maximumFeeMinor !== undefined && feeMinor > maximumFeeMinor) {
      feeMinor = maximumFeeMinor;
    }
    const vatMinor = (feeMinor * vatBps) / BASIS_POINTS;
    const totalMinor = amountMinor + feeMinor + vatMinor;
    if (totalMinor > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException('Fee calculation total must fit in a PostgreSQL BIGINT');
    }

    return {
      paymentType: rule.paymentType,
      currency,
      amountMinor: amountMinor.toString(),
      feeMinor: feeMinor.toString(),
      vatMinor: vatMinor.toString(),
      totalMinor: totalMinor.toString(),
    };
  }
}
