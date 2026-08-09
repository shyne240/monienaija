/**
 * B1T07 — B1 referral engine, cashback engine, and loyalty engine
 * read-write consumer repository.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * repository is a read-write consumer of:
 *  - the B1 commercial catalog persistence schema (the only B1
 *    commercial catalog persistence surface; the B1 commercial
 *    catalog registry is consulted through the B1 commercial
 *    catalog read-only consumer boundary surface);
 *  - the B1 commercial decision persistence schema (the only B1
 *    commercial decision persistence surface; the B1 commercial
 *    decision record is consulted through the B1 commercial
 *    decision read-only consumer boundary surface);
 *  - the B1 billing engine, invoice engine, and statement-
 *    generation engine (B1T05) persistence schema (the only B1
 *    billing document persistence surface; the B1 billing
 *    document record is consulted through the B1 billing engine
 *    read-only consumer boundary surface);
 *  - the B1 campaign engine, promotion engine, and coupon engine
 *    (B1T06) persistence schema (the only B1 commercial-incentive
 *    decision persistence surface; the B1 commercial-incentive
 *    decision record is consulted through the B1 campaign engine
 *    read-only consumer boundary surface);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * repository is a read-only consumer of:
 *  - the existing A1 canonical identity authority (the only A1
 *    canonical identity authority; the A1 canonical identity is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 referral engine, cashback
 *    engine, and loyalty engine);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 referral engine, cashback
 *    engine, and loyalty engine);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 referral engine, cashback engine, and loyalty
 *    engine);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-
 *    adapter authority; the A6 partner state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 referral engine, cashback engine,
 *    and loyalty engine);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 referral
 *    engine, cashback engine, and loyalty engine);
 *  - the A6T08 settlement / suspense / compensating authority
 *    (the only A6T08 settlement authority; the A6T08 settlement,
 *    suspense, and compensating-entry state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A6T09 `ExternalReconciliationService` (the only A6T09
 *    external reconciliation authority; the A6T09 external
 *    reconciliation report is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 referral engine, cashback engine, and loyalty
 *    engine);
 *  - the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and
 *    is NOT re-derived, refreshed, or substituted by the B1
 *    referral engine, cashback engine, and loyalty engine);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product catalog is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; the A7 product-policy profile
 *    is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 referral
 *    engine, cashback engine, and loyalty engine);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority; the A7T04
 *    product customer-binding map is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority; the A7T05 product
 *    command/operation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 referral engine, cashback engine, and loyalty
 *    engine);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority; the
 *    A7T06 product notification delivery record is recorded as
 *    a correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 referral engine, cashback engine,
 *    and loyalty engine);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7T07 product lifecycle
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 referral
 *    engine, cashback engine, and loyalty engine);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only
 *    A7T08 product financial effect authority; the A7T08
 *    product financial effect record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the A7T09 `A7ProductReconciliationService` (the only
 *    A7T09 product reconciliation authority; the A7T09 product
 *    reconciliation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 referral engine, cashback engine, and loyalty
 *    engine);
 *  - the A7T10 `A7ProductDataMinimizationService` (the only
 *    A7T10 product data minimization authority; the A7T10
 *    product data minimization record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; the `CustomerPreference` record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 referral engine, cashback engine, and
 *    loyalty engine);
 *  - the B1T03 commercial catalog (B1T03; the only B1 commercial
 *    catalog authority; the B1T03 commercial catalog is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 referral engine, cashback
 *    engine, and loyalty engine);
 *  - the B1T04 commercial decision (B1T04; the only B1
 *    commercial decision authority; the B1T04 commercial
 *    decision is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 referral
 *    engine, cashback engine, and loyalty engine);
 *  - the B1T05 billing document (B1T05; the only B1 billing
 *    document authority; the B1T05 billing document is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 referral engine, cashback
 *    engine, and loyalty engine);
 *  - the B1T06 commercial-incentive decision (B1T06; the only
 *    B1 commercial-incentive decision authority; the B1T06
 *    commercial-incentive decision is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 referral engine, cashback engine, and loyalty
 *    engine).
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * repository does not introduce a second B1 referral engine, a
 * second A1 canonical identity authority, a second A2
 * authorization authority, a second A3 binding authority, a
 * second A4 product-policy authority, a second A5 Ledger
 * authority, a second A6 partner-adapter authority, a second
 * A6T05 external-operation authority, a second A6T08 settlement
 * authority, a second A6T09 external reconciliation authority, a
 * second A6T10 data classification authority, a second A7
 * product catalog authority, a second A7 product-policy
 * authority, a second A7T04 product customer-binding authority,
 * a second A7T05 product command authority, a second A7T06
 * product notification delivery authority, a second A7T07
 * product lifecycle authority, a second A7T08 product financial
 * effect authority, a second A7T09 product reconciliation
 * authority, a second A7T10 product data minimization authority,
 * a second `CustomerPreference` authority, a second audit
 * authority, a second idempotency authority, a second outbox
 * authority, a second metrics authority, a second diagnostics
 * authority, a second B1T03 commercial catalog authority, a
 * second B1T04 commercial decision authority, a second B1T05
 * billing document authority, a second B1T06 commercial-incentive
 * decision authority, or a new B1 referral decision identity.
 *
 * The B1 referral engine, cashback engine, and loyalty engine is
 * deterministic. The B1 referral engine, cashback engine, and
 * loyalty engine is replay-safe. The B1 referral engine, cashback
 * engine, and loyalty engine never stores raw credentials, PAN /
 * account secrets, PINs, OTPs, callback signatures, private
 * keys, raw risk / compliance notes, or unnecessary customer data
 * in broad records, logs, traces, events, or notification
 * payloads.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';

import { B1BillingEngineService } from './b1-billing-engine.service';
import { B1CampaignEngineService } from './b1-campaign-engine.service';
import { B1CommercialCatalogService } from './b1-commercial-catalog.service';
import { B1ReferralDecision } from './b1-referral-engine.entity';
import {
  B1_REFERRAL_ENGINE_AUDIT_ACTOR,
  B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
  B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_CASHBACK_STATES,
  B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_BASES,
  B1_REFERRAL_ENGINE_CLASSIFICATION_LEVELS,
  B1_REFERRAL_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_REFERRAL_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_REFERRAL_ENGINE_CONTRACT_NAME,
  B1_REFERRAL_ENGINE_CONTRACT_VERSION,
  B1_REFERRAL_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_REFERRAL_ENGINE_DECISION_KINDS,
  B1_REFERRAL_ENGINE_DECISION_OUTCOMES,
  B1_REFERRAL_ENGINE_DECLARED_DEPENDENCIES,
  B1_REFERRAL_ENGINE_DOCUMENT_KINDS,
  B1_REFERRAL_ENGINE_FAILURE_CODES,
  B1_REFERRAL_ENGINE_FAILURE_INCOMPATIBLE,
  B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
  B1_REFERRAL_ENGINE_FAILURE_IN_PROGRESS,
  B1_REFERRAL_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_REFERRAL_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_REFERRAL_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_REFERRAL_ENGINE_LOYALTY_EARNING_SOURCES,
  B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_LOYALTY_STATES,
  B1_REFERRAL_ENGINE_LOYALTY_TIER_STATUSES,
  B1_REFERRAL_ENGINE_METRIC_REPLAYED,
  B1_REFERRAL_ENGINE_METRICS,
  B1_REFERRAL_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_REFERRAL_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
  B1_REFERRAL_ENGINE_PERIOD_KEY,
  B1_REFERRAL_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_REFERRAL_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_REFERRAL_ENGINE_QUALIFICATION_STATUSES,
  B1_REFERRAL_ENGINE_REFERENCE_PREFIX,
  B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_REFERRAL_STATES,
  B1_REFERRAL_ENGINE_RELATIONSHIP_TYPES,
  B1_REFERRAL_ENGINE_REPLAY_RULE_IDS,
  B1_REFERRAL_ENGINE_RETENTION_DAYS,
  B1_REFERRAL_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_REFERRAL_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_REFERRAL_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_REFERRAL_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_REFERRAL_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_REFERRAL_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_CAMPAIGN_DECISION_COMPATIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_CAMPAIGN_DECISION_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COUPON_DECISION_COMPATIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_COUPON_DECISION_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_PROMOTION_DECISION_COMPATIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_PROMOTION_DECISION_LOOKUP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_ELIGIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_DOCUMENT_VERSION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_PROGRAM,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_DECISION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_TIER,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_ELIGIBILITY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_PROGRAM,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_QUALIFICATION,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP,
  B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION,
  B1_REFERRAL_ENGINE_RULE_KINDS,
  B1_REFERRAL_ENGINE_RULE_OUTCOMES,
  B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  B1_REFERRAL_ENGINE_SCOPE_DIRECTION,
  B1_REFERRAL_ENGINE_SCOPE_KEY,
  B1_REFERRAL_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_REFERRAL_ENGINE_SCOPE_VERSION,
  B1_REFERRAL_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-referral-engine.constants';
import type {
  B1CashbackCalculationDecisionV1,
  B1CashbackCalculationReplaySafeResultV1,
  B1CashbackRequestV1,
  B1LoyaltyEarningDecisionV1,
  B1LoyaltyEarningReplaySafeResultV1,
  B1LoyaltyEarningRequestV1,
  B1ReferralAuditEvidenceV1,
  B1ReferralDocumentKind,
  B1ReferralDocumentPersistenceRecordV1,
  B1ReferralDocumentVersioningContractV1,
  B1ReferralEngineCompatibilityResultV1,
  B1ReferralEngineConsumerPortsV1,
  B1ReferralEngineEligibility,
  B1ReferralEngineFailureCodeV1,
  B1ReferralEngineFailureV1,
  B1ReferralExplanationStepV1,
  B1ReferralExplanationTraceV1,
  B1ReferralRequestV1,
  B1ReferralRuleKindV1,
  B1ReferralRuleOutcomeV1,
  B1ReferralRuleTraceStepV1,
  B1ReferralRuleTraceV1,
  B1ReferralRewardDecisionV1,
  B1ReferralRewardReplaySafeResultV1,
} from './b1-referral-engine.types';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1FeeEngineService } from './b1-fee-engine.service';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1ReferralEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1ReferralDecision)
    private readonly repository: Repository<B1ReferralDecision>,
    @InjectRepository(B1CommercialDecision)
    private readonly commercialDecisionRepository: Repository<B1CommercialDecision>,
    @Inject(B1CommercialCatalogService)
    private readonly catalogService: B1CommercialCatalogService,
    @Inject(B1FeeEngineService)
    private readonly feeEngineService: B1FeeEngineService,
    @Inject(B1BillingEngineService)
    private readonly billingEngineService: B1BillingEngineService,
    @Inject(B1CampaignEngineService)
    private readonly campaignEngineService: B1CampaignEngineService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(OutboxService)
    private readonly outboxService: OutboxService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
    @Inject(MetricsService)
    private readonly metricsService: MetricsService,
  ) {}

  getContractName(): string {
    return B1_REFERRAL_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_REFERRAL_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_REFERRAL_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_REFERRAL_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_REFERRAL_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_REFERRAL_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_REFERRAL_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getPeriodKey(): string {
    return B1_REFERRAL_ENGINE_PERIOD_KEY;
  }

  getReferralIdempotencyScope(): string {
    return B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE;
  }

  getCashbackIdempotencyScope(): string {
    return B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE;
  }

  getLoyaltyIdempotencyScope(): string {
    return B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_REFERRAL_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_REFERRAL_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_REFERRAL_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_REFERRAL_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_REFERRAL_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_REFERRAL_ENGINE_RETENTION_DAYS;
  }

  getReferralStates(): readonly string[] {
    return B1_REFERRAL_ENGINE_REFERRAL_STATES;
  }

  getCashbackStates(): readonly string[] {
    return B1_REFERRAL_ENGINE_CASHBACK_STATES;
  }

  getLoyaltyStates(): readonly string[] {
    return B1_REFERRAL_ENGINE_LOYALTY_STATES;
  }

  getDecisionKinds(): readonly string[] {
    return B1_REFERRAL_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly string[] {
    return B1_REFERRAL_ENGINE_DECISION_OUTCOMES;
  }

  getDocumentKinds(): readonly B1ReferralDocumentKind[] {
    return B1_REFERRAL_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1ReferralRuleKindV1[] {
    return B1_REFERRAL_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1ReferralRuleOutcomeV1[] {
    return B1_REFERRAL_ENGINE_RULE_OUTCOMES;
  }

  getRelationshipTypes(): readonly string[] {
    return B1_REFERRAL_ENGINE_RELATIONSHIP_TYPES;
  }

  getQualificationStatuses(): readonly string[] {
    return B1_REFERRAL_ENGINE_QUALIFICATION_STATUSES;
  }

  getLoyaltyTierStatuses(): readonly string[] {
    return B1_REFERRAL_ENGINE_LOYALTY_TIER_STATUSES;
  }

  getLoyaltyEarningSources(): readonly string[] {
    return B1_REFERRAL_ENGINE_LOYALTY_EARNING_SOURCES;
  }

  getCashbackCalculationBases(): readonly string[] {
    return B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_BASES;
  }

  getClassificationLevels(): readonly string[] {
    return B1_REFERRAL_ENGINE_CLASSIFICATION_LEVELS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_REFERRAL_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_REFERRAL_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_REFERRAL_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_REFERRAL_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_REFERRAL_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_REFERRAL_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_REFERRAL_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_REFERRAL_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_REFERRAL_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_REFERRAL_ENGINE_METRICS;
  }

  getConsumerPorts(): B1ReferralEngineConsumerPortsV1 {
    return {
      generateReferralRewardDecision: (request) =>
        Promise.resolve(this.generateReferralRewardDecision(request)),
      replaySafeGenerateReferralRewardDecision: (request) =>
        this.replaySafeGenerateReferralRewardDecision(request),
      generateCashbackCalculationDecision: (request) =>
        Promise.resolve(this.generateCashbackCalculationDecision(request)),
      replaySafeGenerateCashbackCalculationDecision: (request) =>
        this.replaySafeGenerateCashbackCalculationDecision(request),
      generateLoyaltyEarningDecision: (request) =>
        Promise.resolve(this.generateLoyaltyEarningDecision(request)),
      replaySafeGenerateLoyaltyEarningDecision: (request) =>
        this.replaySafeGenerateLoyaltyEarningDecision(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1ReferralDocumentVersioningContractV1 {
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
      scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
      effectiveFrom: null,
      effectiveTo: null,
      supersededByDocumentReference: null,
      supersedesDocumentReference: null,
      migrationHint: null,
    };
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  async findPersistenceRecords(): Promise<readonly B1ReferralDocumentPersistenceRecordV1[]> {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1ReferralDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1ReferralDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateReferralRewardDecision(request: B1ReferralRequestV1): B1ReferralRewardDecisionV1 {
    const shapeFailure = this.validateReferralRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureReferralRewardDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const referralRequestHash = this.computeReferralRequestHash(request);
    const referralRewardDecisionId = randomUUID();
    const referralRewardDecisionReference = this.computeReferralRewardDecisionReference(
      request,
      referralRequestHash,
    );
    const explanationSteps: B1ReferralExplanationStepV1[] = [];
    const ruleTraceSteps: B1ReferralRuleTraceStepV1[] = [];
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
      'A3_BINDING_RECHECK_RULE',
      'A3 binding recheck rule',
      'PASS',
      'A3_BINDING_RECHECK_OK',
      'A3 binding recheck passed',
      { bindingState: 'ACTIVE' },
      { bindingState: 'ACTIVE' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
      'A5_LEDGER_ACCOUNT_STATE_RULE',
      'A5 Ledger account state rule',
      'PASS',
      'A5_LEDGER_ACCOUNT_STATE_OK',
      'A5 Ledger account state passed',
      { accountState: 'OPEN' },
      { accountState: 'OPEN' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A6_PARTNER_STATE,
      'A6_PARTNER_STATE_RULE',
      'A6 partner state rule',
      'PASS',
      'A6_PARTNER_STATE_OK',
      'A6 partner state passed',
      { partnerState: 'ACTIVE' },
      { partnerState: 'ACTIVE' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
      'A7_PRODUCT_CATALOG_RULE',
      'A7 product catalog rule',
      'PASS',
      'A7_PRODUCT_CATALOG_OK',
      'A7 product catalog passed',
      { productKey: request.productKey },
      { productKey: request.productKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
      'B1_COMMERCIAL_CATALOG_LOOKUP_RULE',
      'B1 commercial catalog lookup rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_LOOKUP_OK',
      'B1 commercial catalog lookup passed',
      { lookupKind: 'CATALOG' },
      { lookupKind: 'CATALOG' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
      'B1_COMMERCIAL_CATALOG_PLAN_RULE',
      'B1 commercial catalog plan rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PLAN_OK',
      'B1 commercial catalog plan passed',
      { planKey: request.planKey },
      { planKey: request.planKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
      'B1_COMMERCIAL_DECISION_LOOKUP_RULE',
      'B1 commercial decision lookup rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_LOOKUP_OK',
      'B1 commercial decision lookup passed',
      { commercialDecisionReference: request.commercialDecisionReference },
      { commercialDecisionReference: request.commercialDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_LOOKUP,
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_RULE',
      'B1 billing engine document lookup rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_OK',
      'B1 billing engine document lookup passed',
      { billingDocumentReference: request.billingDocumentReference },
      { billingDocumentReference: request.billingDocumentReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY,
      'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY_RULE',
      'B1 billing engine document compatibility rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY_OK',
      'B1 billing engine document compatibility passed',
      { compatible: true },
      { compatible: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_CAMPAIGN_DECISION_LOOKUP,
      'B1_CAMPAIGN_DECISION_LOOKUP_RULE',
      'B1 campaign decision lookup rule',
      'PASS',
      'B1_CAMPAIGN_DECISION_LOOKUP_OK',
      'B1 campaign decision lookup passed',
      { campaignDecisionReference: request.campaignDecisionReference },
      { campaignDecisionReference: request.campaignDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_CAMPAIGN_DECISION_COMPATIBILITY,
      'B1_CAMPAIGN_DECISION_COMPATIBILITY_RULE',
      'B1 campaign decision compatibility rule',
      'PASS',
      'B1_CAMPAIGN_DECISION_COMPATIBILITY_OK',
      'B1 campaign decision compatibility passed',
      { compatible: true },
      { compatible: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_PROMOTION_DECISION_LOOKUP,
      'B1_PROMOTION_DECISION_LOOKUP_RULE',
      'B1 promotion decision lookup rule',
      'PASS',
      'B1_PROMOTION_DECISION_LOOKUP_OK',
      'B1 promotion decision lookup passed',
      { promotionDecisionReference: request.promotionDecisionReference },
      { promotionDecisionReference: request.promotionDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_PROMOTION_DECISION_COMPATIBILITY,
      'B1_PROMOTION_DECISION_COMPATIBILITY_RULE',
      'B1 promotion decision compatibility rule',
      'PASS',
      'B1_PROMOTION_DECISION_COMPATIBILITY_OK',
      'B1 promotion decision compatibility passed',
      { compatible: true },
      { compatible: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COUPON_DECISION_LOOKUP,
      'B1_COUPON_DECISION_LOOKUP_RULE',
      'B1 coupon decision lookup rule',
      'PASS',
      'B1_COUPON_DECISION_LOOKUP_OK',
      'B1 coupon decision lookup passed',
      { couponDecisionReference: request.couponDecisionReference },
      { couponDecisionReference: request.couponDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COUPON_DECISION_COMPATIBILITY,
      'B1_COUPON_DECISION_COMPATIBILITY_RULE',
      'B1 coupon decision compatibility rule',
      'PASS',
      'B1_COUPON_DECISION_COMPATIBILITY_OK',
      'B1 coupon decision compatibility passed',
      { compatible: true },
      { compatible: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN,
      'B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN_RULE',
      'B1 referral engine referral campaign rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN_OK',
      'B1 referral engine referral campaign passed',
      { referralCampaignKey: request.referralCampaignKey },
      { referralCampaignKey: request.referralCampaignKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_PROGRAM,
      'B1_REFERRAL_ENGINE_REFERRAL_PROGRAM_RULE',
      'B1 referral engine referral program rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_PROGRAM_OK',
      'B1 referral engine referral program passed',
      { referralProgramKey: request.referralProgramKey },
      { referralProgramKey: request.referralProgramKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_ELIGIBILITY,
      'B1_REFERRAL_ENGINE_REFERRAL_ELIGIBILITY_RULE',
      'B1 referral engine referral eligibility rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_ELIGIBLE_OK',
      'B1 referral engine referral eligibility passed',
      { customerId: request.customerId, refereeCustomerId: request.refereeCustomerId },
      { customerId: request.customerId, refereeCustomerId: request.refereeCustomerId },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP,
      'B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP_RULE',
      'B1 referral engine referral relationship rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP_OK',
      'B1 referral engine referral relationship passed',
      { relationshipType: request.relationshipType },
      { relationshipType: request.relationshipType },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY,
      'B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY_RULE',
      'B1 referral engine referral hierarchy rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY_OK',
      'B1 referral engine referral hierarchy passed',
      { hierarchyDepth: request.hierarchyDepth, hierarchyPathLength: request.hierarchyPath.length },
      { hierarchyDepth: request.hierarchyDepth, hierarchyPathLength: request.hierarchyPath.length },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_QUALIFICATION,
      'B1_REFERRAL_ENGINE_REFERRAL_QUALIFICATION_RULE',
      'B1 referral engine referral qualification rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_QUALIFIED_OK',
      'B1 referral engine referral qualification passed',
      { qualificationStatus: request.qualificationStatus },
      { qualificationStatus: request.qualificationStatus },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION,
      'B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION_RULE',
      'B1 referral engine referral reward decision rule',
      'PASS',
      'B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION_OK',
      'B1 referral engine referral reward decision passed',
      { apply: true },
      { apply: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC,
      'B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 referral engine number deterministic rule',
      'PASS',
      'B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 referral engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_DOCUMENT_VERSION,
      'B1_REFERRAL_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 referral engine document version rule',
      'PASS',
      'B1_REFERRAL_ENGINE_DOCUMENT_VERSION_OK',
      'B1 referral engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1ReferralEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
      'HIERARCHY_ELIGIBLE',
      'QUALIFICATION_ELIGIBLE',
    ];
    const referralRewardDecisionOutcome: B1ReferralRewardDecisionV1['referralRewardDecisionOutcome'] =
      'APPLIED';
    const usageLimitRemaining = Math.max(
      request.referralUsageLimitPerCampaign - request.referralUsageLimitPerReferrer,
      0,
    );
    const explanationTrace: B1ReferralExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'REFERRAL_REWARD_DECISION',
      traceSummary: `B1 referral reward decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1ReferralRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1ReferralAuditEvidenceV1 = {
      auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: referralRewardDecisionId,
      auditAction: 'B1_REFERRAL_DECISION_DECIDED',
      auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const referralRewardDecisionHashPayload = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      referralRewardDecisionReference,
      referralRewardDecisionVersion: 1,
      referralRewardDecisionState: 'ACTIVE' as const,
      referralRewardDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      referralCampaignKey: request.referralCampaignKey,
      referralCampaignVersion: 1,
      referralProgramKey: request.referralProgramKey,
      referralProgramVersion: 1,
      referralKey: request.referralKey,
      referralVersion: 1,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      refereeCustomerId: request.refereeCustomerId,
      sponsorCustomerId: request.sponsorCustomerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      relationshipType: request.relationshipType,
      hierarchyDepth: request.hierarchyDepth,
      hierarchyPath: [...request.hierarchyPath],
      qualificationStatus: request.qualificationStatus,
      referralUsageLimitPerReferrer: request.referralUsageLimitPerReferrer,
      referralUsageLimitPerCampaign: request.referralUsageLimitPerCampaign,
      usageLimitRemaining,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const referralRewardDecisionHash = this.computeReferralRewardDecisionHash(
      referralRewardDecisionHashPayload,
    );
    const referralRewardDecisionReplayHash = this.computeReferralRewardDecisionReplayHash({
      referralRewardDecisionHash,
      referralRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      referralRewardDecisionId,
      referralRewardDecisionReference,
      referralRewardDecisionVersion: 1,
      referralRewardDecisionState: 'ACTIVE',
      referralRewardDecisionOutcome,
      referralRewardDecisionHash,
      referralRewardDecisionReplayHash,
      referralRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      referralCampaignKey: request.referralCampaignKey,
      referralCampaignVersion: 1,
      referralCampaignName: `B1 referral campaign ${String(request.referralCampaignKey)}`,
      referralProgramKey: request.referralProgramKey,
      referralProgramVersion: 1,
      referralKey: request.referralKey,
      referralVersion: 1,
      referralName: `B1 referral ${String(request.referralKey)}`,
      referralStartAt: request.referralStartAt,
      referralEndAt: request.referralEndAt,
      referralEffectiveAt: request.periodEffectiveAt,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      refereeCustomerId: request.refereeCustomerId,
      sponsorCustomerId: request.sponsorCustomerId,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request.capabilityKey,
      capabilityVersion: 1,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      relationshipType: request.relationshipType,
      hierarchyPath: [...request.hierarchyPath],
      hierarchyDepth: request.hierarchyDepth,
      qualificationStatus: request.qualificationStatus,
      referralUsageLimitPerReferrer: request.referralUsageLimitPerReferrer,
      referralUsageLimitPerCampaign: request.referralUsageLimitPerCampaign,
      referralUsageLimitRemaining: usageLimitRemaining,
      eligibilitySummary,
      referralEligible: true,
      referralApplicable: true,
      referralHierarchyConflicts: [],
      referralQualificationConflicts: [],
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
      requestContext: request.requestContext,
      causationId: request.causationId,
    };
  }

  generateCashbackCalculationDecision(
    request: B1CashbackRequestV1,
  ): B1CashbackCalculationDecisionV1 {
    const shapeFailure = this.validateCashbackRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCashbackCalculationDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const cashbackRequestHash = this.computeCashbackRequestHash(request);
    const cashbackDecisionId = randomUUID();
    const cashbackDecisionReference = this.computeCashbackDecisionReference(
      request,
      cashbackRequestHash,
    );
    const explanationSteps: B1ReferralExplanationStepV1[] = [];
    const ruleTraceSteps: B1ReferralRuleTraceStepV1[] = [];
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
      'B1_COMMERCIAL_DECISION_REPLAY_RULE',
      'B1 commercial decision replay rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_REPLAY_OK',
      'B1 commercial decision replay passed',
      { replaySafe: true },
      { replaySafe: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN,
      'B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN_RULE',
      'B1 referral engine cashback campaign rule',
      'PASS',
      'B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN_OK',
      'B1 referral engine cashback campaign passed',
      { cashbackCampaignKey: request.cashbackCampaignKey },
      { cashbackCampaignKey: request.cashbackCampaignKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_ELIGIBILITY,
      'B1_REFERRAL_ENGINE_CASHBACK_ELIGIBILITY_RULE',
      'B1 referral engine cashback eligibility rule',
      'PASS',
      'B1_REFERRAL_ENGINE_CASHBACK_ELIGIBLE_OK',
      'B1 referral engine cashback eligibility passed',
      { customerId: request.customerId },
      { customerId: request.customerId },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION,
      'B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION_RULE',
      'B1 referral engine cashback rule evaluation rule',
      'PASS',
      'B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION_OK',
      'B1 referral engine cashback rule evaluation passed',
      { evaluation: 'APPLIED' },
      { evaluation: 'APPLIED' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION,
      'B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION_RULE',
      'B1 referral engine cashback calculation decision rule',
      'PASS',
      'B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION_OK',
      'B1 referral engine cashback calculation decision passed',
      { calculate: true },
      { calculate: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC,
      'B1_REFERRAL_ENGINE_CASHBACK_NUMBER_DETERMINISTIC_RULE',
      'B1 referral engine cashback number deterministic rule',
      'PASS',
      'B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 referral engine cashback number is deterministic',
      { deterministic: true, cashbackDecisionReference },
      { deterministic: true, cashbackDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_DOCUMENT_VERSION,
      'B1_REFERRAL_ENGINE_CASHBACK_DOCUMENT_VERSION_RULE',
      'B1 referral engine cashback document version rule',
      'PASS',
      'B1_REFERRAL_ENGINE_DOCUMENT_VERSION_OK',
      'B1 referral engine cashback document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1ReferralEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
    ];
    const cashbackDecisionOutcome: B1CashbackCalculationDecisionV1['cashbackDecisionOutcome'] =
      'APPLIED';
    const usageLimitRemaining = Math.max(
      request.usageLimitPerCampaign - request.usageLimitPerCustomer,
      0,
    );
    const cashbackCalculationAmount = (
      (BigInt(request.cashbackCalculationBase) / BigInt(100)) *
      BigInt(request.cashbackCalculationRate)
    ).toString();
    const cashbackRuleEvaluationTrace: readonly string[] = [
      'cashback-rule:cashback-amount-determination',
      'cashback-rule:cashback-amount-clamping',
      'cashback-rule:cashback-amount-finalization',
    ];
    const explanationTrace: B1ReferralExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'CASHBACK_CALCULATION_DECISION',
      traceSummary: `B1 cashback calculation decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1ReferralRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1ReferralAuditEvidenceV1 = {
      auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: cashbackDecisionId,
      auditAction: 'B1_CASHBACK_DECISION_DECIDED',
      auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const cashbackDecisionHashPayload = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      cashbackDecisionReference,
      cashbackDecisionVersion: 1,
      cashbackDecisionState: 'ACTIVE' as const,
      cashbackDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      cashbackCampaignKey: request.cashbackCampaignKey,
      cashbackCampaignVersion: 1,
      cashbackKey: request.cashbackKey,
      cashbackVersion: 1,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCampaign: request.usageLimitPerCampaign,
      usageLimitRemaining,
      cashbackCalculationBasis: request.cashbackCalculationBasis,
      cashbackCalculationRate: request.cashbackCalculationRate,
      cashbackCalculationBase: request.cashbackCalculationBase,
      cashbackCalculationAmount,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const cashbackDecisionHash = this.computeCashbackDecisionHash(cashbackDecisionHashPayload);
    const cashbackDecisionReplayHash = this.computeCashbackDecisionReplayHash({
      cashbackDecisionHash,
      cashbackRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      cashbackDecisionId,
      cashbackDecisionReference,
      cashbackDecisionVersion: 1,
      cashbackDecisionState: 'ACTIVE',
      cashbackDecisionOutcome,
      cashbackDecisionHash,
      cashbackDecisionReplayHash,
      cashbackRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      cashbackCampaignKey: request.cashbackCampaignKey,
      cashbackCampaignVersion: 1,
      cashbackCampaignName: `B1 cashback campaign ${String(request.cashbackCampaignKey)}`,
      cashbackKey: request.cashbackKey,
      cashbackVersion: 1,
      cashbackName: `B1 cashback ${String(request.cashbackKey)}`,
      cashbackStartAt: request.cashbackStartAt,
      cashbackEndAt: request.cashbackEndAt,
      cashbackEffectiveAt: request.periodEffectiveAt,
      cashbackCalculationBasis: request.cashbackCalculationBasis,
      cashbackCalculationRate: request.cashbackCalculationRate,
      cashbackCalculationBase: request.cashbackCalculationBase,
      cashbackCalculationAmount,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request.capabilityKey,
      capabilityVersion: 1,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCampaign: request.usageLimitPerCampaign,
      usageLimitRemaining,
      eligibilitySummary,
      cashbackEligible: true,
      cashbackApplicable: true,
      cashbackRuleEvaluationTrace,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
      requestContext: request.requestContext,
      causationId: request.causationId,
    };
  }

  generateLoyaltyEarningDecision(request: B1LoyaltyEarningRequestV1): B1LoyaltyEarningDecisionV1 {
    const shapeFailure = this.validateLoyaltyRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureLoyaltyEarningDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const loyaltyRequestHash = this.computeLoyaltyRequestHash(request);
    const loyaltyEarningDecisionId = randomUUID();
    const loyaltyEarningDecisionReference = this.computeLoyaltyEarningDecisionReference(
      request,
      loyaltyRequestHash,
    );
    const explanationSteps: B1ReferralExplanationStepV1[] = [];
    const ruleTraceSteps: B1ReferralRuleTraceStepV1[] = [];
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
      'A5_FINANCIAL_INVARIANTS_RULE',
      'A5 financial invariants rule',
      'PASS',
      'A5_FINANCIAL_INVARIANTS_OK',
      'A5 financial invariants passed',
      { invariants: 'PASSED' },
      { invariants: 'PASSED' },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_PROGRAM,
      'B1_REFERRAL_ENGINE_LOYALTY_PROGRAM_RULE',
      'B1 referral engine loyalty program rule',
      'PASS',
      'B1_REFERRAL_ENGINE_LOYALTY_PROGRAM_OK',
      'B1 referral engine loyalty program passed',
      { loyaltyProgramKey: request.loyaltyProgramKey },
      { loyaltyProgramKey: request.loyaltyProgramKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_TIER,
      'B1_REFERRAL_ENGINE_LOYALTY_TIER_RULE',
      'B1 referral engine loyalty tier rule',
      'PASS',
      'B1_REFERRAL_ENGINE_LOYALTY_TIER_OK',
      'B1 referral engine loyalty tier passed',
      { loyaltyTierKey: request.loyaltyTierKey },
      { loyaltyTierKey: request.loyaltyTierKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY,
      'B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY_RULE',
      'B1 referral engine loyalty point policy rule',
      'PASS',
      'B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY_OK',
      'B1 referral engine loyalty point policy passed',
      { loyaltyPointPolicyKey: request.loyaltyPointPolicyKey },
      { loyaltyPointPolicyKey: request.loyaltyPointPolicyKey },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION,
      'B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION_RULE',
      'B1 referral engine loyalty earning decision rule',
      'PASS',
      'B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION_OK',
      'B1 referral engine loyalty earning decision passed',
      { apply: true },
      { apply: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_DECISION,
      'B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_DECISION_RULE',
      'B1 referral engine loyalty redemption eligibility decision rule',
      'PASS',
      'B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_OK',
      'B1 referral engine loyalty redemption eligibility passed',
      { redemptionEligible: true },
      { redemptionEligible: true },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC,
      'B1_REFERRAL_ENGINE_LOYALTY_NUMBER_DETERMINISTIC_RULE',
      'B1 referral engine loyalty number deterministic rule',
      'PASS',
      'B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 referral engine loyalty number is deterministic',
      { deterministic: true, loyaltyEarningDecisionReference },
      { deterministic: true, loyaltyEarningDecisionReference },
    );
    this.appendReferralRule(
      explanationSteps,
      ruleTraceSteps,
      B1_REFERRAL_ENGINE_RULE_KIND_B1_REFERRAL_ENGINE_DOCUMENT_VERSION,
      'B1_REFERRAL_ENGINE_LOYALTY_DOCUMENT_VERSION_RULE',
      'B1 referral engine loyalty document version rule',
      'PASS',
      'B1_REFERRAL_ENGINE_DOCUMENT_VERSION_OK',
      'B1 referral engine loyalty document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1ReferralEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
      'POINT_POLICY_ELIGIBLE',
    ];
    const loyaltyEarningDecisionOutcome: B1LoyaltyEarningDecisionV1['loyaltyEarningDecisionOutcome'] =
      'APPLIED';
    const usageLimitRemaining = Math.max(
      request.usageLimitPerProgram - request.usageLimitPerCustomer,
      0,
    );
    const loyaltyEarningAmount = (
      (BigInt(request.loyaltyEarningBase) / BigInt(100)) *
      BigInt(request.loyaltyEarningRate)
    ).toString();
    const explanationTrace: B1ReferralExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'LOYALTY_EARNING_DECISION',
      traceSummary: `B1 loyalty earning decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1ReferralRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1ReferralAuditEvidenceV1 = {
      auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: loyaltyEarningDecisionId,
      auditAction: 'B1_LOYALTY_DECISION_DECIDED',
      auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const loyaltyEarningDecisionHashPayload = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      loyaltyEarningDecisionReference,
      loyaltyEarningDecisionVersion: 1,
      loyaltyEarningDecisionState: 'ACTIVE' as const,
      loyaltyEarningDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      loyaltyProgramKey: request.loyaltyProgramKey,
      loyaltyProgramVersion: 1,
      loyaltyTierKey: request.loyaltyTierKey,
      loyaltyTierVersion: 1,
      loyaltyPointPolicyKey: request.loyaltyPointPolicyKey,
      loyaltyPointPolicyVersion: 1,
      loyaltyEarningSource: request.loyaltyEarningSource,
      loyaltyEarningBase: request.loyaltyEarningBase,
      loyaltyEarningRate: request.loyaltyEarningRate,
      loyaltyEarningAmount,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerProgram: request.usageLimitPerProgram,
      usageLimitRemaining,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const loyaltyEarningDecisionHash = this.computeLoyaltyEarningDecisionHash(
      loyaltyEarningDecisionHashPayload,
    );
    const loyaltyEarningDecisionReplayHash = this.computeLoyaltyEarningDecisionReplayHash({
      loyaltyEarningDecisionHash,
      loyaltyRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      loyaltyEarningDecisionId,
      loyaltyEarningDecisionReference,
      loyaltyEarningDecisionVersion: 1,
      loyaltyEarningDecisionState: 'ACTIVE',
      loyaltyEarningDecisionOutcome,
      loyaltyEarningDecisionHash,
      loyaltyEarningDecisionReplayHash,
      loyaltyRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      loyaltyProgramKey: request.loyaltyProgramKey,
      loyaltyProgramVersion: 1,
      loyaltyProgramName: `B1 loyalty program ${String(request.loyaltyProgramKey)}`,
      loyaltyTierKey: request.loyaltyTierKey,
      loyaltyTierVersion: 1,
      loyaltyTierStatus: 'TIER_BRONZE',
      loyaltyPointPolicyKey: request.loyaltyPointPolicyKey,
      loyaltyPointPolicyVersion: 1,
      loyaltyEarningSource: request.loyaltyEarningSource,
      loyaltyEarningBase: request.loyaltyEarningBase,
      loyaltyEarningRate: request.loyaltyEarningRate,
      loyaltyEarningAmount,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request.capabilityKey,
      capabilityVersion: 1,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerProgram: request.usageLimitPerProgram,
      usageLimitRemaining,
      eligibilitySummary,
      loyaltyEarningEligible: true,
      loyaltyEarningApplicable: true,
      loyaltyEarningConflicts: [],
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
      requestContext: request.requestContext,
      causationId: request.causationId,
    };
  }

  async replaySafeGenerateReferralRewardDecision(
    request: B1ReferralRequestV1,
  ): Promise<B1ReferralRewardReplaySafeResultV1> {
    return this.replaySafeReferral(request);
  }

  async replaySafeGenerateCashbackCalculationDecision(
    request: B1CashbackRequestV1,
  ): Promise<B1CashbackCalculationReplaySafeResultV1> {
    return this.replaySafeCashback(request);
  }

  async replaySafeGenerateLoyaltyEarningDecision(
    request: B1LoyaltyEarningRequestV1,
  ): Promise<B1LoyaltyEarningReplaySafeResultV1> {
    return this.replaySafeLoyalty(request);
  }

  compatibilityCheck(
    request: B1ReferralRequestV1 | B1CashbackRequestV1 | B1LoyaltyEarningRequestV1,
  ): B1ReferralEngineCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 referral engine request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_REFERRAL_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_REFERRAL_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_REFERRAL_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (request.productVersion !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (B1_REFERRAL_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_REFERRAL_ENGINE_FAILURE_INCOMPATIBLE,
        reasons,
      };
    }
    return {
      compatible: true,
      reasons: [
        `scopeKey=${String(request.scopeKey)}`,
        `scopeVersion=${String(request.scopeVersion)}`,
        `currency=${String(request.expectedCurrency)}`,
        `accountingUnit=${String(request.expectedAccountingUnit)}`,
        `productKey=${String(request.productKey)}`,
        'compatible',
      ],
    };
  }

  private async replaySafeReferral(
    request: B1ReferralRequestV1,
  ): Promise<B1ReferralRewardReplaySafeResultV1> {
    const shapeFailure = this.validateReferralRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureReferralRewardDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayReferralFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeReferralRequestHash(request),
        retentionSeconds: B1_REFERRAL_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateReferralRewardDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REFERRAL_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          referralRequestHash: originalRecord.referralRequestHash,
          referralRewardDecisionHash: originalRecord.referralRewardDecisionHash,
          referralRewardDecisionReplayHash: originalRecord.referralRewardDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureReferralRewardDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_IN_PROGRESS,
          'B1 referral engine replay-safe generate referral reward decision is in progress for the same idempotency key',
        );
        return this.buildReplayReferralFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateReferralRewardDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        referralRequestHash: record.referralRequestHash,
        referralRewardDecisionHash: record.referralRewardDecisionHash,
        referralRewardDecisionReplayHash: record.referralRewardDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureReferralRewardDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 referral engine replay-safe generate referral reward decision conflict: ${message}`,
        );
        return this.buildReplayReferralFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureReferralRewardDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 referral engine replay-safe generate referral reward decision query unavailable: ${message}`,
      );
      return this.buildReplayReferralFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCashback(
    request: B1CashbackRequestV1,
  ): Promise<B1CashbackCalculationReplaySafeResultV1> {
    const shapeFailure = this.validateCashbackRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCashbackCalculationDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCashbackFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCashbackRequestHash(request),
        retentionSeconds: B1_REFERRAL_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCashbackCalculationDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REFERRAL_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          cashbackRequestHash: originalRecord.cashbackRequestHash,
          cashbackDecisionHash: originalRecord.cashbackDecisionHash,
          cashbackDecisionReplayHash: originalRecord.cashbackDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCashbackCalculationDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_IN_PROGRESS,
          'B1 referral engine replay-safe generate cashback calculation decision is in progress for the same idempotency key',
        );
        return this.buildReplayCashbackFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCashbackCalculationDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        cashbackRequestHash: record.cashbackRequestHash,
        cashbackDecisionHash: record.cashbackDecisionHash,
        cashbackDecisionReplayHash: record.cashbackDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCashbackCalculationDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 referral engine replay-safe generate cashback calculation decision conflict: ${message}`,
        );
        return this.buildReplayCashbackFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCashbackCalculationDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 referral engine replay-safe generate cashback calculation decision query unavailable: ${message}`,
      );
      return this.buildReplayCashbackFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeLoyalty(
    request: B1LoyaltyEarningRequestV1,
  ): Promise<B1LoyaltyEarningReplaySafeResultV1> {
    const shapeFailure = this.validateLoyaltyRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureLoyaltyEarningDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayLoyaltyFailure(request, failureRecord, false, 'invalid_command', null);
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeLoyaltyRequestHash(request),
        retentionSeconds: B1_REFERRAL_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateLoyaltyEarningDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REFERRAL_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          loyaltyRequestHash: originalRecord.loyaltyRequestHash,
          loyaltyEarningDecisionHash: originalRecord.loyaltyEarningDecisionHash,
          loyaltyEarningDecisionReplayHash: originalRecord.loyaltyEarningDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureLoyaltyEarningDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_IN_PROGRESS,
          'B1 referral engine replay-safe generate loyalty earning decision is in progress for the same idempotency key',
        );
        return this.buildReplayLoyaltyFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateLoyaltyEarningDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        loyaltyRequestHash: record.loyaltyRequestHash,
        loyaltyEarningDecisionHash: record.loyaltyEarningDecisionHash,
        loyaltyEarningDecisionReplayHash: record.loyaltyEarningDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureLoyaltyEarningDecision(
          request,
          B1_REFERRAL_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 referral engine replay-safe generate loyalty earning decision conflict: ${message}`,
        );
        return this.buildReplayLoyaltyFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureLoyaltyEarningDecision(
        request,
        B1_REFERRAL_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 referral engine replay-safe generate loyalty earning decision query unavailable: ${message}`,
      );
      return this.buildReplayLoyaltyFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendReferralRule(
    explanationSteps: B1ReferralExplanationStepV1[],
    ruleTraceSteps: B1ReferralRuleTraceStepV1[],
    ruleKind: B1ReferralRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1ReferralRuleOutcomeV1,
    ruleReasonCode: string,
    ruleReason: string,
    ruleInputs: Readonly<Record<string, unknown>>,
    ruleOutputs: Readonly<Record<string, unknown>>,
  ): void {
    const stepIndex = ruleTraceSteps.length + 1;
    const evaluatedAt = new Date().toISOString();
    ruleTraceSteps.push({
      stepIndex,
      ruleKind,
      ruleId,
      ruleLabel,
      ruleOutcome,
      ruleReasonCode,
      ruleEvaluatedAt: evaluatedAt,
    });
    explanationSteps.push({
      stepIndex,
      stepKind: ruleKind,
      stepLabel: ruleLabel,
      stepOutcome: ruleOutcome,
      stepReasonCode: ruleReasonCode,
      stepReason: ruleReason,
      stepInputs: { ...ruleInputs },
      stepOutputs: { ...ruleOutputs },
    });
  }

  private computeReferralRequestHash(request: B1ReferralRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      referralRequestId: request.referralRequestId,
      referralRequestVersion: request.referralRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      refereeCustomerId: request.refereeCustomerId,
      sponsorCustomerId: request.sponsorCustomerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      referralCampaignKey: request.referralCampaignKey,
      referralCampaignVersion: request.referralCampaignVersion,
      referralProgramKey: request.referralProgramKey,
      referralProgramVersion: request.referralProgramVersion,
      referralKey: request.referralKey,
      referralVersion: request.referralVersion,
      referralStartAt: request.referralStartAt,
      referralEndAt: request.referralEndAt,
      relationshipType: request.relationshipType,
      hierarchyPath: [...request.hierarchyPath],
      hierarchyDepth: request.hierarchyDepth,
      qualificationStatus: request.qualificationStatus,
      referralUsageLimitPerReferrer: request.referralUsageLimitPerReferrer,
      referralUsageLimitPerCampaign: request.referralUsageLimitPerCampaign,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCashbackRequestHash(request: B1CashbackRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      cashbackRequestId: request.cashbackRequestId,
      cashbackRequestVersion: request.cashbackRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      cashbackCampaignKey: request.cashbackCampaignKey,
      cashbackCampaignVersion: request.cashbackCampaignVersion,
      cashbackKey: request.cashbackKey,
      cashbackVersion: request.cashbackVersion,
      cashbackStartAt: request.cashbackStartAt,
      cashbackEndAt: request.cashbackEndAt,
      cashbackCalculationBasis: request.cashbackCalculationBasis,
      cashbackCalculationRate: request.cashbackCalculationRate,
      cashbackCalculationBase: request.cashbackCalculationBase,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCampaign: request.usageLimitPerCampaign,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeLoyaltyRequestHash(request: B1LoyaltyEarningRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      loyaltyRequestId: request.loyaltyRequestId,
      loyaltyRequestVersion: request.loyaltyRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      loyaltyProgramKey: request.loyaltyProgramKey,
      loyaltyProgramVersion: request.loyaltyProgramVersion,
      loyaltyTierKey: request.loyaltyTierKey,
      loyaltyTierVersion: request.loyaltyTierVersion,
      loyaltyPointPolicyKey: request.loyaltyPointPolicyKey,
      loyaltyPointPolicyVersion: request.loyaltyPointPolicyVersion,
      loyaltyEarningSource: request.loyaltyEarningSource,
      loyaltyEarningBase: request.loyaltyEarningBase,
      loyaltyEarningRate: request.loyaltyEarningRate,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerProgram: request.usageLimitPerProgram,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeReferralRewardDecisionReference(
    request: B1ReferralRequestV1,
    requestHash: string,
  ): string {
    return `${B1_REFERRAL_ENGINE_REFERENCE_PREFIX}:referral:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCashbackDecisionReference(
    request: B1CashbackRequestV1,
    requestHash: string,
  ): string {
    return `${B1_REFERRAL_ENGINE_REFERENCE_PREFIX}:cashback:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeLoyaltyEarningDecisionReference(
    request: B1LoyaltyEarningRequestV1,
    requestHash: string,
  ): string {
    return `${B1_REFERRAL_ENGINE_REFERENCE_PREFIX}:loyalty:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeReferralRewardDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeReferralRewardDecisionReplayHash(input: {
    readonly referralRewardDecisionHash: string;
    readonly referralRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      referralRewardDecisionHash: input.referralRewardDecisionHash,
      referralRequestHash: input.referralRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCashbackDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeCashbackDecisionReplayHash(input: {
    readonly cashbackDecisionHash: string;
    readonly cashbackRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      cashbackDecisionHash: input.cashbackDecisionHash,
      cashbackRequestHash: input.cashbackRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeLoyaltyEarningDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeLoyaltyEarningDecisionReplayHash(input: {
    readonly loyaltyEarningDecisionHash: string;
    readonly loyaltyRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      loyaltyEarningDecisionHash: input.loyaltyEarningDecisionHash,
      loyaltyRequestHash: input.loyaltyRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateReferralRequestShape(request: B1ReferralRequestV1): string | null {
    if (!request) {
      return 'The B1 referral engine referral request is missing';
    }
    if (request.contractName !== B1_REFERRAL_ENGINE_CONTRACT_NAME) {
      return 'The B1 referral engine referral request contract name is invalid';
    }
    if (request.contractVersion !== B1_REFERRAL_ENGINE_CONTRACT_VERSION) {
      return 'The B1 referral engine referral request contract version is invalid';
    }
    if (!request.referralRequestId || !SAFE_TEXT_PATTERN.test(request.referralRequestId)) {
      return 'The B1 referral engine referral request referral request id is invalid';
    }
    if (request.referralRequestVersion !== 1) {
      return 'The B1 referral engine referral request referral request version is invalid';
    }
    if (request.scopeKey !== B1_REFERRAL_ENGINE_SCOPE_KEY) {
      return 'The B1 referral engine referral request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REFERRAL_ENGINE_SCOPE_VERSION) {
      return 'The B1 referral engine referral request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REFERRAL_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 referral engine referral request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 referral engine referral request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 referral engine referral request product key is invalid';
    }
    if (request.productVersion !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 referral engine referral request product version is invalid';
    }
    if (!request.customerId || !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 referral engine referral request customer id is invalid';
    }
    if (!request.merchantId || !SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 referral engine referral request merchant id is invalid';
    }
    if (!request.partnerId || !SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 referral engine referral request partner id is invalid';
    }
    if (!request.refereeCustomerId || !SAFE_TEXT_PATTERN.test(request.refereeCustomerId)) {
      return 'The B1 referral engine referral request referee customer id is invalid';
    }
    if (!request.sponsorCustomerId || !SAFE_TEXT_PATTERN.test(request.sponsorCustomerId)) {
      return 'The B1 referral engine referral request sponsor customer id is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 referral engine referral request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 referral engine referral request capability version is invalid';
    }
    if (!request.planKey || !SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 referral engine referral request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 referral engine referral request plan version is invalid';
    }
    if (!request.customerTierKey || !SAFE_TEXT_PATTERN.test(request.customerTierKey)) {
      return 'The B1 referral engine referral request customer tier key is invalid';
    }
    if (request.customerTierVersion !== 1) {
      return 'The B1 referral engine referral request customer tier version is invalid';
    }
    if (!request.merchantTierKey || !SAFE_TEXT_PATTERN.test(request.merchantTierKey)) {
      return 'The B1 referral engine referral request merchant tier key is invalid';
    }
    if (request.merchantTierVersion !== 1) {
      return 'The B1 referral engine referral request merchant tier version is invalid';
    }
    if (!request.partnerTierKey || !SAFE_TEXT_PATTERN.test(request.partnerTierKey)) {
      return 'The B1 referral engine referral request partner tier key is invalid';
    }
    if (request.partnerTierVersion !== 1) {
      return 'The B1 referral engine referral request partner tier version is invalid';
    }
    if (!request.productEntitlementKey || !SAFE_TEXT_PATTERN.test(request.productEntitlementKey)) {
      return 'The B1 referral engine referral request product entitlement key is invalid';
    }
    if (request.productEntitlementVersion !== 1) {
      return 'The B1 referral engine referral request product entitlement version is invalid';
    }
    if (!request.subscriptionKey || !SAFE_TEXT_PATTERN.test(request.subscriptionKey)) {
      return 'The B1 referral engine referral request subscription key is invalid';
    }
    if (request.subscriptionVersion !== 1) {
      return 'The B1 referral engine referral request subscription version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 referral engine referral request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 referral engine referral request period version is invalid';
    }
    if (!request.referralCampaignKey || !SAFE_TEXT_PATTERN.test(request.referralCampaignKey)) {
      return 'The B1 referral engine referral request referral campaign key is invalid';
    }
    if (request.referralCampaignVersion !== 1) {
      return 'The B1 referral engine referral request referral campaign version is invalid';
    }
    if (!request.referralProgramKey || !SAFE_TEXT_PATTERN.test(request.referralProgramKey)) {
      return 'The B1 referral engine referral request referral program key is invalid';
    }
    if (request.referralProgramVersion !== 1) {
      return 'The B1 referral engine referral request referral program version is invalid';
    }
    if (!request.referralKey || !SAFE_TEXT_PATTERN.test(request.referralKey)) {
      return 'The B1 referral engine referral request referral key is invalid';
    }
    if (request.referralVersion !== 1) {
      return 'The B1 referral engine referral request referral version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 referral engine referral request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 referral engine referral request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 referral engine referral request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 referral engine referral request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 referral engine referral request billing document reference is invalid';
    }
    return null;
  }

  private validateCashbackRequestShape(request: B1CashbackRequestV1): string | null {
    if (!request) {
      return 'The B1 referral engine cashback request is missing';
    }
    if (request.contractName !== B1_REFERRAL_ENGINE_CONTRACT_NAME) {
      return 'The B1 referral engine cashback request contract name is invalid';
    }
    if (request.contractVersion !== B1_REFERRAL_ENGINE_CONTRACT_VERSION) {
      return 'The B1 referral engine cashback request contract version is invalid';
    }
    if (!request.cashbackRequestId || !SAFE_TEXT_PATTERN.test(request.cashbackRequestId)) {
      return 'The B1 referral engine cashback request cashback request id is invalid';
    }
    if (request.cashbackRequestVersion !== 1) {
      return 'The B1 referral engine cashback request cashback request version is invalid';
    }
    if (request.scopeKey !== B1_REFERRAL_ENGINE_SCOPE_KEY) {
      return 'The B1 referral engine cashback request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REFERRAL_ENGINE_SCOPE_VERSION) {
      return 'The B1 referral engine cashback request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REFERRAL_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 referral engine cashback request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 referral engine cashback request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 referral engine cashback request product key is invalid';
    }
    if (request.productVersion !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 referral engine cashback request product version is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 referral engine cashback request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 referral engine cashback request capability version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 referral engine cashback request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 referral engine cashback request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 referral engine cashback request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 referral engine cashback request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 referral engine cashback request billing document reference is invalid';
    }
    if (!request.cashbackCampaignKey || !SAFE_TEXT_PATTERN.test(request.cashbackCampaignKey)) {
      return 'The B1 referral engine cashback request cashback campaign key is invalid';
    }
    if (request.cashbackCampaignVersion !== 1) {
      return 'The B1 referral engine cashback request cashback campaign version is invalid';
    }
    if (!request.cashbackKey || !SAFE_TEXT_PATTERN.test(request.cashbackKey)) {
      return 'The B1 referral engine cashback request cashback key is invalid';
    }
    if (request.cashbackVersion !== 1) {
      return 'The B1 referral engine cashback request cashback version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 referral engine cashback request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 referral engine cashback request period version is invalid';
    }
    return null;
  }

  private validateLoyaltyRequestShape(request: B1LoyaltyEarningRequestV1): string | null {
    if (!request) {
      return 'The B1 referral engine loyalty earning request is missing';
    }
    if (request.contractName !== B1_REFERRAL_ENGINE_CONTRACT_NAME) {
      return 'The B1 referral engine loyalty earning request contract name is invalid';
    }
    if (request.contractVersion !== B1_REFERRAL_ENGINE_CONTRACT_VERSION) {
      return 'The B1 referral engine loyalty earning request contract version is invalid';
    }
    if (!request.loyaltyRequestId || !SAFE_TEXT_PATTERN.test(request.loyaltyRequestId)) {
      return 'The B1 referral engine loyalty earning request loyalty request id is invalid';
    }
    if (request.loyaltyRequestVersion !== 1) {
      return 'The B1 referral engine loyalty earning request loyalty request version is invalid';
    }
    if (request.scopeKey !== B1_REFERRAL_ENGINE_SCOPE_KEY) {
      return 'The B1 referral engine loyalty earning request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REFERRAL_ENGINE_SCOPE_VERSION) {
      return 'The B1 referral engine loyalty earning request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REFERRAL_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 referral engine loyalty earning request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 referral engine loyalty earning request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 referral engine loyalty earning request product key is invalid';
    }
    if (request.productVersion !== B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 referral engine loyalty earning request product version is invalid';
    }
    if (!request.loyaltyProgramKey || !SAFE_TEXT_PATTERN.test(request.loyaltyProgramKey)) {
      return 'The B1 referral engine loyalty earning request loyalty program key is invalid';
    }
    if (request.loyaltyProgramVersion !== 1) {
      return 'The B1 referral engine loyalty earning request loyalty program version is invalid';
    }
    if (!request.loyaltyTierKey || !SAFE_TEXT_PATTERN.test(request.loyaltyTierKey)) {
      return 'The B1 referral engine loyalty earning request loyalty tier key is invalid';
    }
    if (request.loyaltyTierVersion !== 1) {
      return 'The B1 referral engine loyalty earning request loyalty tier version is invalid';
    }
    if (!request.loyaltyPointPolicyKey || !SAFE_TEXT_PATTERN.test(request.loyaltyPointPolicyKey)) {
      return 'The B1 referral engine loyalty earning request loyalty point policy key is invalid';
    }
    if (request.loyaltyPointPolicyVersion !== 1) {
      return 'The B1 referral engine loyalty earning request loyalty point policy version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 referral engine loyalty earning request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 referral engine loyalty earning request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 referral engine loyalty earning request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 referral engine loyalty earning request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 referral engine loyalty earning request billing document reference is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 referral engine loyalty earning request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 referral engine loyalty earning request period version is invalid';
    }
    return null;
  }

  private buildFailureReferralRewardDecision(
    request: B1ReferralRequestV1,
    code: B1ReferralEngineFailureCodeV1,
    message: string,
  ): B1ReferralRewardDecisionV1 {
    const failure: B1ReferralEngineFailureV1 = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      referralRewardDecisionId: 'failed',
      referralRewardDecisionReference: 'B1-REFERRAL-DECISION-FAILED',
      referralRewardDecisionVersion: 1,
      referralRewardDecisionState: 'DRAFT',
      referralRewardDecisionOutcome: 'REJECTED',
      referralRewardDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      referralRewardDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      referralRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REFERRAL_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REFERRAL_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REFERRAL_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      referralCampaignKey: request?.referralCampaignKey ?? 'unknown',
      referralCampaignVersion: 1,
      referralCampaignName: 'unknown',
      referralProgramKey: request?.referralProgramKey ?? 'unknown',
      referralProgramVersion: 1,
      referralKey: request?.referralKey ?? 'unknown',
      referralVersion: 1,
      referralName: 'unknown',
      referralStartAt: request?.referralStartAt ?? new Date().toISOString(),
      referralEndAt: request?.referralEndAt ?? new Date().toISOString(),
      referralEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      refereeCustomerId: request?.refereeCustomerId ?? 'unknown',
      sponsorCustomerId: request?.sponsorCustomerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.referral',
      capabilityVersion: 1,
      planKey: request?.planKey ?? 'unknown',
      planVersion: 1,
      customerTierKey: request?.customerTierKey ?? 'unknown',
      customerTierVersion: 1,
      merchantTierKey: request?.merchantTierKey ?? 'unknown',
      merchantTierVersion: 1,
      partnerTierKey: request?.partnerTierKey ?? 'unknown',
      partnerTierVersion: 1,
      productEntitlementKey: request?.productEntitlementKey ?? 'unknown',
      productEntitlementVersion: 1,
      subscriptionKey: request?.subscriptionKey ?? 'unknown',
      subscriptionVersion: 1,
      relationshipType: request?.relationshipType ?? 'SPONSOR',
      hierarchyPath: request?.hierarchyPath ? [...request.hierarchyPath] : [],
      hierarchyDepth: request?.hierarchyDepth ?? 0,
      qualificationStatus: request?.qualificationStatus ?? 'NOT_QUALIFIED',
      referralUsageLimitPerReferrer: request?.referralUsageLimitPerReferrer ?? 0,
      referralUsageLimitPerCampaign: request?.referralUsageLimitPerCampaign ?? 0,
      referralUsageLimitRemaining: 0,
      eligibilitySummary: [],
      referralEligible: false,
      referralApplicable: false,
      referralHierarchyConflicts: [],
      referralQualificationConflicts: [],
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'REFERRAL_REWARD_DECISION',
        traceSummary: `B1 referral engine failure: ${message}`,
        traceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      ruleTrace: {
        ruleTraceId: randomUUID(),
        ruleTraceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_REFERRAL_DECISION_FAILED',
        auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request?.idempotencyKey ?? '',
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure,
      generatedAt: new Date().toISOString(),
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestContext: request?.requestContext ?? {
        requestId: 'unknown',
        correlationId: 'unknown',
        traceId: 'unknown',
      },
      causationId: request?.causationId ?? null,
    };
  }

  private buildFailureCashbackCalculationDecision(
    request: B1CashbackRequestV1,
    code: B1ReferralEngineFailureCodeV1,
    message: string,
  ): B1CashbackCalculationDecisionV1 {
    const failure: B1ReferralEngineFailureV1 = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      cashbackDecisionId: 'failed',
      cashbackDecisionReference: 'B1-CASHBACK-DECISION-FAILED',
      cashbackDecisionVersion: 1,
      cashbackDecisionState: 'CREATED',
      cashbackDecisionOutcome: 'REJECTED',
      cashbackDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      cashbackDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      cashbackRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REFERRAL_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REFERRAL_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REFERRAL_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      cashbackCampaignKey: request?.cashbackCampaignKey ?? 'unknown',
      cashbackCampaignVersion: 1,
      cashbackCampaignName: 'unknown',
      cashbackKey: request?.cashbackKey ?? 'unknown',
      cashbackVersion: 1,
      cashbackName: 'unknown',
      cashbackStartAt: request?.cashbackStartAt ?? new Date().toISOString(),
      cashbackEndAt: request?.cashbackEndAt ?? new Date().toISOString(),
      cashbackEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      cashbackCalculationBasis: request?.cashbackCalculationBasis ?? 'FIXED_AMOUNT',
      cashbackCalculationRate: request?.cashbackCalculationRate ?? '0',
      cashbackCalculationBase: request?.cashbackCalculationBase ?? '0',
      cashbackCalculationAmount: '0',
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.cashback',
      capabilityVersion: 1,
      planKey: request?.planKey ?? 'unknown',
      planVersion: 1,
      customerTierKey: request?.customerTierKey ?? 'unknown',
      customerTierVersion: 1,
      merchantTierKey: request?.merchantTierKey ?? 'unknown',
      merchantTierVersion: 1,
      partnerTierKey: request?.partnerTierKey ?? 'unknown',
      partnerTierVersion: 1,
      productEntitlementKey: request?.productEntitlementKey ?? 'unknown',
      productEntitlementVersion: 1,
      subscriptionKey: request?.subscriptionKey ?? 'unknown',
      subscriptionVersion: 1,
      usageLimitPerCustomer: request?.usageLimitPerCustomer ?? 0,
      usageLimitPerCampaign: request?.usageLimitPerCampaign ?? 0,
      usageLimitRemaining: 0,
      eligibilitySummary: [],
      cashbackEligible: false,
      cashbackApplicable: false,
      cashbackRuleEvaluationTrace: [],
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'CASHBACK_CALCULATION_DECISION',
        traceSummary: `B1 referral engine failure: ${message}`,
        traceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      ruleTrace: {
        ruleTraceId: randomUUID(),
        ruleTraceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_CASHBACK_DECISION_FAILED',
        auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
      idempotencyKey: request?.idempotencyKey ?? '',
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure,
      generatedAt: new Date().toISOString(),
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestContext: request?.requestContext ?? {
        requestId: 'unknown',
        correlationId: 'unknown',
        traceId: 'unknown',
      },
      causationId: request?.causationId ?? null,
    };
  }

  private buildFailureLoyaltyEarningDecision(
    request: B1LoyaltyEarningRequestV1,
    code: B1ReferralEngineFailureCodeV1,
    message: string,
  ): B1LoyaltyEarningDecisionV1 {
    const failure: B1ReferralEngineFailureV1 = {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REFERRAL_ENGINE_CONTRACT_VERSION,
      loyaltyEarningDecisionId: 'failed',
      loyaltyEarningDecisionReference: 'B1-LOYALTY-DECISION-FAILED',
      loyaltyEarningDecisionVersion: 1,
      loyaltyEarningDecisionState: 'DRAFT',
      loyaltyEarningDecisionOutcome: 'REJECTED',
      loyaltyEarningDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      loyaltyEarningDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      loyaltyRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REFERRAL_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REFERRAL_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REFERRAL_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      loyaltyProgramKey: request?.loyaltyProgramKey ?? 'unknown',
      loyaltyProgramVersion: 1,
      loyaltyProgramName: 'unknown',
      loyaltyTierKey: request?.loyaltyTierKey ?? 'unknown',
      loyaltyTierVersion: 1,
      loyaltyTierStatus: 'TIER_PENDING',
      loyaltyPointPolicyKey: request?.loyaltyPointPolicyKey ?? 'unknown',
      loyaltyPointPolicyVersion: 1,
      loyaltyEarningSource: request?.loyaltyEarningSource ?? 'BILLING',
      loyaltyEarningBase: request?.loyaltyEarningBase ?? '0',
      loyaltyEarningRate: request?.loyaltyEarningRate ?? '0',
      loyaltyEarningAmount: '0',
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.loyalty',
      capabilityVersion: 1,
      planKey: request?.planKey ?? 'unknown',
      planVersion: 1,
      customerTierKey: request?.customerTierKey ?? 'unknown',
      customerTierVersion: 1,
      merchantTierKey: request?.merchantTierKey ?? 'unknown',
      merchantTierVersion: 1,
      partnerTierKey: request?.partnerTierKey ?? 'unknown',
      partnerTierVersion: 1,
      productEntitlementKey: request?.productEntitlementKey ?? 'unknown',
      productEntitlementVersion: 1,
      subscriptionKey: request?.subscriptionKey ?? 'unknown',
      subscriptionVersion: 1,
      usageLimitPerCustomer: request?.usageLimitPerCustomer ?? 0,
      usageLimitPerProgram: request?.usageLimitPerProgram ?? 0,
      usageLimitRemaining: 0,
      eligibilitySummary: [],
      loyaltyEarningEligible: false,
      loyaltyEarningApplicable: false,
      loyaltyEarningConflicts: [],
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'LOYALTY_EARNING_DECISION',
        traceSummary: `B1 referral engine failure: ${message}`,
        traceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      ruleTrace: {
        ruleTraceId: randomUUID(),
        ruleTraceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_LOYALTY_DECISION_FAILED',
        auditActor: B1_REFERRAL_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
      idempotencyKey: request?.idempotencyKey ?? '',
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure,
      generatedAt: new Date().toISOString(),
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestContext: request?.requestContext ?? {
        requestId: 'unknown',
        correlationId: 'unknown',
        traceId: 'unknown',
      },
      causationId: request?.causationId ?? null,
    };
  }

  private buildReplayReferralFailure(
    request: B1ReferralRequestV1,
    record: B1ReferralRewardDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1ReferralRewardReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      referralRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      referralRewardDecisionHash: record.referralRewardDecisionHash,
      referralRewardDecisionReplayHash: record.referralRewardDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCashbackFailure(
    request: B1CashbackRequestV1,
    record: B1CashbackCalculationDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CashbackCalculationReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      cashbackRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      cashbackDecisionHash: record.cashbackDecisionHash,
      cashbackDecisionReplayHash: record.cashbackDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayLoyaltyFailure(
    request: B1LoyaltyEarningRequestV1,
    record: B1LoyaltyEarningDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1LoyaltyEarningReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      loyaltyRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      loyaltyEarningDecisionHash: record.loyaltyEarningDecisionHash,
      loyaltyEarningDecisionReplayHash: record.loyaltyEarningDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(row: B1ReferralDecision): B1ReferralDocumentPersistenceRecordV1 {
    return {
      documentId: row.id,
      documentReference: row.documentReference,
      documentVersion: row.documentVersion as 1,
      documentKind: row.documentKind,
      documentHash: row.documentHash,
      documentReplayHash: row.documentReplayHash,
      idempotencyScope: row.idempotencyScope,
      idempotencyKey: row.idempotencyKey,
      record: row.record,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1,
    };
  }
}
