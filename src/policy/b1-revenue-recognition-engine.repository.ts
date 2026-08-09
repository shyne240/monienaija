/**
 * B1T08 — B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine read-write consumer repository.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine repository is a read-write consumer of:
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
 *  - the B1 referral engine, cashback engine, and loyalty engine
 *    (B1T07) persistence schema (the only B1 commercial-rewards
 *    decision persistence surface; the B1 commercial-rewards
 *    decision record is consulted through the B1 referral engine
 *    read-only consumer boundary surface);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine repository is a read-only consumer of:
 *  - the existing A1 canonical identity authority (the only A1
 *    canonical identity authority; the A1 canonical identity is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 revenue-recognition
 *    engine, tax / VAT engine, and cost-accounting engine);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 revenue-recognition
 *    engine, tax / VAT engine, and cost-accounting engine);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-
 *    adapter authority; the A6 partner state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 revenue-recognition engine, tax /
 *    VAT engine, and cost-accounting engine);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 revenue-
 *    recognition engine, tax / VAT engine, and cost-accounting
 *    engine);
 *  - the A6T08 settlement / suspense / compensating authority
 *    (the only A6T08 settlement authority; the A6T08 settlement,
 *    suspense, and compensating-entry state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A6T09 `ExternalReconciliationService` (the only A6T09
 *    external reconciliation authority; the A6T09 external
 *    reconciliation report is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine);
 *  - the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and
 *    is NOT re-derived, refreshed, or substituted by the B1
 *    revenue-recognition engine, tax / VAT engine, and cost-
 *    accounting engine);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product catalog is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; the A7 product-policy profile
 *    is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 revenue-
 *    recognition engine, tax / VAT engine, and cost-accounting
 *    engine);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority; the A7T04
 *    product customer-binding map is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority; the A7T05 product
 *    command/operation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority; the
 *    A7T06 product notification delivery record is recorded as
 *    a correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 revenue-recognition engine, tax /
 *    VAT engine, and cost-accounting engine);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7T07 product lifecycle
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 revenue-
 *    recognition engine, tax / VAT engine, and cost-accounting
 *    engine);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only
 *    A7T08 product financial effect authority; the A7T08
 *    product financial effect record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the A7T09 `A7ProductReconciliationService` (the only
 *    A7T09 product reconciliation authority; the A7T09 product
 *    reconciliation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine);
 *  - the A7T10 `A7ProductDataMinimizationService` (the only
 *    A7T10 product data minimization authority; the A7T10
 *    product data minimization record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; the `CustomerPreference` record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 revenue-recognition engine, tax / VAT
 *    engine, and cost-accounting engine);
 *  - the B1T03 commercial catalog (B1T03; the only B1 commercial
 *    catalog authority; the B1T03 commercial catalog is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 revenue-recognition
 *    engine, tax / VAT engine, and cost-accounting engine);
 *  - the B1T04 commercial decision (B1T04; the only B1
 *    commercial decision authority; the B1T04 commercial
 *    decision is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 revenue-
 *    recognition engine, tax / VAT engine, and cost-accounting
 *    engine);
 *  - the B1T05 billing document (B1T05; the only B1 billing
 *    document authority; the B1T05 billing document is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 revenue-recognition
 *    engine, tax / VAT engine, and cost-accounting engine);
 *  - the B1T06 commercial-incentive decision (B1T06; the only
 *    B1 commercial-incentive decision authority; the B1T06
 *    commercial-incentive decision is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine);
 *  - the B1T07 commercial-rewards decision (B1T07; the only
 *    B1 commercial-rewards decision authority; the B1T07
 *    commercial-rewards decision is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine).
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine repository does not introduce a second
 * B1 commercial-financial-recognition engine, a second A1
 * canonical identity authority, a second A2 authorization
 * authority, a second A3 binding authority, a second A4 product-
 * policy authority, a second A5 Ledger authority, a second A6
 * partner-adapter authority, a second A6T05 external-operation
 * authority, a second A6T08 settlement authority, a second A6T09
 * external reconciliation authority, a second A6T10 data
 * classification authority, a second A7 product catalog
 * authority, a second A7 product-policy authority, a second A7T04
 * product customer-binding authority, a second A7T05 product
 * command authority, a second A7T06 product notification
 * delivery authority, a second A7T07 product lifecycle authority,
 * a second A7T08 product financial effect authority, a second
 * A7T09 product reconciliation authority, a second A7T10 product
 * data minimization authority, a second `CustomerPreference`
 * authority, a second audit authority, a second idempotency
 * authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, a second B1T03
 * commercial catalog authority, a second B1T04 commercial decision
 * authority, a second B1T05 billing document authority, a second
 * B1T06 commercial-incentive decision authority, a second B1T07
 * commercial-rewards decision authority, or a new B1 commercial-
 * financial-recognition identity.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine is deterministic. The B1 revenue-
 * recognition engine, tax / VAT engine, and cost-accounting engine
 * is replay-safe. The B1 revenue-recognition engine, tax / VAT
 * engine, and cost-accounting engine never stores raw credentials,
 * PAN / account secrets, PINs, OTPs, callback signatures, private
 * keys, raw risk / compliance notes, or unnecessary customer data
 * in broad records, logs, traces, events, or notification payloads.
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
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1ReferralEngineService } from './b1-referral-engine.service';
import {
  B1_REVENUE_RECOGNITION_ENGINE_ACCOUNTING_BASES,
  B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
  B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
  B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_STATES,
  B1_REVENUE_RECOGNITION_ENGINE_COST_ALLOCATION_METHODS,
  B1_REVENUE_RECOGNITION_ENGINE_COST_CATEGORIES,
  B1_REVENUE_RECOGNITION_ENGINE_CLASSIFICATION_LEVELS,
  B1_REVENUE_RECOGNITION_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_REVENUE_RECOGNITION_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_REVENUE_RECOGNITION_ENGINE_DECISION_KINDS,
  B1_REVENUE_RECOGNITION_ENGINE_DECISION_OUTCOMES,
  B1_REVENUE_RECOGNITION_ENGINE_DECLARED_DEPENDENCIES,
  B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_KINDS,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_CODES,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INCOMPATIBLE,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_IN_PROGRESS,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_REVENUE_RECOGNITION_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_REVENUE_RECOGNITION_ENGINE_METRICS,
  B1_REVENUE_RECOGNITION_ENGINE_METRIC_REPLAYED,
  B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
  B1_REVENUE_RECOGNITION_ENGINE_PERIOD_KEY,
  B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_METHODS,
  B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX,
  B1_REVENUE_RECOGNITION_ENGINE_REPLAY_RULE_IDS,
  B1_REVENUE_RECOGNITION_ENGINE_RETENTION_DAYS,
  B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_STATES,
  B1_REVENUE_RECOGNITION_ENGINE_RULE_KINDS,
  B1_REVENUE_RECOGNITION_ENGINE_RULE_OUTCOMES,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_DIRECTION,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORIES,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTIONS,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_STATES,
  B1_REVENUE_RECOGNITION_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-revenue-recognition-engine.constants';
import type {
  B1CostAccountingDecisionReplaySafeResultV1,
  B1CostAccountingDecisionV1,
  B1CostAccountingRequestV1,
  B1RevenueRecognitionAuditEvidenceV1,
  B1RevenueRecognitionDecisionReplaySafeResultV1,
  B1RevenueRecognitionDecisionV1,
  B1RevenueRecognitionDocumentKind,
  B1RevenueRecognitionDocumentPersistenceRecordV1,
  B1RevenueRecognitionDocumentVersioningContractV1,
  B1RevenueRecognitionEngineCompatibilityResultV1,
  B1RevenueRecognitionEngineConsumerPortsV1,
  B1RevenueRecognitionEngineEligibility,
  B1RevenueRecognitionEngineFailureCodeV1,
  B1RevenueRecognitionEngineFailureV1,
  B1RevenueRecognitionExplanationStepV1,
  B1RevenueRecognitionExplanationTraceV1,
  B1RevenueRecognitionRecognitionStepV1,
  B1RevenueRecognitionRecognitionTraceV1,
  B1RevenueRecognitionRequestV1,
  B1RevenueRecognitionRuleKindV1,
  B1RevenueRecognitionRuleOutcomeV1,
  B1RevenueRecognitionRuleTraceStepV1,
  B1RevenueRecognitionRuleTraceV1,
  B1TaxVatDecisionReplaySafeResultV1,
  B1TaxVatDecisionV1,
  B1TaxVatRequestV1,
} from './b1-revenue-recognition-engine.types';
import { B1RevenueRecognitionDecision as B1RevenueRecognitionDecisionEntity } from './b1-revenue-recognition-engine.entity';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1RevenueRecognitionEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1RevenueRecognitionDecisionEntity)
    private readonly repository: Repository<B1RevenueRecognitionDecisionEntity>,
    @Inject(B1CommercialCatalogService)
    private readonly catalogService: B1CommercialCatalogService,
    @Inject(B1FeeEngineService)
    private readonly feeEngineService: B1FeeEngineService,
    @Inject(B1BillingEngineService)
    private readonly billingEngineService: B1BillingEngineService,
    @Inject(B1CampaignEngineService)
    private readonly campaignEngineService: B1CampaignEngineService,
    @Inject(B1ReferralEngineService)
    private readonly referralEngineService: B1ReferralEngineService,
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
    return B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getPeriodKey(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_PERIOD_KEY;
  }

  getRevenueRecognitionIdempotencyScope(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE;
  }

  getTaxVatIdempotencyScope(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE;
  }

  getCostAccountingIdempotencyScope(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_REVENUE_RECOGNITION_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_REVENUE_RECOGNITION_ENGINE_RETENTION_DAYS;
  }

  getRevenueRecognitionStates(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_STATES;
  }

  getTaxVatStates(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_STATES;
  }

  getCostAccountingStates(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_STATES;
  }

  getDecisionKinds(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_DECISION_OUTCOMES;
  }

  getDocumentKinds(): readonly B1RevenueRecognitionDocumentKind[] {
    return B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1RevenueRecognitionRuleKindV1[] {
    return B1_REVENUE_RECOGNITION_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1RevenueRecognitionRuleOutcomeV1[] {
    return B1_REVENUE_RECOGNITION_ENGINE_RULE_OUTCOMES;
  }

  getAccountingBases(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_ACCOUNTING_BASES;
  }

  getRecognitionMethods(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_METHODS;
  }

  getTaxCategories(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORIES;
  }

  getTaxJurisdictions(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTIONS;
  }

  getCostCategories(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_COST_CATEGORIES;
  }

  getCostAllocationMethods(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_COST_ALLOCATION_METHODS;
  }

  getClassificationLevels(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_CLASSIFICATION_LEVELS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_REVENUE_RECOGNITION_ENGINE_METRICS;
  }

  getConsumerPorts(): B1RevenueRecognitionEngineConsumerPortsV1 {
    return {
      generateRevenueRecognitionDecision: (request) =>
        Promise.resolve(this.generateRevenueRecognitionDecision(request)),
      replaySafeGenerateRevenueRecognitionDecision: (request) =>
        this.replaySafeGenerateRevenueRecognitionDecision(request),
      generateTaxVatDecision: (request) => Promise.resolve(this.generateTaxVatDecision(request)),
      replaySafeGenerateTaxVatDecision: (request) => this.replaySafeGenerateTaxVatDecision(request),
      generateCostAccountingDecision: (request) =>
        Promise.resolve(this.generateCostAccountingDecision(request)),
      replaySafeGenerateCostAccountingDecision: (request) =>
        this.replaySafeGenerateCostAccountingDecision(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1RevenueRecognitionDocumentVersioningContractV1 {
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
      scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
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

  async findPersistenceRecords(): Promise<
    readonly B1RevenueRecognitionDocumentPersistenceRecordV1[]
  > {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1RevenueRecognitionDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1RevenueRecognitionDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateRevenueRecognitionDecision(
    request: B1RevenueRecognitionRequestV1,
  ): B1RevenueRecognitionDecisionV1 {
    const shapeFailure = this.validateRevenueRecognitionRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureRevenueRecognitionDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const revenueRecognitionRequestHash = this.computeRevenueRecognitionRequestHash(request);
    const revenueRecognitionDecisionId = randomUUID();
    const revenueRecognitionDecisionReference = this.computeRevenueRecognitionDecisionReference(
      request,
      revenueRecognitionRequestHash,
    );
    const explanationSteps: B1RevenueRecognitionExplanationStepV1[] = [];
    const ruleTraceSteps: B1RevenueRecognitionRuleTraceStepV1[] = [];
    const recognitionSteps: B1RevenueRecognitionRecognitionStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1RevenueRecognitionRuleKindV1,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A3_BINDING_RECHECK' as B1RevenueRecognitionRuleKindV1,
      'A3_BINDING_RECHECK_RULE',
      'A3 binding recheck rule',
      'PASS',
      'A3_BINDING_RECHECK_OK',
      'A3 binding recheck passed',
      { bindingState: 'ACTIVE' },
      { bindingState: 'ACTIVE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A5_FINANCIAL_INVARIANTS' as B1RevenueRecognitionRuleKindV1,
      'A5_FINANCIAL_INVARIANTS_RULE',
      'A5 financial invariants rule',
      'PASS',
      'A5_FINANCIAL_INVARIANTS_OK',
      'A5 financial invariants passed',
      { invariants: 'PASSED' },
      { invariants: 'PASSED' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A6_PARTNER_STATE' as B1RevenueRecognitionRuleKindV1,
      'A6_PARTNER_STATE_RULE',
      'A6 partner state rule',
      'PASS',
      'A6_PARTNER_STATE_OK',
      'A6 partner state passed',
      { partnerState: 'ACTIVE' },
      { partnerState: 'ACTIVE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A7_PRODUCT_CATALOG' as B1RevenueRecognitionRuleKindV1,
      'A7_PRODUCT_CATALOG_RULE',
      'A7 product catalog rule',
      'PASS',
      'A7_PRODUCT_CATALOG_OK',
      'A7 product catalog passed',
      { productKey: request.productKey },
      { productKey: request.productKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_CATALOG_LOOKUP' as B1RevenueRecognitionRuleKindV1,
      'B1_COMMERCIAL_CATALOG_LOOKUP_RULE',
      'B1 commercial catalog lookup rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_LOOKUP_OK',
      'B1 commercial catalog lookup passed',
      { lookupKind: 'CATALOG' },
      { lookupKind: 'CATALOG' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_DECISION_LOOKUP' as B1RevenueRecognitionRuleKindV1,
      'B1_COMMERCIAL_DECISION_LOOKUP_RULE',
      'B1 commercial decision lookup rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_LOOKUP_OK',
      'B1 commercial decision lookup passed',
      { commercialDecisionReference: request.commercialDecisionReference },
      { commercialDecisionReference: request.commercialDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP' as B1RevenueRecognitionRuleKindV1,
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_RULE',
      'B1 billing engine document lookup rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP_OK',
      'B1 billing engine document lookup passed',
      { billingDocumentReference: request.billingDocumentReference },
      { billingDocumentReference: request.billingDocumentReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_POLICY' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_POLICY_RULE',
      'B1 revenue-recognition engine revenue recognition policy rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_POLICY_OK',
      'B1 revenue-recognition engine revenue recognition policy passed',
      { recognitionPolicyReference: request.recognitionPolicyReference },
      { recognitionPolicyReference: request.recognitionPolicyReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS_RULE',
      'B1 revenue-recognition engine recognition basis rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS_OK',
      'B1 revenue-recognition engine recognition basis passed',
      { accountingBasis: request.accountingBasis },
      { accountingBasis: request.accountingBasis },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_SCHEDULE' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_SCHEDULE_RULE',
      'B1 revenue-recognition engine recognition schedule rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_SCHEDULE_OK',
      'B1 revenue-recognition engine recognition schedule passed',
      { recognitionScheduleReference: request.recognitionScheduleReference },
      { recognitionScheduleReference: request.recognitionScheduleReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 revenue-recognition engine number deterministic rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 revenue-recognition engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 revenue-recognition engine document version rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_OK',
      'B1 revenue-recognition engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'REVENUE_RECOGNITION',
      request.recognitionPolicyReference,
      'B1 revenue-recognition policy',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_POLICY_OK',
      request.recognizedRevenueAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'RECOGNITION_SCHEDULE',
      request.recognitionScheduleReference,
      'B1 revenue-recognition schedule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_SCHEDULE_OK',
      request.recognizedRevenueAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'RECOGNITION_EVENT',
      request.recognitionEventReference,
      'B1 revenue-recognition event',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_EVENT_OK',
      request.recognizedRevenueAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'DEFERRED_REVENUE',
      'B1_DEFERRED_REVENUE_DEFAULT',
      'B1 deferred revenue',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_DEFERRED_REVENUE_OK',
      request.deferredRevenueAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'RECOGNIZED_REVENUE',
      'B1_RECOGNIZED_REVENUE_DEFAULT',
      'B1 recognized revenue',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_RECOGNIZED_REVENUE_OK',
      request.recognizedRevenueAmount,
      new Date().toISOString(),
    );

    const eligibilitySummary: B1RevenueRecognitionEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'RECOGNITION_BASIS_ELIGIBLE',
      'TAX_POLICY_ELIGIBLE',
      'COST_ALLOCATION_ELIGIBLE',
    ];
    const revenueRecognitionDecisionOutcome: B1RevenueRecognitionDecisionV1['revenueRecognitionDecisionOutcome'] =
      'APPLIED';
    const explanationTrace: B1RevenueRecognitionExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'REVENUE_RECOGNITION_DECISION',
      traceSummary: `B1 revenue-recognition decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1RevenueRecognitionRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const recognitionTrace: B1RevenueRecognitionRecognitionTraceV1 = {
      recognitionTraceId: randomUUID(),
      recognitionMethod: request.recognitionMethod,
      recognitionSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1RevenueRecognitionAuditEvidenceV1 = {
      auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: revenueRecognitionDecisionId,
      auditAction: 'B1_REVENUE_RECOGNITION_DECISION_DECIDED',
      auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const revenueRecognitionDecisionHashPayload = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      revenueRecognitionDecisionReference,
      revenueRecognitionDecisionVersion: 1,
      revenueRecognitionDecisionState: 'RECOGNIZED' as const,
      revenueRecognitionDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      recognitionMethod: request.recognitionMethod,
      recognitionPolicyReference: request.recognitionPolicyReference,
      recognitionScheduleReference: request.recognitionScheduleReference,
      recognitionEventReference: request.recognitionEventReference,
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
      deferredRevenueAmount: request.deferredRevenueAmount,
      recognizedRevenueAmount: request.recognizedRevenueAmount,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
    };
    const revenueRecognitionDecisionHash = this.computeRevenueRecognitionDecisionHash(
      revenueRecognitionDecisionHashPayload,
    );
    const revenueRecognitionDecisionReplayHash = this.computeRevenueRecognitionDecisionReplayHash({
      revenueRecognitionDecisionHash,
      revenueRecognitionRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      revenueRecognitionDecisionId,
      revenueRecognitionDecisionReference,
      revenueRecognitionDecisionVersion: 1,
      revenueRecognitionDecisionState: 'RECOGNIZED',
      revenueRecognitionDecisionOutcome,
      revenueRecognitionDecisionHash,
      revenueRecognitionDecisionReplayHash,
      revenueRecognitionRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      accountingUnit: 'CUSTOMER_FUNDS',
      recognitionPolicyReference: request.recognitionPolicyReference,
      recognitionPolicyVersion: 1,
      recognitionScheduleReference: request.recognitionScheduleReference,
      recognitionScheduleVersion: 1,
      recognitionMethod: request.recognitionMethod,
      deferredRevenueAmount: request.deferredRevenueAmount,
      recognizedRevenueAmount: request.recognizedRevenueAmount,
      recognitionEventReference: request.recognitionEventReference,
      recognitionEventVersion: 1,
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
      revenueRecognitionStartAt: request.revenueRecognitionStartAt,
      revenueRecognitionEndAt: request.revenueRecognitionEndAt,
      revenueRecognitionEffectiveAt: request.periodEffectiveAt,
      eligibilitySummary,
      revenueRecognitionEligible: true,
      revenueRecognitionApplicable: true,
      revenueRecognitionScheduleConflicts: [],
      revenueRecognitionPolicyConflicts: [],
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: '',
      couponDecisionReference: '',
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: '',
      loyaltyDecisionReference: '',
      explanationTrace,
      ruleTrace,
      recognitionTrace,
      auditEvidence,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
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

  generateTaxVatDecision(request: B1TaxVatRequestV1): B1TaxVatDecisionV1 {
    const shapeFailure = this.validateTaxVatRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureTaxVatDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const taxVatRequestHash = this.computeTaxVatRequestHash(request);
    const taxVatDecisionId = randomUUID();
    const taxVatDecisionReference = this.computeTaxVatDecisionReference(request, taxVatRequestHash);
    const explanationSteps: B1RevenueRecognitionExplanationStepV1[] = [];
    const ruleTraceSteps: B1RevenueRecognitionRuleTraceStepV1[] = [];
    const recognitionSteps: B1RevenueRecognitionRecognitionStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_POLICY' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_POLICY_RULE',
      'B1 revenue-recognition engine tax / VAT policy rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_POLICY_OK',
      'B1 revenue-recognition engine tax / VAT policy passed',
      { taxVatPolicyReference: request.taxVatPolicyReference },
      { taxVatPolicyReference: request.taxVatPolicyReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION_RULE',
      'B1 revenue-recognition engine tax jurisdiction rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION_OK',
      'B1 revenue-recognition engine tax jurisdiction passed',
      { taxJurisdiction: request.taxJurisdiction },
      { taxJurisdiction: request.taxJurisdiction },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORY' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORY_RULE',
      'B1 revenue-recognition engine tax category rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORY_OK',
      'B1 revenue-recognition engine tax category passed',
      { taxCategory: request.taxCategory },
      { taxCategory: request.taxCategory },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_EXEMPTION' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_EXEMPTION_RULE',
      'B1 revenue-recognition engine tax exemption rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_EXEMPTION_OK',
      'B1 revenue-recognition engine tax exemption passed',
      { taxExemptionStatus: request.taxExemptionStatus },
      { taxExemptionStatus: request.taxExemptionStatus },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 revenue-recognition engine number deterministic rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 revenue-recognition engine number is deterministic',
      { deterministic: true, taxVatDecisionReference },
      { deterministic: true, taxVatDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 revenue-recognition engine document version rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_OK',
      'B1 revenue-recognition engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'TAX_VAT',
      request.taxVatPolicyReference,
      'B1 tax / VAT policy',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_POLICY_OK',
      request.taxBaseAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'TAX_EVIDENCE',
      request.taxEvidenceReference,
      'B1 tax evidence',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_TAX_EVIDENCE_OK',
      request.taxBaseAmount,
      new Date().toISOString(),
    );

    const eligibilitySummary: B1RevenueRecognitionEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'RECOGNITION_BASIS_ELIGIBLE',
      'TAX_POLICY_ELIGIBLE',
    ];
    const taxVatDecisionOutcome: B1TaxVatDecisionV1['taxVatDecisionOutcome'] = 'APPLIED';
    const taxAmount = (
      (BigInt(request.taxBaseAmount) / BigInt(100)) *
      BigInt(request.taxRate)
    ).toString();
    const explanationTrace: B1RevenueRecognitionExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'TAX_VAT_DECISION',
      traceSummary: `B1 tax / VAT decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1RevenueRecognitionRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const recognitionTrace: B1RevenueRecognitionRecognitionTraceV1 = {
      recognitionTraceId: randomUUID(),
      recognitionMethod: 'POINT_IN_TIME',
      recognitionSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1RevenueRecognitionAuditEvidenceV1 = {
      auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: taxVatDecisionId,
      auditAction: 'B1_TAX_VAT_DECISION_DECIDED',
      auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const taxVatDecisionHashPayload = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      taxVatDecisionReference,
      taxVatDecisionVersion: 1,
      taxVatDecisionState: 'ASSESSED' as const,
      taxVatDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      taxJurisdiction: request.taxJurisdiction,
      taxCategory: request.taxCategory,
      taxExemptionStatus: request.taxExemptionStatus,
      taxExemptionReference: request.taxExemptionReference,
      taxBaseAmount: request.taxBaseAmount,
      taxRate: request.taxRate,
      taxAmount,
      taxVatPolicyReference: request.taxVatPolicyReference,
      taxEvidenceReference: request.taxEvidenceReference,
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
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
    };
    const taxVatDecisionHash =
      this.computeRevenueRecognitionDecisionHash(taxVatDecisionHashPayload);
    const taxVatDecisionReplayHash = this.computeTaxVatDecisionReplayHash({
      taxVatDecisionHash,
      taxVatRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      taxVatDecisionId,
      taxVatDecisionReference,
      taxVatDecisionVersion: 1,
      taxVatDecisionState: 'ASSESSED',
      taxVatDecisionOutcome,
      taxVatDecisionHash,
      taxVatDecisionReplayHash,
      taxVatRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      accountingUnit: 'CUSTOMER_FUNDS',
      taxJurisdiction: request.taxJurisdiction,
      taxCategory: request.taxCategory,
      taxExemptionStatus: request.taxExemptionStatus,
      taxExemptionReference: request.taxExemptionReference,
      taxExemptionVersion: 1,
      taxBaseAmount: request.taxBaseAmount,
      taxRate: request.taxRate,
      taxAmount,
      taxVatPolicyReference: request.taxVatPolicyReference,
      taxVatPolicyVersion: 1,
      taxEvidenceReference: request.taxEvidenceReference,
      taxEvidenceVersion: 1,
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
      taxVatStartAt: request.taxVatStartAt,
      taxVatEndAt: request.taxVatEndAt,
      taxVatEffectiveAt: request.periodEffectiveAt,
      eligibilitySummary,
      taxVatEligible: true,
      taxVatApplicable: true,
      taxJurisdictionConflicts: [],
      taxExemptionConflicts: [],
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: '',
      couponDecisionReference: '',
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: '',
      loyaltyDecisionReference: '',
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      explanationTrace,
      ruleTrace,
      recognitionTrace,
      auditEvidence,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
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

  generateCostAccountingDecision(request: B1CostAccountingRequestV1): B1CostAccountingDecisionV1 {
    const shapeFailure = this.validateCostAccountingRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCostAccountingDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const costAccountingRequestHash = this.computeCostAccountingRequestHash(request);
    const costAccountingDecisionId = randomUUID();
    const costAccountingDecisionReference = this.computeCostAccountingDecisionReference(
      request,
      costAccountingRequestHash,
    );
    const explanationSteps: B1RevenueRecognitionExplanationStepV1[] = [];
    const ruleTraceSteps: B1RevenueRecognitionRuleTraceStepV1[] = [];
    const recognitionSteps: B1RevenueRecognitionRecognitionStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_POLICY' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_POLICY_RULE',
      'B1 revenue-recognition engine cost-accounting policy rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_POLICY_OK',
      'B1 revenue-recognition engine cost-accounting policy passed',
      { costAccountingPolicyReference: request.costAccountingPolicyReference },
      { costAccountingPolicyReference: request.costAccountingPolicyReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_DIRECT_COST' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_DIRECT_COST_RULE',
      'B1 revenue-recognition engine direct cost rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_DIRECT_COST_OK',
      'B1 revenue-recognition engine direct cost passed',
      { directCostAmount: request.directCostAmount },
      { directCostAmount: request.directCostAmount },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_INDIRECT_COST' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_INDIRECT_COST_RULE',
      'B1 revenue-recognition engine indirect cost rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_INDIRECT_COST_OK',
      'B1 revenue-recognition engine indirect cost passed',
      { indirectCostAmount: request.indirectCostAmount },
      { indirectCostAmount: request.indirectCostAmount },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_ACQUISITION_COST' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_ACQUISITION_COST_RULE',
      'B1 revenue-recognition engine acquisition cost rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_ACQUISITION_COST_OK',
      'B1 revenue-recognition engine acquisition cost passed',
      { acquisitionCostAmount: request.acquisitionCostAmount },
      { acquisitionCostAmount: request.acquisitionCostAmount },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_OPERATIONAL_COST' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_OPERATIONAL_COST_RULE',
      'B1 revenue-recognition engine operational cost rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_OPERATIONAL_COST_OK',
      'B1 revenue-recognition engine operational cost passed',
      { operationalCostAmount: request.operationalCostAmount },
      { operationalCostAmount: request.operationalCostAmount },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_ALLOCATED_COST' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_ALLOCATED_COST_RULE',
      'B1 revenue-recognition engine allocated cost rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_ALLOCATED_COST_OK',
      'B1 revenue-recognition engine allocated cost passed',
      {
        allocatedCostAmount: request.allocatedCostAmount,
        costAllocationMethod: request.costAllocationMethod,
      },
      {
        allocatedCostAmount: request.allocatedCostAmount,
        costAllocationMethod: request.costAllocationMethod,
      },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 revenue-recognition engine number deterministic rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 revenue-recognition engine number is deterministic',
      { deterministic: true, costAccountingDecisionReference },
      { deterministic: true, costAccountingDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION' as B1RevenueRecognitionRuleKindV1,
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 revenue-recognition engine document version rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION_OK',
      'B1 revenue-recognition engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'COST_ACCOUNTING',
      request.costAccountingPolicyReference,
      'B1 cost-accounting policy',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_POLICY_OK',
      request.directCostAmount,
      new Date().toISOString(),
    );
    this.appendRecognitionStep(
      recognitionSteps,
      'COST_ALLOCATION',
      request.costAccountingPolicyReference,
      'B1 cost allocation',
      'PASS',
      'B1_REVENUE_RECOGNITION_ENGINE_ALLOCATED_COST_OK',
      request.allocatedCostAmount,
      new Date().toISOString(),
    );

    const eligibilitySummary: B1RevenueRecognitionEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'RECOGNITION_BASIS_ELIGIBLE',
      'COST_ALLOCATION_ELIGIBLE',
    ];
    const costAccountingDecisionOutcome: B1CostAccountingDecisionV1['costAccountingDecisionOutcome'] =
      'APPLIED';
    const totalCostAmount = (
      BigInt(request.directCostAmount) +
      BigInt(request.indirectCostAmount) +
      BigInt(request.acquisitionCostAmount) +
      BigInt(request.operationalCostAmount) +
      BigInt(request.allocatedCostAmount)
    ).toString();
    const explanationTrace: B1RevenueRecognitionExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COST_ACCOUNTING_DECISION',
      traceSummary: `B1 cost-accounting decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1RevenueRecognitionRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const recognitionTrace: B1RevenueRecognitionRecognitionTraceV1 = {
      recognitionTraceId: randomUUID(),
      recognitionMethod: 'OVER_TIME',
      recognitionSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1RevenueRecognitionAuditEvidenceV1 = {
      auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: costAccountingDecisionId,
      auditAction: 'B1_COST_ACCOUNTING_DECISION_DECIDED',
      auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const costAccountingDecisionHashPayload = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      costAccountingDecisionReference,
      costAccountingDecisionVersion: 1,
      costAccountingDecisionState: 'ALLOCATED' as const,
      costAccountingDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      costCategory: request.costCategory,
      costAllocationMethod: request.costAllocationMethod,
      directCostAmount: request.directCostAmount,
      indirectCostAmount: request.indirectCostAmount,
      acquisitionCostAmount: request.acquisitionCostAmount,
      operationalCostAmount: request.operationalCostAmount,
      allocatedCostAmount: request.allocatedCostAmount,
      totalCostAmount,
      costAccountingPolicyReference: request.costAccountingPolicyReference,
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
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
    };
    const costAccountingDecisionHash = this.computeRevenueRecognitionDecisionHash(
      costAccountingDecisionHashPayload,
    );
    const costAccountingDecisionReplayHash = this.computeCostAccountingDecisionReplayHash({
      costAccountingDecisionHash,
      costAccountingRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      costAccountingDecisionId,
      costAccountingDecisionReference,
      costAccountingDecisionVersion: 1,
      costAccountingDecisionState: 'ALLOCATED',
      costAccountingDecisionOutcome,
      costAccountingDecisionHash,
      costAccountingDecisionReplayHash,
      costAccountingRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      accountingBasis: request.accountingBasis,
      accountingUnit: 'CUSTOMER_FUNDS',
      costCategory: request.costCategory,
      costAllocationMethod: request.costAllocationMethod,
      directCostAmount: request.directCostAmount,
      indirectCostAmount: request.indirectCostAmount,
      acquisitionCostAmount: request.acquisitionCostAmount,
      operationalCostAmount: request.operationalCostAmount,
      allocatedCostAmount: request.allocatedCostAmount,
      totalCostAmount,
      costAccountingPolicyReference: request.costAccountingPolicyReference,
      costAccountingPolicyVersion: 1,
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
      costAccountingStartAt: request.costAccountingStartAt,
      costAccountingEndAt: request.costAccountingEndAt,
      costAccountingEffectiveAt: request.periodEffectiveAt,
      eligibilitySummary,
      costAccountingEligible: true,
      costAccountingApplicable: true,
      costAllocationConflicts: [],
      costCategoryConflicts: [],
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: '',
      couponDecisionReference: '',
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: '',
      loyaltyDecisionReference: '',
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
      explanationTrace,
      ruleTrace,
      recognitionTrace,
      auditEvidence,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
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

  async replaySafeGenerateRevenueRecognitionDecision(
    request: B1RevenueRecognitionRequestV1,
  ): Promise<B1RevenueRecognitionDecisionReplaySafeResultV1> {
    return this.replaySafeRevenueRecognition(request);
  }

  async replaySafeGenerateTaxVatDecision(
    request: B1TaxVatRequestV1,
  ): Promise<B1TaxVatDecisionReplaySafeResultV1> {
    return this.replaySafeTaxVat(request);
  }

  async replaySafeGenerateCostAccountingDecision(
    request: B1CostAccountingRequestV1,
  ): Promise<B1CostAccountingDecisionReplaySafeResultV1> {
    return this.replaySafeCostAccounting(request);
  }

  compatibilityCheck(
    request: B1RevenueRecognitionRequestV1 | B1TaxVatRequestV1 | B1CostAccountingRequestV1,
  ): B1RevenueRecognitionEngineCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 revenue-recognition engine request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (request.productVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (
      B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)
    ) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INCOMPATIBLE,
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

  // Cashback / loyalty / referral idempotency scopes are owned by
  // B1T07 (referral engine, cashback engine, loyalty engine). The
  // B1 revenue-recognition engine is read-only against those
  // decision references and does NOT introduce cashback / loyalty
  // / referral idempotency scopes of its own.

  private async replaySafeRevenueRecognition(
    request: B1RevenueRecognitionRequestV1,
  ): Promise<B1RevenueRecognitionDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateRevenueRecognitionRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureRevenueRecognitionDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayRevenueRecognitionFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeRevenueRecognitionRequestHash(request),
        retentionSeconds: B1_REVENUE_RECOGNITION_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateRevenueRecognitionDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REVENUE_RECOGNITION_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          revenueRecognitionRequestHash: originalRecord.revenueRecognitionRequestHash,
          revenueRecognitionDecisionHash: originalRecord.revenueRecognitionDecisionHash,
          revenueRecognitionDecisionReplayHash: originalRecord.revenueRecognitionDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureRevenueRecognitionDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_IN_PROGRESS,
          'B1 revenue-recognition engine replay-safe generate revenue-recognition decision is in progress for the same idempotency key',
        );
        return this.buildReplayRevenueRecognitionFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateRevenueRecognitionDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        revenueRecognitionRequestHash: record.revenueRecognitionRequestHash,
        revenueRecognitionDecisionHash: record.revenueRecognitionDecisionHash,
        revenueRecognitionDecisionReplayHash: record.revenueRecognitionDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureRevenueRecognitionDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 revenue-recognition engine replay-safe generate revenue-recognition decision conflict: ${message}`,
        );
        return this.buildReplayRevenueRecognitionFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureRevenueRecognitionDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 revenue-recognition engine replay-safe generate revenue-recognition decision query unavailable: ${message}`,
      );
      return this.buildReplayRevenueRecognitionFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeTaxVat(
    request: B1TaxVatRequestV1,
  ): Promise<B1TaxVatDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateTaxVatRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureTaxVatDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayTaxVatFailure(request, failureRecord, false, 'invalid_command', null);
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeTaxVatRequestHash(request),
        retentionSeconds: B1_REVENUE_RECOGNITION_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateTaxVatDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REVENUE_RECOGNITION_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          taxVatRequestHash: originalRecord.taxVatRequestHash,
          taxVatDecisionHash: originalRecord.taxVatDecisionHash,
          taxVatDecisionReplayHash: originalRecord.taxVatDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureTaxVatDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_IN_PROGRESS,
          'B1 revenue-recognition engine replay-safe generate tax / VAT decision is in progress for the same idempotency key',
        );
        return this.buildReplayTaxVatFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateTaxVatDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        taxVatRequestHash: record.taxVatRequestHash,
        taxVatDecisionHash: record.taxVatDecisionHash,
        taxVatDecisionReplayHash: record.taxVatDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureTaxVatDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 revenue-recognition engine replay-safe generate tax / VAT decision conflict: ${message}`,
        );
        return this.buildReplayTaxVatFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureTaxVatDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 revenue-recognition engine replay-safe generate tax / VAT decision query unavailable: ${message}`,
      );
      return this.buildReplayTaxVatFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCostAccounting(
    request: B1CostAccountingRequestV1,
  ): Promise<B1CostAccountingDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCostAccountingRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCostAccountingDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCostAccountingFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCostAccountingRequestHash(request),
        retentionSeconds: B1_REVENUE_RECOGNITION_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCostAccountingDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_REVENUE_RECOGNITION_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          costAccountingRequestHash: originalRecord.costAccountingRequestHash,
          costAccountingDecisionHash: originalRecord.costAccountingDecisionHash,
          costAccountingDecisionReplayHash: originalRecord.costAccountingDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCostAccountingDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_IN_PROGRESS,
          'B1 revenue-recognition engine replay-safe generate cost-accounting decision is in progress for the same idempotency key',
        );
        return this.buildReplayCostAccountingFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCostAccountingDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        costAccountingRequestHash: record.costAccountingRequestHash,
        costAccountingDecisionHash: record.costAccountingDecisionHash,
        costAccountingDecisionReplayHash: record.costAccountingDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCostAccountingDecision(
          request,
          B1_REVENUE_RECOGNITION_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 revenue-recognition engine replay-safe generate cost-accounting decision conflict: ${message}`,
        );
        return this.buildReplayCostAccountingFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCostAccountingDecision(
        request,
        B1_REVENUE_RECOGNITION_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 revenue-recognition engine replay-safe generate cost-accounting decision query unavailable: ${message}`,
      );
      return this.buildReplayCostAccountingFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendRule(
    explanationSteps: B1RevenueRecognitionExplanationStepV1[],
    ruleTraceSteps: B1RevenueRecognitionRuleTraceStepV1[],
    ruleKind: B1RevenueRecognitionRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1RevenueRecognitionRuleOutcomeV1,
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

  private appendRecognitionStep(
    recognitionSteps: B1RevenueRecognitionRecognitionStepV1[],
    stepKind: B1RevenueRecognitionRecognitionStepV1['stepKind'],
    stepReference: string,
    stepLabel: string,
    stepOutcome: B1RevenueRecognitionRuleOutcomeV1,
    stepReasonCode: string,
    stepAmount: string,
    stepEvaluatedAt: string,
  ): void {
    const stepIndex = recognitionSteps.length + 1;
    recognitionSteps.push({
      stepIndex,
      stepKind,
      stepReference,
      stepLabel,
      stepOutcome,
      stepReasonCode,
      stepAmount,
      stepCurrency: 'NGN',
      stepEvaluatedAt,
    });
  }

  private computeRevenueRecognitionRequestHash(request: B1RevenueRecognitionRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      revenueRecognitionRequestId: request.revenueRecognitionRequestId,
      revenueRecognitionRequestVersion: request.revenueRecognitionRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      accountingBasis: request.accountingBasis,
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
      recognitionPolicyReference: request.recognitionPolicyReference,
      recognitionPolicyVersion: request.recognitionPolicyVersion,
      recognitionScheduleReference: request.recognitionScheduleReference,
      recognitionScheduleVersion: request.recognitionScheduleVersion,
      recognitionMethod: request.recognitionMethod,
      recognitionEventReference: request.recognitionEventReference,
      recognitionEventVersion: request.recognitionEventVersion,
      deferredRevenueAmount: request.deferredRevenueAmount,
      recognizedRevenueAmount: request.recognizedRevenueAmount,
      revenueRecognitionStartAt: request.revenueRecognitionStartAt,
      revenueRecognitionEndAt: request.revenueRecognitionEndAt,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeTaxVatRequestHash(request: B1TaxVatRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      taxVatRequestId: request.taxVatRequestId,
      taxVatRequestVersion: request.taxVatRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      accountingBasis: request.accountingBasis,
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
      taxJurisdiction: request.taxJurisdiction,
      taxCategory: request.taxCategory,
      taxExemptionStatus: request.taxExemptionStatus,
      taxExemptionReference: request.taxExemptionReference,
      taxExemptionVersion: request.taxExemptionVersion,
      taxBaseAmount: request.taxBaseAmount,
      taxRate: request.taxRate,
      taxVatPolicyReference: request.taxVatPolicyReference,
      taxVatPolicyVersion: request.taxVatPolicyVersion,
      taxEvidenceReference: request.taxEvidenceReference,
      taxEvidenceVersion: request.taxEvidenceVersion,
      taxVatStartAt: request.taxVatStartAt,
      taxVatEndAt: request.taxVatEndAt,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCostAccountingRequestHash(request: B1CostAccountingRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      costAccountingRequestId: request.costAccountingRequestId,
      costAccountingRequestVersion: request.costAccountingRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      accountingBasis: request.accountingBasis,
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
      costCategory: request.costCategory,
      costAllocationMethod: request.costAllocationMethod,
      directCostAmount: request.directCostAmount,
      indirectCostAmount: request.indirectCostAmount,
      acquisitionCostAmount: request.acquisitionCostAmount,
      operationalCostAmount: request.operationalCostAmount,
      allocatedCostAmount: request.allocatedCostAmount,
      costAccountingPolicyReference: request.costAccountingPolicyReference,
      costAccountingPolicyVersion: request.costAccountingPolicyVersion,
      costAccountingStartAt: request.costAccountingStartAt,
      costAccountingEndAt: request.costAccountingEndAt,
      commercialDecisionReference: request.commercialDecisionReference,
      commercialDecisionIdempotencyKey: request.commercialDecisionIdempotencyKey,
      billingDocumentReference: request.billingDocumentReference,
      campaignDecisionReference: request.campaignDecisionReference,
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeRevenueRecognitionDecisionReference(
    request: B1RevenueRecognitionRequestV1,
    requestHash: string,
  ): string {
    return `${B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX}:revenue-recognition:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeTaxVatDecisionReference(request: B1TaxVatRequestV1, requestHash: string): string {
    return `${B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX}:tax-vat:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCostAccountingDecisionReference(
    request: B1CostAccountingRequestV1,
    requestHash: string,
  ): string {
    return `${B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX}:cost-accounting:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeRevenueRecognitionDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeRevenueRecognitionDecisionReplayHash(input: {
    readonly revenueRecognitionDecisionHash: string;
    readonly revenueRecognitionRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      revenueRecognitionDecisionHash: input.revenueRecognitionDecisionHash,
      revenueRecognitionRequestHash: input.revenueRecognitionRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeTaxVatDecisionReplayHash(input: {
    readonly taxVatDecisionHash: string;
    readonly taxVatRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      taxVatDecisionHash: input.taxVatDecisionHash,
      taxVatRequestHash: input.taxVatRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCostAccountingDecisionReplayHash(input: {
    readonly costAccountingDecisionHash: string;
    readonly costAccountingRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      costAccountingDecisionHash: input.costAccountingDecisionHash,
      costAccountingRequestHash: input.costAccountingRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateRevenueRecognitionRequestShape(
    request: B1RevenueRecognitionRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 revenue-recognition engine revenue-recognition request is missing';
    }
    if (request.contractName !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME) {
      return 'The B1 revenue-recognition engine revenue-recognition request contract name is invalid';
    }
    if (request.contractVersion !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION) {
      return 'The B1 revenue-recognition engine revenue-recognition request contract version is invalid';
    }
    if (
      !request.revenueRecognitionRequestId ||
      !SAFE_TEXT_PATTERN.test(request.revenueRecognitionRequestId)
    ) {
      return 'The B1 revenue-recognition engine revenue-recognition request revenue recognition request id is invalid';
    }
    if (request.revenueRecognitionRequestVersion !== 1) {
      return 'The B1 revenue-recognition engine revenue-recognition request revenue recognition request version is invalid';
    }
    if (request.scopeKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY) {
      return 'The B1 revenue-recognition engine revenue-recognition request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION) {
      return 'The B1 revenue-recognition engine revenue-recognition request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 revenue-recognition engine revenue-recognition request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 revenue-recognition engine revenue-recognition request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 revenue-recognition engine revenue-recognition request product key is invalid';
    }
    if (request.productVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 revenue-recognition engine revenue-recognition request product version is invalid';
    }
    if (!request.customerId || !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 revenue-recognition engine revenue-recognition request customer id is invalid';
    }
    if (!request.merchantId || !SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 revenue-recognition engine revenue-recognition request merchant id is invalid';
    }
    if (!request.partnerId || !SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 revenue-recognition engine revenue-recognition request partner id is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 revenue-recognition engine revenue-recognition request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 revenue-recognition engine revenue-recognition request capability version is invalid';
    }
    if (!request.planKey || !SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 revenue-recognition engine revenue-recognition request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 revenue-recognition engine revenue-recognition request plan version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 revenue-recognition engine revenue-recognition request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 revenue-recognition engine revenue-recognition request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 revenue-recognition engine revenue-recognition request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 revenue-recognition engine revenue-recognition request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 revenue-recognition engine revenue-recognition request billing document reference is invalid';
    }
    return null;
  }

  private validateTaxVatRequestShape(request: B1TaxVatRequestV1): string | null {
    if (!request) {
      return 'The B1 revenue-recognition engine tax / VAT request is missing';
    }
    if (request.contractName !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME) {
      return 'The B1 revenue-recognition engine tax / VAT request contract name is invalid';
    }
    if (request.contractVersion !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION) {
      return 'The B1 revenue-recognition engine tax / VAT request contract version is invalid';
    }
    if (!request.taxVatRequestId || !SAFE_TEXT_PATTERN.test(request.taxVatRequestId)) {
      return 'The B1 revenue-recognition engine tax / VAT request tax / VAT request id is invalid';
    }
    if (request.taxVatRequestVersion !== 1) {
      return 'The B1 revenue-recognition engine tax / VAT request tax / VAT request version is invalid';
    }
    if (request.scopeKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY) {
      return 'The B1 revenue-recognition engine tax / VAT request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION) {
      return 'The B1 revenue-recognition engine tax / VAT request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 revenue-recognition engine tax / VAT request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 revenue-recognition engine tax / VAT request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 revenue-recognition engine tax / VAT request product key is invalid';
    }
    if (request.productVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 revenue-recognition engine tax / VAT request product version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 revenue-recognition engine tax / VAT request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 revenue-recognition engine tax / VAT request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 revenue-recognition engine tax / VAT request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 revenue-recognition engine tax / VAT request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 revenue-recognition engine tax / VAT request billing document reference is invalid';
    }
    if (!request.taxVatPolicyReference || !SAFE_TEXT_PATTERN.test(request.taxVatPolicyReference)) {
      return 'The B1 revenue-recognition engine tax / VAT request tax / VAT policy reference is invalid';
    }
    return null;
  }

  private validateCostAccountingRequestShape(request: B1CostAccountingRequestV1): string | null {
    if (!request) {
      return 'The B1 revenue-recognition engine cost-accounting request is missing';
    }
    if (request.contractName !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME) {
      return 'The B1 revenue-recognition engine cost-accounting request contract name is invalid';
    }
    if (request.contractVersion !== B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION) {
      return 'The B1 revenue-recognition engine cost-accounting request contract version is invalid';
    }
    if (
      !request.costAccountingRequestId ||
      !SAFE_TEXT_PATTERN.test(request.costAccountingRequestId)
    ) {
      return 'The B1 revenue-recognition engine cost-accounting request cost-accounting request id is invalid';
    }
    if (request.costAccountingRequestVersion !== 1) {
      return 'The B1 revenue-recognition engine cost-accounting request cost-accounting request version is invalid';
    }
    if (request.scopeKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY) {
      return 'The B1 revenue-recognition engine cost-accounting request scope key is invalid';
    }
    if (request.scopeVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION) {
      return 'The B1 revenue-recognition engine cost-accounting request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 revenue-recognition engine cost-accounting request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 revenue-recognition engine cost-accounting request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 revenue-recognition engine cost-accounting request product key is invalid';
    }
    if (request.productVersion !== B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 revenue-recognition engine cost-accounting request product version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 revenue-recognition engine cost-accounting request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 revenue-recognition engine cost-accounting request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 revenue-recognition engine cost-accounting request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 revenue-recognition engine cost-accounting request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 revenue-recognition engine cost-accounting request billing document reference is invalid';
    }
    if (
      !request.costAccountingPolicyReference ||
      !SAFE_TEXT_PATTERN.test(request.costAccountingPolicyReference)
    ) {
      return 'The B1 revenue-recognition engine cost-accounting request cost-accounting policy reference is invalid';
    }
    return null;
  }

  private buildFailureRevenueRecognitionDecision(
    request: B1RevenueRecognitionRequestV1,
    code: B1RevenueRecognitionEngineFailureCodeV1,
    message: string,
  ): B1RevenueRecognitionDecisionV1 {
    const failure: B1RevenueRecognitionEngineFailureV1 = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      revenueRecognitionDecisionId: 'failed',
      revenueRecognitionDecisionReference: 'B1-REVENUE-RECOGNITION-DECISION-FAILED',
      revenueRecognitionDecisionVersion: 1,
      revenueRecognitionDecisionState: 'DRAFT',
      revenueRecognitionDecisionOutcome: 'REJECTED',
      revenueRecognitionDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      revenueRecognitionDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      revenueRecognitionRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REVENUE_RECOGNITION_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      accountingBasis: request?.accountingBasis ?? 'ACCRUAL_BASIS',
      accountingUnit: 'CUSTOMER_FUNDS',
      recognitionPolicyReference: request?.recognitionPolicyReference ?? 'unknown',
      recognitionPolicyVersion: 1,
      recognitionScheduleReference: request?.recognitionScheduleReference ?? 'unknown',
      recognitionScheduleVersion: 1,
      recognitionMethod: request?.recognitionMethod ?? 'POINT_IN_TIME',
      deferredRevenueAmount: request?.deferredRevenueAmount ?? '0',
      recognizedRevenueAmount: request?.recognizedRevenueAmount ?? '0',
      recognitionEventReference: request?.recognitionEventReference ?? 'unknown',
      recognitionEventVersion: 1,
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.revenue-recognition',
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
      revenueRecognitionStartAt: request?.revenueRecognitionStartAt ?? new Date().toISOString(),
      revenueRecognitionEndAt: request?.revenueRecognitionEndAt ?? new Date().toISOString(),
      revenueRecognitionEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      eligibilitySummary: [],
      revenueRecognitionEligible: false,
      revenueRecognitionApplicable: false,
      revenueRecognitionScheduleConflicts: [],
      revenueRecognitionPolicyConflicts: [],
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      referralDecisionReference: request?.referralDecisionReference ?? '',
      cashbackDecisionReference: request?.cashbackDecisionReference ?? '',
      loyaltyDecisionReference: request?.loyaltyDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'REVENUE_RECOGNITION_DECISION',
        traceSummary: `B1 revenue-recognition engine failure: ${message}`,
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
      recognitionTrace: {
        recognitionTraceId: randomUUID(),
        recognitionMethod: request?.recognitionMethod ?? 'POINT_IN_TIME',
        recognitionSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_REVENUE_RECOGNITION_DECISION_FAILED',
        auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
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

  private buildFailureTaxVatDecision(
    request: B1TaxVatRequestV1,
    code: B1RevenueRecognitionEngineFailureCodeV1,
    message: string,
  ): B1TaxVatDecisionV1 {
    const failure: B1RevenueRecognitionEngineFailureV1 = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      taxVatDecisionId: 'failed',
      taxVatDecisionReference: 'B1-TAX-VAT-DECISION-FAILED',
      taxVatDecisionVersion: 1,
      taxVatDecisionState: 'DRAFT',
      taxVatDecisionOutcome: 'REJECTED',
      taxVatDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      taxVatDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      taxVatRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REVENUE_RECOGNITION_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      accountingBasis: request?.accountingBasis ?? 'ACCRUAL_BASIS',
      accountingUnit: 'CUSTOMER_FUNDS',
      taxJurisdiction: request?.taxJurisdiction ?? 'NIGERIA_FEDERAL',
      taxCategory: request?.taxCategory ?? 'VAT',
      taxExemptionStatus: request?.taxExemptionStatus ?? 'NOT_EXEMPT',
      taxExemptionReference: request?.taxExemptionReference ?? 'unknown',
      taxExemptionVersion: 1,
      taxBaseAmount: request?.taxBaseAmount ?? '0',
      taxRate: request?.taxRate ?? '0',
      taxAmount: '0',
      taxVatPolicyReference: request?.taxVatPolicyReference ?? 'unknown',
      taxVatPolicyVersion: 1,
      taxEvidenceReference: request?.taxEvidenceReference ?? 'unknown',
      taxEvidenceVersion: 1,
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.tax-vat',
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
      taxVatStartAt: request?.taxVatStartAt ?? new Date().toISOString(),
      taxVatEndAt: request?.taxVatEndAt ?? new Date().toISOString(),
      taxVatEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      eligibilitySummary: [],
      taxVatEligible: false,
      taxVatApplicable: false,
      taxJurisdictionConflicts: [],
      taxExemptionConflicts: [],
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      referralDecisionReference: request?.referralDecisionReference ?? '',
      cashbackDecisionReference: request?.cashbackDecisionReference ?? '',
      loyaltyDecisionReference: request?.loyaltyDecisionReference ?? '',
      revenueRecognitionDecisionReference: request?.revenueRecognitionDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'TAX_VAT_DECISION',
        traceSummary: `B1 revenue-recognition engine failure: ${message}`,
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
      recognitionTrace: {
        recognitionTraceId: randomUUID(),
        recognitionMethod: 'POINT_IN_TIME',
        recognitionSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_TAX_VAT_DECISION_FAILED',
        auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
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

  private buildFailureCostAccountingDecision(
    request: B1CostAccountingRequestV1,
    code: B1RevenueRecognitionEngineFailureCodeV1,
    message: string,
  ): B1CostAccountingDecisionV1 {
    const failure: B1RevenueRecognitionEngineFailureV1 = {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
      contractVersion: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
      costAccountingDecisionId: 'failed',
      costAccountingDecisionReference: 'B1-COST-ACCOUNTING-DECISION-FAILED',
      costAccountingDecisionVersion: 1,
      costAccountingDecisionState: 'DRAFT',
      costAccountingDecisionOutcome: 'REJECTED',
      costAccountingDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      costAccountingDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      costAccountingRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_REVENUE_RECOGNITION_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      accountingBasis: request?.accountingBasis ?? 'ACCRUAL_BASIS',
      accountingUnit: 'CUSTOMER_FUNDS',
      costCategory: request?.costCategory ?? 'DIRECT_COST',
      costAllocationMethod: request?.costAllocationMethod ?? 'DIRECT_ALLOCATION',
      directCostAmount: request?.directCostAmount ?? '0',
      indirectCostAmount: request?.indirectCostAmount ?? '0',
      acquisitionCostAmount: request?.acquisitionCostAmount ?? '0',
      operationalCostAmount: request?.operationalCostAmount ?? '0',
      allocatedCostAmount: request?.allocatedCostAmount ?? '0',
      totalCostAmount: '0',
      costAccountingPolicyReference: request?.costAccountingPolicyReference ?? 'unknown',
      costAccountingPolicyVersion: 1,
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.cost-accounting',
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
      costAccountingStartAt: request?.costAccountingStartAt ?? new Date().toISOString(),
      costAccountingEndAt: request?.costAccountingEndAt ?? new Date().toISOString(),
      costAccountingEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      eligibilitySummary: [],
      costAccountingEligible: false,
      costAccountingApplicable: false,
      costAllocationConflicts: [],
      costCategoryConflicts: [],
      commercialDecisionReference: request?.commercialDecisionReference ?? '',
      commercialDecisionIdempotencyKey: request?.commercialDecisionIdempotencyKey ?? '',
      billingDocumentReference: request?.billingDocumentReference ?? '',
      campaignDecisionReference: request?.campaignDecisionReference ?? '',
      promotionDecisionReference: request?.promotionDecisionReference ?? '',
      couponDecisionReference: request?.couponDecisionReference ?? '',
      referralDecisionReference: request?.referralDecisionReference ?? '',
      cashbackDecisionReference: request?.cashbackDecisionReference ?? '',
      loyaltyDecisionReference: request?.loyaltyDecisionReference ?? '',
      revenueRecognitionDecisionReference: request?.revenueRecognitionDecisionReference ?? '',
      taxVatDecisionReference: request?.taxVatDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COST_ACCOUNTING_DECISION',
        traceSummary: `B1 revenue-recognition engine failure: ${message}`,
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
      recognitionTrace: {
        recognitionTraceId: randomUUID(),
        recognitionMethod: 'OVER_TIME',
        recognitionSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COST_ACCOUNTING_DECISION_FAILED',
        auditActor: B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
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

  private buildReplayRevenueRecognitionFailure(
    request: B1RevenueRecognitionRequestV1,
    record: B1RevenueRecognitionDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1RevenueRecognitionDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      revenueRecognitionRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      revenueRecognitionDecisionHash: record.revenueRecognitionDecisionHash,
      revenueRecognitionDecisionReplayHash: record.revenueRecognitionDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayTaxVatFailure(
    request: B1TaxVatRequestV1,
    record: B1TaxVatDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1TaxVatDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      taxVatRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      taxVatDecisionHash: record.taxVatDecisionHash,
      taxVatDecisionReplayHash: record.taxVatDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCostAccountingFailure(
    request: B1CostAccountingRequestV1,
    record: B1CostAccountingDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CostAccountingDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      costAccountingRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      costAccountingDecisionHash: record.costAccountingDecisionHash,
      costAccountingDecisionReplayHash: record.costAccountingDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(
    row: B1RevenueRecognitionDecisionEntity,
  ): B1RevenueRecognitionDocumentPersistenceRecordV1 {
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
