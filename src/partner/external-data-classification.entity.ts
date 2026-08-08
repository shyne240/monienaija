import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalDataHandlingLevel } from './external-data-minimization.enums';

@Entity({ name: 'external_data_classifications' })
@Index('uq_external_data_classifications_field', ['fieldName'], { unique: true })
@Index('idx_external_data_classifications_level', ['level'])
@Check('chk_external_data_classifications_field', "field_name ~ '^[\\x20-\\x7E]{1,200}$'")
@Check(
  'chk_external_data_classifications_source_domain',
  "source_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$'",
)
@Check('chk_external_data_classifications_owner', "owner ~ '^[\\x20-\\x7E]{1,160}$'")
@Check(
  'chk_external_data_classifications_secret_none',
  "secret_category IS NULL OR level = 'HIGHLY_RESTRICTED'",
)
@Check(
  'chk_external_data_classifications_level',
  "level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')",
)
@Check('chk_external_data_classifications_retention_days', 'retention_days >= 0')
export class ExternalDataClassificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'field_name', type: 'varchar', length: 200 })
  fieldName!: string;

  @Column({ name: 'source_domain', type: 'varchar', length: 80 })
  sourceDomain!: string;

  @Column({ name: 'level', type: 'varchar', length: 24 })
  level!: ExternalDataHandlingLevel;

  @Column({ name: 'owner', type: 'varchar', length: 160 })
  owner!: string;

  @Column({ name: 'secret_category', type: 'varchar', length: 80, nullable: true })
  secretCategory!: string | null;

  @Column({ name: 'retention_days', type: 'integer', default: 365 })
  retentionDays!: number;

  @Column({ name: 'hold_support', type: 'boolean', default: true })
  holdSupport!: boolean;

  @Column({ name: 'audience_maximums', type: 'jsonb' })
  audienceMaximums!: Record<string, string>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
