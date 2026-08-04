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

import { CustomerOperatingPermissionType } from './customer-eligibility.enums';

@Entity({ name: 'customer_operating_permissions' })
@Index('uq_customer_operating_permissions_customer_type', ['customerId', 'type'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_operating_permissions_customer', ['customerId'])
@Check(
  'chk_customer_operating_permissions_type',
  "type IN ('DEPOSIT', 'WITHDRAW', 'TRANSFER', 'PAYMENT', 'BILL_PAYMENT', 'AIRTIME', 'CARD', 'VIRTUAL_ACCOUNT', 'QR_PAYMENT', 'USSD', 'API')",
)
@Check('chk_customer_operating_permissions_version', 'version > 0')
export class CustomerOperatingPermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: CustomerOperatingPermissionType;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

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
