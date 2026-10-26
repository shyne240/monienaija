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
import { AgentOutlet } from './agent-outlet.entity';
import { TerminalStatus } from './outlet.enums';

/**
 * AgentTerminal — device/terminal associated with an Agent and its Outlet.
 *
 * Minimal V1 foundation:
 * - Agent-owned (agent_id) + Outlet-associated (outlet_id) — outlet must belong to same agent (enforced in service)
 * - Globally unique reference (and optional code) where deleted_at IS NULL
 * - Lifecycle ACTIVE → SUSPENDED ↔ ACTIVE → TERMINATED (TERMINATED terminal)
 * - No wallet, no ledger, no financial account, no NIBSS/bank/SIM/crypto/settlement fields
 * - Aggregator context via Agent's Aggregator relationship, not a direct FK
 */
@Entity({ name: 'agent_terminals' })
@Index('idx_agent_terminals_agent', ['agentId'])
@Index('idx_agent_terminals_outlet', ['outletId'])
@Index('idx_agent_terminals_status', ['status'])
@Check('chk_agent_terminals_status', "status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')")
@Check('chk_agent_terminals_version', 'version > 0')
@Check('chk_agent_terminals_reference', 'length(reference) >= 3')
export class AgentTerminal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => Agent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent;

  @Column({ name: 'outlet_id', type: 'uuid' })
  outletId!: string;

  @ManyToOne(() => AgentOutlet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'outlet_id' })
  outlet!: AgentOutlet;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  label!: string | null;

  @Column({ type: 'varchar', length: 20, default: TerminalStatus.ACTIVE })
  status!: TerminalStatus;

  @Column({ name: 'serial_number', type: 'varchar', length: 100, nullable: true })
  serialNumber!: string | null;

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
