/**
 * B2T03 — B2 customer activation-readiness persistence entity.
 *
 * The B2 customer activation-readiness entity is the durable TypeORM
 * record for each activation-readiness attestation. It persists the
 * attestation as a JSONB payload alongside the attestation reference,
 * hashes, idempotency scope/key, cohort identity, and eligibility.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2CustomerActivationReadinessEligibility,
  B2CustomerActivationReadinessOutcome,
  B2CustomerActivationReadinessVerificationState,
} from './b2-customer-activation-readiness.types';

@Index(
  'uq_b2_customer_activation_readiness_reference',
  ['attestationReference', 'attestationVersion'],
  {
    unique: true,
  },
)
@Index('idx_b2_customer_activation_readiness_customer', ['customerId'])
@Index('idx_b2_customer_activation_readiness_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_customer_activation_readiness_request_hash', ['requestHash'])
@Index('idx_b2_customer_activation_readiness_decision_hash', ['decisionHash'])
@Index('idx_b2_customer_activation_readiness_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_customer_activation_readiness_eligibility', ['activationEligibility'])
@Index('idx_b2_customer_activation_readiness_correlation', ['correlationId'])
@Entity('b2_customer_activation_readiness')
export class B2CustomerActivationReadiness {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'attestation_reference', type: 'varchar', length: 200 })
  attestationReference!: string;

  @Column({ name: 'attestation_version', type: 'integer' })
  attestationVersion!: 1;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId!: string;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'verification_state', type: 'varchar', length: 24 })
  verificationState!: B2CustomerActivationReadinessVerificationState;

  @Column({ name: 'activation_eligibility', type: 'varchar', length: 24 })
  activationEligibility!: B2CustomerActivationReadinessEligibility;

  @Column({ name: 'activation_ready', type: 'boolean' })
  activationReady!: boolean;

  @Column({ name: 'outcome', type: 'varchar', length: 40 })
  outcome!: B2CustomerActivationReadinessOutcome;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: 'b2.customer-activation-readiness.idempotency.v1';

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
