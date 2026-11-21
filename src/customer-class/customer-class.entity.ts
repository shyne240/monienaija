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

/**
 * Class of service for customers. Deliberately independent from KYC tier: nothing here reads
 * or writes `customers.kyc_level`, and no KYC column exists on this table. The `code` alphabet
 * matches the limit-catalogue SEGMENT alphabet so a class code is consumable as `segmentCodes`.
 */
@Entity({ name: 'customer_classes' })
@Index('uq_customer_classes_reference', ['reference'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('uq_customer_classes_code', ['code'], { unique: true, where: 'deleted_at IS NULL' })
@Index('uq_customer_classes_default', ['isDefault'], {
  unique: true,
  where: 'is_default AND deleted_at IS NULL',
})
@Index('idx_customer_classes_status', ['status'])
@Index('idx_customer_classes_enabled', ['enabled'])
@Check('chk_customer_classes_code', `code ~ '^[A-Z0-9_]{3,80}$'`)
@Check('chk_customer_classes_kind', "kind IN ('CUSTOMER')")
@Check('chk_customer_classes_status', "status IN ('ACTIVE','DISABLED','DEPRECATED')")
@Check(
  'chk_customer_classes_configuration',
  "configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')",
)
@Check('chk_customer_classes_version', 'version > 0')
export class CustomerClass {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'CUSTOMER' })
  kind!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'configuration_status', type: 'varchar', length: 20, default: 'NOT_CONFIGURED' })
  configurationStatus!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160, nullable: true })
  updatedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
