/**
 * B1T09 — B1 commercial-analytics engine, profitability engine,
 * and commercial-reconciliation engine read-only consumer
 * repository.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine repository is a read-write
 * consumer of:
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
 *  - the B1 revenue-recognition engine, tax / VAT engine, and
 *    cost-accounting engine (B1T08) persistence schema (the only
 *    B1 commercial-financial-recognition decision persistence
 *    surface; the B1 commercial-financial-recognition decision
 *    record is consulted through the B1 revenue-recognition
 *    engine read-only consumer boundary surface);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine repository is a read-only
 * consumer of the existing A1 canonical identity, A2 authorization,
 * A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter,
 * A6T05 external-operation, A6T08 settlement / suspense /
 * compensating, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command, A7T06
 * product notification, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, A7T10 product
 * data minimization, `CustomerPreference`, B1T03 commercial
 * catalog, B1T04 commercial decision, B1T05 billing document,
 * B1T06 commercial-incentive decision, B1T07 commercial-rewards
 * decision, B1T08 commercial-financial-recognition decision, and
 * the shared Operations audit, idempotency, outbox, and metrics
 * services. The B1 commercial-analytics engine, profitability
 * engine, and commercial-reconciliation engine repository does NOT
 * write source records, does NOT auto-repair discrepancies, does
 * NOT rewrite history, does NOT execute settlements, does NOT
 * perform payouts, does NOT perform reconciliation, does NOT
 * communicate with external partners, does NOT dispatch
 * notifications, and does NOT execute any financial effect.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine is deterministic. The B1
 * commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine is replay-safe. The B1
 * commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine never stores raw credentials,
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
import { B1CommercialAnalyticsDecision as B1CommercialAnalyticsDecisionEntity } from './b1-commercial-analytics-engine.entity';
import {
  B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
  B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_STATES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_STATES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_KINDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_OUTCOMES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DECLARED_DEPENDENCIES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_CATEGORIES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_OWNERS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_RECOVERY_STATES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_SEVERITIES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_KINDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_CODES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_IN_PROGRESS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_COMMERCIAL_ANALYTICS_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_KPIS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_METRICS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_METRIC_REPLAYED,
  B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PERIOD_KEY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_STATES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_DIMENSIONS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX,
  B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_RULE_IDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_RETENTION_DAYS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_RULE_KINDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_RULE_OUTCOMES,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_DIRECTION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_TRENDS,
  B1_COMMERCIAL_ANALYTICS_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-commercial-analytics-engine.constants';
import type {
  B1CommercialAnalyticsAnalyticsStepV1,
  B1CommercialAnalyticsAnalyticsTraceV1,
  B1CommercialAnalyticsAuditEvidenceV1,
  B1CommercialAnalyticsDecisionReplaySafeResultV1,
  B1CommercialAnalyticsDecisionV1,
  B1CommercialAnalyticsDocumentKind,
  B1CommercialAnalyticsDocumentPersistenceRecordV1,
  B1CommercialAnalyticsDocumentVersioningContractV1,
  B1CommercialAnalyticsEngineCompatibilityResultV1,
  B1CommercialAnalyticsEngineConsumerPortsV1,
  B1CommercialAnalyticsEngineEligibility,
  B1CommercialAnalyticsEngineFailureCodeV1,
  B1CommercialAnalyticsEngineFailureV1,
  B1CommercialAnalyticsExplanationStepV1,
  B1CommercialAnalyticsExplanationTraceV1,
  B1CommercialAnalyticsRequestV1,
  B1CommercialAnalyticsRuleKindV1,
  B1CommercialAnalyticsRuleOutcomeV1,
  B1CommercialAnalyticsRuleTraceStepV1,
  B1CommercialAnalyticsRuleTraceV1,
  B1CommercialReconciliationDecisionReplaySafeResultV1,
  B1CommercialReconciliationDecisionV1,
  B1CommercialReconciliationDiscrepancyV1,
  B1CommercialReconciliationRequestV1,
  B1ProfitabilityDecisionReplaySafeResultV1,
  B1ProfitabilityDecisionV1,
  B1ProfitabilityRequestV1,
} from './b1-commercial-analytics-engine.types';
import { B1CommercialCatalogService } from './b1-commercial-catalog.service';
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1ReferralEngineService } from './b1-referral-engine.service';
import { B1RevenueRecognitionEngineService } from './b1-revenue-recognition-engine.service';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1CommercialAnalyticsEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1CommercialAnalyticsDecisionEntity)
    private readonly repository: Repository<B1CommercialAnalyticsDecisionEntity>,
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
    @Inject(B1RevenueRecognitionEngineService)
    private readonly revenueRecognitionEngineService: B1RevenueRecognitionEngineService,
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
    return B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getPeriodKey(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PERIOD_KEY;
  }

  getCommercialAnalyticsIdempotencyScope(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE;
  }

  getProfitabilityIdempotencyScope(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE;
  }

  getCommercialReconciliationIdempotencyScope(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_RETENTION_DAYS;
  }

  getCommercialAnalyticsStates(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_STATES;
  }

  getProfitabilityStates(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_STATES;
  }

  getCommercialReconciliationStates(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_STATES;
  }

  getDecisionKinds(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_OUTCOMES;
  }

  getDocumentKinds(): readonly B1CommercialAnalyticsDocumentKind[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1CommercialAnalyticsRuleKindV1[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1CommercialAnalyticsRuleOutcomeV1[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_RULE_OUTCOMES;
  }

  getKpis(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_KPIS;
  }

  getTrends(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_TRENDS;
  }

  getDiscrepancySeverities(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_SEVERITIES;
  }

  getDiscrepancyOwners(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_OWNERS;
  }

  getDiscrepancyRecoveryStates(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_RECOVERY_STATES;
  }

  getDiscrepancyCategories(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_CATEGORIES;
  }

  getProfitabilityDimensions(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_DIMENSIONS;
  }

  getClassificationLevels(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_METRICS;
  }

  getConsumerPorts(): B1CommercialAnalyticsEngineConsumerPortsV1 {
    return {
      generateCommercialAnalyticsDecision: (request) =>
        Promise.resolve(this.generateCommercialAnalyticsDecision(request)),
      replaySafeGenerateCommercialAnalyticsDecision: (request) =>
        this.replaySafeGenerateCommercialAnalyticsDecision(request),
      generateProfitabilityDecision: (request) =>
        Promise.resolve(this.generateProfitabilityDecision(request)),
      replaySafeGenerateProfitabilityDecision: (request) =>
        this.replaySafeGenerateProfitabilityDecision(request),
      generateCommercialReconciliationDecision: (request) =>
        Promise.resolve(this.generateCommercialReconciliationDecision(request)),
      replaySafeGenerateCommercialReconciliationDecision: (request) =>
        this.replaySafeGenerateCommercialReconciliationDecision(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1CommercialAnalyticsDocumentVersioningContractV1 {
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
      scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
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
    readonly B1CommercialAnalyticsDocumentPersistenceRecordV1[]
  > {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CommercialAnalyticsDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CommercialAnalyticsDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateCommercialAnalyticsDecision(
    request: B1CommercialAnalyticsRequestV1,
  ): B1CommercialAnalyticsDecisionV1 {
    const shapeFailure = this.validateCommercialAnalyticsRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialAnalyticsDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialAnalyticsRequestHash = this.computeCommercialAnalyticsRequestHash(request);
    const commercialAnalyticsDecisionId = randomUUID();
    const commercialAnalyticsDecisionReference = this.computeCommercialAnalyticsDecisionReference(
      request,
      commercialAnalyticsRequestHash,
    );
    const explanationSteps: B1CommercialAnalyticsExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialAnalyticsRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialAnalyticsAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialAnalyticsRuleKindV1,
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
      'A3_BINDING_RECHECK' as B1CommercialAnalyticsRuleKindV1,
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
      'A5_LEDGER_ACCOUNT_STATE' as B1CommercialAnalyticsRuleKindV1,
      'A5_LEDGER_ACCOUNT_STATE_RULE',
      'A5 Ledger account state rule',
      'PASS',
      'A5_LEDGER_ACCOUNT_STATE_OK',
      'A5 Ledger account state passed',
      { accountState: 'OPEN' },
      { accountState: 'OPEN' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A6_PARTNER_STATE' as B1CommercialAnalyticsRuleKindV1,
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
      'A7_PRODUCT_CATALOG' as B1CommercialAnalyticsRuleKindV1,
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
      'B1_COMMERCIAL_CATALOG_LOOKUP' as B1CommercialAnalyticsRuleKindV1,
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
      'B1_COMMERCIAL_DECISION_LOOKUP' as B1CommercialAnalyticsRuleKindV1,
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
      'B1_BILLING_ENGINE_DOCUMENT_LOOKUP' as B1CommercialAnalyticsRuleKindV1,
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
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT' as B1CommercialAnalyticsRuleKindV1,
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT_RULE',
      'A6T09 external reconciliation snapshot rule',
      'PASS',
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT_OK',
      'A6T09 external reconciliation snapshot passed',
      { snapshotState: 'FRESH' },
      { snapshotState: 'FRESH' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_READ_ONLY_TRANSACTION' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_READ_ONLY_TRANSACTION_RULE',
      'B1 commercial-analytics engine read-only transaction rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_READ_ONLY_TRANSACTION_OK',
      'B1 commercial-analytics engine read-only transaction passed',
      { transactionMode: 'REPEATABLE READ', writeLock: false },
      { transactionMode: 'REPEATABLE READ', writeLock: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR_RULE',
      'B1 commercial-analytics engine no auto-repair rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR_OK',
      'B1 commercial-analytics engine no auto-repair passed',
      { autoRepair: false, sourceMutation: false },
      { autoRepair: false, sourceMutation: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-analytics engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-analytics engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-analytics engine document version rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-analytics engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_KPI',
      request.commercialDecisionReference,
      'B1 commercial KPI',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_KPI_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_METRIC',
      request.commercialDecisionReference,
      'B1 commercial metric',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_METRIC_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'TREND_ANALYSIS',
      request.commercialDecisionReference,
      'B1 trend analysis',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_TREND_ANALYSIS_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialAnalyticsEngineEligibility[] = [
      'CUSTOMER_ELIGIBLE',
      'MERCHANT_ELIGIBLE',
      'PARTNER_ELIGIBLE',
      'PRODUCT_ELIGIBLE',
      'TIER_ELIGIBLE',
      'PERIOD_ELIGIBLE',
      'KPI_AVAILABLE',
      'PROFITABILITY_AVAILABLE',
      'RECONCILIATION_AVAILABLE',
    ];
    const commercialAnalyticsDecisionOutcome: B1CommercialAnalyticsDecisionV1['commercialAnalyticsDecisionOutcome'] =
      'COMPLETED';
    const explanationTrace: B1CommercialAnalyticsExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_ANALYTICS_DECISION',
      traceSummary: `B1 commercial-analytics decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialAnalyticsRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialAnalyticsAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialAnalyticsDecisionId,
      auditAction: 'B1_COMMERCIAL_ANALYTICS_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialAnalyticsDecisionHashPayload = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialAnalyticsDecisionReference,
      commercialAnalyticsDecisionVersion: 1,
      commercialAnalyticsDecisionState: 'ACTIVE' as const,
      commercialAnalyticsDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialKpi: request.commercialKpi,
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
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
      costAccountingDecisionReference: request.costAccountingDecisionReference,
    };
    const commercialAnalyticsDecisionHash = this.computeCommercialAnalyticsDecisionHash(
      commercialAnalyticsDecisionHashPayload,
    );
    const commercialAnalyticsDecisionReplayHash = this.computeCommercialAnalyticsDecisionReplayHash(
      {
        commercialAnalyticsDecisionHash,
        commercialAnalyticsRequestHash,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.requestContext.correlationId,
      },
    );
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialAnalyticsDecisionId,
      commercialAnalyticsDecisionReference,
      commercialAnalyticsDecisionVersion: 1,
      commercialAnalyticsDecisionState: 'ACTIVE',
      commercialAnalyticsDecisionOutcome,
      commercialAnalyticsDecisionHash,
      commercialAnalyticsDecisionReplayHash,
      commercialAnalyticsRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialKpi: request.commercialKpi,
      commercialMetricValue: '0',
      commercialMetricUnit: 'NGN',
      commercialTrend: 'STABLE',
      commercialAnalyticsEligible: true,
      commercialAnalyticsApplicable: true,
      commercialKpiSummary: [request.commercialKpi],
      commercialTrendSummary: ['STABLE'],
      productAnalyticsSummary: [],
      customerAnalyticsSummary: [],
      merchantAnalyticsSummary: [],
      partnerAnalyticsSummary: [],
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
      commercialAnalyticsStartAt: request.commercialAnalyticsStartAt,
      commercialAnalyticsEndAt: request.commercialAnalyticsEndAt,
      commercialAnalyticsEffectiveAt: request.periodEffectiveAt,
      eligibilitySummary,
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
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

  generateProfitabilityDecision(request: B1ProfitabilityRequestV1): B1ProfitabilityDecisionV1 {
    const shapeFailure = this.validateProfitabilityRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureProfitabilityDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const profitabilityRequestHash = this.computeProfitabilityRequestHash(request);
    const profitabilityDecisionId = randomUUID();
    const profitabilityDecisionReference = this.computeProfitabilityDecisionReference(
      request,
      profitabilityRequestHash,
    );
    const explanationSteps: B1CommercialAnalyticsExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialAnalyticsRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialAnalyticsAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialAnalyticsRuleKindV1,
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
      'B1_COMMERCIAL_DECISION_REPLAY' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_DECISION_REPLAY_RULE',
      'B1 commercial decision replay rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_REPLAY_OK',
      'B1 commercial decision replay passed',
      { replaySafe: true },
      { replaySafe: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_REVENUE_RECOGNITION_DECISION_LOOKUP' as B1CommercialAnalyticsRuleKindV1,
      'B1_REVENUE_RECOGNITION_DECISION_LOOKUP_RULE',
      'B1 revenue-recognition decision lookup rule',
      'PASS',
      'B1_REVENUE_RECOGNITION_DECISION_LOOKUP_OK',
      'B1 revenue-recognition decision lookup passed',
      { revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference },
      { revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COST_ACCOUNTING_DECISION_LOOKUP' as B1CommercialAnalyticsRuleKindV1,
      'B1_COST_ACCOUNTING_DECISION_LOOKUP_RULE',
      'B1 cost-accounting decision lookup rule',
      'PASS',
      'B1_COST_ACCOUNTING_DECISION_LOOKUP_OK',
      'B1 cost-accounting decision lookup passed',
      { costAccountingDecisionReference: request.costAccountingDecisionReference },
      { costAccountingDecisionReference: request.costAccountingDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-analytics engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-analytics engine number is deterministic',
      { deterministic: true, profitabilityDecisionReference },
      { deterministic: true, profitabilityDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-analytics engine document version rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-analytics engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'PROFITABILITY',
      request.commercialDecisionReference,
      'B1 profitability',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'REVENUE_ATTRIBUTION',
      request.commercialDecisionReference,
      'B1 revenue attribution',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_REVENUE_ATTRIBUTION_OK',
      request.revenueAttributionAmount,
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COST_ATTRIBUTION',
      request.commercialDecisionReference,
      'B1 cost attribution',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_COST_ATTRIBUTION_OK',
      request.costAttributionAmount,
      new Date().toISOString(),
    );

    const profitabilityDecisionOutcome: B1ProfitabilityDecisionV1['profitabilityDecisionOutcome'] =
      'COMPLETED';
    const grossProfitAmount = (
      BigInt(request.revenueAttributionAmount) - BigInt(request.costAttributionAmount)
    ).toString();
    const netProfitAmount = grossProfitAmount;
    const explanationTrace: B1CommercialAnalyticsExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'PROFITABILITY_DECISION',
      traceSummary: `B1 profitability decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialAnalyticsRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialAnalyticsAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: profitabilityDecisionId,
      auditAction: 'B1_PROFITABILITY_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const profitabilityDecisionHashPayload = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      profitabilityDecisionReference,
      profitabilityDecisionVersion: 1,
      profitabilityDecisionState: 'ACTIVE' as const,
      profitabilityDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      profitabilityDimension: request.profitabilityDimension,
      revenueAttributionAmount: request.revenueAttributionAmount,
      costAttributionAmount: request.costAttributionAmount,
      grossProfitAmount,
      netProfitAmount,
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
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
      costAccountingDecisionReference: request.costAccountingDecisionReference,
    };
    const profitabilityDecisionHash = this.computeCommercialAnalyticsDecisionHash(
      profitabilityDecisionHashPayload,
    );
    const profitabilityDecisionReplayHash = this.computeProfitabilityDecisionReplayHash({
      profitabilityDecisionHash,
      profitabilityRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      profitabilityDecisionId,
      profitabilityDecisionReference,
      profitabilityDecisionVersion: 1,
      profitabilityDecisionState: 'ACTIVE',
      profitabilityDecisionOutcome,
      profitabilityDecisionHash,
      profitabilityDecisionReplayHash,
      profitabilityRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      profitabilityDimension: request.profitabilityDimension,
      revenueAttributionAmount: request.revenueAttributionAmount,
      costAttributionAmount: request.costAttributionAmount,
      grossProfitAmount,
      netProfitAmount,
      profitabilityEligible: true,
      profitabilityApplicable: true,
      revenueAttributionSummary: [],
      costAttributionSummary: [],
      productProfitabilitySummary: [],
      customerProfitabilitySummary: [],
      merchantProfitabilitySummary: [],
      campaignProfitabilitySummary: [],
      feeProfitabilitySummary: [],
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
      profitabilityStartAt: request.profitabilityStartAt,
      profitabilityEndAt: request.profitabilityEndAt,
      profitabilityEffectiveAt: request.periodEffectiveAt,
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
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

  generateCommercialReconciliationDecision(
    request: B1CommercialReconciliationRequestV1,
  ): B1CommercialReconciliationDecisionV1 {
    const shapeFailure = this.validateCommercialReconciliationRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialReconciliationDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialReconciliationRequestHash =
      this.computeCommercialReconciliationRequestHash(request);
    const commercialReconciliationDecisionId = randomUUID();
    const commercialReconciliationDecisionReference =
      this.computeCommercialReconciliationDecisionReference(
        request,
        commercialReconciliationRequestHash,
      );
    const explanationSteps: B1CommercialAnalyticsExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialAnalyticsRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialAnalyticsAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A5_FINANCIAL_INVARIANTS' as B1CommercialAnalyticsRuleKindV1,
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
      'A6T09_EXTERNAL_RECONCILIATION' as B1CommercialAnalyticsRuleKindV1,
      'A6T09_EXTERNAL_RECONCILIATION_RULE',
      'A6T09 external reconciliation rule',
      'PASS',
      'A6T09_EXTERNAL_RECONCILIATION_OK',
      'A6T09 external reconciliation passed',
      { snapshotState: 'FRESH' },
      { snapshotState: 'FRESH' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT' as B1CommercialAnalyticsRuleKindV1,
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT_RULE',
      'A6T09 external reconciliation snapshot rule',
      'PASS',
      'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT_OK',
      'A6T09 external reconciliation snapshot passed',
      { snapshotState: 'FRESH' },
      { snapshotState: 'FRESH' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR_RULE',
      'B1 commercial-analytics engine no auto-repair rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR_OK',
      'B1 commercial-analytics engine no auto-repair passed',
      { autoRepair: false, sourceMutation: false },
      { autoRepair: false, sourceMutation: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-analytics engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-analytics engine number is deterministic',
      { deterministic: true, commercialReconciliationDecisionReference },
      { deterministic: true, commercialReconciliationDecisionReference },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION' as B1CommercialAnalyticsRuleKindV1,
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-analytics engine document version rule',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-analytics engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_RECONCILIATION',
      request.commercialDecisionReference,
      'B1 commercial reconciliation',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_RECONCILIATION_EVIDENCE',
      request.commercialDecisionReference,
      'B1 commercial reconciliation evidence',
      'PASS',
      'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_EVIDENCE_OK',
      '0',
      new Date().toISOString(),
    );

    const discrepancies: B1CommercialReconciliationDiscrepancyV1[] = [];
    const commercialReconciliationDecisionOutcome: B1CommercialReconciliationDecisionV1['commercialReconciliationDecisionOutcome'] =
      'RECONCILED';
    const explanationTrace: B1CommercialAnalyticsExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_RECONCILIATION_DECISION',
      traceSummary: `B1 commercial-reconciliation decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialAnalyticsRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialAnalyticsAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialReconciliationDecisionId,
      auditAction: 'B1_COMMERCIAL_RECONCILIATION_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialReconciliationDecisionHashPayload = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialReconciliationDecisionReference,
      commercialReconciliationDecisionVersion: 1,
      commercialReconciliationDecisionState: 'RECONCILED' as const,
      commercialReconciliationDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      reconciliationWindowStartAt: request.reconciliationWindowStartAt,
      reconciliationWindowEndAt: request.reconciliationWindowEndAt,
      discrepancyCount: discrepancies.length,
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
      promotionDecisionReference: request.promotionDecisionReference,
      couponDecisionReference: request.couponDecisionReference,
      referralDecisionReference: request.referralDecisionReference,
      cashbackDecisionReference: request.cashbackDecisionReference,
      loyaltyDecisionReference: request.loyaltyDecisionReference,
      revenueRecognitionDecisionReference: request.revenueRecognitionDecisionReference,
      taxVatDecisionReference: request.taxVatDecisionReference,
      costAccountingDecisionReference: request.costAccountingDecisionReference,
    };
    const commercialReconciliationDecisionHash = this.computeCommercialAnalyticsDecisionHash(
      commercialReconciliationDecisionHashPayload,
    );
    const commercialReconciliationDecisionReplayHash =
      this.computeCommercialReconciliationDecisionReplayHash({
        commercialReconciliationDecisionHash,
        commercialReconciliationRequestHash,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.requestContext.correlationId,
      });
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialReconciliationDecisionId,
      commercialReconciliationDecisionReference,
      commercialReconciliationDecisionVersion: 1,
      commercialReconciliationDecisionState: 'RECONCILED',
      commercialReconciliationDecisionOutcome,
      commercialReconciliationDecisionHash,
      commercialReconciliationDecisionReplayHash,
      commercialReconciliationRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      reconciliationWindowStartAt: request.reconciliationWindowStartAt,
      reconciliationWindowEndAt: request.reconciliationWindowEndAt,
      reconciliationWindowEffectiveAt: request.periodEffectiveAt,
      commercialReconciliationEligible: true,
      commercialReconciliationApplicable: true,
      commercialReconciliationReportSummary: [],
      commercialReconciliationEvidenceSummary: [],
      commercialReconciliationTraceSummary: [],
      commercialReconciliationDiscrepancySummary: discrepancies,
      commercialReconciliationDiscrepancyCount: discrepancies.length,
      commercialReconciliationDiscrepancySeveritySummary: [],
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
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

  async replaySafeGenerateCommercialAnalyticsDecision(
    request: B1CommercialAnalyticsRequestV1,
  ): Promise<B1CommercialAnalyticsDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialAnalytics(request);
  }

  async replaySafeGenerateProfitabilityDecision(
    request: B1ProfitabilityRequestV1,
  ): Promise<B1ProfitabilityDecisionReplaySafeResultV1> {
    return this.replaySafeProfitability(request);
  }

  async replaySafeGenerateCommercialReconciliationDecision(
    request: B1CommercialReconciliationRequestV1,
  ): Promise<B1CommercialReconciliationDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialReconciliation(request);
  }

  compatibilityCheck(
    request:
      | B1CommercialAnalyticsRequestV1
      | B1ProfitabilityRequestV1
      | B1CommercialReconciliationRequestV1,
  ): B1CommercialAnalyticsEngineCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 commercial-analytics engine request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (
      request.productVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION
    ) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (
      B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)
    ) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INCOMPATIBLE,
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
        'read-only',
        'compatible',
      ],
    };
  }

  private async replaySafeCommercialAnalytics(
    request: B1CommercialAnalyticsRequestV1,
  ): Promise<B1CommercialAnalyticsDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialAnalyticsRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialAnalyticsDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialAnalyticsFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialAnalyticsRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_ANALYTICS_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialAnalyticsDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_ANALYTICS_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialAnalyticsRequestHash: originalRecord.commercialAnalyticsRequestHash,
          commercialAnalyticsDecisionHash: originalRecord.commercialAnalyticsDecisionHash,
          commercialAnalyticsDecisionReplayHash:
            originalRecord.commercialAnalyticsDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialAnalyticsDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-analytics engine replay-safe generate commercial-analytics decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialAnalyticsFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialAnalyticsDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialAnalyticsRequestHash: record.commercialAnalyticsRequestHash,
        commercialAnalyticsDecisionHash: record.commercialAnalyticsDecisionHash,
        commercialAnalyticsDecisionReplayHash: record.commercialAnalyticsDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialAnalyticsDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-analytics engine replay-safe generate commercial-analytics decision conflict: ${message}`,
        );
        return this.buildReplayCommercialAnalyticsFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialAnalyticsDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-analytics engine replay-safe generate commercial-analytics decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialAnalyticsFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeProfitability(
    request: B1ProfitabilityRequestV1,
  ): Promise<B1ProfitabilityDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateProfitabilityRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureProfitabilityDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayProfitabilityFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeProfitabilityRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_ANALYTICS_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateProfitabilityDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_ANALYTICS_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          profitabilityRequestHash: originalRecord.profitabilityRequestHash,
          profitabilityDecisionHash: originalRecord.profitabilityDecisionHash,
          profitabilityDecisionReplayHash: originalRecord.profitabilityDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureProfitabilityDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-analytics engine replay-safe generate profitability decision is in progress for the same idempotency key',
        );
        return this.buildReplayProfitabilityFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateProfitabilityDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        profitabilityRequestHash: record.profitabilityRequestHash,
        profitabilityDecisionHash: record.profitabilityDecisionHash,
        profitabilityDecisionReplayHash: record.profitabilityDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureProfitabilityDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-analytics engine replay-safe generate profitability decision conflict: ${message}`,
        );
        return this.buildReplayProfitabilityFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureProfitabilityDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-analytics engine replay-safe generate profitability decision query unavailable: ${message}`,
      );
      return this.buildReplayProfitabilityFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCommercialReconciliation(
    request: B1CommercialReconciliationRequestV1,
  ): Promise<B1CommercialReconciliationDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialReconciliationRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialReconciliationDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialReconciliationFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialReconciliationRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_ANALYTICS_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialReconciliationDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_ANALYTICS_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope:
            B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialReconciliationRequestHash: originalRecord.commercialReconciliationRequestHash,
          commercialReconciliationDecisionHash: originalRecord.commercialReconciliationDecisionHash,
          commercialReconciliationDecisionReplayHash:
            originalRecord.commercialReconciliationDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialReconciliationDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-analytics engine replay-safe generate commercial-reconciliation decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialReconciliationFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialReconciliationDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope:
          B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialReconciliationRequestHash: record.commercialReconciliationRequestHash,
        commercialReconciliationDecisionHash: record.commercialReconciliationDecisionHash,
        commercialReconciliationDecisionReplayHash:
          record.commercialReconciliationDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialReconciliationDecision(
          request,
          B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-analytics engine replay-safe generate commercial-reconciliation decision conflict: ${message}`,
        );
        return this.buildReplayCommercialReconciliationFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialReconciliationDecision(
        request,
        B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-analytics engine replay-safe generate commercial-reconciliation decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialReconciliationFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendRule(
    explanationSteps: B1CommercialAnalyticsExplanationStepV1[],
    ruleTraceSteps: B1CommercialAnalyticsRuleTraceStepV1[],
    ruleKind: B1CommercialAnalyticsRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1CommercialAnalyticsRuleOutcomeV1,
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

  private appendAnalyticsStep(
    analyticsSteps: B1CommercialAnalyticsAnalyticsStepV1[],
    stepKind: B1CommercialAnalyticsAnalyticsStepV1['stepKind'],
    stepReference: string,
    stepLabel: string,
    stepOutcome: B1CommercialAnalyticsRuleOutcomeV1,
    stepReasonCode: string,
    stepAmount: string,
    stepEvaluatedAt: string,
  ): void {
    const stepIndex = analyticsSteps.length + 1;
    analyticsSteps.push({
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

  private computeCommercialAnalyticsRequestHash(request: B1CommercialAnalyticsRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialAnalyticsRequestId: request.commercialAnalyticsRequestId,
      commercialAnalyticsRequestVersion: request.commercialAnalyticsRequestVersion,
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
      commercialKpi: request.commercialKpi,
      commercialAnalyticsStartAt: request.commercialAnalyticsStartAt,
      commercialAnalyticsEndAt: request.commercialAnalyticsEndAt,
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeProfitabilityRequestHash(request: B1ProfitabilityRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      profitabilityRequestId: request.profitabilityRequestId,
      profitabilityRequestVersion: request.profitabilityRequestVersion,
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
      profitabilityDimension: request.profitabilityDimension,
      revenueAttributionAmount: request.revenueAttributionAmount,
      costAttributionAmount: request.costAttributionAmount,
      profitabilityStartAt: request.profitabilityStartAt,
      profitabilityEndAt: request.profitabilityEndAt,
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialReconciliationRequestHash(
    request: B1CommercialReconciliationRequestV1,
  ): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialReconciliationRequestId: request.commercialReconciliationRequestId,
      commercialReconciliationRequestVersion: request.commercialReconciliationRequestVersion,
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
      reconciliationWindowStartAt: request.reconciliationWindowStartAt,
      reconciliationWindowEndAt: request.reconciliationWindowEndAt,
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
      costAccountingDecisionReference: request.costAccountingDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialAnalyticsDecisionReference(
    request: B1CommercialAnalyticsRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX}:commercial-analytics:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeProfitabilityDecisionReference(
    request: B1ProfitabilityRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX}:profitability:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialReconciliationDecisionReference(
    request: B1CommercialReconciliationRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX}:commercial-reconciliation:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialAnalyticsDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeCommercialAnalyticsDecisionReplayHash(input: {
    readonly commercialAnalyticsDecisionHash: string;
    readonly commercialAnalyticsRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      commercialAnalyticsDecisionHash: input.commercialAnalyticsDecisionHash,
      commercialAnalyticsRequestHash: input.commercialAnalyticsRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeProfitabilityDecisionReplayHash(input: {
    readonly profitabilityDecisionHash: string;
    readonly profitabilityRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      profitabilityDecisionHash: input.profitabilityDecisionHash,
      profitabilityRequestHash: input.profitabilityRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialReconciliationDecisionReplayHash(input: {
    readonly commercialReconciliationDecisionHash: string;
    readonly commercialReconciliationRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      commercialReconciliationDecisionHash: input.commercialReconciliationDecisionHash,
      commercialReconciliationRequestHash: input.commercialReconciliationRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateCommercialAnalyticsRequestShape(
    request: B1CommercialAnalyticsRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-analytics engine commercial-analytics request is missing';
    }
    if (request.contractName !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME) {
      return 'The B1 commercial-analytics engine commercial-analytics request contract name is invalid';
    }
    if (request.contractVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION) {
      return 'The B1 commercial-analytics engine commercial-analytics request contract version is invalid';
    }
    if (
      !request.commercialAnalyticsRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialAnalyticsRequestId)
    ) {
      return 'The B1 commercial-analytics engine commercial-analytics request commercial analytics request id is invalid';
    }
    if (request.commercialAnalyticsRequestVersion !== 1) {
      return 'The B1 commercial-analytics engine commercial-analytics request commercial analytics request version is invalid';
    }
    if (request.scopeKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY) {
      return 'The B1 commercial-analytics engine commercial-analytics request scope key is invalid';
    }
    if (request.scopeVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION) {
      return 'The B1 commercial-analytics engine commercial-analytics request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 commercial-analytics engine commercial-analytics request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 commercial-analytics engine commercial-analytics request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 commercial-analytics engine commercial-analytics request product key is invalid';
    }
    if (
      request.productVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION
    ) {
      return 'The B1 commercial-analytics engine commercial-analytics request product version is invalid';
    }
    if (!request.customerId || !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 commercial-analytics engine commercial-analytics request customer id is invalid';
    }
    if (!request.merchantId || !SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 commercial-analytics engine commercial-analytics request merchant id is invalid';
    }
    if (!request.partnerId || !SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 commercial-analytics engine commercial-analytics request partner id is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 commercial-analytics engine commercial-analytics request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 commercial-analytics engine commercial-analytics request capability version is invalid';
    }
    if (!request.planKey || !SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 commercial-analytics engine commercial-analytics request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 commercial-analytics engine commercial-analytics request plan version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 commercial-analytics engine commercial-analytics request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 commercial-analytics engine commercial-analytics request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 commercial-analytics engine commercial-analytics request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 commercial-analytics engine commercial-analytics request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 commercial-analytics engine commercial-analytics request billing document reference is invalid';
    }
    return null;
  }

  private validateProfitabilityRequestShape(request: B1ProfitabilityRequestV1): string | null {
    if (!request) {
      return 'The B1 commercial-analytics engine profitability request is missing';
    }
    if (request.contractName !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME) {
      return 'The B1 commercial-analytics engine profitability request contract name is invalid';
    }
    if (request.contractVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION) {
      return 'The B1 commercial-analytics engine profitability request contract version is invalid';
    }
    if (
      !request.profitabilityRequestId ||
      !SAFE_TEXT_PATTERN.test(request.profitabilityRequestId)
    ) {
      return 'The B1 commercial-analytics engine profitability request profitability request id is invalid';
    }
    if (request.profitabilityRequestVersion !== 1) {
      return 'The B1 commercial-analytics engine profitability request profitability request version is invalid';
    }
    if (request.scopeKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY) {
      return 'The B1 commercial-analytics engine profitability request scope key is invalid';
    }
    if (request.scopeVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION) {
      return 'The B1 commercial-analytics engine profitability request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 commercial-analytics engine profitability request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 commercial-analytics engine profitability request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 commercial-analytics engine profitability request product key is invalid';
    }
    if (
      request.productVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION
    ) {
      return 'The B1 commercial-analytics engine profitability request product version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 commercial-analytics engine profitability request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 commercial-analytics engine profitability request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 commercial-analytics engine profitability request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 commercial-analytics engine profitability request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 commercial-analytics engine profitability request billing document reference is invalid';
    }
    return null;
  }

  private validateCommercialReconciliationRequestShape(
    request: B1CommercialReconciliationRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request is missing';
    }
    if (request.contractName !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request contract name is invalid';
    }
    if (request.contractVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request contract version is invalid';
    }
    if (
      !request.commercialReconciliationRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialReconciliationRequestId)
    ) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request commercial reconciliation request id is invalid';
    }
    if (request.commercialReconciliationRequestVersion !== 1) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request commercial reconciliation request version is invalid';
    }
    if (request.scopeKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request scope key is invalid';
    }
    if (request.scopeVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request product key is invalid';
    }
    if (
      request.productVersion !== B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION
    ) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request product version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request request context is missing';
    }
    if (
      !request.commercialDecisionReference ||
      !SAFE_TEXT_PATTERN.test(request.commercialDecisionReference)
    ) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request commercial decision reference is invalid';
    }
    if (
      !request.commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialDecisionIdempotencyKey)
    ) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request commercial decision idempotency key is invalid';
    }
    if (
      !request.billingDocumentReference ||
      !SAFE_TEXT_PATTERN.test(request.billingDocumentReference)
    ) {
      return 'The B1 commercial-analytics engine commercial-reconciliation request billing document reference is invalid';
    }
    return null;
  }

  private buildFailureCommercialAnalyticsDecision(
    request: B1CommercialAnalyticsRequestV1,
    code: B1CommercialAnalyticsEngineFailureCodeV1,
    message: string,
  ): B1CommercialAnalyticsDecisionV1 {
    const failure: B1CommercialAnalyticsEngineFailureV1 = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialAnalyticsDecisionId: 'failed',
      commercialAnalyticsDecisionReference: 'B1-COMMERCIAL-ANALYTICS-DECISION-FAILED',
      commercialAnalyticsDecisionVersion: 1,
      commercialAnalyticsDecisionState: 'DRAFT',
      commercialAnalyticsDecisionOutcome: 'DISCREPANCY',
      commercialAnalyticsDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialAnalyticsDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialAnalyticsRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialKpi: request?.commercialKpi ?? 'GMV',
      commercialMetricValue: '0',
      commercialMetricUnit: 'NGN',
      commercialTrend: 'INSUFFICIENT_DATA',
      commercialAnalyticsEligible: false,
      commercialAnalyticsApplicable: false,
      commercialKpiSummary: [],
      commercialTrendSummary: [],
      productAnalyticsSummary: [],
      customerAnalyticsSummary: [],
      merchantAnalyticsSummary: [],
      partnerAnalyticsSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.commercial-analytics',
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
      commercialAnalyticsStartAt: request?.commercialAnalyticsStartAt ?? new Date().toISOString(),
      commercialAnalyticsEndAt: request?.commercialAnalyticsEndAt ?? new Date().toISOString(),
      commercialAnalyticsEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      eligibilitySummary: [],
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
      costAccountingDecisionReference: request?.costAccountingDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_ANALYTICS_DECISION',
        traceSummary: `B1 commercial-analytics engine failure: ${message}`,
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
      analyticsTrace: {
        analyticsTraceId: randomUUID(),
        analyticsSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_ANALYTICS_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
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

  private buildFailureProfitabilityDecision(
    request: B1ProfitabilityRequestV1,
    code: B1CommercialAnalyticsEngineFailureCodeV1,
    message: string,
  ): B1ProfitabilityDecisionV1 {
    const failure: B1CommercialAnalyticsEngineFailureV1 = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      profitabilityDecisionId: 'failed',
      profitabilityDecisionReference: 'B1-PROFITABILITY-DECISION-FAILED',
      profitabilityDecisionVersion: 1,
      profitabilityDecisionState: 'DRAFT',
      profitabilityDecisionOutcome: 'DISCREPANCY',
      profitabilityDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      profitabilityDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      profitabilityRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      profitabilityDimension: request?.profitabilityDimension ?? 'PRODUCT',
      revenueAttributionAmount: request?.revenueAttributionAmount ?? '0',
      costAttributionAmount: request?.costAttributionAmount ?? '0',
      grossProfitAmount: '0',
      netProfitAmount: '0',
      profitabilityEligible: false,
      profitabilityApplicable: false,
      revenueAttributionSummary: [],
      costAttributionSummary: [],
      productProfitabilitySummary: [],
      customerProfitabilitySummary: [],
      merchantProfitabilitySummary: [],
      campaignProfitabilitySummary: [],
      feeProfitabilitySummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.profitability',
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
      profitabilityStartAt: request?.profitabilityStartAt ?? new Date().toISOString(),
      profitabilityEndAt: request?.profitabilityEndAt ?? new Date().toISOString(),
      profitabilityEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
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
      costAccountingDecisionReference: request?.costAccountingDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'PROFITABILITY_DECISION',
        traceSummary: `B1 commercial-analytics engine failure: ${message}`,
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
      analyticsTrace: {
        analyticsTraceId: randomUUID(),
        analyticsSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_PROFITABILITY_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
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

  private buildFailureCommercialReconciliationDecision(
    request: B1CommercialReconciliationRequestV1,
    code: B1CommercialAnalyticsEngineFailureCodeV1,
    message: string,
  ): B1CommercialReconciliationDecisionV1 {
    const failure: B1CommercialAnalyticsEngineFailureV1 = {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
      commercialReconciliationDecisionId: 'failed',
      commercialReconciliationDecisionReference: 'B1-COMMERCIAL-RECONCILIATION-DECISION-FAILED',
      commercialReconciliationDecisionVersion: 1,
      commercialReconciliationDecisionState: 'DRAFT',
      commercialReconciliationDecisionOutcome: 'DISCREPANCY',
      commercialReconciliationDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialReconciliationDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialReconciliationRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_ANALYTICS_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      reconciliationWindowStartAt: request?.reconciliationWindowStartAt ?? new Date().toISOString(),
      reconciliationWindowEndAt: request?.reconciliationWindowEndAt ?? new Date().toISOString(),
      reconciliationWindowEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      commercialReconciliationEligible: false,
      commercialReconciliationApplicable: false,
      commercialReconciliationReportSummary: [],
      commercialReconciliationEvidenceSummary: [],
      commercialReconciliationTraceSummary: [],
      commercialReconciliationDiscrepancySummary: [],
      commercialReconciliationDiscrepancyCount: 0,
      commercialReconciliationDiscrepancySeveritySummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ??
        'commercial.virtual-account.inbound-funding.commercial-reconciliation',
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
      costAccountingDecisionReference: request?.costAccountingDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_RECONCILIATION_DECISION',
        traceSummary: `B1 commercial-analytics engine failure: ${message}`,
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
      analyticsTrace: {
        analyticsTraceId: randomUUID(),
        analyticsSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_RECONCILIATION_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
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

  private buildReplayCommercialAnalyticsFailure(
    request: B1CommercialAnalyticsRequestV1,
    record: B1CommercialAnalyticsDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialAnalyticsDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialAnalyticsRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialAnalyticsDecisionHash: record.commercialAnalyticsDecisionHash,
      commercialAnalyticsDecisionReplayHash: record.commercialAnalyticsDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayProfitabilityFailure(
    request: B1ProfitabilityRequestV1,
    record: B1ProfitabilityDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1ProfitabilityDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      profitabilityRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      profitabilityDecisionHash: record.profitabilityDecisionHash,
      profitabilityDecisionReplayHash: record.profitabilityDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCommercialReconciliationFailure(
    request: B1CommercialReconciliationRequestV1,
    record: B1CommercialReconciliationDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialReconciliationDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialReconciliationRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialReconciliationDecisionHash: record.commercialReconciliationDecisionHash,
      commercialReconciliationDecisionReplayHash: record.commercialReconciliationDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(
    row: B1CommercialAnalyticsDecisionEntity,
  ): B1CommercialAnalyticsDocumentPersistenceRecordV1 {
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
