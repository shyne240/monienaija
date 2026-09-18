/**
 * B1T08 — B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine persistence entity.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine entity is the durable TypeORM record for
 * each B1 revenue-recognition decision, B1 tax / VAT decision,
 * and B1 cost-accounting decision. The B1 revenue-recognition
 * engine, tax / VAT engine, and cost-accounting engine entity
 * persists the B1 commercial-financial-recognition decision
 * record as a JSONB payload alongside the B1 commercial-financial-
 * recognition decision key, the B1 commercial-financial-
 * recognition decision reference, the B1 commercial-financial-
 * recognition decision version, the B1 commercial-financial-
 * recognition decision kind, the B1 commercial-financial-
 * recognition decision hash, the B1 commercial-financial-
 * recognition decision replay hash, the B1 commercial-financial-
 * recognition decision idempotency scope, the B1 commercial-
 * financial-recognition decision idempotency key, and the B1
 * commercial-financial-recognition decision effective-from /
 * effective-to as a relational column.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine entity is the only B1 commercial-
 * financial-recognition decision persistence surface; the B1
 * revenue-recognition engine, tax / VAT engine, and cost-
 * accounting engine entity does NOT introduce a second B1
 * commercial-financial-recognition decision persistence surface.
 */

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type {
  B1CostAccountingDecisionV1,
  B1RevenueRecognitionDecisionV1,
  B1RevenueRecognitionDocumentKind,
  B1RevenueRecognitionDocumentPersistenceRecordV1,
  B1RevenueRecognitionDocumentVersion,
  B1TaxVatDecisionV1,
} from './b1-revenue-recognition-engine.types';

@Entity({ name: 'b1_revenue_recognition_decisions' })
@Index('uq_b1_revenue_recognition_decisions_reference', ['documentReference', 'documentVersion'], {
  unique: true,
})
@Index('idx_b1_revenue_recognition_decisions_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_revenue_recognition_decisions_kind', ['documentKind'])
@Index('idx_b1_revenue_recognition_decisions_hash', ['documentHash'])
@Index('idx_b1_revenue_recognition_decisions_replay_hash', ['documentReplayHash'])
@Index('idx_b1_revenue_recognition_decisions_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b1_revenue_recognition_decisions_commercial_decision_reference', [
  'commercialDecisionReference',
])
@Index('idx_b1_revenue_recognition_decisions_billing_document_reference', [
  'billingDocumentReference',
])
@Index('idx_b1_revenue_recognition_decisions_campaign_decision_reference', [
  'campaignDecisionReference',
])
@Index('idx_b1_revenue_recognition_decisions_referral_decision_reference', [
  'referralDecisionReference',
])
@Index('idx_b1_revenue_recognition_decisions_customer_id', ['customerId'])
@Index('idx_b1_revenue_recognition_decisions_correlation_id', ['correlationId'])
export class B1RevenueRecognitionDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_reference', type: 'varchar', length: 200 })
  documentReference!: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion!: B1RevenueRecognitionDocumentVersion;

  @Column({ name: 'document_kind', type: 'varchar', length: 40 })
  documentKind!: B1RevenueRecognitionDocumentKind;

  @Column({ name: 'document_hash', type: 'varchar', length: 64 })
  documentHash!: string;

  @Column({ name: 'document_replay_hash', type: 'varchar', length: 64 })
  documentReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 200 })
  scopeKey!: string;

  @Column({ name: 'scope_version', type: 'integer' })
  scopeVersion!: 1;

  @Column({ name: 'commercial_decision_reference', type: 'varchar', length: 200, nullable: true })
  commercialDecisionReference!: string | null;

  @Column({ name: 'billing_document_reference', type: 'varchar', length: 200, nullable: true })
  billingDocumentReference!: string | null;

  @Column({ name: 'campaign_decision_reference', type: 'varchar', length: 200, nullable: true })
  campaignDecisionReference!: string | null;

  @Column({ name: 'referral_decision_reference', type: 'varchar', length: 200, nullable: true })
  referralDecisionReference!: string | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId!: string;

  @Column({ name: 'merchant_id', type: 'varchar', length: 64 })
  merchantId!: string;

  @Column({ name: 'partner_id', type: 'varchar', length: 64 })
  partnerId!: string;

  @Column({ name: 'product_key', type: 'varchar', length: 80 })
  productKey!: string;

  @Column({ name: 'product_version', type: 'integer' })
  productVersion!: 1;

  @Column({ name: 'period_key', type: 'varchar', length: 200 })
  periodKey!: string;

  @Column({ name: 'period_version', type: 'integer' })
  periodVersion!: 1;

  @Column({ name: 'classification_level', type: 'varchar', length: 24 })
  classificationLevel!: string;

  @Column({ name: 'retention_days', type: 'integer' })
  retentionDays!: number;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom!: Date | null;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: B1RevenueRecognitionDecisionV1 | B1TaxVatDecisionV1 | B1CostAccountingDecisionV1;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type B1RevenueRecognitionDocumentPersistenceRecordLike =
  B1RevenueRecognitionDocumentPersistenceRecordV1;
