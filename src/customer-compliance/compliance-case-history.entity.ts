import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ComplianceCaseHistoryAction, ComplianceCaseStatus } from './customer-compliance.enums';

@Entity({ name: 'compliance_case_histories' })
@Index('idx_compliance_case_histories_case_created', ['caseId', 'createdAt'])
@Check(
  'chk_compliance_case_histories_action',
  "action IN ('CASE_CREATED', 'STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'CASE_CLOSED', 'RESOLUTION_UPDATED', 'COMMENT_ADDED', 'EVIDENCE_ADDED')",
)
@Check(
  'chk_compliance_case_histories_previous_status',
  "previous_status IS NULL OR previous_status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')",
)
@Check(
  'chk_compliance_case_histories_new_status',
  "new_status IS NULL OR new_status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')",
)
export class ComplianceCaseHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId!: string;

  @Column({ type: 'varchar', length: 40 })
  action!: ComplianceCaseHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 24, nullable: true })
  previousStatus!: ComplianceCaseStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 24, nullable: true })
  newStatus!: ComplianceCaseStatus | null;

  @Column({ name: 'previous_assignee', type: 'varchar', length: 160, nullable: true })
  previousAssignee!: string | null;

  @Column({ name: 'new_assignee', type: 'varchar', length: 160, nullable: true })
  newAssignee!: string | null;

  @Column({ name: 'previous_resolution', type: 'varchar', length: 1000, nullable: true })
  previousResolution!: string | null;

  @Column({ name: 'new_resolution', type: 'varchar', length: 1000, nullable: true })
  newResolution!: string | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
