/**
 * B1T10 — B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface TypeORM persistence entity.
 *
 * The B1 commercial-governance decision is persisted in the
 * `b1_commercial_governance_decisions` table. The B1 commercial-
 * governance decision persistence is the only B1 commercial-governance
 * decision persistence surface. The B1 commercial-governance decision
 * persistence does NOT introduce a second B1 commercial-governance
 * decision authority.
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { B1CommercialGovernanceEngineDocumentPersistenceRecordV1 } from './b1-commercial-governance-engine.types';

void 0;

@Entity({ name: 'b1_commercial_governance_decisions' })
@Index('b1_cge_unique_doc_ref', ['documentReference', 'documentVersion'], { unique: true })
@Index('b1_cge_scope_idx', ['scopeKey', 'scopeVersion'])
@Index('b1_cge_period_idx', ['periodKey', 'periodVersion'])
@Index('b1_cge_document_kind_idx', ['documentKind'])
@Index('b1_cge_doc_hash_idx', ['documentHash'])
@Index('b1_cge_doc_replay_hash_idx', ['documentReplayHash'])
@Index('b1_cge_idempotency_idx', ['idempotencyScope', 'idempotencyKey'])
@Index('b1_cge_commercial_decision_idx', ['commercialDecisionReference'])
@Index('b1_cge_billing_document_idx', ['billingDocumentReference'])
@Index('b1_cge_campaign_idx', ['campaignDecisionReference'])
@Index('b1_cge_referral_idx', ['referralDecisionReference'])
@Index('b1_cge_revenue_recognition_idx', ['revenueRecognitionDecisionReference'])
@Index('b1_cge_customer_idx', ['customerId'])
@Index('b1_cge_correlation_idx', ['correlationId'])
export class B1CommercialGovernanceDecision {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 64 })
  id!: string;

  @Column({ name: 'document_reference', type: 'varchar', length: 256 })
  documentReference!: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion!: number;

  @Column({ name: 'document_kind', type: 'varchar', length: 128 })
  documentKind!: string;

  @Column({ name: 'document_hash', type: 'varchar', length: 128 })
  documentHash!: string;

  @Column({ name: 'document_replay_hash', type: 'varchar', length: 128 })
  documentReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 128 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: Record<string, unknown>;

  @Column({ name: 'scope_key', type: 'varchar', length: 128 })
  scopeKey!: string;

  @Column({ name: 'scope_version', type: 'integer' })
  scopeVersion!: number;

  @Column({ name: 'period_key', type: 'varchar', length: 128 })
  periodKey!: string;

  @Column({ name: 'period_version', type: 'integer' })
  periodVersion!: number;

  @Column({ name: 'commercial_decision_reference', type: 'varchar', length: 256, nullable: true })
  commercialDecisionReference!: string | null;

  @Column({ name: 'billing_document_reference', type: 'varchar', length: 256, nullable: true })
  billingDocumentReference!: string | null;

  @Column({ name: 'campaign_decision_reference', type: 'varchar', length: 256, nullable: true })
  campaignDecisionReference!: string | null;

  @Column({ name: 'referral_decision_reference', type: 'varchar', length: 256, nullable: true })
  referralDecisionReference!: string | null;

  @Column({
    name: 'revenue_recognition_decision_reference',
    type: 'varchar',
    length: 256,
    nullable: true,
  })
  revenueRecognitionDecisionReference!: string | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 128, nullable: true })
  customerId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}

export type { B1CommercialGovernanceEngineDocumentPersistenceRecordV1 };
