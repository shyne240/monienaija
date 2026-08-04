import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { CustomerWalletStatus, WalletProvisioningHistoryAction } from './customer-wallet.enums';

@Entity({ name: 'wallet_provisioning_histories' })
@Index('idx_wallet_provisioning_histories_wallet_created', ['walletId', 'createdAt'])
@Check(
  'chk_wallet_provisioning_histories_action',
  "action IN ('PROVISIONED', 'STATUS_CHANGED', 'ALIAS_ADDED', 'OWNERSHIP_CREATED')",
)
@Check(
  'chk_wallet_provisioning_histories_statuses',
  "previous_status IS NULL OR previous_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')",
)
@Check(
  'chk_wallet_provisioning_histories_new_status',
  "new_status IS NULL OR new_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')",
)
export class WalletProvisioningHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ type: 'varchar', length: 30 })
  action!: WalletProvisioningHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 20, nullable: true })
  previousStatus!: CustomerWalletStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 20, nullable: true })
  newStatus!: CustomerWalletStatus | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
