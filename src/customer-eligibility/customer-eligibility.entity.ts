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

import { CustomerEligibilityStatus } from './customer-eligibility.enums';

@Entity({ name: 'customer_eligibilities' })
@Index('uq_customer_eligibilities_active_customer', ['customerId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_eligibilities_status', ['status'])
@Check(
  'chk_customer_eligibilities_status',
  "status IN ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED', 'REVOKED')",
)
@Check('chk_customer_eligibilities_version', 'version > 0')
export class CustomerEligibility {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'onboarding_id', type: 'uuid', nullable: true })
  onboardingId!: string | null;

  @Column({ type: 'varchar', length: 20, default: CustomerEligibilityStatus.PENDING })
  status!: CustomerEligibilityStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 160 })
  reviewedBy!: string;

  @Column({ name: 'status_changed_at', type: 'timestamptz' })
  statusChangedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
