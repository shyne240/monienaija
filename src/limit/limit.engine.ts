import { BadRequestException, Injectable } from '@nestjs/common';

import { parseMinorUnits, parsePositiveMinorUnits } from '../common/money';
import { QuotePaymentType } from '../quote/quote.enums';
import type { LimitEvaluation, LimitEvaluationRequest } from './limit.types';

@Injectable()
export class LimitEngine {
  evaluate(request: LimitEvaluationRequest): LimitEvaluation {
    const customerId = request.customerId.trim();
    const walletId = request.walletId.trim();
    if (!customerId || !walletId) {
      throw new BadRequestException('customerId and walletId are required');
    }
    if (!Object.values(QuotePaymentType).includes(request.paymentType)) {
      throw new BadRequestException('Unsupported limit payment type');
    }

    const amountMinor = parsePositiveMinorUnits(request.amountMinor, 'amountMinor');
    const singleLimit = parseMinorUnits(
      request.singleTransactionLimitMinor,
      'singleTransactionLimitMinor',
    );
    const dailyLimit = parseMinorUnits(request.dailyLimitMinor, 'dailyLimitMinor');
    const monthlyLimit = parseMinorUnits(request.monthlyLimitMinor, 'monthlyLimitMinor');
    const dailyUsed = parseMinorUnits(request.dailyUsedMinor, 'dailyUsedMinor');
    const monthlyUsed = parseMinorUnits(request.monthlyUsedMinor, 'monthlyUsedMinor');

    const reasons: string[] = [];
    if (amountMinor > singleLimit) {
      reasons.push('SINGLE_TRANSACTION_LIMIT_EXCEEDED');
    }
    if (dailyUsed + amountMinor > dailyLimit) {
      reasons.push('DAILY_LIMIT_EXCEEDED');
    }
    if (monthlyUsed + amountMinor > monthlyLimit) {
      reasons.push('MONTHLY_LIMIT_EXCEEDED');
    }

    return {
      customerId,
      walletId,
      paymentType: request.paymentType,
      amountMinor: amountMinor.toString(),
      allowed: reasons.length === 0,
      reasons,
      remainingSingleTransactionMinor: this.remaining(singleLimit, amountMinor),
      remainingDailyMinor: this.remaining(dailyLimit, dailyUsed + amountMinor),
      remainingMonthlyMinor: this.remaining(monthlyLimit, monthlyUsed + amountMinor),
    };
  }

  private remaining(limit: bigint, consumed: bigint): string {
    return (limit > consumed ? limit - consumed : 0n).toString();
  }
}
