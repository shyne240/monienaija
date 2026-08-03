import type { QuotePaymentType } from '../quote/quote.enums';

export interface LimitEvaluationRequest {
  customerId: string;
  walletId: string;
  paymentType: QuotePaymentType;
  amountMinor: string | number | bigint;
  singleTransactionLimitMinor: string | number | bigint;
  dailyLimitMinor: string | number | bigint;
  monthlyLimitMinor: string | number | bigint;
  dailyUsedMinor: string | number | bigint;
  monthlyUsedMinor: string | number | bigint;
}

export interface LimitEvaluation {
  customerId: string;
  walletId: string;
  paymentType: QuotePaymentType;
  amountMinor: string;
  allowed: boolean;
  reasons: string[];
  remainingSingleTransactionMinor: string;
  remainingDailyMinor: string;
  remainingMonthlyMinor: string;
}
