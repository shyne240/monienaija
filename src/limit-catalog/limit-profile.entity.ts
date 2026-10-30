import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  LimitProfileConfigurationStatus,
  LimitProfileKind,
  LimitProfileStatus,
} from './limit-catalog.enums';

@Entity({ name: 'limit_profiles' })
@Index('uq_limit_profiles_code_active', ['code'], { unique: true, where: 'deleted_at IS NULL' })
@Index('idx_limit_profiles_kind', ['kind'])
@Index('idx_limit_profiles_status', ['status'])
@Check('chk_limit_profiles_code', "code ~ '^[A-Z0-9_]{3,80}$'")
@Check('chk_limit_profiles_kind', "kind IN ('CUSTOMER','AGENT','SYSTEM','UNIVERSAL')")
@Check('chk_limit_profiles_status', "status IN ('ACTIVE','DISABLED','DEPRECATED')")
@Check('chk_limit_profiles_configuration', "configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')")
@Check('chk_limit_profiles_version', 'version > 0')
export class LimitProfile {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20 })
  kind!: string; // LimitProfileKind

  @Column({ type: 'varchar', length: 20, default: LimitProfileStatus.ACTIVE })
  status!: string; // LimitProfileStatus

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'configuration_status', type: 'varchar', length: 20, default: LimitProfileConfigurationStatus.NOT_CONFIGURED })
  configurationStatus!: string; // LimitProfileConfigurationStatus

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
