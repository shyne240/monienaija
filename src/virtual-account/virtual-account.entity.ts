import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { VirtualAccountStatus } from './virtual-account.enums';

@Entity({ name: 'virtual_accounts' })
@Index('uq_virtual_accounts_wallet_provider_active', ['walletId', 'provider'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('uq_virtual_accounts_provider_number', ['provider', 'accountNumber'], { unique: true })
@Index('idx_virtual_accounts_wallet', ['walletId', 'status'])
export class VirtualAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ name: 'bank_code', type: 'varchar', length: 20 })
  bankCode!: string;

  @Column({ name: 'account_number', type: 'varchar', length: 32 })
  accountNumber!: string;

  @Column({ name: 'account_name', type: 'varchar', length: 160 })
  accountName!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: VirtualAccountStatus;

  @Column({ type: 'varchar', length: 64 })
  reference!: string;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt!: Date;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt!: Date | null;
}
