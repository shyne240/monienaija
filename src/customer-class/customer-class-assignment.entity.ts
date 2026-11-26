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
 * One row per class assignment episode. Switching a customer class closes the live row
 * (`is_active=false`, `effective_to=now`, version bump) and inserts a fresh row — so the table
 * itself is the auditable assignment history, and the partial unique index
 * `uq_customer_class_assignments_active` guarantees at most one live assignment per customer.
 */
@Entity({ name: 'customer_class_assignments' })
@Index('uq_customer_class_assignments_active', ['customerId'], {
  unique: true,
  where: 'is_active AND deleted_at IS NULL',
})
@Index('idx_customer_class_assignments_class', ['classId'])
@Index('idx_customer_class_assignments_customer_effective', ['customerId', 'effectiveFrom'])
@Check(
  'chk_customer_class_assignments_effective',
  'effective_to IS NULL OR effective_to > effective_from',
)
@Check(
  'chk_customer_class_assignments_source',
  "source IN ('REGISTRATION_DEFAULT','MANUAL','BACKFILL','SWITCH','TIER_DEFAULT')",
)
@Check('chk_customer_class_assignments_version', 'version > 0')
export class CustomerClassAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'class_id', type: 'uuid' })
  classId!: string;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'integer', default: 0 })
  precedence!: number;

  @Column({ type: 'varchar', length: 40, default: 'MANUAL' })
  source!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

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
