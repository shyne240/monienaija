/**
 * B2T05 — B2 activation workflow persistence entity.
 *
 * The B2 activation workflow entity is the durable TypeORM record for
 * each activation. It persists the activation as a JSONB payload alongside
 * the activation reference, state, hashes, idempotency scope/key, cohort
 * identity, and principal identity. The table is the only B2 activation
 * workflow persistence surface.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2ActivationOutcome,
  B2ActivationPrincipalKind,
  B2ActivationState,
} from './b2-activation-workflow.types';

@Index('uq_b2_activation_reference', ['activationReference', 'activationVersion'], { unique: true })
@Index('idx_b2_activation_principal', ['principalId'])
@Index('idx_b2_activation_kind', ['kind'])
@Index('idx_b2_activation_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_activation_state', ['state'])
@Index('idx_b2_activation_request_hash', ['requestHash'])
@Index('idx_b2_activation_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_activation_correlation', ['correlationId'])
@Entity('b2_activation')
export class B2Activation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'activation_reference', type: 'varchar', length: 200 })
  activationReference!: string;

  @Column({ name: 'activation_version', type: 'integer' })
  activationVersion!: 1;

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind!: B2ActivationPrincipalKind;

  @Column({ name: 'principal_id', type: 'varchar', length: 64 })
  principalId!: string;

  @Column({ name: 'beneficial_owner_customer_id', type: 'varchar', length: 64, nullable: true })
  beneficialOwnerCustomerId!: string | null;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'state', type: 'varchar', length: 24 })
  state!: B2ActivationState;

  @Column({ name: 'outcome', type: 'varchar', length: 24 })
  outcome!: B2ActivationOutcome;

  @Column({ name: 'readiness_reference', type: 'varchar', length: 200 })
  readinessReference!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: 'b2.activation-workflow.idempotency.v1';

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
