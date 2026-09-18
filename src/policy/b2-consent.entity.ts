/**
 * B2T06 — B2 consent authority persistence entity.
 *
 * The B2 consent entity is the durable TypeORM record for each consent
 * decision. It persists the consent as a JSONB payload alongside the
 * consent reference, purpose, channel, state, hashes, idempotency
 * scope/key, cohort identity, and subject identity. The table is the
 * only B2 consent persistence surface.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2ConsentChannel,
  B2ConsentOutcome,
  B2ConsentPurpose,
  B2ConsentState,
} from './b2-consent.types';

@Index('uq_b2_consent_reference', ['consentReference', 'consentVersion'], { unique: true })
@Index('idx_b2_consent_subject', ['subjectCustomerId'])
@Index('idx_b2_consent_purpose', ['purpose'])
@Index('idx_b2_consent_state', ['state'])
@Index('idx_b2_consent_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_consent_request_hash', ['requestHash'])
@Index('idx_b2_consent_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_consent_correlation', ['correlationId'])
@Entity('b2_consent')
export class B2Consent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'consent_reference', type: 'varchar', length: 200 })
  consentReference!: string;

  @Column({ name: 'consent_version', type: 'integer' })
  consentVersion!: 1;

  @Column({ name: 'subject_customer_id', type: 'varchar', length: 64 })
  subjectCustomerId!: string;

  @Column({ name: 'purpose', type: 'varchar', length: 40 })
  purpose!: B2ConsentPurpose;

  @Column({ name: 'channel', type: 'varchar', length: 16, nullable: true })
  channel!: B2ConsentChannel;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state!: B2ConsentState;

  @Column({ name: 'outcome', type: 'varchar', length: 16 })
  outcome!: B2ConsentOutcome;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: 'b2.consent.idempotency.v1';

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
