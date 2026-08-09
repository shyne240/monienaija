/**
 * B1T10 — B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface read-only consumer repository.
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface repository is a read-only contract
 * against the existing A1 canonical identity, A2 authorization, A3
 * binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05
 * external-operation, A6T08 settlement / suspense / compensating,
 * A6T09 external reconciliation, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, A7T04 product
 * customer-binding, A7T05 product command / operation, A7T06
 * product notification delivery, A7T07 product lifecycle, A7T08
 * product financial effect, A7T09 product reconciliation, A7T10
 * product data minimization, B1T03 commercial catalog, B1T04
 * commercial decision, B1T05 billing document, B1T06 commercial-
 * incentive decision, B1T07 commercial-rewards decision, B1T08
 * commercial-financial-recognition decision, B1T09 commercial-
 * analytics decision, `CustomerPreference`, and the shared
 * Operations audit, idempotency, outbox, and metrics services.
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface repository is a read-write
 * contract against the shared Operations `IdempotencyService`,
 * `AuditService`, `OutboxService`, and `MetricsService` (idempotency
 * reservation, metrics increment, audit recording, and outbox event
 * publishing only). The B1 commercial-governance engine, commercial
 * data-classification, commercial idempotency, commercial audit,
 * commercial approvals, and commercial feature-flag surface
 * repository does NOT write source records, does NOT mutate
 * classifications, does NOT auto-repair discrepancies, does NOT
 * rewrite history, does NOT execute settlements, does NOT perform
 * payouts, does NOT perform reconciliation, does NOT communicate
 * with external partners, does NOT dispatch notifications, does
 * NOT execute any financial effect, does NOT execute any approval,
 * does NOT enable any feature, does NOT modify any classification,
 * and does NOT execute any commercial-decision or commercial-
 * financial-effect.
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface is deterministic. The B1
 * commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface is replay-safe. The B1
 * commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface never stores raw credentials, PAN
 * / account secrets, PINs, OTPs, callback signatures, private keys,
 * raw risk / compliance notes, or unnecessary customer data in
 * broad records, logs, traces, events, or notification payloads.
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
import { B1CommercialAnalyticsEngineService } from './b1-commercial-analytics-engine.service';
import { B1CommercialGovernanceDecision as B1CommercialGovernanceDecisionEntity } from './b1-commercial-governance-engine.entity';
import {
  B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_KINDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_OUTCOMES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_DECLARED_DEPENDENCIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_KINDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_CODES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_METRICS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_RULE_IDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_RETENTION_DAYS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_RULE_KINDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_RULE_OUTCOMES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_DIRECTION,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_SENSITIVITIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DISCLOSURE_LEVELS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_RETENTION_CLASSES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_EXPORT_RULES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVENTS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICIES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_ROLLOUT_STATES,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESSES,
} from './b1-commercial-governance-engine.constants';
import type {
  B1CommercialApprovalDecisionReplaySafeResultV1,
  B1CommercialApprovalDecisionV1,
  B1CommercialApprovalRequestV1,
  B1CommercialAuditDecisionReplaySafeResultV1,
  B1CommercialAuditDecisionV1,
  B1CommercialAuditRequestV1,
  B1CommercialDataClassificationDecisionReplaySafeResultV1,
  B1CommercialDataClassificationDecisionV1,
  B1CommercialDataClassificationRequestV1,
  B1CommercialFeatureFlagDecisionReplaySafeResultV1,
  B1CommercialFeatureFlagDecisionV1,
  B1CommercialFeatureFlagRequestV1,
  B1CommercialGovernanceEngineAnalyticsStepV1,
  B1CommercialGovernanceEngineAnalyticsTraceV1,
  B1CommercialGovernanceEngineAuditEvidenceV1,
  B1CommercialGovernanceEngineCompatibilityResultV1,
  B1CommercialGovernanceEngineConsumerPortsV1,
  B1CommercialGovernanceEngineDocumentKind,
  B1CommercialGovernanceEngineDocumentPersistenceRecordV1,
  B1CommercialGovernanceEngineDocumentVersioningContractV1,
  B1CommercialGovernanceEngineEligibility,
  B1CommercialGovernanceEngineExplanationStepV1,
  B1CommercialGovernanceEngineExplanationTraceV1,
  B1CommercialGovernanceEngineFailureCodeV1,
  B1CommercialGovernanceEngineFailureV1,
  B1CommercialGovernanceEngineRuleKindV1,
  B1CommercialGovernanceEngineRuleOutcomeV1,
  B1CommercialGovernanceEngineRuleTraceStepV1,
  B1CommercialGovernanceEngineRuleTraceV1,
  B1CommercialIdempotencyDecisionReplaySafeResultV1,
  B1CommercialIdempotencyDecisionV1,
  B1CommercialIdempotencyRequestV1,
} from './b1-commercial-governance-engine.types';
import { B1CommercialCatalogService } from './b1-commercial-catalog.service';
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1ReferralEngineService } from './b1-referral-engine.service';
import { B1RevenueRecognitionEngineService } from './b1-revenue-recognition-engine.service';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1CommercialGovernanceEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1CommercialGovernanceDecisionEntity)
    private readonly repository: Repository<B1CommercialGovernanceDecisionEntity>,
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
    @Inject(B1CommercialAnalyticsEngineService)
    private readonly commercialAnalyticsEngineService: B1CommercialAnalyticsEngineService,
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
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getPeriodKey(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY;
  }

  getCommercialDataClassificationIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE;
  }

  getCommercialIdempotencyIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE;
  }

  getCommercialAuditIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE;
  }

  getCommercialApprovalIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE;
  }

  getCommercialFeatureFlagIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getReferencePrefix(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_RETENTION_DAYS;
  }

  getCommercialDataClassificationStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_STATES;
  }

  getCommercialIdempotencyStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_STATES;
  }

  getCommercialAuditStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_STATES;
  }

  getCommercialApprovalStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_STATES;
  }

  getCommercialFeatureFlagStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_STATES;
  }

  getDecisionKinds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_OUTCOMES;
  }

  getDocumentKinds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1CommercialGovernanceEngineRuleKindV1[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1CommercialGovernanceEngineRuleOutcomeV1[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_RULE_OUTCOMES;
  }

  getClassificationLevels(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCommercialSensitivities(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_SENSITIVITIES;
  }

  getCommercialDisclosureLevels(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DISCLOSURE_LEVELS;
  }

  getCommercialRetentionClasses(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_RETENTION_CLASSES;
  }

  getCommercialExportRules(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_EXPORT_RULES;
  }

  getCommercialReplayPolicies(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICIES;
  }

  getCommercialReplayEligibilities(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITIES;
  }

  getCommercialAuditEvents(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVENTS;
  }

  getCommercialApprovalRequirements(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS;
  }

  getCommercialApprovalPolicies(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICIES;
  }

  getCommercialFeatureFlagRolloutStates(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_ROLLOUT_STATES;
  }

  getCommercialActivationReadinesses(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESSES;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_METRICS;
  }

  getConsumerPorts(): B1CommercialGovernanceEngineConsumerPortsV1 {
    return {
      generateCommercialDataClassificationDecision: (request) =>
        Promise.resolve(this.generateCommercialDataClassificationDecision(request)),
      replaySafeGenerateCommercialDataClassificationDecision: (request) =>
        this.replaySafeGenerateCommercialDataClassificationDecision(request),
      generateCommercialIdempotencyDecision: (request) =>
        Promise.resolve(this.generateCommercialIdempotencyDecision(request)),
      replaySafeGenerateCommercialIdempotencyDecision: (request) =>
        this.replaySafeGenerateCommercialIdempotencyDecision(request),
      generateCommercialAuditDecision: (request) =>
        Promise.resolve(this.generateCommercialAuditDecision(request)),
      replaySafeGenerateCommercialAuditDecision: (request) =>
        this.replaySafeGenerateCommercialAuditDecision(request),
      generateCommercialApprovalDecision: (request) =>
        Promise.resolve(this.generateCommercialApprovalDecision(request)),
      replaySafeGenerateCommercialApprovalDecision: (request) =>
        this.replaySafeGenerateCommercialApprovalDecision(request),
      generateCommercialFeatureFlagDecision: (request) =>
        Promise.resolve(this.generateCommercialFeatureFlagDecision(request)),
      replaySafeGenerateCommercialFeatureFlagDecision: (request) =>
        this.replaySafeGenerateCommercialFeatureFlagDecision(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1CommercialGovernanceEngineDocumentVersioningContractV1 {
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
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
    readonly B1CommercialGovernanceEngineDocumentPersistenceRecordV1[]
  > {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CommercialGovernanceEngineDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CommercialGovernanceEngineDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateCommercialDataClassificationDecision(
    request: B1CommercialDataClassificationRequestV1,
  ): B1CommercialDataClassificationDecisionV1 {
    const shapeFailure = this.validateCommercialDataClassificationRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialDataClassificationDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialDataClassificationRequestHash =
      this.computeCommercialDataClassificationRequestHash(request);
    const commercialDataClassificationDecisionId = randomUUID();
    const commercialDataClassificationDecisionReference =
      this.computeCommercialDataClassificationDecisionReference(
        request,
        commercialDataClassificationRequestHash,
      );
    const explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialGovernanceEngineRuleKindV1,
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
      'A6T10_DATA_CLASSIFICATION' as B1CommercialGovernanceEngineRuleKindV1,
      'A6T10_DATA_CLASSIFICATION_RULE',
      'A6T10 data classification rule',
      'PASS',
      'A6T10_DATA_CLASSIFICATION_OK',
      'A6T10 data classification passed',
      { classificationLevel: request.commercialClassificationLevel },
      { classificationLevel: request.commercialClassificationLevel },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A6T10_DATA_MINIMIZATION' as B1CommercialGovernanceEngineRuleKindV1,
      'A6T10_DATA_MINIMIZATION_RULE',
      'A6T10 data minimization rule',
      'PASS',
      'A6T10_DATA_MINIMIZATION_OK',
      'A6T10 data minimization passed',
      { sourceMutation: false, autoRepair: false },
      { sourceMutation: false, autoRepair: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_CATALOG_LOOKUP' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_DECISION_LOOKUP' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_READ_ONLY_TRANSACTION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_READ_ONLY_TRANSACTION_RULE',
      'B1 commercial-governance engine read-only transaction rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_READ_ONLY_TRANSACTION_OK',
      'B1 commercial-governance engine read-only transaction passed',
      { transactionMode: 'REPEATABLE READ', writeLock: false },
      { transactionMode: 'REPEATABLE READ', writeLock: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_AUTO_REPAIR' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_AUTO_REPAIR_RULE',
      'B1 commercial-governance engine no auto-repair rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_AUTO_REPAIR_OK',
      'B1 commercial-governance engine no auto-repair passed',
      { autoRepair: false, sourceMutation: false },
      { autoRepair: false, sourceMutation: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_NOTIFICATION_DISPATCH' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_NOTIFICATION_DISPATCH_RULE',
      'B1 commercial-governance engine no notification dispatch rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_NOTIFICATION_DISPATCH_OK',
      'B1 commercial-governance engine no notification dispatch passed',
      { notificationDispatch: false },
      { notificationDispatch: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_CLASSIFICATION_MUTATION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_CLASSIFICATION_MUTATION_RULE',
      'B1 commercial-governance engine no classification mutation rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_CLASSIFICATION_MUTATION_OK',
      'B1 commercial-governance engine no classification mutation passed',
      { classificationMutation: false },
      { classificationMutation: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-governance engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-governance engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-governance engine document version rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-governance engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_CLASSIFICATION',
      request.commercialDecisionReference,
      'B1 commercial classification',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_CLASSIFICATION_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_DISCLOSURE',
      request.commercialDecisionReference,
      'B1 commercial disclosure',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DISCLOSURE_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_SENSITIVITY',
      request.commercialDecisionReference,
      'B1 commercial sensitivity',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_SENSITIVITY_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_RETENTION',
      request.commercialDecisionReference,
      'B1 commercial retention',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_RETENTION_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_EXPORT_RULES',
      request.commercialDecisionReference,
      'B1 commercial export rules',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_EXPORT_RULES_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialGovernanceEngineEligibility[] = [
      'CLASSIFICATION_AVAILABLE',
      'DISCLOSURE_AVAILABLE',
      'SENSITIVITY_AVAILABLE',
      'RETENTION_AVAILABLE',
      'EXPORT_AVAILABLE',
      'IDEMPOTENCY_AVAILABLE',
      'AUDIT_AVAILABLE',
      'APPROVAL_AVAILABLE',
      'FEATURE_FLAG_AVAILABLE',
      'REPLAY_AVAILABLE',
    ];
    const commercialDataClassificationDecisionOutcome: B1CommercialDataClassificationDecisionV1['commercialDataClassificationDecisionOutcome'] =
      'CLASSIFIED';
    const explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_DATA_CLASSIFICATION_DECISION',
      traceSummary: `B1 commercial-governance commercial-data-classification decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialGovernanceEngineRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialDataClassificationDecisionId,
      auditAction: 'B1_COMMERCIAL_DATA_CLASSIFICATION_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialDataClassificationDecisionHashPayload = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialDataClassificationDecisionReference,
      commercialDataClassificationDecisionVersion: 1,
      commercialDataClassificationDecisionState: 'CLASSIFIED' as const,
      commercialDataClassificationDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialClassificationLevel: request.commercialClassificationLevel,
      commercialSensitivity: request.commercialSensitivity,
      commercialDisclosureLevel: request.commercialDisclosureLevel,
      commercialRetentionClass: request.commercialRetentionClass,
      commercialExportRule: request.commercialExportRule,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
    };
    const commercialDataClassificationDecisionHash = this.computeGovernanceDecisionHash(
      commercialDataClassificationDecisionHashPayload,
    );
    const commercialDataClassificationDecisionReplayHash = this.computeGovernanceReplayHash({
      decisionHash: commercialDataClassificationDecisionHash,
      requestHash: commercialDataClassificationRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialDataClassificationDecisionId,
      commercialDataClassificationDecisionReference,
      commercialDataClassificationDecisionVersion: 1,
      commercialDataClassificationDecisionState: 'CLASSIFIED',
      commercialDataClassificationDecisionOutcome,
      commercialDataClassificationDecisionHash,
      commercialDataClassificationDecisionReplayHash,
      commercialDataClassificationRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialClassificationLevel: request.commercialClassificationLevel,
      commercialSensitivity: request.commercialSensitivity,
      commercialDisclosureLevel: request.commercialDisclosureLevel,
      commercialRetentionClass: request.commercialRetentionClass,
      commercialExportRule: request.commercialExportRule,
      commercialDataClassificationEligible: true,
      commercialDataClassificationApplicable: true,
      commercialDataClassificationSummary: [request.commercialClassificationLevel],
      commercialDisclosureSummary: [request.commercialDisclosureLevel],
      commercialSensitivitySummary: [request.commercialSensitivity],
      commercialRetentionSummary: [request.commercialRetentionClass],
      commercialExportRuleSummary: [request.commercialExportRule],
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
      commercialDataClassificationStartAt: request.commercialDataClassificationStartAt,
      commercialDataClassificationEndAt: request.commercialDataClassificationEndAt,
      commercialDataClassificationEffectiveAt: request.periodEffectiveAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope:
        B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
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

  generateCommercialIdempotencyDecision(
    request: B1CommercialIdempotencyRequestV1,
  ): B1CommercialIdempotencyDecisionV1 {
    const shapeFailure = this.validateCommercialIdempotencyRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialIdempotencyDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialIdempotencyRequestHash = this.computeCommercialIdempotencyRequestHash(request);
    const commercialIdempotencyDecisionId = randomUUID();
    const commercialIdempotencyDecisionReference =
      this.computeCommercialIdempotencyDecisionReference(request, commercialIdempotencyRequestHash);
    const explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICY' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICY_RULE',
      'B1 commercial-governance engine commercial replay policy rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICY_OK',
      'B1 commercial-governance engine commercial replay policy passed',
      { replayPolicy: request.commercialReplayPolicy },
      { replayPolicy: request.commercialReplayPolicy },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITY' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITY_RULE',
      'B1 commercial-governance engine commercial replay eligibility rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITY_OK',
      'B1 commercial-governance engine commercial replay eligibility passed',
      { replayEligibility: 'COMMERCIAL_REPLAY_ELIGIBLE' },
      { replayEligibility: 'COMMERCIAL_REPLAY_ELIGIBLE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_VALIDATION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_VALIDATION_RULE',
      'B1 commercial-governance engine commercial idempotency validation rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_VALIDATION_OK',
      'B1 commercial-governance engine commercial idempotency validation passed',
      { idempotencyScope: request.commercialIdempotencyScope },
      { idempotencyScope: request.commercialIdempotencyScope },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-governance engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-governance engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-governance engine document version rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-governance engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_IDEMPOTENCY',
      request.commercialDecisionReference,
      'B1 commercial idempotency',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_CONTRACT_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_REPLAY_POLICY',
      request.commercialDecisionReference,
      'B1 commercial replay policy',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICY_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_REPLAY_EVIDENCE',
      request.commercialDecisionReference,
      'B1 commercial replay evidence',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REQUEST_REPLAY_EVIDENCE_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialGovernanceEngineEligibility[] = [
      'IDEMPOTENCY_AVAILABLE',
      'REPLAY_AVAILABLE',
      'AUDIT_AVAILABLE',
    ];
    const commercialIdempotencyDecisionOutcome: B1CommercialIdempotencyDecisionV1['commercialIdempotencyDecisionOutcome'] =
      'AVAILABLE';
    const explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_IDEMPOTENCY_DECISION',
      traceSummary: `B1 commercial-governance commercial-idempotency decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialGovernanceEngineRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialIdempotencyDecisionId,
      auditAction: 'B1_COMMERCIAL_IDEMPOTENCY_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialIdempotencyDecisionHashPayload = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialIdempotencyDecisionReference,
      commercialIdempotencyDecisionVersion: 1,
      commercialIdempotencyDecisionState: 'RESERVED' as const,
      commercialIdempotencyDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialIdempotencyScope: request.commercialIdempotencyScope,
      commercialIdempotencyKey: request.commercialIdempotencyKey,
      commercialReplayPolicy: request.commercialReplayPolicy,
      commercialReplayWindowSeconds: request.commercialReplayWindowSeconds,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
    };
    const commercialIdempotencyDecisionHash = this.computeGovernanceDecisionHash(
      commercialIdempotencyDecisionHashPayload,
    );
    const commercialIdempotencyDecisionReplayHash = this.computeGovernanceReplayHash({
      decisionHash: commercialIdempotencyDecisionHash,
      requestHash: commercialIdempotencyRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialIdempotencyDecisionId,
      commercialIdempotencyDecisionReference,
      commercialIdempotencyDecisionVersion: 1,
      commercialIdempotencyDecisionState: 'RESERVED',
      commercialIdempotencyDecisionOutcome,
      commercialIdempotencyDecisionHash,
      commercialIdempotencyDecisionReplayHash,
      commercialIdempotencyRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialIdempotencyScope: request.commercialIdempotencyScope,
      commercialIdempotencyKey: request.commercialIdempotencyKey,
      commercialReplayPolicy: request.commercialReplayPolicy,
      commercialReplayEligibility: 'COMMERCIAL_REPLAY_ELIGIBLE',
      commercialReplayWindowSeconds: request.commercialReplayWindowSeconds,
      commercialIdempotencyEligible: true,
      commercialIdempotencyApplicable: true,
      commercialIdempotencyContractSummary: [request.commercialIdempotencyScope],
      commercialReplayPolicySummary: [request.commercialReplayPolicy],
      commercialReplayEligibilitySummary: ['COMMERCIAL_REPLAY_ELIGIBLE'],
      commercialIdempotencyValidationSummary: [request.commercialIdempotencyKey],
      commercialRequestReplayEvidenceSummary: [request.commercialIdempotencyScope],
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
      commercialIdempotencyStartAt: request.commercialIdempotencyStartAt,
      commercialIdempotencyEndAt: request.commercialIdempotencyEndAt,
      commercialIdempotencyEffectiveAt: request.periodEffectiveAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScopeRef: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
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

  generateCommercialAuditDecision(
    request: B1CommercialAuditRequestV1,
  ): B1CommercialAuditDecisionV1 {
    const shapeFailure = this.validateCommercialAuditRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialAuditDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialAuditRequestHash = this.computeCommercialAuditRequestHash(request);
    const commercialAuditDecisionId = randomUUID();
    const commercialAuditDecisionReference = this.computeCommercialAuditDecisionReference(
      request,
      commercialAuditRequestHash,
    );
    const explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVIDENCE' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVIDENCE_RULE',
      'B1 commercial-governance engine commercial audit evidence rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVIDENCE_OK',
      'B1 commercial-governance engine commercial audit evidence passed',
      { auditEvent: request.commercialAuditEvent },
      { auditEvent: request.commercialAuditEvent },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_CORRELATION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_CORRELATION_RULE',
      'B1 commercial-governance engine commercial audit correlation rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_CORRELATION_OK',
      'B1 commercial-governance engine commercial audit correlation passed',
      { auditCorrelationId: request.requestContext.correlationId },
      { auditCorrelationId: request.requestContext.correlationId },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ACTOR_MAPPING' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ACTOR_MAPPING_RULE',
      'B1 commercial-governance engine commercial audit actor mapping rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ACTOR_MAPPING_OK',
      'B1 commercial-governance engine commercial audit actor mapping passed',
      { auditActor: request.commercialAuditActor },
      { auditActor: request.commercialAuditActor },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ENTITY_MAPPING' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ENTITY_MAPPING_RULE',
      'B1 commercial-governance engine commercial audit entity mapping rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ENTITY_MAPPING_OK',
      'B1 commercial-governance engine commercial audit entity mapping passed',
      { auditEntityType: request.commercialAuditEntityType },
      { auditEntityType: request.commercialAuditEntityType },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-governance engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-governance engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-governance engine document version rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-governance engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_AUDIT_EVIDENCE',
      request.commercialDecisionReference,
      'B1 commercial audit evidence',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVIDENCE_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_AUDIT_CORRELATION',
      request.commercialDecisionReference,
      'B1 commercial audit correlation',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_CORRELATION_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_AUDIT_ACTOR_MAPPING',
      request.commercialDecisionReference,
      'B1 commercial audit actor mapping',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ACTOR_MAPPING_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_AUDIT_ENTITY_MAPPING',
      request.commercialDecisionReference,
      'B1 commercial audit entity mapping',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ENTITY_MAPPING_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_AUDIT_EVENT',
      request.commercialDecisionReference,
      'B1 commercial audit event',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVENT_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialGovernanceEngineEligibility[] = [
      'AUDIT_AVAILABLE',
      'CLASSIFICATION_AVAILABLE',
      'APPROVAL_AVAILABLE',
    ];
    const commercialAuditDecisionOutcome: B1CommercialAuditDecisionV1['commercialAuditDecisionOutcome'] =
      'AUDITED';
    const commercialAuditCorrelationId = request.requestContext.correlationId;
    const explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_AUDIT_DECISION',
      traceSummary: `B1 commercial-governance commercial-audit decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialGovernanceEngineRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1 = {
      auditEntityType: request.commercialAuditEntityType,
      auditEntityId: request.commercialAuditEntityId,
      auditAction: request.commercialAuditEvent,
      auditActor: request.commercialAuditActor,
      auditCorrelationId: commercialAuditCorrelationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: true,
    };
    const commercialAuditDecisionHashPayload = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialAuditDecisionReference,
      commercialAuditDecisionVersion: 1,
      commercialAuditDecisionState: 'RECORDED' as const,
      commercialAuditDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialAuditEvent: request.commercialAuditEvent,
      commercialAuditActor: request.commercialAuditActor,
      commercialAuditEntityType: request.commercialAuditEntityType,
      commercialAuditEntityId: request.commercialAuditEntityId,
      commercialAuditCorrelationId,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
    };
    const commercialAuditDecisionHash = this.computeGovernanceDecisionHash(
      commercialAuditDecisionHashPayload,
    );
    const commercialAuditDecisionReplayHash = this.computeGovernanceReplayHash({
      decisionHash: commercialAuditDecisionHash,
      requestHash: commercialAuditRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialAuditDecisionId,
      commercialAuditDecisionReference,
      commercialAuditDecisionVersion: 1,
      commercialAuditDecisionState: 'RECORDED',
      commercialAuditDecisionOutcome,
      commercialAuditDecisionHash,
      commercialAuditDecisionReplayHash,
      commercialAuditRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialAuditEvent: request.commercialAuditEvent,
      commercialAuditActor: request.commercialAuditActor,
      commercialAuditEntityType: request.commercialAuditEntityType,
      commercialAuditCorrelationId,
      commercialAuditEntityId: request.commercialAuditEntityId,
      commercialAuditEligible: true,
      commercialAuditApplicable: true,
      commercialAuditEvidenceSummary: [request.commercialAuditEntityId],
      commercialAuditCorrelationSummary: [commercialAuditCorrelationId],
      commercialAuditActorMappingSummary: [request.commercialAuditActor],
      commercialAuditEntityMappingSummary: [request.commercialAuditEntityType],
      commercialAuditEventSummary: [request.commercialAuditEvent],
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
      commercialAuditStartAt: request.commercialAuditStartAt,
      commercialAuditEndAt: request.commercialAuditEndAt,
      commercialAuditEffectiveAt: request.periodEffectiveAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
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

  generateCommercialApprovalDecision(
    request: B1CommercialApprovalRequestV1,
  ): B1CommercialApprovalDecisionV1 {
    const shapeFailure = this.validateCommercialApprovalRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialApprovalDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialApprovalRequestHash = this.computeCommercialApprovalRequestHash(request);
    const commercialApprovalDecisionId = randomUUID();
    const commercialApprovalDecisionReference = this.computeCommercialApprovalDecisionReference(
      request,
      commercialApprovalRequestHash,
    );
    const explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS_RULE',
      'B1 commercial-governance engine commercial approval requirements rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS_OK',
      'B1 commercial-governance engine commercial approval requirements passed',
      { approvalRequirement: request.commercialApprovalRequirement },
      { approvalRequirement: request.commercialApprovalRequirement },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICY' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICY_RULE',
      'B1 commercial-governance engine commercial approval policy rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICY_OK',
      'B1 commercial-governance engine commercial approval policy passed',
      { approvalPolicy: request.commercialApprovalPolicy },
      { approvalPolicy: request.commercialApprovalPolicy },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_APPROVAL_EXECUTION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_APPROVAL_EXECUTION_RULE',
      'B1 commercial-governance engine no approval execution rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_APPROVAL_EXECUTION_OK',
      'B1 commercial-governance engine no approval execution passed',
      { approvalExecution: false },
      { approvalExecution: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-governance engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-governance engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-governance engine document version rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-governance engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_APPROVAL_REQUIREMENTS',
      request.commercialDecisionReference,
      'B1 commercial approval requirements',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_APPROVAL_POLICY',
      request.commercialDecisionReference,
      'B1 commercial approval policy',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICY_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_APPROVAL_EVIDENCE',
      request.commercialDecisionReference,
      'B1 commercial approval evidence',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_EVIDENCE_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_APPROVAL_TRACE',
      request.commercialDecisionReference,
      'B1 commercial approval trace',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_TRACE_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_APPROVAL_DECISION',
      request.commercialDecisionReference,
      'B1 commercial approval decision',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_DECISION_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialGovernanceEngineEligibility[] = [
      'APPROVAL_AVAILABLE',
      'AUDIT_AVAILABLE',
      'CLASSIFICATION_AVAILABLE',
    ];
    const commercialApprovalDecisionOutcome: B1CommercialApprovalDecisionV1['commercialApprovalDecisionOutcome'] =
      request.commercialApprovalPolicy === 'COMMERCIAL_APPROVAL_POLICY_DENY'
        ? 'REJECTED'
        : 'APPROVED';
    const commercialApprovalGranted = commercialApprovalDecisionOutcome === 'APPROVED';
    const commercialApprovalDenied = commercialApprovalDecisionOutcome === 'REJECTED';
    const commercialApprovalState: B1CommercialApprovalDecisionV1['commercialApprovalDecisionState'] =
      commercialApprovalGranted ? 'GRANTED' : commercialApprovalDenied ? 'DENIED' : 'PENDING';
    const explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_APPROVAL_DECISION',
      traceSummary: `B1 commercial-governance commercial-approval decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialGovernanceEngineRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialApprovalDecisionId,
      auditAction: 'B1_COMMERCIAL_APPROVAL_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialApprovalDecisionHashPayload = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialApprovalDecisionReference,
      commercialApprovalDecisionVersion: 1,
      commercialApprovalDecisionState: commercialApprovalState,
      commercialApprovalDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialApprovalRequirement: request.commercialApprovalRequirement,
      commercialApprovalPolicy: request.commercialApprovalPolicy,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
    };
    const commercialApprovalDecisionHash = this.computeGovernanceDecisionHash(
      commercialApprovalDecisionHashPayload,
    );
    const commercialApprovalDecisionReplayHash = this.computeGovernanceReplayHash({
      decisionHash: commercialApprovalDecisionHash,
      requestHash: commercialApprovalRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialApprovalDecisionId,
      commercialApprovalDecisionReference,
      commercialApprovalDecisionVersion: 1,
      commercialApprovalDecisionState: commercialApprovalState,
      commercialApprovalDecisionOutcome,
      commercialApprovalDecisionHash,
      commercialApprovalDecisionReplayHash,
      commercialApprovalRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialApprovalRequirement: request.commercialApprovalRequirement,
      commercialApprovalPolicy: request.commercialApprovalPolicy,
      commercialApprovalEligible: true,
      commercialApprovalApplicable: true,
      commercialApprovalGranted,
      commercialApprovalDenied,
      commercialApprovalRequirementsSummary: [request.commercialApprovalRequirement],
      commercialApprovalPolicySummary: [request.commercialApprovalPolicy],
      commercialApprovalEvidenceSummary: [request.commercialApprovalRequirement],
      commercialApprovalTraceSummary: [request.commercialApprovalPolicy],
      commercialApprovalDecisionSummary: [commercialApprovalDecisionOutcome],
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
      commercialApprovalStartAt: request.commercialApprovalStartAt,
      commercialApprovalEndAt: request.commercialApprovalEndAt,
      commercialApprovalEffectiveAt: request.periodEffectiveAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
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

  generateCommercialFeatureFlagDecision(
    request: B1CommercialFeatureFlagRequestV1,
  ): B1CommercialFeatureFlagDecisionV1 {
    const shapeFailure = this.validateCommercialFeatureFlagRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureCommercialFeatureFlagDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const commercialFeatureFlagRequestHash = this.computeCommercialFeatureFlagRequestHash(request);
    const commercialFeatureFlagDecisionId = randomUUID();
    const commercialFeatureFlagDecisionReference =
      this.computeCommercialFeatureFlagDecisionReference(request, commercialFeatureFlagRequestHash);
    const explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[] = [];
    const analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[] = [];

    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'A4_POLICY_LIMIT' as B1CommercialGovernanceEngineRuleKindV1,
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
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_REGISTRATION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_REGISTRATION_RULE',
      'B1 commercial-governance engine commercial feature registration rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_REGISTRATION_OK',
      'B1 commercial-governance engine commercial feature registration passed',
      { featureFlagKey: request.commercialFeatureFlagKey },
      { featureFlagKey: request.commercialFeatureFlagKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_STATE' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_STATE_RULE',
      'B1 commercial-governance engine commercial rollout state rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_STATE_OK',
      'B1 commercial-governance engine commercial rollout state passed',
      { rolloutState: request.commercialFeatureFlagRolloutState },
      { rolloutState: request.commercialFeatureFlagRolloutState },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ENABLEMENT_RULES' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ENABLEMENT_RULES_RULE',
      'B1 commercial-governance engine commercial enablement rules rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ENABLEMENT_RULES_OK',
      'B1 commercial-governance engine commercial enablement rules passed',
      { enablementRulesApplied: true },
      { enablementRulesApplied: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DEPENDENCY_RULES' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DEPENDENCY_RULES_RULE',
      'B1 commercial-governance engine commercial dependency rules rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DEPENDENCY_RULES_OK',
      'B1 commercial-governance engine commercial dependency rules passed',
      { dependencyRulesApplied: true },
      { dependencyRulesApplied: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESS' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESS_RULE',
      'B1 commercial-governance engine commercial activation readiness rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESS_OK',
      'B1 commercial-governance engine commercial activation readiness passed',
      { activationReadiness: request.commercialFeatureFlagActivationReadiness },
      { activationReadiness: request.commercialFeatureFlagActivationReadiness },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_FEATURE_ENABLEMENT' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_FEATURE_ENABLEMENT_RULE',
      'B1 commercial-governance engine no feature enablement rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_FEATURE_ENABLEMENT_OK',
      'B1 commercial-governance engine no feature enablement passed',
      { featureEnablement: false },
      { featureEnablement: false },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 commercial-governance engine number deterministic rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 commercial-governance engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION' as B1CommercialGovernanceEngineRuleKindV1,
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 commercial-governance engine document version rule',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION_OK',
      'B1 commercial-governance engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );

    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_FEATURE_REGISTRATION',
      request.commercialDecisionReference,
      'B1 commercial feature registration',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_REGISTRATION_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_ROLLOUT_STATE',
      request.commercialDecisionReference,
      'B1 commercial rollout state',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_STATE_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_ENABLEMENT_RULES',
      request.commercialDecisionReference,
      'B1 commercial enablement rules',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ENABLEMENT_RULES_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_DEPENDENCY_RULES',
      request.commercialDecisionReference,
      'B1 commercial dependency rules',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DEPENDENCY_RULES_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_ACTIVATION_READINESS',
      request.commercialDecisionReference,
      'B1 commercial activation readiness',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESS_OK',
      '0',
      new Date().toISOString(),
    );
    this.appendAnalyticsStep(
      analyticsSteps,
      'COMMERCIAL_ROLLOUT_EVIDENCE',
      request.commercialDecisionReference,
      'B1 commercial rollout evidence',
      'PASS',
      'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_EVIDENCE_OK',
      '0',
      new Date().toISOString(),
    );

    const eligibilitySummary: B1CommercialGovernanceEngineEligibility[] = [
      'FEATURE_FLAG_AVAILABLE',
      'APPROVAL_AVAILABLE',
      'AUDIT_AVAILABLE',
    ];
    const commercialFeatureFlagEnabled =
      request.commercialFeatureFlagActivationReadiness === 'COMMERCIAL_ACTIVATION_READY' &&
      request.commercialFeatureFlagRolloutState === 'COMMERCIAL_FEATURE_FLAG_ENABLED';
    const commercialFeatureFlagDecisionOutcome: B1CommercialFeatureFlagDecisionV1['commercialFeatureFlagDecisionOutcome'] =
      commercialFeatureFlagEnabled
        ? 'ROLLED_OUT'
        : request.commercialFeatureFlagRolloutState === 'COMMERCIAL_FEATURE_FLAG_DISABLED'
          ? 'DISCREPANCY'
          : 'AVAILABLE';
    const commercialFeatureFlagState: B1CommercialFeatureFlagDecisionV1['commercialFeatureFlagDecisionState'] =
      commercialFeatureFlagEnabled
        ? 'ENABLED'
        : request.commercialFeatureFlagRolloutState === 'COMMERCIAL_FEATURE_FLAG_DISABLED'
          ? 'DISABLED'
          : 'REGISTERED';
    const explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'COMMERCIAL_FEATURE_FLAG_DECISION',
      traceSummary: `B1 commercial-governance commercial-feature-flag decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialGovernanceEngineRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1 = {
      analyticsTraceId: randomUUID(),
      analyticsSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1 = {
      auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: commercialFeatureFlagDecisionId,
      auditAction: 'B1_COMMERCIAL_FEATURE_FLAG_DECISION_DECIDED',
      auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const commercialFeatureFlagDecisionHashPayload = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialFeatureFlagDecisionReference,
      commercialFeatureFlagDecisionVersion: 1,
      commercialFeatureFlagDecisionState: commercialFeatureFlagState,
      commercialFeatureFlagDecisionOutcome,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialFeatureFlagKey: request.commercialFeatureFlagKey,
      commercialFeatureFlagRolloutState: request.commercialFeatureFlagRolloutState,
      commercialFeatureFlagActivationReadiness: request.commercialFeatureFlagActivationReadiness,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
    };
    const commercialFeatureFlagDecisionHash = this.computeGovernanceDecisionHash(
      commercialFeatureFlagDecisionHashPayload,
    );
    const commercialFeatureFlagDecisionReplayHash = this.computeGovernanceReplayHash({
      decisionHash: commercialFeatureFlagDecisionHash,
      requestHash: commercialFeatureFlagRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialFeatureFlagDecisionId,
      commercialFeatureFlagDecisionReference,
      commercialFeatureFlagDecisionVersion: 1,
      commercialFeatureFlagDecisionState: commercialFeatureFlagState,
      commercialFeatureFlagDecisionOutcome,
      commercialFeatureFlagDecisionHash,
      commercialFeatureFlagDecisionReplayHash,
      commercialFeatureFlagRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      commercialFeatureFlagKey: request.commercialFeatureFlagKey,
      commercialFeatureFlagVersion: 1,
      commercialFeatureFlagRolloutState: request.commercialFeatureFlagRolloutState,
      commercialFeatureFlagActivationReadiness: request.commercialFeatureFlagActivationReadiness,
      commercialFeatureFlagEnabled,
      commercialFeatureFlagApplicable: true,
      commercialFeatureRegistrationSummary: [request.commercialFeatureFlagKey],
      commercialRolloutStateSummary: [request.commercialFeatureFlagRolloutState],
      commercialEnablementRulesSummary: [request.commercialFeatureFlagActivationReadiness],
      commercialDependencyRulesSummary: [request.commercialFeatureFlagKey],
      commercialActivationReadinessSummary: [request.commercialFeatureFlagActivationReadiness],
      commercialRolloutEvidenceSummary: [request.commercialFeatureFlagRolloutState],
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
      commercialFeatureFlagStartAt: request.commercialFeatureFlagStartAt,
      commercialFeatureFlagEndAt: request.commercialFeatureFlagEndAt,
      commercialFeatureFlagEffectiveAt: request.periodEffectiveAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      explanationTrace,
      ruleTrace,
      analyticsTrace,
      auditEvidence,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
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

  async replaySafeGenerateCommercialDataClassificationDecision(
    request: B1CommercialDataClassificationRequestV1,
  ): Promise<B1CommercialDataClassificationDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialDataClassification(request);
  }

  async replaySafeGenerateCommercialIdempotencyDecision(
    request: B1CommercialIdempotencyRequestV1,
  ): Promise<B1CommercialIdempotencyDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialIdempotency(request);
  }

  async replaySafeGenerateCommercialAuditDecision(
    request: B1CommercialAuditRequestV1,
  ): Promise<B1CommercialAuditDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialAudit(request);
  }

  async replaySafeGenerateCommercialApprovalDecision(
    request: B1CommercialApprovalRequestV1,
  ): Promise<B1CommercialApprovalDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialApproval(request);
  }

  async replaySafeGenerateCommercialFeatureFlagDecision(
    request: B1CommercialFeatureFlagRequestV1,
  ): Promise<B1CommercialFeatureFlagDecisionReplaySafeResultV1> {
    return this.replaySafeCommercialFeatureFlag(request);
  }

  compatibilityCheck(
    request:
      | B1CommercialDataClassificationRequestV1
      | B1CommercialIdempotencyRequestV1
      | B1CommercialAuditRequestV1
      | B1CommercialApprovalRequestV1
      | B1CommercialFeatureFlagRequestV1,
  ): B1CommercialGovernanceEngineCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 commercial-governance engine request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (
      request.productVersion !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION
    ) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (
      B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)
    ) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INCOMPATIBLE,
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

  private async replaySafeCommercialDataClassification(
    request: B1CommercialDataClassificationRequestV1,
  ): Promise<B1CommercialDataClassificationDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialDataClassificationRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialDataClassificationDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialDataClassificationFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialDataClassificationRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialDataClassificationDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope:
            B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialDataClassificationRequestHash:
            originalRecord.commercialDataClassificationRequestHash,
          commercialDataClassificationDecisionHash:
            originalRecord.commercialDataClassificationDecisionHash,
          commercialDataClassificationDecisionReplayHash:
            originalRecord.commercialDataClassificationDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialDataClassificationDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-governance engine replay-safe generate commercial-data-classification decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialDataClassificationFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialDataClassificationDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope:
          B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialDataClassificationRequestHash: record.commercialDataClassificationRequestHash,
        commercialDataClassificationDecisionHash: record.commercialDataClassificationDecisionHash,
        commercialDataClassificationDecisionReplayHash:
          record.commercialDataClassificationDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialDataClassificationDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-governance engine replay-safe generate commercial-data-classification decision conflict: ${message}`,
        );
        return this.buildReplayCommercialDataClassificationFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialDataClassificationDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-governance engine replay-safe generate commercial-data-classification decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialDataClassificationFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCommercialIdempotency(
    request: B1CommercialIdempotencyRequestV1,
  ): Promise<B1CommercialIdempotencyDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialIdempotencyRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialIdempotencyDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialIdempotencyFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialIdempotencyRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialIdempotencyDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope:
            B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialIdempotencyRequestHash: originalRecord.commercialIdempotencyRequestHash,
          commercialIdempotencyDecisionHash: originalRecord.commercialIdempotencyDecisionHash,
          commercialIdempotencyDecisionReplayHash:
            originalRecord.commercialIdempotencyDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialIdempotencyDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-governance engine replay-safe generate commercial-idempotency decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialIdempotencyFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialIdempotencyDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialIdempotencyRequestHash: record.commercialIdempotencyRequestHash,
        commercialIdempotencyDecisionHash: record.commercialIdempotencyDecisionHash,
        commercialIdempotencyDecisionReplayHash: record.commercialIdempotencyDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialIdempotencyDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-governance engine replay-safe generate commercial-idempotency decision conflict: ${message}`,
        );
        return this.buildReplayCommercialIdempotencyFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialIdempotencyDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-governance engine replay-safe generate commercial-idempotency decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialIdempotencyFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCommercialAudit(
    request: B1CommercialAuditRequestV1,
  ): Promise<B1CommercialAuditDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialAuditRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialAuditDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialAuditFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialAuditRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialAuditDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialAuditRequestHash: originalRecord.commercialAuditRequestHash,
          commercialAuditDecisionHash: originalRecord.commercialAuditDecisionHash,
          commercialAuditDecisionReplayHash: originalRecord.commercialAuditDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialAuditDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-governance engine replay-safe generate commercial-audit decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialAuditFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialAuditDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialAuditRequestHash: record.commercialAuditRequestHash,
        commercialAuditDecisionHash: record.commercialAuditDecisionHash,
        commercialAuditDecisionReplayHash: record.commercialAuditDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialAuditDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-governance engine replay-safe generate commercial-audit decision conflict: ${message}`,
        );
        return this.buildReplayCommercialAuditFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialAuditDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-governance engine replay-safe generate commercial-audit decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialAuditFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCommercialApproval(
    request: B1CommercialApprovalRequestV1,
  ): Promise<B1CommercialApprovalDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialApprovalRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialApprovalDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialApprovalFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialApprovalRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialApprovalDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialApprovalRequestHash: originalRecord.commercialApprovalRequestHash,
          commercialApprovalDecisionHash: originalRecord.commercialApprovalDecisionHash,
          commercialApprovalDecisionReplayHash: originalRecord.commercialApprovalDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialApprovalDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-governance engine replay-safe generate commercial-approval decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialApprovalFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialApprovalDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialApprovalRequestHash: record.commercialApprovalRequestHash,
        commercialApprovalDecisionHash: record.commercialApprovalDecisionHash,
        commercialApprovalDecisionReplayHash: record.commercialApprovalDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialApprovalDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-governance engine replay-safe generate commercial-approval decision conflict: ${message}`,
        );
        return this.buildReplayCommercialApprovalFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialApprovalDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-governance engine replay-safe generate commercial-approval decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialApprovalFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeCommercialFeatureFlag(
    request: B1CommercialFeatureFlagRequestV1,
  ): Promise<B1CommercialFeatureFlagDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateCommercialFeatureFlagRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureCommercialFeatureFlagDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayCommercialFeatureFlagFailure(
        request,
        failureRecord,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeCommercialFeatureFlagRequestHash(request),
        retentionSeconds: B1_COMMERCIAL_GOVERNANCE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateCommercialFeatureFlagDecision(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope:
            B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          commercialFeatureFlagRequestHash: originalRecord.commercialFeatureFlagRequestHash,
          commercialFeatureFlagDecisionHash: originalRecord.commercialFeatureFlagDecisionHash,
          commercialFeatureFlagDecisionReplayHash:
            originalRecord.commercialFeatureFlagDecisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureCommercialFeatureFlagDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_IN_PROGRESS,
          'B1 commercial-governance engine replay-safe generate commercial-feature-flag decision is in progress for the same idempotency key',
        );
        return this.buildReplayCommercialFeatureFlagFailure(
          request,
          failureRecord,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.generateCommercialFeatureFlagDecision(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        commercialFeatureFlagRequestHash: record.commercialFeatureFlagRequestHash,
        commercialFeatureFlagDecisionHash: record.commercialFeatureFlagDecisionHash,
        commercialFeatureFlagDecisionReplayHash: record.commercialFeatureFlagDecisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureCommercialFeatureFlagDecision(
          request,
          B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 commercial-governance engine replay-safe generate commercial-feature-flag decision conflict: ${message}`,
        );
        return this.buildReplayCommercialFeatureFlagFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureCommercialFeatureFlagDecision(
        request,
        B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 commercial-governance engine replay-safe generate commercial-feature-flag decision query unavailable: ${message}`,
      );
      return this.buildReplayCommercialFeatureFlagFailure(
        request,
        failureRecord,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendRule(
    explanationSteps: B1CommercialGovernanceEngineExplanationStepV1[],
    ruleTraceSteps: B1CommercialGovernanceEngineRuleTraceStepV1[],
    ruleKind: B1CommercialGovernanceEngineRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1CommercialGovernanceEngineRuleOutcomeV1,
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
    analyticsSteps: B1CommercialGovernanceEngineAnalyticsStepV1[],
    stepKind: B1CommercialGovernanceEngineAnalyticsStepV1['stepKind'],
    stepReference: string,
    stepLabel: string,
    stepOutcome: B1CommercialGovernanceEngineRuleOutcomeV1,
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

  private computeCommercialDataClassificationRequestHash(
    request: B1CommercialDataClassificationRequestV1,
  ): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialDataClassificationRequestId: request.commercialDataClassificationRequestId,
      commercialDataClassificationRequestVersion:
        request.commercialDataClassificationRequestVersion,
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
      commercialClassificationLevel: request.commercialClassificationLevel,
      commercialSensitivity: request.commercialSensitivity,
      commercialDisclosureLevel: request.commercialDisclosureLevel,
      commercialRetentionClass: request.commercialRetentionClass,
      commercialExportRule: request.commercialExportRule,
      commercialDataClassificationStartAt: request.commercialDataClassificationStartAt,
      commercialDataClassificationEndAt: request.commercialDataClassificationEndAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialIdempotencyRequestHash(
    request: B1CommercialIdempotencyRequestV1,
  ): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialIdempotencyRequestId: request.commercialIdempotencyRequestId,
      commercialIdempotencyRequestVersion: request.commercialIdempotencyRequestVersion,
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
      commercialIdempotencyScope: request.commercialIdempotencyScope,
      commercialIdempotencyKey: request.commercialIdempotencyKey,
      commercialReplayPolicy: request.commercialReplayPolicy,
      commercialReplayWindowSeconds: request.commercialReplayWindowSeconds,
      commercialIdempotencyStartAt: request.commercialIdempotencyStartAt,
      commercialIdempotencyEndAt: request.commercialIdempotencyEndAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialAuditRequestHash(request: B1CommercialAuditRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialAuditRequestId: request.commercialAuditRequestId,
      commercialAuditRequestVersion: request.commercialAuditRequestVersion,
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
      commercialAuditEvent: request.commercialAuditEvent,
      commercialAuditActor: request.commercialAuditActor,
      commercialAuditEntityType: request.commercialAuditEntityType,
      commercialAuditEntityId: request.commercialAuditEntityId,
      commercialAuditStartAt: request.commercialAuditStartAt,
      commercialAuditEndAt: request.commercialAuditEndAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialApprovalRequestHash(request: B1CommercialApprovalRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialApprovalRequestId: request.commercialApprovalRequestId,
      commercialApprovalRequestVersion: request.commercialApprovalRequestVersion,
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
      commercialApprovalRequirement: request.commercialApprovalRequirement,
      commercialApprovalPolicy: request.commercialApprovalPolicy,
      commercialApprovalStartAt: request.commercialApprovalStartAt,
      commercialApprovalEndAt: request.commercialApprovalEndAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialFeatureFlagRequestHash(
    request: B1CommercialFeatureFlagRequestV1,
  ): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      commercialFeatureFlagRequestId: request.commercialFeatureFlagRequestId,
      commercialFeatureFlagRequestVersion: request.commercialFeatureFlagRequestVersion,
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
      commercialFeatureFlagKey: request.commercialFeatureFlagKey,
      commercialFeatureFlagRolloutState: request.commercialFeatureFlagRolloutState,
      commercialFeatureFlagActivationReadiness: request.commercialFeatureFlagActivationReadiness,
      commercialFeatureFlagStartAt: request.commercialFeatureFlagStartAt,
      commercialFeatureFlagEndAt: request.commercialFeatureFlagEndAt,
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
      commercialAnalyticsDecisionReference: request.commercialAnalyticsDecisionReference,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeCommercialDataClassificationDecisionReference(
    request: B1CommercialDataClassificationRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX}:commercial-data-classification:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialIdempotencyDecisionReference(
    request: B1CommercialIdempotencyRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX}:commercial-idempotency:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialAuditDecisionReference(
    request: B1CommercialAuditRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX}:commercial-audit:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialApprovalDecisionReference(
    request: B1CommercialApprovalRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX}:commercial-approvals:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeCommercialFeatureFlagDecisionReference(
    request: B1CommercialFeatureFlagRequestV1,
    requestHash: string,
  ): string {
    return `${B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX}:commercial-feature-flag:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeGovernanceDecisionHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeGovernanceReplayHash(input: {
    readonly decisionHash: string;
    readonly requestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      decisionHash: input.decisionHash,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateCommonRequestShape(
    contractName: string,
    contractVersion: number,
    scopeKey: string,
    scopeVersion: number,
    expectedCurrency: string,
    expectedAccountingUnit: string,
    productKey: string,
    productVersion: number,
    requestContext: { correlationId?: string } | null | undefined,
    customerId: string,
    merchantId: string,
    partnerId: string,
    capabilityKey: string,
    capabilityVersion: number,
    planKey: string,
    planVersion: number,
    idempotencyKey: string,
    commercialDecisionReference: string,
    commercialDecisionIdempotencyKey: string,
    billingDocumentReference: string,
    requestKind: string,
  ): string | null {
    if (contractName !== B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME) {
      return `The B1 commercial-governance engine ${requestKind} request contract name is invalid`;
    }
    if (contractVersion !== B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION) {
      return `The B1 commercial-governance engine ${requestKind} request contract version is invalid`;
    }
    if (scopeKey !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY) {
      return `The B1 commercial-governance engine ${requestKind} request scope key is invalid`;
    }
    if (scopeVersion !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION) {
      return `The B1 commercial-governance engine ${requestKind} request scope version is invalid`;
    }
    if (expectedCurrency !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY) {
      return `The B1 commercial-governance engine ${requestKind} request expected currency is invalid`;
    }
    if (expectedAccountingUnit !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return `The B1 commercial-governance engine ${requestKind} request expected accounting unit is invalid`;
    }
    if (productKey !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return `The B1 commercial-governance engine ${requestKind} request product key is invalid`;
    }
    if (productVersion !== B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return `The B1 commercial-governance engine ${requestKind} request product version is invalid`;
    }
    if (!customerId || !SAFE_TEXT_PATTERN.test(customerId)) {
      return `The B1 commercial-governance engine ${requestKind} request customer id is invalid`;
    }
    if (!merchantId || !SAFE_TEXT_PATTERN.test(merchantId)) {
      return `The B1 commercial-governance engine ${requestKind} request merchant id is invalid`;
    }
    if (!partnerId || !SAFE_TEXT_PATTERN.test(partnerId)) {
      return `The B1 commercial-governance engine ${requestKind} request partner id is invalid`;
    }
    if (!capabilityKey || !SAFE_TEXT_PATTERN.test(capabilityKey)) {
      return `The B1 commercial-governance engine ${requestKind} request capability key is invalid`;
    }
    if (capabilityVersion !== 1) {
      return `The B1 commercial-governance engine ${requestKind} request capability version is invalid`;
    }
    if (!planKey || !SAFE_TEXT_PATTERN.test(planKey)) {
      return `The B1 commercial-governance engine ${requestKind} request plan key is invalid`;
    }
    if (planVersion !== 1) {
      return `The B1 commercial-governance engine ${requestKind} request plan version is invalid`;
    }
    if (!idempotencyKey || !SHA256_PATTERN.test(idempotencyKey)) {
      return `The B1 commercial-governance engine ${requestKind} request idempotency key is invalid`;
    }
    if (!requestContext || !requestContext.correlationId) {
      return `The B1 commercial-governance engine ${requestKind} request request context is missing`;
    }
    if (!commercialDecisionReference || !SAFE_TEXT_PATTERN.test(commercialDecisionReference)) {
      return `The B1 commercial-governance engine ${requestKind} request commercial decision reference is invalid`;
    }
    if (
      !commercialDecisionIdempotencyKey ||
      !SHA256_PATTERN.test(commercialDecisionIdempotencyKey)
    ) {
      return `The B1 commercial-governance engine ${requestKind} request commercial decision idempotency key is invalid`;
    }
    if (!billingDocumentReference || !SAFE_TEXT_PATTERN.test(billingDocumentReference)) {
      return `The B1 commercial-governance engine ${requestKind} request billing document reference is invalid`;
    }
    return null;
  }

  private validateCommercialDataClassificationRequestShape(
    request: B1CommercialDataClassificationRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-governance engine commercial-data-classification request is missing';
    }
    if (
      !request.commercialDataClassificationRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialDataClassificationRequestId)
    ) {
      return 'The B1 commercial-governance engine commercial-data-classification request commercial data classification request id is invalid';
    }
    if (request.commercialDataClassificationRequestVersion !== 1) {
      return 'The B1 commercial-governance engine commercial-data-classification request commercial data classification request version is invalid';
    }
    return this.validateCommonRequestShape(
      request.contractName,
      request.contractVersion,
      request.scopeKey,
      request.scopeVersion,
      request.expectedCurrency,
      request.expectedAccountingUnit,
      request.productKey,
      request.productVersion,
      request.requestContext,
      request.customerId,
      request.merchantId,
      request.partnerId,
      request.capabilityKey,
      request.capabilityVersion,
      request.planKey,
      request.planVersion,
      request.idempotencyKey,
      request.commercialDecisionReference,
      request.commercialDecisionIdempotencyKey,
      request.billingDocumentReference,
      'commercial-data-classification',
    );
  }

  private validateCommercialIdempotencyRequestShape(
    request: B1CommercialIdempotencyRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-governance engine commercial-idempotency request is missing';
    }
    if (
      !request.commercialIdempotencyRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialIdempotencyRequestId)
    ) {
      return 'The B1 commercial-governance engine commercial-idempotency request commercial idempotency request id is invalid';
    }
    if (request.commercialIdempotencyRequestVersion !== 1) {
      return 'The B1 commercial-governance engine commercial-idempotency request commercial idempotency request version is invalid';
    }
    if (
      !request.commercialIdempotencyScope ||
      !SAFE_TEXT_PATTERN.test(request.commercialIdempotencyScope)
    ) {
      return 'The B1 commercial-governance engine commercial-idempotency request commercial idempotency scope is invalid';
    }
    if (
      !request.commercialIdempotencyKey ||
      !SHA256_PATTERN.test(request.commercialIdempotencyKey)
    ) {
      return 'The B1 commercial-governance engine commercial-idempotency request commercial idempotency key is invalid';
    }
    if (request.commercialReplayWindowSeconds <= 0) {
      return 'The B1 commercial-governance engine commercial-idempotency request commercial replay window seconds is invalid';
    }
    return this.validateCommonRequestShape(
      request.contractName,
      request.contractVersion,
      request.scopeKey,
      request.scopeVersion,
      request.expectedCurrency,
      request.expectedAccountingUnit,
      request.productKey,
      request.productVersion,
      request.requestContext,
      request.customerId,
      request.merchantId,
      request.partnerId,
      request.capabilityKey,
      request.capabilityVersion,
      request.planKey,
      request.planVersion,
      request.idempotencyKey,
      request.commercialDecisionReference,
      request.commercialDecisionIdempotencyKey,
      request.billingDocumentReference,
      'commercial-idempotency',
    );
  }

  private validateCommercialAuditRequestShape(request: B1CommercialAuditRequestV1): string | null {
    if (!request) {
      return 'The B1 commercial-governance engine commercial-audit request is missing';
    }
    if (
      !request.commercialAuditRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialAuditRequestId)
    ) {
      return 'The B1 commercial-governance engine commercial-audit request commercial audit request id is invalid';
    }
    if (request.commercialAuditRequestVersion !== 1) {
      return 'The B1 commercial-governance engine commercial-audit request commercial audit request version is invalid';
    }
    if (!request.commercialAuditActor || !SAFE_TEXT_PATTERN.test(request.commercialAuditActor)) {
      return 'The B1 commercial-governance engine commercial-audit request commercial audit actor is invalid';
    }
    if (
      !request.commercialAuditEntityType ||
      !SAFE_TEXT_PATTERN.test(request.commercialAuditEntityType)
    ) {
      return 'The B1 commercial-governance engine commercial-audit request commercial audit entity type is invalid';
    }
    if (
      !request.commercialAuditEntityId ||
      !SAFE_TEXT_PATTERN.test(request.commercialAuditEntityId)
    ) {
      return 'The B1 commercial-governance engine commercial-audit request commercial audit entity id is invalid';
    }
    return this.validateCommonRequestShape(
      request.contractName,
      request.contractVersion,
      request.scopeKey,
      request.scopeVersion,
      request.expectedCurrency,
      request.expectedAccountingUnit,
      request.productKey,
      request.productVersion,
      request.requestContext,
      request.customerId,
      request.merchantId,
      request.partnerId,
      request.capabilityKey,
      request.capabilityVersion,
      request.planKey,
      request.planVersion,
      request.idempotencyKey,
      request.commercialDecisionReference,
      request.commercialDecisionIdempotencyKey,
      request.billingDocumentReference,
      'commercial-audit',
    );
  }

  private validateCommercialApprovalRequestShape(
    request: B1CommercialApprovalRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-governance engine commercial-approval request is missing';
    }
    if (
      !request.commercialApprovalRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialApprovalRequestId)
    ) {
      return 'The B1 commercial-governance engine commercial-approval request commercial approval request id is invalid';
    }
    if (request.commercialApprovalRequestVersion !== 1) {
      return 'The B1 commercial-governance engine commercial-approval request commercial approval request version is invalid';
    }
    return this.validateCommonRequestShape(
      request.contractName,
      request.contractVersion,
      request.scopeKey,
      request.scopeVersion,
      request.expectedCurrency,
      request.expectedAccountingUnit,
      request.productKey,
      request.productVersion,
      request.requestContext,
      request.customerId,
      request.merchantId,
      request.partnerId,
      request.capabilityKey,
      request.capabilityVersion,
      request.planKey,
      request.planVersion,
      request.idempotencyKey,
      request.commercialDecisionReference,
      request.commercialDecisionIdempotencyKey,
      request.billingDocumentReference,
      'commercial-approval',
    );
  }

  private validateCommercialFeatureFlagRequestShape(
    request: B1CommercialFeatureFlagRequestV1,
  ): string | null {
    if (!request) {
      return 'The B1 commercial-governance engine commercial-feature-flag request is missing';
    }
    if (
      !request.commercialFeatureFlagRequestId ||
      !SAFE_TEXT_PATTERN.test(request.commercialFeatureFlagRequestId)
    ) {
      return 'The B1 commercial-governance engine commercial-feature-flag request commercial feature flag request id is invalid';
    }
    if (request.commercialFeatureFlagRequestVersion !== 1) {
      return 'The B1 commercial-governance engine commercial-feature-flag request commercial feature flag request version is invalid';
    }
    if (
      !request.commercialFeatureFlagKey ||
      !SAFE_TEXT_PATTERN.test(request.commercialFeatureFlagKey)
    ) {
      return 'The B1 commercial-governance engine commercial-feature-flag request commercial feature flag key is invalid';
    }
    return this.validateCommonRequestShape(
      request.contractName,
      request.contractVersion,
      request.scopeKey,
      request.scopeVersion,
      request.expectedCurrency,
      request.expectedAccountingUnit,
      request.productKey,
      request.productVersion,
      request.requestContext,
      request.customerId,
      request.merchantId,
      request.partnerId,
      request.capabilityKey,
      request.capabilityVersion,
      request.planKey,
      request.planVersion,
      request.idempotencyKey,
      request.commercialDecisionReference,
      request.commercialDecisionIdempotencyKey,
      request.billingDocumentReference,
      'commercial-feature-flag',
    );
  }

  private buildFailureCommercialDataClassificationDecision(
    request: B1CommercialDataClassificationRequestV1,
    code: B1CommercialGovernanceEngineFailureCodeV1,
    message: string,
  ): B1CommercialDataClassificationDecisionV1 {
    const failure: B1CommercialGovernanceEngineFailureV1 = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialDataClassificationDecisionId: 'failed',
      commercialDataClassificationDecisionReference: 'B1-COMMERCIAL-GOVERNANCE-DECISION-FAILED',
      commercialDataClassificationDecisionVersion: 1,
      commercialDataClassificationDecisionState: 'DRAFT',
      commercialDataClassificationDecisionOutcome: 'DISCREPANCY',
      commercialDataClassificationDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialDataClassificationDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialDataClassificationRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialClassificationLevel: request?.commercialClassificationLevel ?? 'INTERNAL',
      commercialSensitivity: request?.commercialSensitivity ?? 'COMMERCIAL_INTERNAL',
      commercialDisclosureLevel:
        request?.commercialDisclosureLevel ?? 'COMMERCIAL_DISCLOSURE_INTERNAL',
      commercialRetentionClass:
        request?.commercialRetentionClass ?? 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT',
      commercialExportRule: request?.commercialExportRule ?? 'COMMERCIAL_EXPORT_INTERNAL_ONLY',
      commercialDataClassificationEligible: false,
      commercialDataClassificationApplicable: false,
      commercialDataClassificationSummary: [],
      commercialDisclosureSummary: [],
      commercialSensitivitySummary: [],
      commercialRetentionSummary: [],
      commercialExportRuleSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ??
        'commercial.virtual-account.inbound-funding.commercial-data-classification',
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
      commercialDataClassificationStartAt:
        request?.commercialDataClassificationStartAt ?? new Date().toISOString(),
      commercialDataClassificationEndAt:
        request?.commercialDataClassificationEndAt ?? new Date().toISOString(),
      commercialDataClassificationEffectiveAt:
        request?.periodEffectiveAt ?? new Date().toISOString(),
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
      commercialAnalyticsDecisionReference: request?.commercialAnalyticsDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_DATA_CLASSIFICATION_DECISION',
        traceSummary: `B1 commercial-governance engine failure: ${message}`,
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
        auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_DATA_CLASSIFICATION_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope:
        B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
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

  private buildFailureCommercialIdempotencyDecision(
    request: B1CommercialIdempotencyRequestV1,
    code: B1CommercialGovernanceEngineFailureCodeV1,
    message: string,
  ): B1CommercialIdempotencyDecisionV1 {
    const failure: B1CommercialGovernanceEngineFailureV1 = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialIdempotencyDecisionId: 'failed',
      commercialIdempotencyDecisionReference: 'B1-COMMERCIAL-GOVERNANCE-DECISION-FAILED',
      commercialIdempotencyDecisionVersion: 1,
      commercialIdempotencyDecisionState: 'DRAFT',
      commercialIdempotencyDecisionOutcome: 'DISCREPANCY',
      commercialIdempotencyDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialIdempotencyDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialIdempotencyRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialIdempotencyScope: request?.commercialIdempotencyScope ?? 'b1.invalid',
      commercialIdempotencyKey: request?.commercialIdempotencyKey ?? 'a'.repeat(64),
      commercialReplayPolicy: request?.commercialReplayPolicy ?? 'COMMERCIAL_REPLAY_INHERIT',
      commercialReplayEligibility: 'COMMERCIAL_REPLAY_INELIGIBLE',
      commercialReplayWindowSeconds: request?.commercialReplayWindowSeconds ?? 0,
      commercialIdempotencyEligible: false,
      commercialIdempotencyApplicable: false,
      commercialIdempotencyContractSummary: [],
      commercialReplayPolicySummary: [],
      commercialReplayEligibilitySummary: [],
      commercialIdempotencyValidationSummary: [],
      commercialRequestReplayEvidenceSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ??
        'commercial.virtual-account.inbound-funding.commercial-idempotency',
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
      commercialIdempotencyStartAt:
        request?.commercialIdempotencyStartAt ?? new Date().toISOString(),
      commercialIdempotencyEndAt: request?.commercialIdempotencyEndAt ?? new Date().toISOString(),
      commercialIdempotencyEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
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
      commercialAnalyticsDecisionReference: request?.commercialAnalyticsDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_IDEMPOTENCY_DECISION',
        traceSummary: `B1 commercial-governance engine failure: ${message}`,
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
        auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_IDEMPOTENCY_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScopeRef: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
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

  private buildFailureCommercialAuditDecision(
    request: B1CommercialAuditRequestV1,
    code: B1CommercialGovernanceEngineFailureCodeV1,
    message: string,
  ): B1CommercialAuditDecisionV1 {
    const failure: B1CommercialGovernanceEngineFailureV1 = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialAuditDecisionId: 'failed',
      commercialAuditDecisionReference: 'B1-COMMERCIAL-GOVERNANCE-DECISION-FAILED',
      commercialAuditDecisionVersion: 1,
      commercialAuditDecisionState: 'DRAFT',
      commercialAuditDecisionOutcome: 'DISCREPANCY',
      commercialAuditDecisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      commercialAuditDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialAuditRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialAuditEvent: request?.commercialAuditEvent ?? 'COMMERCIAL_AUDIT_DECISION_RECORDED',
      commercialAuditActor: request?.commercialAuditActor ?? 'b1-commercial-governance-engine',
      commercialAuditEntityType:
        request?.commercialAuditEntityType ?? 'B1_COMMERCIAL_GOVERNANCE_DECISION',
      commercialAuditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
      commercialAuditEntityId: request?.commercialAuditEntityId ?? 'failed',
      commercialAuditEligible: false,
      commercialAuditApplicable: false,
      commercialAuditEvidenceSummary: [],
      commercialAuditCorrelationSummary: [],
      commercialAuditActorMappingSummary: [],
      commercialAuditEntityMappingSummary: [],
      commercialAuditEventSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.commercial-audit',
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
      commercialAuditStartAt: request?.commercialAuditStartAt ?? new Date().toISOString(),
      commercialAuditEndAt: request?.commercialAuditEndAt ?? new Date().toISOString(),
      commercialAuditEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
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
      commercialAnalyticsDecisionReference: request?.commercialAnalyticsDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_AUDIT_DECISION',
        traceSummary: `B1 commercial-governance engine failure: ${message}`,
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
        auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_AUDIT_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
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

  private buildFailureCommercialApprovalDecision(
    request: B1CommercialApprovalRequestV1,
    code: B1CommercialGovernanceEngineFailureCodeV1,
    message: string,
  ): B1CommercialApprovalDecisionV1 {
    const failure: B1CommercialGovernanceEngineFailureV1 = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialApprovalDecisionId: 'failed',
      commercialApprovalDecisionReference: 'B1-COMMERCIAL-GOVERNANCE-DECISION-FAILED',
      commercialApprovalDecisionVersion: 1,
      commercialApprovalDecisionState: 'DRAFT',
      commercialApprovalDecisionOutcome: 'DISCREPANCY',
      commercialApprovalDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialApprovalDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialApprovalRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialApprovalRequirement:
        request?.commercialApprovalRequirement ?? 'COMMERCIAL_APPROVAL_INHERIT',
      commercialApprovalPolicy:
        request?.commercialApprovalPolicy ?? 'COMMERCIAL_APPROVAL_POLICY_INHERIT',
      commercialApprovalEligible: false,
      commercialApprovalApplicable: false,
      commercialApprovalGranted: false,
      commercialApprovalDenied: false,
      commercialApprovalRequirementsSummary: [],
      commercialApprovalPolicySummary: [],
      commercialApprovalEvidenceSummary: [],
      commercialApprovalTraceSummary: [],
      commercialApprovalDecisionSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.commercial-approvals',
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
      commercialApprovalStartAt: request?.commercialApprovalStartAt ?? new Date().toISOString(),
      commercialApprovalEndAt: request?.commercialApprovalEndAt ?? new Date().toISOString(),
      commercialApprovalEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
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
      commercialAnalyticsDecisionReference: request?.commercialAnalyticsDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_APPROVAL_DECISION',
        traceSummary: `B1 commercial-governance engine failure: ${message}`,
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
        auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_APPROVAL_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
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

  private buildFailureCommercialFeatureFlagDecision(
    request: B1CommercialFeatureFlagRequestV1,
    code: B1CommercialGovernanceEngineFailureCodeV1,
    message: string,
  ): B1CommercialFeatureFlagDecisionV1 {
    const failure: B1CommercialGovernanceEngineFailureV1 = {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
      commercialFeatureFlagDecisionId: 'failed',
      commercialFeatureFlagDecisionReference: 'B1-COMMERCIAL-GOVERNANCE-DECISION-FAILED',
      commercialFeatureFlagDecisionVersion: 1,
      commercialFeatureFlagDecisionState: 'DRAFT',
      commercialFeatureFlagDecisionOutcome: 'DISCREPANCY',
      commercialFeatureFlagDecisionHash: createHash('sha256')
        .update(`failed:${message}`)
        .digest('hex'),
      commercialFeatureFlagDecisionReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      commercialFeatureFlagRequestHash: createHash('sha256')
        .update(`request:${message}`)
        .digest('hex'),
      scopeKey: request?.scopeKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_COMMERCIAL_GOVERNANCE_ENGINE_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      commercialFeatureFlagKey: request?.commercialFeatureFlagKey ?? 'b1.invalid',
      commercialFeatureFlagVersion: 1,
      commercialFeatureFlagRolloutState:
        request?.commercialFeatureFlagRolloutState ?? 'COMMERCIAL_FEATURE_FLAG_DRAFT',
      commercialFeatureFlagActivationReadiness:
        request?.commercialFeatureFlagActivationReadiness ?? 'COMMERCIAL_ACTIVATION_NOT_READY',
      commercialFeatureFlagEnabled: false,
      commercialFeatureFlagApplicable: false,
      commercialFeatureRegistrationSummary: [],
      commercialRolloutStateSummary: [],
      commercialEnablementRulesSummary: [],
      commercialDependencyRulesSummary: [],
      commercialActivationReadinessSummary: [],
      commercialRolloutEvidenceSummary: [],
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey:
        request?.capabilityKey ??
        'commercial.virtual-account.inbound-funding.commercial-feature-flag',
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
      commercialFeatureFlagStartAt:
        request?.commercialFeatureFlagStartAt ?? new Date().toISOString(),
      commercialFeatureFlagEndAt: request?.commercialFeatureFlagEndAt ?? new Date().toISOString(),
      commercialFeatureFlagEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
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
      commercialAnalyticsDecisionReference: request?.commercialAnalyticsDecisionReference ?? '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMMERCIAL_FEATURE_FLAG_DECISION',
        traceSummary: `B1 commercial-governance engine failure: ${message}`,
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
        auditEntityType: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'B1_COMMERCIAL_FEATURE_FLAG_DECISION_FAILED',
        auditActor: B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
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

  private buildReplayCommercialDataClassificationFailure(
    request: B1CommercialDataClassificationRequestV1,
    record: B1CommercialDataClassificationDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialDataClassificationDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope:
        B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialDataClassificationRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialDataClassificationDecisionHash: record.commercialDataClassificationDecisionHash,
      commercialDataClassificationDecisionReplayHash:
        record.commercialDataClassificationDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCommercialIdempotencyFailure(
    request: B1CommercialIdempotencyRequestV1,
    record: B1CommercialIdempotencyDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialIdempotencyDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialIdempotencyRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialIdempotencyDecisionHash: record.commercialIdempotencyDecisionHash,
      commercialIdempotencyDecisionReplayHash: record.commercialIdempotencyDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCommercialAuditFailure(
    request: B1CommercialAuditRequestV1,
    record: B1CommercialAuditDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialAuditDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialAuditRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialAuditDecisionHash: record.commercialAuditDecisionHash,
      commercialAuditDecisionReplayHash: record.commercialAuditDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCommercialApprovalFailure(
    request: B1CommercialApprovalRequestV1,
    record: B1CommercialApprovalDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialApprovalDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialApprovalRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialApprovalDecisionHash: record.commercialApprovalDecisionHash,
      commercialApprovalDecisionReplayHash: record.commercialApprovalDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayCommercialFeatureFlagFailure(
    request: B1CommercialFeatureFlagRequestV1,
    record: B1CommercialFeatureFlagDecisionV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialFeatureFlagDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      commercialFeatureFlagRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      commercialFeatureFlagDecisionHash: record.commercialFeatureFlagDecisionHash,
      commercialFeatureFlagDecisionReplayHash: record.commercialFeatureFlagDecisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(
    row: B1CommercialGovernanceDecisionEntity,
  ): B1CommercialGovernanceEngineDocumentPersistenceRecordV1 {
    return {
      documentId: row.id,
      documentReference: row.documentReference,
      documentVersion: row.documentVersion as 1,
      documentKind: row.documentKind as B1CommercialGovernanceEngineDocumentKind,
      documentHash: row.documentHash,
      documentReplayHash: row.documentReplayHash,
      idempotencyScope: row.idempotencyScope,
      idempotencyKey: row.idempotencyKey,
      record: row.record as never,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1,
    };
  }
}
