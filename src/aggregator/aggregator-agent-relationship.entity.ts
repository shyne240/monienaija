import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { Aggregator } from './aggregator.entity';
import { Agent } from '../agent/agent.entity';
import { AggregatorAgentRelationshipStatus } from './aggregator.enums';

/**
 * Aggregator ↔ Agent relationship — first-class, auditable, lifecycle-aware.
 *
 * Cardinality (A18 determination):
 * - One Agent may belong to at most ONE ACTIVE Aggregator at a time (1-to-many: one Aggregator manages many Agents).
 * - An Agent may exist without an Aggregator (independent).
 * - History preserved via status transitions, not by deleting rows.
 *
 * Rationale: V1 spec says "Agent belonging to an Aggregator" (singular) and distinguishes
 * Agent independence. Existing repo has no parent_agent/hierarchy; inspection found no
 * multi-aggregator requirement. Chose single-active model with partial unique index
 * to prevent duplicate active assignments and to keep future disassociate/terminate auditable.
 * If spec later requires many-to-many, this model can be extended, but A18 does not silently
 * choose many-to-many.
 *
 * Lifecycle: ACTIVE → SUSPENDED → ACTIVE / TERMINATED ; ACTIVE → TERMINATED.
 * Agent remains independent: terminating relationship does NOT terminate Agent itself.
 */
@Entity({ name: 'aggregator_agent_assignments' })
@Index('idx_aggregator_agent_aggregator', ['aggregatorId'])
@Index('idx_aggregator_agent_agent', ['agentId'])
@Index('idx_aggregator_agent_status', ['status'])
// Partial unique index is created in migration for ACTIVE assignments; decorator cannot express partial.
@Check(
  'chk_aggregator_agent_status',
  "status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')",
)
@Check('chk_aggregator_agent_version', 'version > 0')
export class AggregatorAgentAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregator_id', type: 'uuid' })
  aggregatorId!: string;

  @ManyToOne(() => Aggregator, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'aggregator_id' })
  aggregator!: Aggregator;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => Agent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent;

  @Column({ type: 'varchar', length: 20, default: AggregatorAgentRelationshipStatus.ACTIVE })
  status!: AggregatorAgentRelationshipStatus;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt!: Date;

  @Column({ name: 'unassigned_at', type: 'timestamptz', nullable: true })
  unassignedAt!: Date | null;

  @Column({ name: 'assigned_by', type: 'varchar', length: 160 })
  assignedBy!: string;

  @Column({ name: 'unassigned_by', type: 'varchar', length: 160, nullable: true })
  unassignedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
