import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from './customer.enums';

@Entity({ name: 'customers' })
@Index('uq_customers_reference', ['reference'], { unique: true })
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ name: 'customer_type', type: 'varchar', length: 20 })
  type!: CustomerType;

  @Column({ type: 'varchar', length: 20 })
  status!: CustomerStatus;

  @Column({ name: 'kyc_level', type: 'varchar', length: 20 })
  kycLevel!: CustomerKycLevel;

  @Column({ name: 'kyc_status', type: 'varchar', length: 20 })
  kycStatus!: CustomerKycStatus;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
