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

import {
  CustomerOnboardingTaskStatus,
  CustomerOnboardingTaskType,
} from './customer-onboarding.enums';

@Entity({ name: 'customer_onboarding_tasks' })
@Index('idx_customer_onboarding_tasks_customer', ['customerId', 'createdAt'])
@Index('idx_customer_onboarding_tasks_onboarding_status', ['onboardingId', 'status'])
export class CustomerOnboardingTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'task_type', type: 'varchar', length: 40 })
  type!: CustomerOnboardingTaskType;

  @Column({ type: 'varchar', length: 20, default: CustomerOnboardingTaskStatus.PENDING })
  status!: CustomerOnboardingTaskStatus;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired!: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'completed_by', type: 'varchar', length: 160, nullable: true })
  completedBy!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
