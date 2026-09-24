import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { AgentFinancialAccountBindingState } from './agent.enums';

/**
 * F-1 / F-2 — the explicit, persisted answer to "which WalletAccount and
 * LedgerAccount hold this Agent's electronic float?".
 *
 * Deterministic and stored. The relationship is never inferred from the Agent
 * UUID at runtime and never discovered by scanning ledger account names or
 * codes. Mirrors the proven `customer_financial_account_bindings` pattern
 * without reusing it, keeping Customer and Agent ownership isolated.
 */
@Entity({ name: 'agent_financial_account_bindings' })
@Index('idx_agent_financial_account_bindings_agent', ['agentId'])
export class AgentFinancialAccountBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'agent_wallet_id', type: 'uuid' })
  agentWalletId!: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId!: string;

  @Column({ name: 'ledger_account_id', type: 'uuid' })
  ledgerAccountId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** The Finance-approved classification actually used, recorded for audit. */
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  @Column({ type: 'varchar', length: 20, default: AgentFinancialAccountBindingState.ACTIVE })
  state!: AgentFinancialAccountBindingState;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160 })
  updatedBy!: string;

  @Column({ name: 'last_correlation_id', type: 'varchar', length: 255, nullable: true })
  lastCorrelationId!: string | null;

  @Column({ name: 'last_request_id', type: 'varchar', length: 255, nullable: true })
  lastRequestId!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
