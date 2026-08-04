import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { CustomerApprovalDecisionStatus } from './customer-onboarding.enums';

@Entity({ name: 'customer_approval_decisions' })
@Index('uq_customer_approval_decisions_latest_customer', ['customerId'], {
  unique: true,
  where: 'is_latest = TRUE AND deleted_at IS NULL',
})
@Index('idx_customer_approval_decisions_customer_created', ['customerId', 'createdAt'])
export class CustomerApprovalDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ type: 'varchar', length: 20 })
  decision!: CustomerApprovalDecisionStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'decided_by', type: 'varchar', length: 160 })
  decidedBy!: string;

  @Column({ name: 'is_latest', type: 'boolean', default: true })
  isLatest!: boolean;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
