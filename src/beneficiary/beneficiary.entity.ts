import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { BeneficiaryType } from './beneficiary.enums';

@Entity({ name: 'beneficiaries' })
@Index('uq_beneficiaries_duplicate', ['customerId', 'bankCode', 'accountNumber', 'type'], {
  unique: true,
})
@Index('idx_beneficiaries_customer', ['customerId', 'createdAt'])
export class Beneficiary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 160 })
  customerId!: string;

  @Column({ type: 'varchar', length: 100 })
  nickname!: string;

  @Column({ name: 'bank_code', type: 'varchar', length: 20 })
  bankCode!: string;

  @Column({ name: 'account_number', type: 'varchar', length: 32 })
  accountNumber!: string;

  @Column({ name: 'account_name', type: 'varchar', length: 160 })
  accountName!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: BeneficiaryType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
