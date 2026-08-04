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

import { MfaMethodStatus, MfaMethodType } from './customer-authentication.enums';

@Entity({ name: 'mfa_methods' })
@Index('uq_mfa_methods_enrollment_type', ['enrollmentId', 'type'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_mfa_methods_customer_status', ['customerId', 'status'])
@Check(
  'chk_mfa_methods_type',
  "method_type IN ('TOTP', 'AUTHENTICATOR_APP', 'SECURITY_KEY', 'SMS', 'EMAIL')",
)
@Check('chk_mfa_methods_status', "status IN ('PENDING', 'ENABLED', 'DISABLED', 'REVOKED')")
@Check('chk_mfa_methods_version', 'version > 0')
export class MfaMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'enrollment_id', type: 'uuid' })
  enrollmentId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'method_type', type: 'varchar', length: 30 })
  type!: MfaMethodType;

  @Column({ type: 'varchar', length: 160 })
  label!: string;

  @Column({ name: 'identifier_hash', type: 'varchar', length: 512, nullable: true })
  identifierHash!: string | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ type: 'varchar', length: 20, default: MfaMethodStatus.PENDING })
  status!: MfaMethodStatus;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
