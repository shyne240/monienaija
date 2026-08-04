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

import { CustomerProductEnrollmentStatus } from './customer-eligibility.enums';

@Entity({ name: 'customer_product_enrollments' })
@Index('uq_customer_product_enrollments_customer_product', ['customerId', 'product'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_product_enrollments_customer_status', ['customerId', 'status'])
@Check(
  'chk_customer_product_enrollments_status',
  "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')",
)
@Check('chk_customer_product_enrollments_product', "product ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'")
@Check('chk_customer_product_enrollments_version', 'version > 0')
export class CustomerProductEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 80 })
  product!: string;

  @Column({ type: 'varchar', length: 20, default: CustomerProductEnrollmentStatus.PENDING })
  status!: CustomerProductEnrollmentStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamptz' })
  statusChangedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
