import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CustomerKycLevel, CustomerKycStatus } from './customer.enums';

@Entity({ name: 'customer_kyc_assessments' })
@Index('uq_customer_kyc_current', ['customerId'], {
  unique: true,
  where: 'is_current = TRUE',
})
@Index('idx_customer_kyc_customer_created', ['customerId', 'createdAt'])
export class CustomerKycAssessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'kyc_level', type: 'varchar', length: 20 })
  level!: CustomerKycLevel;

  @Column({ name: 'kyc_status', type: 'varchar', length: 20 })
  status!: CustomerKycStatus;

  @Column({ name: 'reason', type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'assessed_by', type: 'varchar', length: 160 })
  assessedBy!: string;

  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent!: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
