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

import { CustomerRestrictionType } from './customer-eligibility.enums';

@Entity({ name: 'customer_restrictions' })
@Index('uq_customer_restrictions_customer_type', ['customerId', 'type'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_restrictions_customer_active', ['customerId', 'isActive'])
@Check(
  'chk_customer_restrictions_type',
  "type IN ('NONE', 'LIMITED', 'MANUAL_REVIEW', 'FROZEN', 'BLACKLISTED')",
)
@Check('chk_customer_restrictions_version', 'version > 0')
export class CustomerRestriction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: CustomerRestrictionType;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
