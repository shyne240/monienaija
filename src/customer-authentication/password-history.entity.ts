import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { PasswordHashAlgorithm, PasswordHistoryAction } from './customer-authentication.enums';

@Entity({ name: 'password_histories' })
@Index('idx_password_histories_credential_created', ['credentialId', 'createdAt'])
@Check('chk_password_histories_action', "action IN ('CREATED', 'ROTATED')")
@Check('chk_password_histories_password_version', 'password_version > 0')
export class PasswordHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'credential_id', type: 'uuid' })
  credentialId!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: PasswordHashAlgorithm;

  @Column({ name: 'password_version', type: 'integer' })
  passwordVersion!: number;

  @Column({ type: 'varchar', length: 20 })
  action!: PasswordHistoryAction;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
