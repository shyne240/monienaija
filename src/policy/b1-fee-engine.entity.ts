/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine persistence entity.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine entity is the durable TypeORM record for each
 * B1 commercial decision. The B1 fee engine, commission engine,
 * and revenue sharing decision engine entity persists the B1
 * commercial decision record as a JSONB payload alongside the B1
 * commercial decision key, the B1 commercial decision reference,
 * the B1 commercial decision version, the B1 commercial decision
 * kind, the B1 commercial decision request hash, the B1 commercial
 * decision decision hash, the B1 commercial decision decision
 * replay hash, the B1 commercial decision idempotency scope, the
 * B1 commercial decision idempotency key, the B1 commercial
 * decision scope key, the B1 commercial decision scope version,
 * the B1 commercial decision decision outcome, the B1 commercial
 * decision base amount, the B1 commercial decision base currency,
 * the B1 commercial decision currency, the B1 commercial decision
 * accounting unit, the B1 commercial decision customer / merchant
 * / partner id, the B1 commercial decision plan key, the B1
 * commercial decision subscription key, the B1 commercial
 * decision package key, the B1 commercial decision bundle key,
 * the B1 commercial decision product entitlement key, the B1
 * commercial decision feature flag key, the B1 commercial decision
 * dynamic limit key, the B1 commercial decision effective-from,
 * the B1 commercial decision effective-to, the B1 commercial
 * decision classification level, and the B1 commercial decision
 * retention days as a relational column.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine entity is the only B1 commercial decision
 * persistence surface; the B1 fee engine, commission engine, and
 * revenue sharing decision engine entity does NOT introduce a
 * second B1 commercial decision persistence surface.
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
  B1CommercialDecisionKind,
  B1CommercialDecisionOutcome,
  B1CommercialDecisionRecordV1,
  B1CommercialDecisionVersion,
} from './b1-fee-engine.types';

@Entity({ name: 'b1_commercial_decisions' })
@Index('uq_b1_commercial_decisions_reference', ['decisionReference', 'decisionVersion'], {
  unique: true,
})
@Index('idx_b1_commercial_decisions_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_commercial_decisions_kind', ['decisionKind'])
@Index('idx_b1_commercial_decisions_outcome', ['decisionOutcome'])
@Index('idx_b1_commercial_decisions_request_hash', ['requestHash'])
@Index('idx_b1_commercial_decisions_decision_hash', ['decisionHash'])
@Index('idx_b1_commercial_decisions_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b1_commercial_decisions_plan', ['planKey', 'planVersion'])
@Index('idx_b1_commercial_decisions_subscription', ['subscriptionKey', 'subscriptionVersion'])
@Index('idx_b1_commercial_decisions_package', ['packageKey', 'packageVersion'])
@Index('idx_b1_commercial_decisions_bundle', ['bundleKey', 'bundleVersion'])
@Index('idx_b1_commercial_decisions_product_entitlement', [
  'productEntitlementKey',
  'productEntitlementVersion',
])
@Index('idx_b1_commercial_decisions_customer_tier', ['customerTierKey', 'customerTierVersion'])
@Index('idx_b1_commercial_decisions_merchant_tier', ['merchantTierKey', 'merchantTierVersion'])
@Index('idx_b1_commercial_decisions_partner_tier', ['partnerTierKey', 'partnerTierVersion'])
@Index('idx_b1_commercial_decisions_feature_flag', ['featureFlagKey'])
@Index('idx_b1_commercial_decisions_dynamic_limit', ['dynamicLimitKey'])
@Index('idx_b1_commercial_decisions_correlation', ['correlationId'])
export class B1CommercialDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'decision_reference', type: 'varchar', length: 200 })
  decisionReference!: string;

  @Column({ name: 'decision_version', type: 'integer' })
  decisionVersion!: B1CommercialDecisionVersion;

  @Column({ name: 'decision_kind', type: 'varchar', length: 24 })
  decisionKind!: B1CommercialDecisionKind;

  @Column({ name: 'scope_key', type: 'varchar', length: 200 })
  scopeKey!: string;

  @Column({ name: 'scope_version', type: 'integer' })
  scopeVersion!: 1;

  @Column({ name: 'decision_outcome', type: 'varchar', length: 40 })
  decisionOutcome!: B1CommercialDecisionOutcome;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: 'b1.commercial-decision.idempotency.v1';

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'base_amount_minor', type: 'varchar', length: 80 })
  baseAmountMinor!: string;

  @Column({ name: 'base_currency', type: 'varchar', length: 8 })
  baseCurrency!: string;

  @Column({ name: 'currency', type: 'varchar', length: 8 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 40 })
  accountingUnit!: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId!: string;

  @Column({ name: 'customer_tier_key', type: 'varchar', length: 200 })
  customerTierKey!: string;

  @Column({ name: 'customer_tier_version', type: 'integer' })
  customerTierVersion!: 1;

  @Column({ name: 'merchant_id', type: 'varchar', length: 64 })
  merchantId!: string;

  @Column({ name: 'merchant_tier_key', type: 'varchar', length: 200 })
  merchantTierKey!: string;

  @Column({ name: 'merchant_tier_version', type: 'integer' })
  merchantTierVersion!: 1;

  @Column({ name: 'partner_id', type: 'varchar', length: 64 })
  partnerId!: string;

  @Column({ name: 'partner_tier_key', type: 'varchar', length: 200 })
  partnerTierKey!: string;

  @Column({ name: 'partner_tier_version', type: 'integer' })
  partnerTierVersion!: 1;

  @Column({ name: 'product_key', type: 'varchar', length: 80 })
  productKey!: string;

  @Column({ name: 'product_version', type: 'integer' })
  productVersion!: 1;

  @Column({ name: 'capability_key', type: 'varchar', length: 200 })
  capabilityKey!: string;

  @Column({ name: 'capability_version', type: 'integer' })
  capabilityVersion!: 1;

  @Column({ name: 'plan_key', type: 'varchar', length: 200 })
  planKey!: string;

  @Column({ name: 'plan_version', type: 'integer' })
  planVersion!: 1;

  @Column({ name: 'subscription_key', type: 'varchar', length: 200 })
  subscriptionKey!: string;

  @Column({ name: 'subscription_version', type: 'integer' })
  subscriptionVersion!: 1;

  @Column({ name: 'package_key', type: 'varchar', length: 200 })
  packageKey!: string;

  @Column({ name: 'package_version', type: 'integer' })
  packageVersion!: 1;

  @Column({ name: 'bundle_key', type: 'varchar', length: 200 })
  bundleKey!: string;

  @Column({ name: 'bundle_version', type: 'integer' })
  bundleVersion!: 1;

  @Column({ name: 'product_entitlement_key', type: 'varchar', length: 200 })
  productEntitlementKey!: string;

  @Column({ name: 'product_entitlement_version', type: 'integer' })
  productEntitlementVersion!: 1;

  @Column({ name: 'feature_flag_key', type: 'varchar', length: 200, nullable: true })
  featureFlagKey!: string | null;

  @Column({ name: 'dynamic_limit_key', type: 'varchar', length: 200, nullable: true })
  dynamicLimitKey!: string | null;

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
  record!: B1CommercialDecisionRecordV1;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
