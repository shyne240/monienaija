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

import { AgentApplicationStatus } from './agent-application.enums';

@Entity({ name: 'agent_applications' })
@Index('uq_agent_applications_reference', ['reference'], { unique: true })
@Index('idx_agent_applications_class_status', ['agentClassId', 'status'])
@Index('idx_agent_applications_agent', ['agentId'])
@Check(
  'chk_agent_applications_status',
  "status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')",
)
@Check('chk_agent_applications_version', 'version > 0')
export class AgentApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ name: 'agent_class_id', type: 'uuid' })
  agentClassId!: string;

  @Column({ type: 'varchar', length: 20, default: AgentApplicationStatus.DRAFT })
  status!: AgentApplicationStatus;

  @Column({ name: 'applicant_reference', type: 'varchar', length: 160 })
  applicantReference!: string;

  @Column({ name: 'business_name', type: 'varchar', length: 320, nullable: true })
  businessName!: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 320, nullable: true })
  contactEmail!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160, nullable: true })
  updatedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
