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

import { SupportWorkforceUserStatus } from './support-authentication.enums';

@Entity({ name: 'support_workforce_users' })
@Index('idx_support_workforce_users_status', ['status'])
@Check('chk_support_workforce_users_status', "status IN ('ACTIVE','DISABLED')")
export class SupportWorkforceUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  username!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: string;

  @Column({ type: 'varchar', length: 20, default: SupportWorkforceUserStatus.ACTIVE })
  status!: SupportWorkforceUserStatus;

  @Column({ name: 'password_expires_at', type: 'timestamptz', nullable: true })
  passwordExpiresAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'disabled_by', type: 'varchar', length: 160, nullable: true })
  disabledBy!: string | null;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  @Column({ name: 'disable_reason', type: 'varchar', length: 500, nullable: true })
  disableReason!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
