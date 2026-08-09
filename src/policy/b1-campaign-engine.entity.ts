/**
 * B1T06 — B1 campaign engine, promotion engine, and coupon engine
 * persistence entity.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * entity is the durable TypeORM record for each B1 campaign
 * decision, B1 promotion decision, and B1 coupon decision. The
 * B1 campaign engine, promotion engine, and coupon engine entity
 * persists the B1 campaign decision record as a JSONB payload
 * alongside the B1 campaign decision key, the B1 campaign
 * decision reference, the B1 campaign decision version, the B1
 * campaign decision kind, the B1 campaign decision hash, the B1
 * campaign decision replay hash, the B1 campaign decision
 * idempotency scope, the B1 campaign decision idempotency key,
 * and the B1 campaign decision effective-from / effective-to as
 * a relational column.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * entity is the only B1 campaign decision persistence surface;
 * the B1 campaign engine, promotion engine, and coupon engine
 * entity does NOT introduce a second B1 campaign decision
 * persistence surface.
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
  B1CampaignDecisionV1,
  B1CampaignDocumentKind,
  B1CampaignDocumentPersistenceRecordV1,
  B1CampaignDocumentVersion,
  B1CouponDecisionV1,
  B1PromotionDecisionV1,
} from './b1-campaign-engine.types';

@Entity({ name: 'b1_campaign_decisions' })
@Index('uq_b1_campaign_decisions_reference', ['documentReference', 'documentVersion'], {
  unique: true,
})
@Index('idx_b1_campaign_decisions_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_campaign_decisions_kind', ['documentKind'])
@Index('idx_b1_campaign_decisions_hash', ['documentHash'])
@Index('idx_b1_campaign_decisions_replay_hash', ['documentReplayHash'])
@Index('idx_b1_campaign_decisions_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b1_campaign_decisions_commercial_decision_reference', ['commercialDecisionReference'])
@Index('idx_b1_campaign_decisions_billing_document_reference', ['billingDocumentReference'])
@Index('idx_b1_campaign_decisions_campaign_decision_reference', ['campaignDecisionReference'])
@Index('idx_b1_campaign_decisions_promotion_decision_reference', ['promotionDecisionReference'])
@Index('idx_b1_campaign_decisions_customer_id', ['customerId'])
@Index('idx_b1_campaign_decisions_correlation_id', ['correlationId'])
export class B1CampaignDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_reference', type: 'varchar', length: 200 })
  documentReference!: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion!: B1CampaignDocumentVersion;

  @Column({ name: 'document_kind', type: 'varchar', length: 40 })
  documentKind!: B1CampaignDocumentKind;

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

  @Column({ name: 'promotion_decision_reference', type: 'varchar', length: 200, nullable: true })
  promotionDecisionReference!: string | null;

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
  record!: B1CampaignDecisionV1 | B1PromotionDecisionV1 | B1CouponDecisionV1;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type B1CampaignDocumentPersistenceRecordLike = B1CampaignDocumentPersistenceRecordV1;
