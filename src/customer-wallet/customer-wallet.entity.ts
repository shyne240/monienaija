import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { CustomerWalletStatus, CustomerWalletType } from './customer-wallet.enums';

@Entity({ name: 'customer_wallets' })
@Index('uq_customer_wallets_primary_customer', ['customerId'], {
  unique: true,
  where: "type = 'PRIMARY' AND deleted_at IS NULL",
})
@Index('idx_customer_wallets_customer', ['customerId', 'status'])
@Check('chk_customer_wallets_status', "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')")
@Check('chk_customer_wallets_type', "type IN ('PRIMARY', 'SAVINGS', 'BUSINESS', 'ESCROW')")
@Check('chk_customer_wallets_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_customer_wallets_version', 'version > 0')
export class CustomerWallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: CustomerWalletType;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerWalletStatus.PENDING })
  status!: CustomerWalletStatus;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
