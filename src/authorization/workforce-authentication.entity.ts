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
import type { A2WorkforceAssertionEvidenceV1 } from './workforce-authentication.types';

@Entity({ name: 'a2_workforce_sessions' })
@Index('uq_a2_workforce_session_token_hash', ['tokenHash'], { unique: true })
@Index('idx_a2_workforce_session_principal_status', ['principalId', 'status'])
@Index('idx_a2_workforce_session_expiry', ['status', 'expiresAt'])
@Check('chk_a2_workforce_session_status', "status IN ('ACTIVE','REVOKED','EXPIRED')")
export class A2WorkforceSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'principal_id', type: 'varchar', length: 160 }) principalId!: string;
  @Column({ type: 'varchar', length: 2048 }) issuer!: string;
  @Column({ type: 'varchar', length: 255 }) subject!: string;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash!: string;
  @Column({ type: 'varchar', length: 80 }) audience!: string;
  @Column({ type: 'varchar', length: 16 }) status!: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  @Column({ name: 'assurance_level', type: 'varchar', length: 16 }) assuranceLevel!:
    | 'PASSWORD'
    | 'MFA';
  @Column({ type: 'jsonb' }) roles!: readonly string[];
  @Column({ type: 'jsonb' }) scopes!: readonly string[];
  @Column({ name: 'assertion_evidence', type: 'jsonb' })
  assertionEvidence!: A2WorkforceAssertionEvidenceV1;
  @Column({ name: 'authenticated_at', type: 'timestamptz' }) authenticatedAt!: Date;
  @Column({ name: 'issued_at', type: 'timestamptz' }) issuedAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'revoke_reason', type: 'varchar', length: 500, nullable: true }) revokeReason!:
    | string
    | null;
  @VersionColumn({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'a2_finance_role_assignments' })
@Index('uq_a2_finance_assignment_reference_version', ['assignmentReference', 'assignmentVersion'], {
  unique: true,
})
@Index('idx_a2_finance_assignment_principal_status', ['principalId', 'status'])
@Index('idx_a2_finance_assignment_role_status', ['roleKey', 'status'])
@Check('chk_a2_finance_assignment_status', "status IN ('ACTIVE','REVOKED')")
export class A2FinanceRoleAssignment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'assignment_reference', type: 'varchar', length: 160 })
  assignmentReference!: string;
  @Column({ name: 'assignment_version', type: 'integer' }) assignmentVersion!: number;
  @Column({ name: 'principal_id', type: 'varchar', length: 160 }) principalId!: string;
  @Column({ name: 'role_key', type: 'varchar', length: 100 }) roleKey!: string;
  @Column({ type: 'jsonb' }) scopes!: readonly string[];
  @Column({ type: 'varchar', length: 16 }) status!: 'ACTIVE' | 'REVOKED';
  @Column({ type: 'boolean', default: true }) interim!: true;
  @Column({ name: 'effective_from', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'effective_to', type: 'timestamptz' }) effectiveTo!: Date;
  @Column({ name: 'assigned_by', type: 'varchar', length: 160 }) assignedBy!: string;
  @Column({ name: 'assigned_at', type: 'timestamptz' }) assignedAt!: Date;
  @Column({ name: 'revoked_by', type: 'varchar', length: 160, nullable: true }) revokedBy!:
    | string
    | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'bootstrap_reference', type: 'varchar', length: 160, nullable: true })
  bootstrapReference!: string | null;
  @Column({ name: 'approval_ids', type: 'jsonb' }) approvalIds!: readonly string[];
  @Column({ name: 'audit_references', type: 'jsonb' }) auditReferences!: readonly string[];
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'a2_workforce_bootstrap_consumptions' })
@Index('uq_a2_workforce_bootstrap_nonce', ['nonce'], { unique: true })
@Index('idx_a2_workforce_bootstrap_principal', ['principalId'])
export class A2WorkforceBootstrapConsumption {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'bootstrap_reference', type: 'varchar', length: 160 })
  bootstrapReference!: string;
  @Column({ type: 'varchar', length: 255 }) nonce!: string;
  @Column({ name: 'statement_hash', type: 'char', length: 64 }) statementHash!: string;
  @Column({ name: 'principal_id', type: 'varchar', length: 160 }) principalId!: string;
  @Column({ name: 'role_key', type: 'varchar', length: 100 }) roleKey!: 'FINANCE_ADMIN';
  @Column({ type: 'jsonb' }) scopes!: readonly string[];
  @Column({ type: 'varchar', length: 80 }) environment!: string;
  @Column({ type: 'varchar', length: 80 }) audience!: string;
  @Column({ name: 'signing_key_reference', type: 'varchar', length: 160 })
  signingKeyReference!: string;
  @Column({ name: 'approval_change_reference', type: 'varchar', length: 160 })
  approvalChangeReference!: string;
  @Column({ name: 'consumed_at', type: 'timestamptz' }) consumedAt!: Date;
  @Column({ name: 'audit_reference', type: 'uuid' }) auditReference!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'a2_security_rate_buckets' })
@Index('uq_a2_security_rate_bucket_key', ['bucketKey'], { unique: true })
export class A2SecurityRateBucket {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'bucket_key', type: 'char', length: 64 }) bucketKey!: string;
  @Column({ name: 'category', type: 'varchar', length: 80 }) category!: string;
  @Column({ type: 'double precision' }) tokens!: number;
  @Column({ name: 'last_refill_at', type: 'timestamptz' }) lastRefillAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @VersionColumn({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
