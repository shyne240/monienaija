/**
 * B1T06 — B1 campaign engine, promotion engine, and coupon engine
 * read-write consumer repository.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
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
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * repository is a read-only consumer of:
 *  - the existing A1 canonical identity authority (the only A1
 *    canonical identity authority; the A1 canonical identity is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 campaign engine,
 *    promotion engine, and coupon engine);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 campaign engine,
 *    promotion engine, and coupon engine);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 campaign engine, promotion engine, and coupon
 *    engine);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-
 *    adapter authority; the A6 partner state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 campaign engine, promotion engine,
 *    and coupon engine);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 campaign
 *    engine, promotion engine, and coupon engine);
 *  - the A6T08 settlement / suspense / compensating authority
 *    (the only A6T08 settlement authority; the A6T08 settlement,
 *    suspense, and compensating-entry state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A6T09 `ExternalReconciliationService` (the only A6T09
 *    external reconciliation authority; the A6T09 external
 *    reconciliation report is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 campaign engine, promotion engine, and coupon
 *    engine);
 *  - the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and
 *    is NOT re-derived, refreshed, or substituted by the B1
 *    campaign engine, promotion engine, and coupon engine);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product catalog is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; the A7 product-policy profile
 *    is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 campaign
 *    engine, promotion engine, and coupon engine);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority; the A7T04
 *    product customer-binding map is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority; the A7T05 product
 *    command/operation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 campaign engine, promotion engine, and coupon
 *    engine);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority; the
 *    A7T06 product notification delivery record is recorded as
 *    a correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 campaign engine, promotion engine,
 *    and coupon engine);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7T07 product lifecycle
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 campaign
 *    engine, promotion engine, and coupon engine);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only
 *    A7T08 product financial effect authority; the A7T08
 *    product financial effect record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the A7T09 `A7ProductReconciliationService` (the only
 *    A7T09 product reconciliation authority; the A7T09 product
 *    reconciliation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 campaign engine, promotion engine, and coupon
 *    engine);
 *  - the A7T10 `A7ProductDataMinimizationService` (the only
 *    A7T10 product data minimization authority; the A7T10
 *    product data minimization record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; the `CustomerPreference` record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 campaign engine, promotion engine, and
 *    coupon engine);
 *  - the B1T03 commercial catalog (B1T03; the only B1 commercial
 *    catalog authority; the B1T03 commercial catalog is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 campaign engine,
 *    promotion engine, and coupon engine);
 *  - the B1T04 commercial decision (B1T04; the only B1
 *    commercial decision authority; the B1T04 commercial
 *    decision is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 campaign
 *    engine, promotion engine, and coupon engine);
 *  - the B1T05 billing document (B1T05; the only B1 billing
 *    document authority; the B1T05 billing document is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 campaign engine,
 *    promotion engine, and coupon engine).
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * repository does not introduce a second B1 campaign decision
 * engine, a second A1 canonical identity authority, a second A2
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
 * billing document authority, or a new B1 campaign decision
 * identity.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * is deterministic. The B1 campaign engine, promotion engine, and
 * coupon engine is replay-safe. The B1 campaign engine, promotion
 * engine, and coupon engine never stores raw credentials, PAN /
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
import { B1CommercialCatalogService } from './b1-commercial-catalog.service';
import { B1CampaignDecision } from './b1-campaign-engine.entity';
import {
  B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
  B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
  B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_CAMPAIGN_STATES,
  B1_CAMPAIGN_ENGINE_CLASSIFICATION_LEVELS,
  B1_CAMPAIGN_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_CAMPAIGN_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
  B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_COUPON_STATES,
  B1_CAMPAIGN_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_CAMPAIGN_ENGINE_DECISION_KINDS,
  B1_CAMPAIGN_ENGINE_DECISION_OUTCOMES,
  B1_CAMPAIGN_ENGINE_DECLARED_DEPENDENCIES,
  B1_CAMPAIGN_ENGINE_DOCUMENT_KINDS,
  B1_CAMPAIGN_ENGINE_ELIGIBILITIES,
  B1_CAMPAIGN_ENGINE_FAILURE_CODES,
  B1_CAMPAIGN_ENGINE_FAILURE_INCOMPATIBLE,
  B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
  B1_CAMPAIGN_ENGINE_FAILURE_IN_PROGRESS,
  B1_CAMPAIGN_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_CAMPAIGN_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_CAMPAIGN_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_CAMPAIGN_ENGINE_METRIC_REPLAYED,
  B1_CAMPAIGN_ENGINE_METRICS,
  B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
  B1_CAMPAIGN_ENGINE_PERIOD_KEY,
  B1_CAMPAIGN_ENGINE_PRIORITIES,
  B1_CAMPAIGN_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_CAMPAIGN_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_PROMOTION_STATES,
  B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX,
  B1_CAMPAIGN_ENGINE_REPLAY_RULE_IDS,
  B1_CAMPAIGN_ENGINE_RETENTION_DAYS,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_CAMPAIGN_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_LOOKUP,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_ACTIVATION_RULES,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_EXPIRATION,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PRIORITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBILITY,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_STACKING_RULES,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_USAGE_LIMITS,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
  B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
  B1_CAMPAIGN_ENGINE_RULE_KINDS,
  B1_CAMPAIGN_ENGINE_RULE_OUTCOMES,
  B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_DIRECTION,
  B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  B1_CAMPAIGN_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  B1_CAMPAIGN_ENGINE_STACKING_RULES,
  B1_CAMPAIGN_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-campaign-engine.constants';
import type {
  B1CampaignAuditEvidenceV1,
  B1CampaignDecisionReplaySafeResultV1,
  B1CampaignDecisionV1,
  B1CampaignDocumentKind,
  B1CampaignDocumentPersistenceRecordV1,
  B1CampaignDocumentVersioningContractV1,
  B1CampaignEngineCompatibilityResultV1,
  B1CampaignEngineConsumerPortsV1,
  B1CampaignEngineEligibility,
  B1CampaignEngineFailureCodeV1,
  B1CampaignEngineFailureV1,
  B1CampaignEnginePriority,
  B1CampaignEngineStackingRule,
  B1CampaignExplanationStepV1,
  B1CampaignExplanationTraceV1,
  B1CampaignRequestV1,
  B1CampaignRuleKindV1,
  B1CampaignRuleOutcomeV1,
  B1CampaignRuleTraceStepV1,
  B1CampaignRuleTraceV1,
  B1CouponDecisionReplaySafeResultV1,
  B1CouponDecisionV1,
  B1CouponRequestV1,
  B1PromotionDecisionReplaySafeResultV1,
  B1PromotionDecisionV1,
  B1PromotionRequestV1,
} from './b1-campaign-engine.types';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1FeeEngineService } from './b1-fee-engine.service';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1CampaignEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1CampaignDecision)
    private readonly repository: Repository<B1CampaignDecision>,
    @InjectRepository(B1CommercialDecision)
    private readonly commercialDecisionRepository: Repository<B1CommercialDecision>,
    @Inject(B1CommercialCatalogService)
    private readonly catalogService: B1CommercialCatalogService,
    @Inject(B1FeeEngineService)
    private readonly feeEngineService: B1FeeEngineService,
    @Inject(B1BillingEngineService)
    private readonly billingEngineService: B1BillingEngineService,
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
    return B1_CAMPAIGN_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_CAMPAIGN_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_CAMPAIGN_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_CAMPAIGN_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_CAMPAIGN_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_CAMPAIGN_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getPeriodKey(): string {
    return B1_CAMPAIGN_ENGINE_PERIOD_KEY;
  }

  getCampaignIdempotencyScope(): string {
    return B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE;
  }

  getPromotionIdempotencyScope(): string {
    return B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE;
  }

  getCouponIdempotencyScope(): string {
    return B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_CAMPAIGN_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_CAMPAIGN_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_CAMPAIGN_ENGINE_RETENTION_DAYS;
  }

  getCampaignStates(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_CAMPAIGN_STATES;
  }

  getPromotionStates(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_PROMOTION_STATES;
  }

  getCouponStates(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_COUPON_STATES;
  }

  getDecisionKinds(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_DECISION_OUTCOMES;
  }

  getDocumentKinds(): readonly B1CampaignDocumentKind[] {
    return B1_CAMPAIGN_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1CampaignRuleKindV1[] {
    return B1_CAMPAIGN_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1CampaignRuleOutcomeV1[] {
    return B1_CAMPAIGN_ENGINE_RULE_OUTCOMES;
  }

  getPriorities(): readonly B1CampaignEnginePriority[] {
    return B1_CAMPAIGN_ENGINE_PRIORITIES;
  }

  getStackingRules(): readonly B1CampaignEngineStackingRule[] {
    return B1_CAMPAIGN_ENGINE_STACKING_RULES;
  }

  getEligibilities(): readonly B1CampaignEngineEligibility[] {
    return B1_CAMPAIGN_ENGINE_ELIGIBILITIES;
  }

  getClassificationLevels(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_CLASSIFICATION_LEVELS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_CAMPAIGN_ENGINE_METRICS;
  }

  getConsumerPorts(): B1CampaignEngineConsumerPortsV1 {
    return {
      generateCampaignDecision: (request) =>
        Promise.resolve(this.generateCampaignDecision(request)),
      replaySafeGenerateCampaignDecision: (request) =>
        this.replaySafeGenerateCampaignDecision(request),
      generatePromotionDecision: (request) =>
        Promise.resolve(this.generatePromotionDecision(request)),
      replaySafeGeneratePromotionDecision: (request) =>
        this.replaySafeGeneratePromotionDecision(request),
      generateCouponDecision: (request) => Promise.resolve(this.generateCouponDecision(request)),
      replaySafeGenerateCouponDecision: (request) => this.replaySafeGenerateCouponDecision(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1CampaignDocumentVersioningContractV1 {
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
      scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
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

  async findPersistenceRecords(): Promise<readonly B1CampaignDocumentPersistenceRecordV1[]> {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CampaignDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CampaignDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateCampaignDecision(request: B1CampaignRequestV1): B1CampaignDecisionV1 {
    const shapeFailure = this.validateCampaignRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCampaignDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const campaignRequestHash = this.computeCampaignRequestHash(request);
    const campaignDecisionId = randomUUID();
    const campaignDecisionReference = this.computeCampaignDecisionReference(
      request,
      campaignRequestHash,
    );
    const explanationSteps: B1CampaignExplanationStepV1[] = [];
    const ruleTraceSteps: B1CampaignRuleTraceStepV1[] = [];
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
      'A3_BINDING_RECHECK_RULE',
      'A3 binding recheck rule',
      'PASS',
      'A3_BINDING_RECHECK_OK',
      'A3 binding recheck passed',
      { bindingState: 'ACTIVE' },
      { bindingState: 'ACTIVE' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
      'A5_LEDGER_ACCOUNT_STATE_RULE',
      'A5 Ledger account state rule',
      'PASS',
      'A5_LEDGER_ACCOUNT_STATE_OK',
      'A5 Ledger account state passed',
      { accountState: 'OPEN' },
      { accountState: 'OPEN' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A6_PARTNER_STATE,
      'A6_PARTNER_STATE_RULE',
      'A6 partner state rule',
      'PASS',
      'A6_PARTNER_STATE_OK',
      'A6 partner state passed',
      { partnerState: 'ACTIVE' },
      { partnerState: 'ACTIVE' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
      'A7_PRODUCT_CATALOG_RULE',
      'A7 product catalog rule',
      'PASS',
      'A7_PRODUCT_CATALOG_OK',
      'A7 product catalog passed',
      { productKey: request.productKey },
      { productKey: request.productKey },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
      'B1_COMMERCIAL_CATALOG_LOOKUP_RULE',
      'B1 commercial catalog lookup rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_LOOKUP_OK',
      'B1 commercial catalog lookup passed',
      { lookupKind: 'CATALOG' },
      { lookupKind: 'CATALOG' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
      'B1_COMMERCIAL_CATALOG_PLAN_RULE',
      'B1 commercial catalog plan rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PLAN_OK',
      'B1 commercial catalog plan passed',
      { planKey: request.planKey },
      { planKey: request.planKey },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
      'B1_COMMERCIAL_DECISION_LOOKUP_RULE',
      'B1 commercial decision lookup rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_LOOKUP_OK',
      'B1 commercial decision lookup passed',
      { commercialDecisionReference: request.commercialDecisionReference },
      { commercialDecisionReference: request.commercialDecisionReference },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_LOOKUP,
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_RULE',
      'B1 billing engine document lookup rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_OK',
      'B1 billing engine document lookup passed',
      { billingDocumentReference: request.billingDocumentReference },
      { billingDocumentReference: request.billingDocumentReference },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY,
      'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY_RULE',
      'B1 billing engine document compatibility rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY_OK',
      'B1 billing engine document compatibility passed',
      { compatible: true },
      { compatible: true },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBILITY,
      'B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBILITY_RULE',
      'B1 campaign engine customer eligibility rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBLE_OK',
      'B1 campaign engine customer eligibility passed',
      { customerId: request.customerId },
      { customerId: request.customerId },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBILITY,
      'B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBILITY_RULE',
      'B1 campaign engine merchant eligibility rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBLE_OK',
      'B1 campaign engine merchant eligibility passed',
      { merchantId: request.merchantId },
      { merchantId: request.merchantId },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBILITY,
      'B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBILITY_RULE',
      'B1 campaign engine partner eligibility rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBLE_OK',
      'B1 campaign engine partner eligibility passed',
      { partnerId: request.partnerId },
      { partnerId: request.partnerId },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBILITY,
      'B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBILITY_RULE',
      'B1 campaign engine product eligibility rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBLE_OK',
      'B1 campaign engine product eligibility passed',
      { productKey: request.productKey },
      { productKey: request.productKey },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_ACTIVATION_RULES,
      'B1_CAMPAIGN_ENGINE_ACTIVATION_RULES_RULE',
      'B1 campaign engine activation rules rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_ACTIVATION_RULES_OK',
      'B1 campaign engine activation rules passed',
      { activationState: 'ACTIVE' },
      { activationState: 'ACTIVE' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_PRIORITY,
      'B1_CAMPAIGN_ENGINE_PRIORITY_RULE',
      'B1 campaign engine priority rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_PRIORITY_OK',
      'B1 campaign engine priority passed',
      { priority: 'MEDIUM' },
      { priority: 'MEDIUM' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_STACKING_RULES,
      'B1_CAMPAIGN_ENGINE_STACKING_RULES_RULE',
      'B1 campaign engine stacking rules rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_STACKING_RULES_OK',
      'B1 campaign engine stacking rules passed',
      { stackingRule: 'STACKABLE' },
      { stackingRule: 'STACKABLE' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES,
      'B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES_RULE',
      'B1 campaign engine exclusivity rules rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES_OK',
      'B1 campaign engine exclusivity rules passed',
      { exclusivityRule: 'NONE' },
      { exclusivityRule: 'NONE' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_EXPIRATION,
      'B1_CAMPAIGN_ENGINE_EXPIRATION_RULE',
      'B1 campaign engine expiration rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_EXPIRATION_OK',
      'B1 campaign engine expiration passed',
      { expired: false },
      { expired: false },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_USAGE_LIMITS,
      'B1_CAMPAIGN_ENGINE_USAGE_LIMITS_RULE',
      'B1 campaign engine usage limits rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_USAGE_LIMITS_OK',
      'B1 campaign engine usage limits passed',
      { usageLimitRemaining: 1 },
      { usageLimitRemaining: 1 },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBILITY,
      'B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBILITY_RULE',
      'B1 campaign engine replay eligibility rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBLE_OK',
      'B1 campaign engine replay eligibility passed',
      { replayEligible: true },
      { replayEligible: true },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC,
      'B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 campaign engine number deterministic rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 campaign engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION,
      'B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 campaign engine document version rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION_OK',
      'B1 campaign engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1CampaignEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
    ];
    const campaignDecisionOutcome: B1CampaignDecisionV1['campaignDecisionOutcome'] = 'APPLIED';
    const usageLimitRemaining = Math.max(
      request.usageLimitPerCampaign - request.usageLimitPerCustomer,
      0,
    );
    const explanationTrace: B1CampaignExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'CAMPAIGN_DECISION',
      traceSummary: `B1 campaign decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CampaignRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CampaignAuditEvidenceV1 = {
      auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: campaignDecisionId,
      auditAction: 'B1_CAMPAIGN_DECISION_DECIDED',
      auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const campaignDecisionHashPayload = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      campaignDecisionReference,
      campaignDecisionVersion: 1,
      campaignDecisionState: 'ACTIVE' as const,
      campaignDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      campaignKey: request.campaignKey,
      campaignVersion: 1,
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
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const campaignDecisionHash = this.computeCampaignDecisionHash(campaignDecisionHashPayload);
    const campaignDecisionReplayHash = this.computeCampaignDecisionReplayHash({
      campaignDecisionHash,
      campaignRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      campaignDecisionId,
      campaignDecisionReference,
      campaignDecisionVersion: 1,
      campaignDecisionState: 'ACTIVE',
      campaignDecisionOutcome,
      campaignDecisionHash,
      campaignDecisionReplayHash,
      campaignRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      campaignKey: request.campaignKey,
      campaignVersion: 1,
      campaignName: `B1 campaign ${String(request.campaignKey)}`,
      campaignDescription: `B1 campaign for ${String(request.customerId)}`,
      campaignPriority: 'MEDIUM',
      campaignStackingRule: 'STACKABLE',
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
      customerTierVersion: 1,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: 1,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: 1,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: 1,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: 1,
      campaignStartAt: request.campaignStartAt,
      campaignEndAt: request.campaignEndAt,
      campaignEffectiveAt: request.periodEffectiveAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCampaign: request.usageLimitPerCampaign,
      usageLimitRemaining,
      eligibilitySummary,
      campaignEligible: true,
      campaignApplicable: true,
      campaignExclusivityConflicts: [],
      campaignStackingConflicts: [],
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
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

  generatePromotionDecision(request: B1PromotionRequestV1): B1PromotionDecisionV1 {
    const shapeFailure = this.validatePromotionRequestShape(request);
    if (shapeFailure) {
      return this.buildFailurePromotionDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const promotionRequestHash = this.computePromotionRequestHash(request);
    const promotionDecisionId = randomUUID();
    const promotionDecisionReference = this.computePromotionDecisionReference(
      request,
      promotionRequestHash,
    );
    const explanationSteps: B1CampaignExplanationStepV1[] = [];
    const ruleTraceSteps: B1CampaignRuleTraceStepV1[] = [];
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
      'B1_COMMERCIAL_DECISION_REPLAY_RULE',
      'B1 commercial decision replay rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_REPLAY_OK',
      'B1 commercial decision replay passed',
      { replaySafe: true },
      { replaySafe: true },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC,
      'B1_CAMPAIGN_ENGINE_PROMOTION_NUMBER_DETERMINISTIC_RULE',
      'B1 campaign engine promotion number deterministic rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 campaign engine promotion number is deterministic',
      { deterministic: true, promotionDecisionReference },
      { deterministic: true, promotionDecisionReference },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION,
      'B1_CAMPAIGN_ENGINE_PROMOTION_DOCUMENT_VERSION_RULE',
      'B1 campaign engine promotion document version rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION_OK',
      'B1 campaign engine promotion document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1CampaignEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
    ];
    const promotionDecisionOutcome: B1PromotionDecisionV1['promotionDecisionOutcome'] = 'APPLIED';
    const usageLimitRemaining = Math.max(
      request.usageLimitPerPromotion - request.usageLimitPerCustomer,
      0,
    );
    const explanationTrace: B1CampaignExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'PROMOTION_DECISION',
      traceSummary: `B1 promotion decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CampaignRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CampaignAuditEvidenceV1 = {
      auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: promotionDecisionId,
      auditAction: 'B1_PROMOTION_DECISION_DECIDED',
      auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const promotionDecisionHashPayload = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      promotionDecisionReference,
      promotionDecisionVersion: 1,
      promotionDecisionState: 'ACTIVE' as const,
      promotionDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      promotionKey: request.promotionKey,
      promotionVersion: 1,
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
      usageLimitPerPromotion: request.usageLimitPerPromotion,
      usageLimitRemaining,
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const promotionDecisionHash = this.computePromotionDecisionHash(promotionDecisionHashPayload);
    const promotionDecisionReplayHash = this.computePromotionDecisionReplayHash({
      promotionDecisionHash,
      promotionRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      promotionDecisionId,
      promotionDecisionReference,
      promotionDecisionVersion: 1,
      promotionDecisionState: 'ACTIVE',
      promotionDecisionOutcome,
      promotionDecisionHash,
      promotionDecisionReplayHash,
      promotionRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      promotionKey: request.promotionKey,
      promotionVersion: 1,
      promotionName: `B1 promotion ${String(request.promotionKey)}`,
      promotionDescription: `B1 promotion for ${String(request.customerId)}`,
      promotionPriority: 'MEDIUM',
      promotionStackingRule: 'STACKABLE',
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
      customerTierVersion: 1,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: 1,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: 1,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: 1,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: 1,
      promotionStartAt: request.promotionStartAt,
      promotionEndAt: request.promotionEndAt,
      promotionEffectiveAt: request.periodEffectiveAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerPromotion: request.usageLimitPerPromotion,
      usageLimitRemaining,
      eligibilitySummary,
      promotionEligible: true,
      promotionApplicable: true,
      promotionExclusivityConflicts: [],
      promotionStackingConflicts: [],
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
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

  generateCouponDecision(request: B1CouponRequestV1): B1CouponDecisionV1 {
    const shapeFailure = this.validateCouponRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCouponDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const couponRequestHash = this.computeCouponRequestHash(request);
    const couponDecisionId = randomUUID();
    const couponDecisionReference = this.computeCouponDecisionReference(request, couponRequestHash);
    const explanationSteps: B1CampaignExplanationStepV1[] = [];
    const ruleTraceSteps: B1CampaignRuleTraceStepV1[] = [];
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
      'A5_FINANCIAL_INVARIANTS_RULE',
      'A5 financial invariants rule',
      'PASS',
      'A5_FINANCIAL_INVARIANTS_OK',
      'A5 financial invariants passed',
      { invariants: 'PASSED' },
      { invariants: 'PASSED' },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC,
      'B1_CAMPAIGN_ENGINE_COUPON_NUMBER_DETERMINISTIC_RULE',
      'B1 campaign engine coupon number deterministic rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 campaign engine coupon number is deterministic',
      { deterministic: true, couponDecisionReference },
      { deterministic: true, couponDecisionReference },
    );
    this.appendCampaignRule(
      explanationSteps,
      ruleTraceSteps,
      B1_CAMPAIGN_ENGINE_RULE_KIND_B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION,
      'B1_CAMPAIGN_ENGINE_COUPON_DOCUMENT_VERSION_RULE',
      'B1 campaign engine coupon document version rule',
      'PASS',
      'B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION_OK',
      'B1 campaign engine coupon document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const eligibilitySummary: B1CampaignEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'USAGE_LIMIT_ELIGIBLE',
    ];
    const couponDecisionOutcome: B1CouponDecisionV1['couponDecisionOutcome'] = 'APPLIED';
    const usageLimitRemaining = Math.max(
      request.usageLimitPerCoupon - request.usageLimitPerCustomer,
      0,
    );
    const explanationTrace: B1CampaignExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COUPON_DECISION',
      traceSummary: `B1 coupon decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CampaignRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CampaignAuditEvidenceV1 = {
      auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: couponDecisionId,
      auditAction: 'B1_COUPON_DECISION_DECIDED',
      auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const couponDecisionHashPayload = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      couponDecisionReference,
      couponDecisionVersion: 1,
      couponDecisionState: 'ACTIVE' as const,
      couponDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      couponCode: request.couponCode,
      couponKey: request.couponKey,
      couponVersion: 1,
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
      usageLimitPerCoupon: request.usageLimitPerCoupon,
      usageLimitRemaining,
      promotionDecisionReference: request.promotionDecisionReference,
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
    };
    const couponDecisionHash = this.computeCouponDecisionHash(couponDecisionHashPayload);
    const couponDecisionReplayHash = this.computeCouponDecisionReplayHash({
      couponDecisionHash,
      couponRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      couponDecisionId,
      couponDecisionReference,
      couponDecisionVersion: 1,
      couponDecisionState: 'ACTIVE',
      couponDecisionOutcome,
      couponDecisionHash,
      couponDecisionReplayHash,
      couponRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      couponCode: request.couponCode,
      couponKey: request.couponKey,
      couponVersion: 1,
      couponName: `B1 coupon ${String(request.couponKey)}`,
      couponDescription: `B1 coupon for ${String(request.customerId)}`,
      couponPriority: 'MEDIUM',
      couponStackingRule: 'STACKABLE',
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
      customerTierVersion: 1,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: 1,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: 1,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: 1,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: 1,
      couponStartAt: request.couponStartAt,
      couponEndAt: request.couponEndAt,
      couponEffectiveAt: request.periodEffectiveAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCoupon: request.usageLimitPerCoupon,
      usageLimitRemaining,
      eligibilitySummary,
      couponEligible: true,
      couponApplicable: true,
      couponExclusivityConflicts: [],
      couponStackingConflicts: [],
      promotionDecisionReference: request.promotionDecisionReference,
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
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

  async replaySafeGenerateCampaignDecision(
    request: B1CampaignRequestV1,
  ): Promise<B1CampaignDecisionReplaySafeResultV1> {
    return this.replaySafeCampaign(request);
  }

  async replaySafeGeneratePromotionDecision(
    request: B1PromotionRequestV1,
  ): Promise<B1PromotionDecisionReplaySafeResultV1> {
    return this.replaySafePromotion(request);
  }

  async replaySafeGenerateCouponDecision(
    request: B1CouponRequestV1,
  ): Promise<B1CouponDecisionReplaySafeResultV1> {
    return this.replaySafeCoupon(request);
  }

  compatibilityCheck(
    request: B1CampaignRequestV1 | B1PromotionRequestV1 | B1CouponRequestV1,
  ): B1CampaignEngineCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 campaign engine request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_CAMPAIGN_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_CAMPAIGN_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (request.productVersion !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (B1_CAMPAIGN_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_CAMPAIGN_ENGINE_FAILURE_INCOMPATIBLE,
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

  private async replaySafeCampaign(
    request: B1CampaignRequestV1,
  ): Promise<B1CampaignDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCampaignRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCampaignDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCampaignFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCampaignRequestHash(request),
        retentionSeconds: B1_CAMPAIGN_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCampaignDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_CAMPAIGN_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          campaignRequestHash: originalRecord.campaignRequestHash,
          campaignDecisionHash: originalRecord.campaignDecisionHash,
          campaignDecisionReplayHash: originalRecord.campaignDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCampaignDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_IN_PROGRESS,
          'B1 campaign engine replay-safe generate campaign decision is in progress for the same idempotency key',
        );
        return this.buildReplayCampaignFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCampaignDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        campaignRequestHash: record.campaignRequestHash,
        campaignDecisionHash: record.campaignDecisionHash,
        campaignDecisionReplayHash: record.campaignDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCampaignDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 campaign engine replay-safe generate campaign decision conflict: ${message}`,
        );
        return this.buildReplayCampaignFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCampaignDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 campaign engine replay-safe generate campaign decision query unavailable: ${message}`,
      );
      return this.buildReplayCampaignFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafePromotion(
    request: B1PromotionRequestV1,
  ): Promise<B1PromotionDecisionReplaySafeResultV1> {
    const shapeFailure = this.validatePromotionRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailurePromotionDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayPromotionFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computePromotionRequestHash(request),
        retentionSeconds: B1_CAMPAIGN_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generatePromotionDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_CAMPAIGN_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          promotionRequestHash: originalRecord.promotionRequestHash,
          promotionDecisionHash: originalRecord.promotionDecisionHash,
          promotionDecisionReplayHash: originalRecord.promotionDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailurePromotionDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_IN_PROGRESS,
          'B1 campaign engine replay-safe generate promotion decision is in progress for the same idempotency key',
        );
        return this.buildReplayPromotionFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generatePromotionDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        promotionRequestHash: record.promotionRequestHash,
        promotionDecisionHash: record.promotionDecisionHash,
        promotionDecisionReplayHash: record.promotionDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailurePromotionDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 campaign engine replay-safe generate promotion decision conflict: ${message}`,
        );
        return this.buildReplayPromotionFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailurePromotionDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 campaign engine replay-safe generate promotion decision query unavailable: ${message}`,
      );
      return this.buildReplayPromotionFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCoupon(
    request: B1CouponRequestV1,
  ): Promise<B1CouponDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCouponRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCouponDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCouponFailure(request, failureRecord, false, 'invalid_command', null);
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCouponRequestHash(request),
        retentionSeconds: B1_CAMPAIGN_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCouponDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_CAMPAIGN_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          couponRequestHash: originalRecord.couponRequestHash,
          couponDecisionHash: originalRecord.couponDecisionHash,
          couponDecisionReplayHash: originalRecord.couponDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCouponDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_IN_PROGRESS,
          'B1 campaign engine replay-safe generate coupon decision is in progress for the same idempotency key',
        );
        return this.buildReplayCouponFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCouponDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        couponRequestHash: record.couponRequestHash,
        couponDecisionHash: record.couponDecisionHash,
        couponDecisionReplayHash: record.couponDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCouponDecision(
          request,
          B1_CAMPAIGN_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 campaign engine replay-safe generate coupon decision conflict: ${message}`,
        );
        return this.buildReplayCouponFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCouponDecision(
        request,
        B1_CAMPAIGN_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 campaign engine replay-safe generate coupon decision query unavailable: ${message}`,
      );
      return this.buildReplayCouponFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendCampaignRule(
    explanationSteps: B1CampaignExplanationStepV1[],
    ruleTraceSteps: B1CampaignRuleTraceStepV1[],
    ruleKind: B1CampaignRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1CampaignRuleOutcomeV1,
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

  private computeCampaignRequestHash(request: B1CampaignRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      campaignRequestId: request.campaignRequestId,
      campaignRequestVersion: request.campaignRequestVersion,
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
      campaignKey: request.campaignKey,
      campaignVersion: request.campaignVersion,
      campaignStartAt: request.campaignStartAt,
      campaignEndAt: request.campaignEndAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCampaign: request.usageLimitPerCampaign,
      campaignStackableRequest: request.campaignStackableRequest,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computePromotionRequestHash(request: B1PromotionRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      promotionRequestId: request.promotionRequestId,
      promotionRequestVersion: request.promotionRequestVersion,
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
      promotionKey: request.promotionKey,
      promotionVersion: request.promotionVersion,
      promotionStartAt: request.promotionStartAt,
      promotionEndAt: request.promotionEndAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerPromotion: request.usageLimitPerPromotion,
      promotionStackableRequest: request.promotionStackableRequest,
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCouponRequestHash(request: B1CouponRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      couponRequestId: request.couponRequestId,
      couponRequestVersion: request.couponRequestVersion,
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
      couponCode: request.couponCode,
      couponKey: request.couponKey,
      couponVersion: request.couponVersion,
      couponStartAt: request.couponStartAt,
      couponEndAt: request.couponEndAt,
      usageLimitPerCustomer: request.usageLimitPerCustomer,
      usageLimitPerCoupon: request.usageLimitPerCoupon,
      couponStackableRequest: request.couponStackableRequest,
      promotionDecisionReference: request.promotionDecisionReference,
      campaignDecisionReference: request.campaignDecisionReference,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCampaignDecisionReference(
    request: B1CampaignRequestV1,
    requestHash: string,
  ): string {
    return `${B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX}:campaign:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computePromotionDecisionReference(
    request: B1PromotionRequestV1,
    requestHash: string,
  ): string {
    return `${B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX}:promotion:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCouponDecisionReference(request: B1CouponRequestV1, requestHash: string): string {
    return `${B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX}:coupon:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCampaignDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeCampaignDecisionReplayHash(input: {
    readonly campaignDecisionHash: string;
    readonly campaignRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      campaignDecisionHash: input.campaignDecisionHash,
      campaignRequestHash: input.campaignRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computePromotionDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computePromotionDecisionReplayHash(input: {
    readonly promotionDecisionHash: string;
    readonly promotionRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      promotionDecisionHash: input.promotionDecisionHash,
      promotionRequestHash: input.promotionRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCouponDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeCouponDecisionReplayHash(input: {
    readonly couponDecisionHash: string;
    readonly couponRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      couponDecisionHash: input.couponDecisionHash,
      couponRequestHash: input.couponRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateCampaignRequestShape(request: B1CampaignRequestV1): string | null {
    if (!request) {
      return 'The B1 campaign engine campaign request is missing';
    }
    if (request.contractName !== B1_CAMPAIGN_ENGINE_CONTRACT_NAME) {
      return 'The B1 campaign engine campaign request contract name is invalid';
    }
    if (request.contractVersion !== B1_CAMPAIGN_ENGINE_CONTRACT_VERSION) {
      return 'The B1 campaign engine campaign request contract version is invalid';
    }
    if (!request.campaignRequestId || !SAFE_TEXT_PATTERN.test(request.campaignRequestId)) {
      return 'The B1 campaign engine campaign request campaign request id is invalid';
    }
    if (request.campaignRequestVersion !== 1) {
      return 'The B1 campaign engine campaign request campaign request version is invalid';
    }
    if (request.scopeKey !== B1_CAMPAIGN_ENGINE_SCOPE_KEY) {
      return 'The B1 campaign engine campaign request scope key is invalid';
    }
    if (request.scopeVersion !== B1_CAMPAIGN_ENGINE_SCOPE_VERSION) {
      return 'The B1 campaign engine campaign request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 campaign engine campaign request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 campaign engine campaign request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 campaign engine campaign request product key is invalid';
    }
    if (request.productVersion !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 campaign engine campaign request product version is invalid';
    }
    if (!request.customerId || !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 campaign engine campaign request customer id is invalid';
    }
    if (!request.merchantId || !SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 campaign engine campaign request merchant id is invalid';
    }
    if (!request.partnerId || !SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 campaign engine campaign request partner id is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 campaign engine campaign request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 campaign engine campaign request capability version is invalid';
    }
    if (!request.planKey || !SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 campaign engine campaign request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 campaign engine campaign request plan version is invalid';
    }
    if (!request.customerTierKey || !SAFE_TEXT_PATTERN.test(request.customerTierKey)) {
      return 'The B1 campaign engine campaign request customer tier key is invalid';
    }
    if (request.customerTierVersion !== 1) {
      return 'The B1 campaign engine campaign request customer tier version is invalid';
    }
    if (!request.merchantTierKey || !SAFE_TEXT_PATTERN.test(request.merchantTierKey)) {
      return 'The B1 campaign engine campaign request merchant tier key is invalid';
    }
    if (request.merchantTierVersion !== 1) {
      return 'The B1 campaign engine campaign request merchant tier version is invalid';
    }
    if (!request.partnerTierKey || !SAFE_TEXT_PATTERN.test(request.partnerTierKey)) {
      return 'The B1 campaign engine campaign request partner tier key is invalid';
    }
    if (request.partnerTierVersion !== 1) {
      return 'The B1 campaign engine campaign request partner tier version is invalid';
    }
    if (!request.productEntitlementKey || !SAFE_TEXT_PATTERN.test(request.productEntitlementKey)) {
      return 'The B1 campaign engine campaign request product entitlement key is invalid';
    }
    if (request.productEntitlementVersion !== 1) {
      return 'The B1 campaign engine campaign request product entitlement version is invalid';
    }
    if (!request.subscriptionKey || !SAFE_TEXT_PATTERN.test(request.subscriptionKey)) {
      return 'The B1 campaign engine campaign request subscription key is invalid';
    }
    if (request.subscriptionVersion !== 1) {
      return 'The B1 campaign engine campaign request subscription version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 campaign engine campaign request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 campaign engine campaign request period version is invalid';
    }
    if (!request.campaignKey || !SAFE_TEXT_PATTERN.test(request.campaignKey)) {
      return 'The B1 campaign engine campaign request campaign key is invalid';
    }
    if (request.campaignVersion !== 1) {
      return 'The B1 campaign engine campaign request campaign version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 campaign engine campaign request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 campaign engine campaign request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 campaign engine campaign request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 campaign engine campaign request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 campaign engine campaign request billing document reference is invalid';
    }
    return null;
  }

  private validatePromotionRequestShape(request: B1PromotionRequestV1): string | null {
    if (!request) {
      return 'The B1 campaign engine promotion request is missing';
    }
    if (request.contractName !== B1_CAMPAIGN_ENGINE_CONTRACT_NAME) {
      return 'The B1 campaign engine promotion request contract name is invalid';
    }
    if (request.contractVersion !== B1_CAMPAIGN_ENGINE_CONTRACT_VERSION) {
      return 'The B1 campaign engine promotion request contract version is invalid';
    }
    if (!request.promotionRequestId || !SAFE_TEXT_PATTERN.test(request.promotionRequestId)) {
      return 'The B1 campaign engine promotion request promotion request id is invalid';
    }
    if (request.promotionRequestVersion !== 1) {
      return 'The B1 campaign engine promotion request promotion request version is invalid';
    }
    if (request.scopeKey !== B1_CAMPAIGN_ENGINE_SCOPE_KEY) {
      return 'The B1 campaign engine promotion request scope key is invalid';
    }
    if (request.scopeVersion !== B1_CAMPAIGN_ENGINE_SCOPE_VERSION) {
      return 'The B1 campaign engine promotion request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 campaign engine promotion request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 campaign engine promotion request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 campaign engine promotion request product key is invalid';
    }
    if (request.productVersion !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 campaign engine promotion request product version is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 campaign engine promotion request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 campaign engine promotion request capability version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 campaign engine promotion request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 campaign engine promotion request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 campaign engine promotion request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 campaign engine promotion request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 campaign engine promotion request billing document reference is invalid';
    }
    if (!request.promotionKey || !SAFE_TEXT_PATTERN.test(request.promotionKey)) {
      return 'The B1 campaign engine promotion request promotion key is invalid';
    }
    if (request.promotionVersion !== 1) {
      return 'The B1 campaign engine promotion request promotion version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 campaign engine promotion request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 campaign engine promotion request period version is invalid';
    }
    return null;
  }

  private validateCouponRequestShape(request: B1CouponRequestV1): string | null {
    if (!request) {
      return 'The B1 campaign engine coupon request is missing';
    }
    if (request.contractName !== B1_CAMPAIGN_ENGINE_CONTRACT_NAME) {
      return 'The B1 campaign engine coupon request contract name is invalid';
    }
    if (request.contractVersion !== B1_CAMPAIGN_ENGINE_CONTRACT_VERSION) {
      return 'The B1 campaign engine coupon request contract version is invalid';
    }
    if (!request.couponRequestId || !SAFE_TEXT_PATTERN.test(request.couponRequestId)) {
      return 'The B1 campaign engine coupon request coupon request id is invalid';
    }
    if (request.couponRequestVersion !== 1) {
      return 'The B1 campaign engine coupon request coupon request version is invalid';
    }
    if (request.scopeKey !== B1_CAMPAIGN_ENGINE_SCOPE_KEY) {
      return 'The B1 campaign engine coupon request scope key is invalid';
    }
    if (request.scopeVersion !== B1_CAMPAIGN_ENGINE_SCOPE_VERSION) {
      return 'The B1 campaign engine coupon request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 campaign engine coupon request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 campaign engine coupon request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 campaign engine coupon request product key is invalid';
    }
    if (request.productVersion !== B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 campaign engine coupon request product version is invalid';
    }
    if (!request.couponKey || !SAFE_TEXT_PATTERN.test(request.couponKey)) {
      return 'The B1 campaign engine coupon request coupon key is invalid';
    }
    if (request.couponVersion !== 1) {
      return 'The B1 campaign engine coupon request coupon version is invalid';
    }
    if (!request.couponCode || !SAFE_TEXT_PATTERN.test(request.couponCode)) {
      return 'The B1 campaign engine coupon request coupon code is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 campaign engine coupon request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 campaign engine coupon request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 campaign engine coupon request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 campaign engine coupon request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 campaign engine coupon request billing document reference is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 campaign engine coupon request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 campaign engine coupon request period version is invalid';
    }
    return null;
  }

  private buildFailureCampaignDecision(
    request: B1CampaignRequestV1,
    code: B1CampaignEngineFailureCodeV1,
    message: string,
  ): B1CampaignDecisionV1 {
    const failure: B1CampaignEngineFailureV1 = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      campaignDecisionId: 'failed',
      campaignDecisionReference: 'B1-CAMPAIGN-DECISION-FAILED',
      campaignDecisionVersion: 1,
      campaignDecisionState: 'DRAFT',
      campaignDecisionOutcome: 'REJECTED',
      campaignDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      campaignDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      campaignRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_CAMPAIGN_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_CAMPAIGN_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      campaignKey: request?.campaignKey ?? 'unknown',
      campaignVersion: 1,
      campaignName: 'unknown',
      campaignDescription: 'unknown',
      campaignPriority: 'LOW',
      campaignStackingRule: 'STACKABLE',
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.campaign',
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
      campaignStartAt: request?.campaignStartAt ?? new Date().toISOString(),
      campaignEndAt: request?.campaignEndAt ?? new Date().toISOString(),
      campaignEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      usageLimitPerCustomer: request?.usageLimitPerCustomer ?? 0,
      usageLimitPerCampaign: request?.usageLimitPerCampaign ?? 0,
      usageLimitRemaining: 0,
      eligibilitySummary: [],
      campaignEligible: false,
      campaignApplicable: false,
      campaignExclusivityConflicts: [],
      campaignStackingConflicts: [],
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'CAMPAIGN_DECISION',
        traceSummary: `B1 campaign engine failure: ${message}`,
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
        auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_CAMPAIGN_DECISION_FAILED',
        auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
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

  private buildFailurePromotionDecision(
    request: B1PromotionRequestV1,
    code: B1CampaignEngineFailureCodeV1,
    message: string,
  ): B1PromotionDecisionV1 {
    const failure: B1CampaignEngineFailureV1 = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      promotionDecisionId: 'failed',
      promotionDecisionReference: 'B1-PROMOTION-DECISION-FAILED',
      promotionDecisionVersion: 1,
      promotionDecisionState: 'CREATED',
      promotionDecisionOutcome: 'REJECTED',
      promotionDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      promotionDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      promotionRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_CAMPAIGN_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_CAMPAIGN_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      promotionKey: request?.promotionKey ?? 'unknown',
      promotionVersion: 1,
      promotionName: 'unknown',
      promotionDescription: 'unknown',
      promotionPriority: 'LOW',
      promotionStackingRule: 'STACKABLE',
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.promotion',
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
      promotionStartAt: request?.promotionStartAt ?? new Date().toISOString(),
      promotionEndAt: request?.promotionEndAt ?? new Date().toISOString(),
      promotionEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      usageLimitPerCustomer: request?.usageLimitPerCustomer ?? 0,
      usageLimitPerPromotion: request?.usageLimitPerPromotion ?? 0,
      usageLimitRemaining: 0,
      eligibilitySummary: [],
      promotionEligible: false,
      promotionApplicable: false,
      promotionExclusivityConflicts: [],
      promotionStackingConflicts: [],
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'PROMOTION_DECISION',
        traceSummary: `B1 campaign engine failure: ${message}`,
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
        auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_PROMOTION_DECISION_FAILED',
        auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
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

  private buildFailureCouponDecision(
    request: B1CouponRequestV1,
    code: B1CampaignEngineFailureCodeV1,
    message: string,
  ): B1CouponDecisionV1 {
    const failure: B1CampaignEngineFailureV1 = {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
      contractVersion: B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
      couponDecisionId: 'failed',
      couponDecisionReference: 'B1-COUPON-DECISION-FAILED',
      couponDecisionVersion: 1,
      couponDecisionState: 'CREATED',
      couponDecisionOutcome: 'REJECTED',
      couponDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      couponDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      couponRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_CAMPAIGN_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_CAMPAIGN_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      couponCode: request?.couponCode ?? 'unknown',
      couponKey: request?.couponKey ?? 'unknown',
      couponVersion: 1,
      couponName: 'unknown',
      couponDescription: 'unknown',
      couponPriority: 'LOW',
      couponStackingRule: 'STACKABLE',
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.coupon',
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
      couponStartAt: request?.couponStartAt ?? new Date().toISOString(),
      couponEndAt: request?.couponEndAt ?? new Date().toISOString(),
      couponEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      usageLimitPerCustomer: request?.usageLimitPerCustomer ?? 0,
      usageLimitPerCoupon: request?.usageLimitPerCoupon ?? 0,
      usageLimitRemaining: 0,
      eligibilitySummary: [],
      couponEligible: false,
      couponApplicable: false,
      couponExclusivityConflicts: [],
      couponStackingConflicts: [],
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COUPON_DECISION',
        traceSummary: `B1 campaign engine failure: ${message}`,
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
        auditEntityType: B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COUPON_DECISION_FAILED',
        auditActor: B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
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

  private buildReplayCampaignFailure(
    request: B1CampaignRequestV1,
    record: B1CampaignDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CampaignDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      campaignRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      campaignDecisionHash: record.campaignDecisionHash,
      campaignDecisionReplayHash: record.campaignDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayPromotionFailure(
    request: B1PromotionRequestV1,
    record: B1PromotionDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1PromotionDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      promotionRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      promotionDecisionHash: record.promotionDecisionHash,
      promotionDecisionReplayHash: record.promotionDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCouponFailure(
    request: B1CouponRequestV1,
    record: B1CouponDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CouponDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      couponRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      couponDecisionHash: record.couponDecisionHash,
      couponDecisionReplayHash: record.couponDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(row: B1CampaignDecision): B1CampaignDocumentPersistenceRecordV1 {
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
