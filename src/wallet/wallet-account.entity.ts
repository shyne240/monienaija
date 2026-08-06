import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { LedgerAccount } from '../ledger/ledger-account.entity';
import { WalletStatus } from './wallet.enums';

@Entity({ name: 'wallet_accounts' })
@Unique('uq_wallet_accounts_id_ledger_account', ['id', 'ledgerAccountId'])
@Index('uq_wallet_accounts_customer_currency', ['customerId', 'currency'], { unique: true })
@Index('idx_wallet_accounts_customer', ['customerId'])
@Index('uq_wallet_accounts_creation_idempotency_key', ['creationIdempotencyKey'], {
  unique: true,
  where: 'creation_idempotency_key IS NOT NULL',
})
export class WalletAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Opaque reference owned by the future identity/customer bounded context. */
  @Column({ name: 'customer_id', type: 'varchar', length: 160 })
  customerId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: WalletStatus.ACTIVE })
  status!: WalletStatus;

  @Column({ name: 'ledger_account_id', type: 'uuid', unique: true })
  ledgerAccountId!: string;

  @OneToOne(() => LedgerAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ledger_account_id' })
  ledgerAccount!: LedgerAccount;

  @Column({ name: 'creation_idempotency_key', type: 'varchar', length: 255, nullable: true })
  creationIdempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
