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

import { CustomerOnboardingStatus } from './customer-onboarding.enums';

@Entity({ name: 'customer_onboardings' })
@Index('uq_customer_onboardings_active_customer', ['customerId'], {
  unique: true,
  where: "deleted_at IS NULL AND status NOT IN ('REJECTED', 'COMPLETED')",
})
@Index('idx_customer_onboardings_customer_created', ['customerId', 'createdAt'])
@Check(
  'chk_customer_onboardings_status',
  "status IN ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED')",
)
@Check('chk_customer_onboardings_version', 'version > 0')
export class CustomerOnboarding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 24, default: CustomerOnboardingStatus.NOT_STARTED })
  status!: CustomerOnboardingStatus;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
