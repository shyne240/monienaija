import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export type CustomerTierDefaultClassStatus = 'PENDING_APPROVAL' | 'APPROVED';

@Entity({ name: 'customer_tier_default_classes' })
@Index('idx_customer_tier_default_classes_class', ['classId'])
@Index('idx_customer_tier_default_classes_status', ['status'])
@Check('chk_customer_tier_default_classes_tier', "tier IN ('LEVEL_1','LEVEL_2','LEVEL_3')")
@Check('chk_customer_tier_default_classes_status', "status IN ('PENDING_APPROVAL','APPROVED')")
@Check('chk_customer_tier_default_classes_version', 'version > 0')
export class CustomerTierDefaultClass {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  tier!: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';

  @Column({ name: 'class_id', type: 'uuid' })
  classId!: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING_APPROVAL' })
  status!: CustomerTierDefaultClassStatus;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 160, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approval_id', type: 'uuid', nullable: true })
  approvalId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({
    name: 'global_default_class_code_at_migration',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  globalDefaultClassCodeAtMigration!: string | null;

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
}
