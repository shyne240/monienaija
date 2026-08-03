import type { PaymentQuoteStatus, QuotePaymentType } from './quote.enums';

export interface CreateQuoteCommand {
  paymentType: QuotePaymentType;
  amountMinor: string | number | bigint;
  feeMinor: string | number | bigint;
  vatMinor: string | number | bigint;
  currency: string;
  expiresAt: string;
  idempotencyKey: string;
}

export interface PaymentQuoteView {
  id: string;
  quoteReference: string;
  paymentType: QuotePaymentType;
  amountMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
  currency: string;
  status: PaymentQuoteStatus;
  idempotencyKey: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}
