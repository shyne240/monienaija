import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { BankStatus } from './bank.enums';

@Entity({ name: 'banks' })
@Index('uq_banks_bank_code', ['bankCode'], { unique: true })
@Index('idx_banks_status', ['status'])
export class Bank {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'bank_code', type: 'varchar', length: 20 })
  bankCode!: string;

  @Column({ name: 'bank_name', type: 'varchar', length: 160 })
  bankName!: string;

  @Column({ name: 'short_name', type: 'varchar', length: 80 })
  shortName!: string;

  @Column({ name: 'nip_supported', type: 'boolean', default: false })
  nipSupported!: boolean;

  @Column({ type: 'varchar', length: 20 })
  status!: BankStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
