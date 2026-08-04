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

import {
  AuthenticationCredentialStatus,
  AuthenticationCredentialType,
  PasswordHashAlgorithm,
} from './customer-authentication.enums';

@Entity({ name: 'customer_authentication_credentials' })
@Index('uq_customer_authentication_credentials_active_customer', ['customerId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_authentication_credentials_customer_status', ['customerId', 'status'])
@Check('chk_customer_authentication_credentials_type', "credential_type IN ('PASSWORD')")
@Check(
  'chk_customer_authentication_credentials_status',
  "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')",
)
@Check(
  'chk_customer_authentication_credentials_algorithm',
  "hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')",
)
@Check('chk_customer_authentication_credentials_password_version', 'password_version > 0')
@Check('chk_customer_authentication_credentials_failed_count', 'failed_authentication_count >= 0')
@Check('chk_customer_authentication_credentials_version', 'version > 0')
export class CustomerAuthenticationCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({
    name: 'credential_type',
    type: 'varchar',
    length: 20,
    default: AuthenticationCredentialType.PASSWORD,
  })
  type!: AuthenticationCredentialType;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: PasswordHashAlgorithm;

  @Column({ name: 'password_version', type: 'integer' })
  passwordVersion!: number;

  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  passwordChangedAt!: Date;

  @Column({ name: 'password_expires_at', type: 'timestamptz', nullable: true })
  passwordExpiresAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: AuthenticationCredentialStatus.ACTIVE })
  status!: AuthenticationCredentialStatus;

  @Column({ name: 'failed_authentication_count', type: 'integer', default: 0 })
  failedAuthenticationCount!: number;

  @Column({ name: 'account_locked', type: 'boolean', default: false })
  accountLocked!: boolean;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 500, nullable: true })
  lockReason!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
