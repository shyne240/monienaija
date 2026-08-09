/**
 * B1T03 — B1 commercial catalog persistence entity.
 *
 * The B1 commercial catalog entity is the durable TypeORM record
 * for the B1 first commercial scope registration. The B1
 * commercial catalog entity persists the B1 commercial catalog
 * registration as a JSONB payload alongside the B1 commercial
 * catalog key, the B1 commercial catalog version, the B1
 * commercial scope key, the B1 commercial scope version, the B1
 * commercial plan key, the B1 commercial plan version, the B1
 * commercial customer tier key, the B1 commercial merchant tier
 * key, the B1 commercial partner tier key, the B1 commercial
 * product entitlement key, the B1 commercial package key, the B1
 * commercial bundle key, the B1 commercial subscription plan key,
 * the B1 commercial feature flag key, the B1 commercial dynamic
 * limit key, the B1 commercial pricing key, and the B1 commercial
 * catalog effective-from / effective-to as a relational column.
 *
 * The B1 commercial catalog entity is the only B1 commercial
 * catalog persistence surface; the B1 commercial catalog entity
 * does NOT introduce a second pricing / fee / commission /
 * revenue-sharing / billing / invoice / statement / campaign /
 * promotion / coupon / referral / cashback / loyalty / revenue-
 * recognition / tax / cost-accounting / profitability / analytics
 * / reconciliation authority. The B1 commercial catalog entity is
 * a read-only entity from the perspective of the B1 commercial
 * catalog runtime; the B1 commercial catalog entity is populated
 * by the B1 commercial catalog seed migration and is consulted by
 * the B1 commercial catalog read-only consumer boundary.
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
  B1CommercialCatalogRegistrationV1,
  B1CommercialScopeKey,
  B1CommercialScopeVersion,
} from './b1-commercial-catalog.types';

@Entity({ name: 'b1_commercial_catalog_registrations' })
@Index('uq_b1_commercial_catalog_registrations_key', ['catalogKey', 'catalogVersion'], {
  unique: true,
})
@Index('idx_b1_commercial_catalog_registrations_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_commercial_catalog_registrations_plan', ['planKey', 'planVersion'])
@Index('idx_b1_commercial_catalog_registrations_customer_tier', ['customerTierKey'])
@Index('idx_b1_commercial_catalog_registrations_merchant_tier', ['merchantTierKey'])
@Index('idx_b1_commercial_catalog_registrations_partner_tier', ['partnerTierKey'])
@Index('idx_b1_commercial_catalog_registrations_entitlement', ['productEntitlementKey'])
@Index('idx_b1_commercial_catalog_registrations_package', ['packageKey', 'packageVersion'])
@Index('idx_b1_commercial_catalog_registrations_bundle', ['bundleKey', 'bundleVersion'])
@Index('idx_b1_commercial_catalog_registrations_subscription', [
  'subscriptionKey',
  'subscriptionVersion',
])
@Index('idx_b1_commercial_catalog_registrations_feature_flag', ['featureFlagKey'])
@Index('idx_b1_commercial_catalog_registrations_dynamic_limit', ['dynamicLimitKey'])
@Index('idx_b1_commercial_catalog_registrations_pricing', ['pricingKey'])
export class B1CommercialCatalogRegistration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'catalog_key', type: 'varchar', length: 200 })
  catalogKey!: string;

  @Column({ name: 'catalog_version', type: 'integer' })
  catalogVersion!: 1;

  @Column({ name: 'scope_key', type: 'varchar', length: 200 })
  scopeKey!: B1CommercialScopeKey;

  @Column({ name: 'scope_version', type: 'integer' })
  scopeVersion!: B1CommercialScopeVersion;

  @Column({ name: 'plan_key', type: 'varchar', length: 200, nullable: true })
  planKey!: string | null;

  @Column({ name: 'plan_version', type: 'integer', nullable: true })
  planVersion!: number | null;

  @Column({ name: 'customer_tier_key', type: 'varchar', length: 200, nullable: true })
  customerTierKey!: string | null;

  @Column({ name: 'merchant_tier_key', type: 'varchar', length: 200, nullable: true })
  merchantTierKey!: string | null;

  @Column({ name: 'partner_tier_key', type: 'varchar', length: 200, nullable: true })
  partnerTierKey!: string | null;

  @Column({ name: 'product_entitlement_key', type: 'varchar', length: 200, nullable: true })
  productEntitlementKey!: string | null;

  @Column({ name: 'package_key', type: 'varchar', length: 200, nullable: true })
  packageKey!: string | null;

  @Column({ name: 'package_version', type: 'integer', nullable: true })
  packageVersion!: number | null;

  @Column({ name: 'bundle_key', type: 'varchar', length: 200, nullable: true })
  bundleKey!: string | null;

  @Column({ name: 'bundle_version', type: 'integer', nullable: true })
  bundleVersion!: number | null;

  @Column({ name: 'subscription_key', type: 'varchar', length: 200, nullable: true })
  subscriptionKey!: string | null;

  @Column({ name: 'subscription_version', type: 'integer', nullable: true })
  subscriptionVersion!: number | null;

  @Column({ name: 'feature_flag_key', type: 'varchar', length: 200, nullable: true })
  featureFlagKey!: string | null;

  @Column({ name: 'dynamic_limit_key', type: 'varchar', length: 200, nullable: true })
  dynamicLimitKey!: string | null;

  @Column({ name: 'pricing_key', type: 'varchar', length: 200, nullable: true })
  pricingKey!: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom!: Date | null;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'classification_level', type: 'varchar', length: 24 })
  classificationLevel!: string;

  @Column({ name: 'retention_days', type: 'integer' })
  retentionDays!: number;

  @Column({ name: 'registration', type: 'jsonb' })
  registration!: B1CommercialCatalogRegistrationV1;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
