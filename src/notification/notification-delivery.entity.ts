import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { sanitizeProviderRefForBoundary } from './provider-security';

// ARENA3-NOTIFICATION-EMAIL: EMAIL widened. DB CHECK constraint replaced by migration
// 1785753600097-AddEmailNotificationChannel (existing SMS/PUSH rows untouched).
export type NotificationChannel = 'SMS' | 'PUSH' | 'EMAIL';
// ARENA4-INTEGRATION: PHONE widened for unregistered Cash-to-Cash beneficiaries (migration
// 1785753600099-AllowPhoneNotificationRecipients; recipient_id is varchar(255) — UUID for
// CUSTOMER/AGENT, canonical phone for PHONE recipients).
export type NotificationRecipientType = 'CUSTOMER' | 'AGENT' | 'PHONE';
export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'UNKNOWN' | 'DEAD';

/**
 * V1-005 Notification Delivery Foundation
 * Additive persistence for provider-neutral dispatch.
 * One row per (outbox eventKey, recipient, channel) — deterministic idempotency.
 * Payload is redacted (no PIN/OTP/token/secret); destination is phone or device token.
 * Delivery attempts are independently leased and fenced. SENT means provider acceptance;
 * UNKNOWN denotes an ambiguous outcome and DEAD denotes a terminal/exhausted attempt.
 * Notification failure never reverses financial state or changes shared outbox progress.
 */
@Entity({ name: 'notification_deliveries' })
@Index('uq_notification_deliveries_event_recipient_channel', ['eventKey', 'recipientId', 'channel'], {
  unique: true,
})
@Index('idx_notification_deliveries_recipient', ['recipientType', 'recipientId', 'createdAt'])
@Index('idx_notification_deliveries_status', ['status', 'createdAt'])
@Index('idx_notification_deliveries_event_type', ['eventType', 'createdAt'])
@Check('chk_notification_deliveries_channel', "channel IN ('SMS', 'PUSH', 'EMAIL')")
@Check('chk_notification_deliveries_recipient_type', "recipient_type IN ('CUSTOMER', 'AGENT', 'PHONE')")
@Check('chk_notification_deliveries_status', "status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD')")
@Check('chk_notification_deliveries_attempts', 'attempts >= 0')
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 180 })
  eventType!: string;

  @Column({ name: 'event_key', type: 'varchar', length: 180 })
  eventKey!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 80, nullable: true })
  aggregateType!: string | null;

  @Column({ name: 'aggregate_id', type: 'uuid', nullable: true })
  aggregateId!: string | null;

  @Column({ name: 'recipient_type', type: 'varchar', length: 20 })
  recipientType!: NotificationRecipientType;

  // UUID for CUSTOMER/AGENT; canonical phone for unregistered PHONE recipients.
  @Column({ name: 'recipient_id', type: 'varchar', length: 255 })
  recipientId!: string;

  @Column({ type: 'varchar', length: 20 })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 320 })
  destination!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 4000, nullable: true })
  message!: string | null;

  @Column({ name: 'rendered_subject', type: 'varchar', length: 200, nullable: true })
  renderedSubject!: string | null;

  @Column({ name: 'rendered_html', type: 'text', nullable: true })
  renderedHtml!: string | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: NotificationDeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({
    name: 'provider_ref',
    type: 'varchar',
    length: 320,
    nullable: true,
    transformer: {
      to: (value: string | null | undefined) => sanitizeProviderRefForBoundary(value),
      from: (value: string | null | undefined) => sanitizeProviderRefForBoundary(value),
    },
  })
  providerRef!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true })
  causationId!: string | null;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
}
