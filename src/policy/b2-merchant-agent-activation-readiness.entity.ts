/**
 * B2T04 — B2 merchant and agent activation-readiness persistence entities.
 *
 * The B2 merchant and agent activation-readiness entities are the durable
 * TypeORM records for each merchant/agent attestation. Each record
 * persists the attestation as a JSONB payload alongside the attestation
 * reference, hashes, idempotency scope/key, cohort identity, and
 * eligibility. Separate tables for merchant and agent preserve explicit
 * beneficial-owner traces and avoid a second Customer table.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2MerchantAgentActivationReadinessEligibility,
  B2MerchantAgentActivationReadinessKind,
  B2MerchantAgentActivationReadinessOutcome,
  B2MerchantAgentVerificationState,
} from './b2-merchant-agent-activation-readiness.types';

@Index(
  'uq_b2_merchant_activation_readiness_reference',
  ['attestationReference', 'attestationVersion'],
  {
    unique: true,
  },
)
@Index('idx_b2_merchant_activation_readiness_merchant', ['merchantId'])
@Index('idx_b2_merchant_activation_readiness_customer', ['beneficialOwnerCustomerId'])
@Index('idx_b2_merchant_activation_readiness_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_merchant_activation_readiness_request_hash', ['requestHash'])
@Index('idx_b2_merchant_activation_readiness_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_merchant_activation_readiness_correlation', ['correlationId'])
@Entity('b2_merchant_activation_readiness')
export class B2MerchantActivationReadiness {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'attestation_reference', type: 'varchar', length: 200 })
  attestationReference!: string;

  @Column({ name: 'attestation_version', type: 'integer' })
  attestationVersion!: 1;

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind!: B2MerchantAgentActivationReadinessKind;

  @Column({ name: 'merchant_id', type: 'varchar', length: 64 })
  merchantId!: string;

  @Column({ name: 'beneficial_owner_customer_id', type: 'varchar', length: 64 })
  beneficialOwnerCustomerId!: string;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'verification_state', type: 'varchar', length: 24 })
  verificationState!: B2MerchantAgentVerificationState;

  @Column({ name: 'activation_eligibility', type: 'varchar', length: 24 })
  activationEligibility!: B2MerchantAgentActivationReadinessEligibility;

  @Column({ name: 'activation_ready', type: 'boolean' })
  activationReady!: boolean;

  @Column({ name: 'outcome', type: 'varchar', length: 40 })
  outcome!: B2MerchantAgentActivationReadinessOutcome;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

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

@Index(
  'uq_b2_agent_activation_readiness_reference',
  ['attestationReference', 'attestationVersion'],
  {
    unique: true,
  },
)
@Index('idx_b2_agent_activation_readiness_agent', ['agentId'])
@Index('idx_b2_agent_activation_readiness_merchant', ['supervisingMerchantId'])
@Index('idx_b2_agent_activation_readiness_customer', ['supervisingCustomerId'])
@Index('idx_b2_agent_activation_readiness_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_agent_activation_readiness_request_hash', ['requestHash'])
@Index('idx_b2_agent_activation_readiness_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_agent_activation_readiness_correlation', ['correlationId'])
@Entity('b2_agent_activation_readiness')
export class B2AgentActivationReadiness {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'attestation_reference', type: 'varchar', length: 200 })
  attestationReference!: string;

  @Column({ name: 'attestation_version', type: 'integer' })
  attestationVersion!: 1;

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind!: B2MerchantAgentActivationReadinessKind;

  @Column({ name: 'agent_id', type: 'varchar', length: 64 })
  agentId!: string;

  @Column({ name: 'supervising_merchant_id', type: 'varchar', length: 64 })
  supervisingMerchantId!: string;

  @Column({ name: 'supervising_customer_id', type: 'varchar', length: 64 })
  supervisingCustomerId!: string;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'verification_state', type: 'varchar', length: 24 })
  verificationState!: B2MerchantAgentVerificationState;

  @Column({ name: 'activation_eligibility', type: 'varchar', length: 24 })
  activationEligibility!: B2MerchantAgentActivationReadinessEligibility;

  @Column({ name: 'activation_ready', type: 'boolean' })
  activationReady!: boolean;

  @Column({ name: 'outcome', type: 'varchar', length: 40 })
  outcome!: B2MerchantAgentActivationReadinessOutcome;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

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
