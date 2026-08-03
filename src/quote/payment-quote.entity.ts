import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { PaymentQuoteStatus, QuotePaymentType } from './quote.enums';

@Entity({ name: 'payment_quotes' })
@Index('uq_payment_quotes_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_payment_quotes_reference', ['quoteReference'], { unique: true })
@Index('idx_payment_quotes_status_expiry', ['status', 'expiresAt'])
@Check('chk_payment_quotes_amount_positive', 'amount_minor > 0')
@Check('chk_payment_quotes_fee_non_negative', 'fee_minor >= 0 AND vat_minor >= 0')
export class PaymentQuote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'quote_reference', type: 'varchar', length: 64 })
  quoteReference!: string;

  @Column({ name: 'payment_type', type: 'varchar', length: 20 })
  paymentType!: QuotePaymentType;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ name: 'fee_minor', type: 'bigint', transformer: bigintTransformer })
  feeMinor!: string;

  @Column({ name: 'vat_minor', type: 'bigint', transformer: bigintTransformer })
  vatMinor!: string;

  @Column({ name: 'total_minor', type: 'bigint', transformer: bigintTransformer })
  totalMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: PaymentQuoteStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
