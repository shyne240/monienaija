import type { QuotePaymentType } from '../quote/quote.enums';

export interface FeeRule {
  paymentType: QuotePaymentType;
  flatFeeMinor: string | number | bigint;
  percentageBps: string | number | bigint;
  minimumFeeMinor?: string | number | bigint;
  maximumFeeMinor?: string | number | bigint;
  vatBps: string | number | bigint;
}

export interface FeeCalculation {
  paymentType: QuotePaymentType;
  currency: string;
  amountMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
}
