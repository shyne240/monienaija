import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { PrivilegedActionApprovalStatus } from './privileged-action-approval.enums';

@Entity({ name: 'privileged_action_approvals' })
@Index('idx_privileged_action_approvals_requester_status', ['requesterPrincipalId', 'status'])
@Index('idx_privileged_action_approvals_expires', ['status', 'expiresAt'])
@Index('idx_privileged_action_approvals_resource', ['resourceType', 'resourceId'])
@Check('chk_privileged_action_approvals_fingerprint', "action_fingerprint ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_privileged_action_approvals_status',
  "status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONSUMED', 'EXPIRED', 'EMERGENCY_ACTIVE', 'EMERGENCY_REVOKED')",
)
@Check('chk_privileged_action_approvals_version', 'version > 0')
export class PrivilegedActionApproval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 120 })
  actionType!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 80 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 255, nullable: true })
  resourceId!: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'action_fingerprint', type: 'char', length: 64 })
  actionFingerprint!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  policy!: Record<string, unknown>;

  @Column({ name: 'approval_scope', type: 'varchar', length: 160 })
  approvalScope!: string;

  @Column({ name: 'required_assurance', type: 'varchar', length: 20, default: 'MFA' })
  requiredAssurance!: string;

  @Column({ name: 'requester_principal_id', type: 'varchar', length: 160 })
  requesterPrincipalId!: string;

  @Column({ name: 'requester_session_id', type: 'uuid', nullable: true })
  requesterSessionId!: string | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 160, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approver_session_id', type: 'uuid', nullable: true })
  approverSessionId!: string | null;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'varchar', length: 20, default: PrivilegedActionApprovalStatus.REQUESTED })
  status!: PrivilegedActionApprovalStatus;

  @Column({ name: 'is_emergency', type: 'boolean', default: false })
  isEmergency!: boolean;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  /**
   * Group 21 — post-incident review obligation for emergency access.
   *
   * Set to `PENDING_REVIEW` when the emergency window closes (by expiry or revocation). Null for
   * non-emergency approvals and for emergency approvals whose window is still open — see the CHECK
   * constraints in `1785753600608`, which also refuse a `REVIEWED` row with no reviewer, no timestamp or
   * empty notes, and refuse a review timestamped before the window it reviews.
   */
  @Column({ name: 'emergency_review_status', type: 'varchar', length: 16, nullable: true })
  emergencyReviewStatus!: 'PENDING_REVIEW' | 'REVIEWED' | null;

  @Column({ name: 'emergency_reviewed_at', type: 'timestamptz', nullable: true })
  emergencyReviewedAt!: Date | null;

  @Column({ name: 'emergency_reviewed_by', type: 'varchar', length: 160, nullable: true })
  emergencyReviewedBy!: string | null;

  @Column({ name: 'emergency_review_notes', type: 'varchar', length: 1000, nullable: true })
  emergencyReviewNotes!: string | null;

  @Column({ name: 'emergency_window_closed_at', type: 'timestamptz', nullable: true })
  emergencyWindowClosedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
