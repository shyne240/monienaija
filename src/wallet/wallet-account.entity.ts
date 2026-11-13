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
import { WalletOwnerClass, WalletStatus } from './wallet.enums';

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

  /** Historical owner reference. Its classification is derived from authoritative domain rows. */
  @Column({ name: 'customer_id', type: 'varchar', length: 160 })
  customerId!: string;

  @Column({ name: 'owner_class', type: 'varchar', length: 12, default: WalletOwnerClass.REVIEW })
  ownerClass!: WalletOwnerClass;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: WalletStatus.ACTIVE })
  status!: WalletStatus;

  @Column({ name: 'ledger_account_id', type: 'uuid', unique: true })
  ledgerAccountId!: string;

  @OneToOne(() => LedgerAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ledger_account_id' })
  ledgerAccount!: LedgerAccount;

  /**
   * Institutional attribution (ARENA 4 Phase 2). Orthogonal to `owner_class`: a wallet stays
   * CUSTOMER/AGENT/SYSTEM-owned and additionally belongs to exactly one financial institution once
   * the governed `WALLET_INSTITUTION_ATTRIBUTION` workflow has run. `null` means deliberately
   * unattributed historical state — never a default institution.
   */
  @Column({ name: 'institution_id', type: 'uuid', nullable: true })
  institutionId!: string | null;

  @Column({ name: 'institution_attribution_id', type: 'uuid', nullable: true })
  institutionAttributionId!: string | null;

  @Column({ name: 'creation_idempotency_key', type: 'varchar', length: 255, nullable: true })
  creationIdempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
