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

import { CustomerRiskLevel, CustomerRiskProfileStatus } from './customer-risk-profile.enums';

@Entity({ name: 'customer_risk_assessments' })
@Index('uq_customer_risk_profiles_active_customer', ['customerId'], {
  unique: true,
  where: "deleted_at IS NULL AND status = 'ACTIVE'",
})
@Index('idx_customer_risk_profiles_customer_updated', ['customerId', 'updatedAt'])
@Check('chk_customer_risk_profiles_status', "status IN ('ACTIVE', 'CLOSED')")
@Check(
  'chk_customer_risk_profiles_risk_level',
  "overall_risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
)
@Check('chk_customer_risk_profiles_version', 'version > 0')
export class CustomerRiskProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerRiskProfileStatus.ACTIVE })
  status!: CustomerRiskProfileStatus;

  @Column({ name: 'assessment_date', type: 'timestamptz' })
  assessmentDate!: Date;

  @Column({ name: 'assessed_by', type: 'varchar', length: 160 })
  assessedBy!: string;

  @Column({ name: 'assessment_method', type: 'varchar', length: 120 })
  assessmentMethod!: string;

  @Column({ name: 'overall_risk_level', type: 'varchar', length: 20 })
  overallRiskLevel!: CustomerRiskLevel;

  @Column({ name: 'review_due_date', type: 'timestamptz' })
  reviewDueDate!: Date;

  @Column({ type: 'varchar', length: 2000, nullable: true })
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
