import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LedgerAccountType, LedgerNormalBalance } from './ledger.enums';

@Entity({ name: 'ledger_accounts' })
@Index('uq_ledger_accounts_code', ['code'], { unique: true })
@Index('idx_ledger_accounts_currency_unit', ['currency', 'accountingUnit'])
export class LedgerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'account_type', type: 'varchar', length: 20 })
  accountType!: LedgerAccountType;

  @Column({ name: 'normal_balance', type: 'varchar', length: 6 })
  normalBalance!: LedgerNormalBalance;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64, default: 'CUSTOMER_FUNDS' })
  accountingUnit!: string;

  @Column({ name: 'allow_negative_balance', type: 'boolean', default: false })
  allowNegativeBalance!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
