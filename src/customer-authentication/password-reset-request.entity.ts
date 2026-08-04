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

import { PasswordResetRequestStatus } from './customer-authentication.enums';

@Entity({ name: 'password_reset_requests' })
@Index('idx_password_reset_requests_customer_created', ['customerId', 'createdAt'])
@Index('idx_password_reset_requests_credential_status', ['credentialId', 'status'])
@Check(
  'chk_password_reset_requests_status',
  "status IN ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED')",
)
@Check('chk_password_reset_requests_version', 'version > 0')
export class PasswordResetRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'credential_id', type: 'uuid' })
  credentialId!: string;

  @Column({ type: 'varchar', length: 20, default: PasswordResetRequestStatus.REQUESTED })
  status!: PasswordResetRequestStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 160 })
  requestedBy!: string;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
