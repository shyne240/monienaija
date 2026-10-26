import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { CustomerFundingStatus } from './customer-funding.enums';

@Entity({ name: 'customer_funding_requests' })
@Index('uq_customer_funding_requests_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_customer_funding_requests_journal_id', ['journalId'], {
  unique: true,
  where: 'journal_id IS NOT NULL',
})
@Index('uq_customer_funding_requests_reference', ['reference'], { unique: true })
@Index('idx_customer_funding_requests_customer_created', ['customerId', 'createdAt'])
@Index('idx_customer_funding_requests_status', ['status'])
@Check('chk_customer_funding_amount_positive', 'amount_minor > 0')
@Check('chk_customer_funding_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_customer_funding_status', "status IN ('PENDING','APPROVED','REJECTED')")
@Check('chk_customer_funding_idempotency_non_empty', 'length(idempotency_key) > 0')
@Check('chk_customer_funding_hash', "request_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_customer_funding_maker_non_empty', 'length(maker_id) > 0')
@Check(
  'chk_customer_funding_journal_for_approved',
  "status <> 'APPROVED' OR journal_id IS NOT NULL",
)
export class CustomerFundingRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerFundingStatus.PENDING })
  status!: CustomerFundingStatus;

  @Column({ name: 'external_reference', type: 'varchar', length: 255, nullable: true })
  externalReference!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  channel!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'maker_id', type: 'varchar', length: 160 })
  makerId!: string;

  @Column({ name: 'maker_type', type: 'varchar', length: 20 })
  makerType!: string;

  @Column({ name: 'checker_id', type: 'varchar', length: 160, nullable: true })
  checkerId!: string | null;

  @Column({ name: 'checker_type', type: 'varchar', length: 20, nullable: true })
  checkerType!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  reference!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;
}
