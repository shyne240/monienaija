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
  CustomerRiskLevel,
  CustomerRiskProfileStatus,
  RiskProfileHistoryAction,
} from './customer-risk-profile.enums';

@Entity({ name: 'risk_assessment_histories' })
@Index('idx_risk_profile_histories_profile_created', ['profileId', 'createdAt'])
@Check('chk_risk_profile_histories_action', "action IN ('CREATED', 'REASSESSED', 'CLOSED')")
@Check('chk_risk_profile_histories_status', "status IN ('ACTIVE', 'CLOSED')")
@Check(
  'chk_risk_profile_histories_risk_level',
  "overall_risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
)
export class RiskProfileHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: RiskProfileHistoryAction;

  @Column({ type: 'varchar', length: 20 })
  status!: CustomerRiskProfileStatus;

  @Column({ type: 'integer' })
  version!: number;

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

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
