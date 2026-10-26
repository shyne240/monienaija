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

@Entity({ name: 'agent_funding_requests' })
@Index('uq_agent_funding_requests_idempotency', ['direction', 'agentId', 'idempotencyKey'], {
  unique: true,
})
@Index('uq_agent_funding_requests_approval', ['approvalId'], { unique: true })
@Index('uq_agent_funding_requests_journal', ['journalId'], { unique: true })
@Index('idx_agent_funding_requests_status_created', ['status', 'createdAt'])
@Index('idx_agent_funding_requests_aggregator_created', ['aggregatorId', 'createdAt'], {
  where: 'aggregator_id IS NOT NULL',
})
@Index('idx_agent_funding_requests_maker_created', ['makerPrincipalId', 'createdAt'])
@Check('chk_agent_funding_requests_direction', "direction IN ('FUND','DEFUND')")
@Check('chk_agent_funding_requests_status', "status IN ('PENDING','REJECTED','EXECUTED')")
@Check('chk_agent_funding_requests_amount', 'amount_minor > 0')
@Check(
  'chk_agent_funding_requests_aggregator',
  '(is_aggregator_funding AND aggregator_id IS NOT NULL) OR (NOT is_aggregator_funding AND aggregator_id IS NULL)',
)
@Check('chk_agent_funding_requests_request_hash', "request_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_agent_funding_requests_approval_fingerprint', "approval_fingerprint ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_agent_funding_requests_maker_checker',
  `(
    status = 'PENDING' AND checker_principal_id IS NULL AND checker_role IS NULL
      AND checker_type IS NULL AND journal_id IS NULL AND rejected_at IS NULL AND executed_at IS NULL
      AND approved_at IS NULL AND rejection_reason IS NULL
  ) OR (
    status = 'REJECTED' AND checker_principal_id IS NOT NULL
      AND checker_role = 'FINANCE_CONTROLLER' AND checker_type IS NOT NULL
      AND checker_principal_id <> maker_principal_id AND journal_id IS NULL
      AND rejected_at IS NOT NULL AND executed_at IS NULL AND approved_at IS NULL
      AND rejection_reason IS NOT NULL
  ) OR (
    status = 'EXECUTED' AND checker_principal_id IS NOT NULL
      AND checker_role = 'FINANCE_CONTROLLER' AND checker_type IS NOT NULL
      AND checker_principal_id <> maker_principal_id AND journal_id IS NOT NULL
      AND rejected_at IS NULL AND executed_at IS NOT NULL AND approved_at IS NOT NULL
      AND rejection_reason IS NULL
  )`,
)
@Check('chk_agent_funding_requests_version', 'version > 0')
export class AgentFundingRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10 })
  direction!: 'FUND' | 'DEFUND';

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'aggregator_id', type: 'uuid', nullable: true })
  aggregatorId!: string | null;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3, default: 'NGN' })
  currency!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 255 })
  reference!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'is_aggregator_funding', type: 'boolean', default: false })
  isAggregatorFunding!: boolean;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'approval_fingerprint', type: 'char', length: 64 })
  approvalFingerprint!: string;

  @Column({ name: 'approval_id', type: 'uuid' })
  approvalId!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'REJECTED' | 'EXECUTED';

  @Column({ name: 'maker_principal_id', type: 'varchar', length: 160 })
  makerPrincipalId!: string;

  @Column({ name: 'maker_role', type: 'varchar', length: 80 })
  makerRole!: string;

  @Column({ name: 'maker_type', type: 'varchar', length: 20 })
  makerType!: string;

  @Column({ name: 'checker_principal_id', type: 'varchar', length: 160, nullable: true })
  checkerPrincipalId!: string | null;

  @Column({ name: 'checker_role', type: 'varchar', length: 80, nullable: true })
  checkerRole!: string | null;

  @Column({ name: 'checker_type', type: 'varchar', length: 20, nullable: true })
  checkerType!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
