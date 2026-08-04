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

import { CustomerRiskLevel } from './customer-onboarding.enums';

@Entity({ name: 'customer_risk_profiles' })
@Index('uq_customer_risk_profiles_current_customer', ['customerId'], {
  unique: true,
  where: 'is_current = TRUE AND deleted_at IS NULL',
})
@Index('idx_customer_risk_profiles_customer_created', ['customerId', 'createdAt'])
export class CustomerRiskProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'risk_level', type: 'varchar', length: 20 })
  riskLevel!: CustomerRiskLevel;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rationale!: string | null;

  @Column({ name: 'assessed_by', type: 'varchar', length: 160 })
  assessedBy!: string;

  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent!: boolean;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
