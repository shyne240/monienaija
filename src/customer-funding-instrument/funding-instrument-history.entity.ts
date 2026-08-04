import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import {
  CustomerFundingInstrumentStatus,
  FundingInstrumentHistoryAction,
  FundingInstrumentVerificationState,
} from './customer-funding-instrument.enums';

@Entity({ name: 'funding_instrument_histories' })
@Index('idx_funding_instrument_histories_instrument_created', ['instrumentId', 'createdAt'])
@Check(
  'chk_funding_instrument_histories_action',
  "action IN ('CREATED', 'STATUS_CHANGED', 'VERIFIED', 'OWNERSHIP_CREATED')",
)
@Check(
  'chk_funding_instrument_histories_previous_status',
  "previous_status IS NULL OR previous_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')",
)
@Check(
  'chk_funding_instrument_histories_new_status',
  "new_status IS NULL OR new_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')",
)
@Check(
  'chk_funding_instrument_histories_previous_verification',
  "previous_verification_state IS NULL OR previous_verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')",
)
@Check(
  'chk_funding_instrument_histories_new_verification',
  "new_verification_state IS NULL OR new_verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')",
)
export class FundingInstrumentHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId!: string;

  @Column({ type: 'varchar', length: 30 })
  action!: FundingInstrumentHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 20, nullable: true })
  previousStatus!: CustomerFundingInstrumentStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 20, nullable: true })
  newStatus!: CustomerFundingInstrumentStatus | null;

  @Column({ name: 'previous_verification_state', type: 'varchar', length: 20, nullable: true })
  previousVerificationState!: FundingInstrumentVerificationState | null;

  @Column({ name: 'new_verification_state', type: 'varchar', length: 20, nullable: true })
  newVerificationState!: FundingInstrumentVerificationState | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
