import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { Agent } from '../agent/agent.entity';
import { OutletStatus } from './outlet.enums';

/**
 * AgentOutlet — physical/service location for an Agent.
 *
 * Minimal V1 foundation for future Agent App / operational workflows.
 * - Agent-owned (agent_id FK agents), multiple outlets per Agent
 * - Globally unique reference (and optional code) where deleted_at IS NULL
 * - Name/display name, optional address fields (minimal, no geospatial/regulatory)
 * - Lifecycle ACTIVE → SUSPENDED ↔ ACTIVE → TERMINATED (TERMINATED terminal)
 * - No wallet, no ledger, no financial balance, no Aggregator foreign key;
 *   Aggregator context is derived via A18 AggregatorAgentRelationship when needed.
 */
@Entity({ name: 'agent_outlets' })
@Index('idx_agent_outlets_agent', ['agentId'])
@Index('idx_agent_outlets_status', ['status'])
@Check('chk_agent_outlets_status', "status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')")
@Check('chk_agent_outlets_version', 'version > 0')
@Check('chk_agent_outlets_reference', 'length(reference) >= 3')
@Check('chk_agent_outlets_name', 'length(name) >= 2')
export class AgentOutlet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => Agent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 320 })
  name!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160, nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 20, default: OutletStatus.ACTIVE })
  status!: OutletStatus;

  @Column({ name: 'address_line', type: 'varchar', length: 500, nullable: true })
  addressLine!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: 'NG' })
  country!: string | null;

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
