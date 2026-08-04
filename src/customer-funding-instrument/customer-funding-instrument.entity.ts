import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  CustomerFundingInstrumentStatus,
  CustomerFundingInstrumentType,
  FundingInstrumentVerificationState,
} from './customer-funding-instrument.enums';

@Entity({ name: 'customer_funding_instruments' })
@Index('uq_customer_funding_instruments_reference', ['reference'], { unique: true })
@Index('idx_customer_funding_instruments_customer_status', ['customerId', 'status'])
@Check(
  'chk_customer_funding_instruments_type',
  "instrument_type IN ('BANK_ACCOUNT', 'MOBILE_MONEY', 'CASH_AGENT', 'INTERNAL_SETTLEMENT')",
)
@Check(
  'chk_customer_funding_instruments_status',
  "status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'INACTIVE', 'REJECTED')",
)
@Check(
  'chk_customer_funding_instruments_verification_state',
  "verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')",
)
@Check('chk_customer_funding_instruments_reference', "reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'")
@Check('chk_customer_funding_instruments_version', 'version > 0')
export class CustomerFundingInstrument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'instrument_type', type: 'varchar', length: 30 })
  type!: CustomerFundingInstrumentType;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerFundingInstrumentStatus.PENDING })
  status!: CustomerFundingInstrumentStatus;

  @Column({
    name: 'verification_state',
    type: 'varchar',
    length: 20,
    default: FundingInstrumentVerificationState.UNVERIFIED,
  })
  verificationState!: FundingInstrumentVerificationState;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
