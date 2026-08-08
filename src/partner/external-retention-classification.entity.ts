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

@Entity({ name: 'external_retention_classifications' })
@Index('uq_external_retention_classifications_dataset', ['dataset'], { unique: true })
@Check(
  'chk_external_retention_classifications_dataset',
  "dataset ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'",
)
@Check('chk_external_retention_classifications_owner', "owner ~ '^[\\x20-\\x7E]{1,160}$'")
@Check(
  'chk_external_retention_classifications_level',
  "level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')",
)
@Check('chk_external_retention_classifications_retention_days', 'retention_days >= 0')
@Check(
  'chk_external_retention_classifications_secret_retention',
  "level <> 'HIGHLY_RESTRICTED' OR retention_days >= 365",
)
@Check(
  'chk_external_retention_classifications_hold_support',
  "level IN ('RESTRICTED', 'HIGHLY_RESTRICTED') OR hold_support = true",
)
export class ExternalRetentionClassificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dataset', type: 'varchar', length: 120 })
  dataset!: string;

  @Column({ name: 'level', type: 'varchar', length: 24 })
  level!: ExternalDataHandlingLevel;

  @Column({ name: 'owner', type: 'varchar', length: 160 })
  owner!: string;

  @Column({ name: 'retention_days', type: 'integer' })
  retentionDays!: number;

  @Column({ name: 'hold_support', type: 'boolean', default: true })
  holdSupport!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
