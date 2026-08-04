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
  ComplianceCaseCategory,
  ComplianceCaseSeverity,
  ComplianceCaseStatus,
} from './customer-compliance.enums';

@Entity({ name: 'customer_compliance_cases' })
@Index('uq_customer_compliance_cases_case_number', ['caseNumber'], { unique: true })
@Index('idx_customer_compliance_cases_customer_status', ['customerId', 'status'])
@Check(
  'chk_customer_compliance_cases_category',
  "category IN ('KYC', 'AML', 'SANCTIONS', 'FRAUD', 'PEP', 'DOCUMENT', 'ACCOUNT_REVIEW', 'MANUAL_REVIEW', 'OTHER')",
)
@Check(
  'chk_customer_compliance_cases_severity',
  "severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
)
@Check(
  'chk_customer_compliance_cases_status',
  "status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')",
)
@Check('chk_customer_compliance_cases_version', 'version > 0')
export class CustomerComplianceCase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'case_number', type: 'varchar', length: 100 })
  caseNumber!: string;

  @Column({ type: 'varchar', length: 30 })
  category!: ComplianceCaseCategory;

  @Column({ type: 'varchar', length: 20 })
  severity!: ComplianceCaseSeverity;

  @Column({ type: 'varchar', length: 24, default: ComplianceCaseStatus.OPEN })
  status!: ComplianceCaseStatus;

  @Column({ name: 'opened_by', type: 'varchar', length: 160 })
  openedBy!: string;

  @Column({ name: 'assigned_to', type: 'varchar', length: 160, nullable: true })
  assignedTo!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  resolution!: string | null;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
