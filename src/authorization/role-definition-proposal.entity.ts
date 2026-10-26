import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface RoleDefinitionFunctionGrant {
  functionCode: string;
  accessType: 'VIEW' | 'EXECUTE' | 'INITIATE' | 'APPROVE';
}

export interface RoleDefinitionPriorSnapshot {
  displayName: string;
  description: string;
  readOnly: boolean;
  isActive: boolean;
  definitionVersion: number;
  functionGrants: RoleDefinitionFunctionGrant[];
}

/**
 * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01
 *
 * The maker/checker ledger for governed role-definition changes (create a new role, or modify a
 * role previously created through this same workflow). A row here NEVER directly mutates
 * `authorization_roles` / `authorization_role_functions` — those tables are only ever touched by
 * `RoleDefinitionGovernanceService.apply()`, after independent approval, inside one atomic
 * transaction. A proposal existing, or even being APPROVED, has zero effect on live authorization
 * until `apply()` succeeds (see AuthorizationCatalogueRuntimeService.resolveForRoleKeys, which only
 * ever reads committed, is_active = true rows from those two tables).
 */
@Entity({ name: 'role_definition_proposals' })
@Index('idx_role_definition_proposals_target_role_key', ['targetRoleKey'])
@Index('idx_role_definition_proposals_status', ['status'])
@Index('idx_role_definition_proposals_proposer', ['proposerPrincipalId'])
export class RoleDefinitionProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'proposal_type', type: 'varchar', length: 10 })
  proposalType!: 'CREATE' | 'MODIFY';

  @Column({ name: 'target_role_key', type: 'varchar', length: 100 })
  targetRoleKey!: string;

  @Column({ name: 'proposed_display_name', type: 'varchar', length: 160 })
  proposedDisplayName!: string;

  @Column({ name: 'proposed_description', type: 'varchar', length: 500 })
  proposedDescription!: string;

  @Column({ name: 'proposed_read_only', type: 'boolean', default: false })
  proposedReadOnly!: boolean;

  @Column({ name: 'proposed_function_grants', type: 'jsonb' })
  proposedFunctionGrants!: RoleDefinitionFunctionGrant[];

  /** MODIFY only: when true, the role is deactivated (`isActive = false`) as part of applying this proposal. */
  @Column({ type: 'boolean', default: false })
  deactivate!: boolean;

  /** Required for MODIFY (optimistic-concurrency token against `authorization_roles.definition_version`); always null for CREATE. */
  @Column({ name: 'expected_definition_version', type: 'integer', nullable: true })
  expectedDefinitionVersion!: number | null;

  /** MODIFY only: the role's metadata + active function grants at proposal-submission time, captured for audit "before" state. */
  @Column({ name: 'prior_snapshot', type: 'jsonb', nullable: true })
  priorSnapshot!: RoleDefinitionPriorSnapshot | null;

  /** sha256 hex of the canonicalized proposal content, computed once at submission and never recomputed from client input. */
  @Column({ name: 'action_fingerprint', type: 'char', length: 64 })
  actionFingerprint!: string;

  @Column({ name: 'approval_id', type: 'uuid', nullable: true })
  approvalId!: string | null;

  /** Set only once APPLIED (CREATE: the newly created role's id; MODIFY: the modified role's id). */
  @Column({ name: 'applied_role_id', type: 'uuid', nullable: true })
  appliedRoleId!: string | null;

  @Column({ name: 'proposer_principal_id', type: 'varchar', length: 160 })
  proposerPrincipalId!: string;

  @Column({ name: 'proposer_session_id', type: 'uuid', nullable: true })
  proposerSessionId!: string | null;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'APPLIED' | 'APPLY_FAILED';

  @Column({ name: 'decided_by', type: 'varchar', length: 160, nullable: true })
  decidedBy!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decision_reason', type: 'varchar', length: 500, nullable: true })
  decisionReason!: string | null;

  @Column({ name: 'applied_by', type: 'varchar', length: 160, nullable: true })
  appliedBy!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'apply_failure_reason', type: 'varchar', length: 500, nullable: true })
  applyFailureReason!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 100, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
