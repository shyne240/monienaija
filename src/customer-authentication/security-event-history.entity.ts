import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { SecurityEventType } from './customer-authentication.enums';

@Entity({ name: 'security_event_histories' })
@Index('idx_security_event_histories_customer_occurred', ['customerId', 'occurredAt'])
@Check(
  'chk_security_event_histories_type',
  "event_type IN ('CREDENTIAL_CREATED', 'PASSWORD_ROTATED', 'PASSWORD_EXPIRED', 'AUTHENTICATION_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_STATUS_CHANGED', 'MFA_ENROLLMENT_CREATED', 'MFA_ENROLLMENT_UPDATED', 'MFA_METHOD_ADDED', 'MFA_METHOD_UPDATED', 'TRUSTED_DEVICE_REGISTERED', 'TRUSTED_DEVICE_UPDATED', 'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED')",
)
export class SecurityEventHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'credential_id', type: 'uuid', nullable: true })
  credentialId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: SecurityEventType;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
