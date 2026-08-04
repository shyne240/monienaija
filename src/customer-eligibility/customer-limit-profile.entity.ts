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

import { bigintTransformer } from '../common/bigint.transformer';

@Entity({ name: 'customer_limit_profiles' })
@Index('uq_customer_limit_profiles_active_customer', ['customerId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_limit_profiles_currency', ['currency'])
@Check('chk_customer_limit_profiles_daily_count', 'daily_transaction_count >= 0')
@Check(
  'chk_customer_limit_profiles_amounts_non_negative',
  'daily_transaction_amount_minor >= 0 AND single_transaction_amount_minor >= 0 AND monthly_transaction_amount_minor >= 0 AND wallet_balance_minor >= 0',
)
@Check('chk_customer_limit_profiles_version', 'version > 0')
export class CustomerLimitProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'daily_transaction_count', type: 'integer' })
  dailyTransactionCount!: number;

  @Column({
    name: 'daily_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  dailyTransactionAmountMinor!: string;

  @Column({
    name: 'single_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  singleTransactionAmountMinor!: string;

  @Column({
    name: 'monthly_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  monthlyTransactionAmountMinor!: string;

  @Column({ name: 'wallet_balance_minor', type: 'bigint', transformer: bigintTransformer })
  walletBalanceMinor!: string;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
