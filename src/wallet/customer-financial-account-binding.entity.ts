import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import { WalletAccount } from './wallet-account.entity';

@Entity({ name: 'customer_financial_account_bindings' })
@Unique('uq_customer_financial_account_bindings_customer_wallet', ['customerWalletId'])
@Unique('uq_customer_financial_account_bindings_wallet_account', ['walletAccountId'])
@Unique('uq_customer_financial_account_bindings_ledger_account', ['ledgerAccountId'])
@Index(
  'uq_customer_financial_account_bindings_active_customer_currency',
  ['customerId', 'currency'],
  {
    unique: true,
    where: "state = 'ACTIVE'",
  },
)
@Index('idx_customer_financial_account_bindings_customer_state', ['customerId', 'state'])
@Index('idx_customer_financial_account_bindings_state_updated', ['state', 'updatedAt'])
@Check(
  'chk_customer_financial_account_bindings_state',
  "state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REPAIR_REQUIRED', 'CLOSED')",
)
@Check('chk_customer_financial_account_bindings_currency', "currency ~ '^[A-Z]{3}$'")
@Check(
  'chk_customer_financial_account_bindings_accounting_unit',
  "accounting_unit = 'CUSTOMER_FUNDS'",
)
@Check(
  'chk_customer_financial_account_bindings_source_customer_version',
  'source_customer_version > 0',
)
@Check(
  'chk_customer_financial_account_bindings_source_wallet_version',
  'source_customer_wallet_version > 0',
)
@Check('chk_customer_financial_account_bindings_version', 'version > 0')
@Check('chk_customer_financial_account_bindings_created_by', 'length(created_by) > 0')
@Check('chk_customer_financial_account_bindings_updated_by', 'length(updated_by) > 0')
@Check(
  'chk_customer_financial_account_bindings_closed_at',
  "(state = 'CLOSED' AND closed_at IS NOT NULL) OR (state <> 'CLOSED' AND closed_at IS NULL)",
)
export class CustomerFinancialAccountBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'customer_wallet_id', type: 'uuid' })
  customerWalletId!: string;

  @OneToOne(() => CustomerWallet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_wallet_id' })
  customerWallet!: CustomerWallet;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId!: string;

  @OneToOne(() => WalletAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount!: WalletAccount;

  @Column({ name: 'ledger_account_id', type: 'uuid' })
  ledgerAccountId!: string;

  @OneToOne(() => LedgerAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ledger_account_id' })
  ledgerAccount!: LedgerAccount;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64, default: 'CUSTOMER_FUNDS' })
  accountingUnit!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerFinancialAccountBindingState.PENDING })
  state!: CustomerFinancialAccountBindingState;

  @Column({ name: 'source_customer_version', type: 'integer' })
  sourceCustomerVersion!: number;

  @Column({ name: 'source_customer_wallet_version', type: 'integer' })
  sourceCustomerWalletVersion!: number;

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
