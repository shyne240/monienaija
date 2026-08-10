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
import type {
  B2FFinanceControlDecisionV1,
  B2FFinanceControlPolicyDefinitionV1,
} from './b2f-finance-control.types';

@Entity({ name: 'b2f_finance_control_policies' })
@Index('uq_b2f_finance_control_policy_key_version', ['policyKey', 'policyVersion'], {
  unique: true,
})
@Index('uq_b2f_finance_control_policy_active', ['policyKey'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Check('chk_b2f_finance_control_policy_status', "status IN ('DRAFT','ACTIVE','RETIRED','REJECTED')")
@Check('chk_b2f_finance_control_policy_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
export class B2FFinanceControlPolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'policy_reference', type: 'varchar', length: 100, unique: true })
  policyReference!: string;
  @Column({ name: 'policy_key', type: 'varchar', length: 100 })
  policyKey!: 'finance.control-policy.ng.primary';
  @Column({ name: 'policy_version', type: 'integer' }) policyVersion!: number;
  @Column({ type: 'varchar', length: 16 }) status!: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'REJECTED';
  @Column({ name: 'definition_hash', type: 'char', length: 64 }) definitionHash!: string;
  @Column({ type: 'jsonb' }) definition!: B2FFinanceControlPolicyDefinitionV1;
  @Column({ name: 'effective_from', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true }) effectiveTo!: Date | null;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'approval_id', type: 'uuid', nullable: true }) approvalId!: string | null;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'b2f_finance_control_decisions' })
@Index('uq_b2f_finance_control_decision_reference', ['decisionReference'], { unique: true })
@Index('idx_b2f_finance_control_decision_resource', ['resourceType', 'resourceId'])
@Index('idx_b2f_finance_control_decision_outcome', ['outcome', 'createdAt'])
@Check('chk_b2f_finance_control_decision_outcome', "outcome IN ('ALLOW','DENY')")
@Check(
  'chk_b2f_finance_control_decision_hashes',
  "request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$'",
)
export class B2FFinanceControlDecision {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'decision_reference', type: 'varchar', length: 100 }) decisionReference!: string;
  @Column({ type: 'varchar', length: 8 }) outcome!: 'ALLOW' | 'DENY';
  @Column({ type: 'varchar', length: 80 }) action!: string;
  @Column({ name: 'materiality_band', type: 'varchar', length: 20, nullable: true })
  materialityBand!: string | null;
  @Column({ name: 'policy_key', type: 'varchar', length: 100 }) policyKey!: string;
  @Column({ name: 'policy_version', type: 'integer' }) policyVersion!: number;
  @Column({ name: 'resource_type', type: 'varchar', length: 100 }) resourceType!: string;
  @Column({ name: 'resource_id', type: 'varchar', length: 255 }) resourceId!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'decision_hash', type: 'char', length: 64 }) decisionHash!: string;
  @Column({ type: 'jsonb' }) decision!: B2FFinanceControlDecisionV1;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
