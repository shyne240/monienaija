/**
 * B1T07 — B1 referral engine, cashback engine, and loyalty engine
 * persistence entity.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * entity is the durable TypeORM record for each B1 referral
 * reward decision, B1 cashback calculation decision, and B1
 * loyalty earning decision. The B1 referral engine, cashback
 * engine, and loyalty engine entity persists the B1 referral
 * decision record as a JSONB payload alongside the B1 referral
 * decision key, the B1 referral decision reference, the B1
 * referral decision version, the B1 referral decision kind, the
 * B1 referral decision hash, the B1 referral decision replay
 * hash, the B1 referral decision idempotency scope, the B1
 * referral decision idempotency key, and the B1 referral decision
 * effective-from / effective-to as a relational column.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * entity is the only B1 referral decision persistence surface;
 * the B1 referral engine, cashback engine, and loyalty engine
 * entity does NOT introduce a second B1 referral decision
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
  B1CashbackCalculationDecisionV1,
  B1LoyaltyEarningDecisionV1,
  B1ReferralDocumentKind,
  B1ReferralDocumentPersistenceRecordV1,
  B1ReferralDocumentVersion,
  B1ReferralRewardDecisionV1,
} from './b1-referral-engine.types';

@Entity({ name: 'b1_referral_decisions' })
@Index('uq_b1_referral_decisions_reference', ['documentReference', 'documentVersion'], {
  unique: true,
})
@Index('idx_b1_referral_decisions_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_referral_decisions_kind', ['documentKind'])
@Index('idx_b1_referral_decisions_hash', ['documentHash'])
@Index('idx_b1_referral_decisions_replay_hash', ['documentReplayHash'])
@Index('idx_b1_referral_decisions_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b1_referral_decisions_commercial_decision_reference', ['commercialDecisionReference'])
@Index('idx_b1_referral_decisions_billing_document_reference', ['billingDocumentReference'])
@Index('idx_b1_referral_decisions_campaign_decision_reference', ['campaignDecisionReference'])
@Index('idx_b1_referral_decisions_promotion_decision_reference', ['promotionDecisionReference'])
@Index('idx_b1_referral_decisions_coupon_decision_reference', ['couponDecisionReference'])
@Index('idx_b1_referral_decisions_referee_customer_id', ['refereeCustomerId'])
@Index('idx_b1_referral_decisions_sponsor_customer_id', ['sponsorCustomerId'])
@Index('idx_b1_referral_decisions_customer_id', ['customerId'])
@Index('idx_b1_referral_decisions_correlation_id', ['correlationId'])
export class B1ReferralDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_reference', type: 'varchar', length: 200 })
  documentReference!: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion!: B1ReferralDocumentVersion;

  @Column({ name: 'document_kind', type: 'varchar', length: 40 })
  documentKind!: B1ReferralDocumentKind;

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

  @Column({ name: 'coupon_decision_reference', type: 'varchar', length: 200, nullable: true })
  couponDecisionReference!: string | null;

  @Column({ name: 'referee_customer_id', type: 'varchar', length: 64, nullable: true })
  refereeCustomerId!: string | null;

  @Column({ name: 'sponsor_customer_id', type: 'varchar', length: 64, nullable: true })
  sponsorCustomerId!: string | null;

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
  record!:
    | B1ReferralRewardDecisionV1
    | B1CashbackCalculationDecisionV1
    | B1LoyaltyEarningDecisionV1;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type B1ReferralDocumentPersistenceRecordLike = B1ReferralDocumentPersistenceRecordV1;
