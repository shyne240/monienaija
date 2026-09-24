import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { AgentWalletStatus } from './agent.enums';

/**
 * F-2 — the Agent's dedicated e-float wallet registry record.
 *
 * One open wallet per Agent per currency; NGN only in V1. Carries NO balance:
 * the electronic balance lives solely in the bound LedgerAccount, so there is
 * no second balance system and no numeric float column on Agent.
 *
 * Physical cash held by an Agent is NOT represented here or anywhere in the
 * ledger.
 */
@Entity({ name: 'agent_wallets' })
@Index('idx_agent_wallets_agent', ['agentId'])
export class AgentWallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: AgentWalletStatus.ACTIVE })
  status!: AgentWalletStatus;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
}
