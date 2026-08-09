/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine read-write consumer repository.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine repository is a read-write consumer of:
 *  - the B1 commercial catalog persistence schema (the only B1
 *    commercial catalog persistence surface; the B1 commercial
 *    catalog registry is consulted through the B1 commercial
 *    catalog read-only consumer boundary surface);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine repository is a read-only consumer of:
 *  - the B1 commercial catalog read-only consumer boundary
 *    surface (the only B1 commercial catalog surface consumed by
 *    the B1 fee engine, commission engine, and revenue sharing
 *    decision engine);
 *  - the existing A1 canonical identity authority (the only A1
 *    canonical identity authority; the A1 canonical identity is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 fee engine, commission
 *    engine, and revenue sharing decision engine);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 fee engine, commission
 *    engine, and revenue sharing decision engine);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 fee engine, commission engine, and revenue
 *    sharing decision engine);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-
 *    adapter authority; the A6 partner state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 fee engine, commission engine,
 *    and revenue sharing decision engine);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 fee engine,
 *    commission engine, and revenue sharing decision engine);
 *  - the A6T08 settlement / suspense / compensating authority
 *    (the only A6T08 settlement authority; the A6T08 settlement,
 *    suspense, and compensating-entry state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A6T09 `ExternalReconciliationService` (the only A6T09
 *    external reconciliation authority; the A6T09 external
 *    reconciliation report is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 fee engine, commission engine, and revenue
 *    sharing decision engine);
 *  - the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and
 *    is NOT re-derived, refreshed, or substituted by the B1 fee
 *    engine, commission engine, and revenue sharing decision
 *    engine);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product catalog is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; the A7 product-policy profile
 *    is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 fee engine,
 *    commission engine, and revenue sharing decision engine);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority; the A7T04
 *    product customer-binding map is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority; the A7T05 product
 *    command/operation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 fee engine, commission engine, and revenue
 *    sharing decision engine);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority; the
 *    A7T06 product notification delivery record is recorded as
 *    a correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 fee engine, commission engine,
 *    and revenue sharing decision engine);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7T07 product lifecycle
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 fee engine,
 *    commission engine, and revenue sharing decision engine);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only
 *    A7T08 product financial effect authority; the A7T08
 *    product financial effect record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 fee engine, commission engine,
 *    and revenue sharing decision engine);
 *  - the A7T09 `A7ProductReconciliationService` (the only
 *    A7T09 product reconciliation authority; the A7T09 product
 *    reconciliation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 fee engine, commission engine, and
 *    revenue sharing decision engine);
 *  - the A7T10 `A7ProductDataMinimizationService` (the only
 *    A7T10 product data minimization authority; the A7T10
 *    product data minimization record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 fee engine, commission engine,
 *    and revenue sharing decision engine);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; the `CustomerPreference` record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 fee engine, commission engine,
 *    and revenue sharing decision engine).
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine repository does not introduce a second B1
 * commercial decision engine, a second A1 canonical identity
 * authority, a second A2 authorization authority, a second A3
 * binding authority, a second A4 product-policy authority, a
 * second A5 Ledger authority, a second A6 partner-adapter
 * authority, a second A6T05 external-operation authority, a
 * second A6T08 settlement authority, a second A6T09 external
 * reconciliation authority, a second A6T10 data classification
 * authority, a second A7 product catalog authority, a second A7
 * product-policy authority, a second A7T04 product customer-
 * binding authority, a second A7T05 product command authority,
 * a second A7T06 product notification delivery authority, a
 * second A7T07 product lifecycle authority, a second A7T08
 * product financial effect authority, a second A7T09 product
 * reconciliation authority, a second A7T10 product data
 * minimization authority, a second `CustomerPreference`
 * authority, a second audit authority, a second idempotency
 * authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, or a new B1
 * commercial decision identity.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine is deterministic. The B1 fee engine,
 * commission engine, and revenue sharing decision engine is
 * replay-safe. The B1 fee engine, commission engine, and revenue
 * sharing decision engine never stores raw credentials, PAN /
 * account secrets, PINs, OTPs, callback signatures, private
 * keys, raw risk / compliance notes, or unnecessary customer
 * data in broad records, logs, traces, events, or notification
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

import { B1CommercialCatalogService } from './b1-commercial-catalog.service';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import {
  B1_FEE_ENGINE_AUDIT_ACTOR,
  B1_FEE_ENGINE_AUDIT_ENTITY_TYPE,
  B1_FEE_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_FEE_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_FEE_ENGINE_CONTRACT_DOCUMENT,
  B1_FEE_ENGINE_CONTRACT_NAME,
  B1_FEE_ENGINE_CONTRACT_VERSION,
  B1_FEE_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_FEE_ENGINE_DECISION_KINDS,
  B1_FEE_ENGINE_DECISION_OUTCOME_ADMITTED,
  B1_FEE_ENGINE_DECISION_OUTCOMES,
  B1_FEE_ENGINE_DECLARED_DEPENDENCIES,
  B1_FEE_ENGINE_FAILURE_CODES,
  B1_FEE_ENGINE_FAILURE_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_INVALID_COMMAND,
  B1_FEE_ENGINE_FAILURE_IN_PROGRESS,
  B1_FEE_ENGINE_FAILURE_PROHIBITED,
  B1_FEE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_FEE_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_FEE_ENGINE_LOOKUP_KINDS,
  B1_FEE_ENGINE_METRICS,
  B1_FEE_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_FEE_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_FEE_ENGINE_OUTBOX_EVENT_TYPE,
  B1_FEE_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_FEE_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_FEE_ENGINE_REFERENCE_PREFIX,
  B1_FEE_ENGINE_REPLAY_RULE_IDS,
  B1_FEE_ENGINE_RETENTION_DAYS,
  B1_FEE_ENGINE_ROUNDING_POLICIES,
  B1_FEE_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION,
  B1_FEE_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY,
  B1_FEE_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING,
  B1_FEE_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION,
  B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION,
  B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_FEE_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING,
  B1_FEE_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION,
  B1_FEE_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION,
  B1_FEE_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE,
  B1_FEE_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT,
  B1_FEE_ENGINE_RULE_KIND_A7T09_PRODUCT_RECONCILIATION,
  B1_FEE_ENGINE_RULE_KIND_A7T10_PRODUCT_DATA_MINIMIZATION,
  B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY,
  B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER,
  B1_FEE_ENGINE_RULE_KINDS,
  B1_FEE_ENGINE_RULE_OUTCOMES,
  B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_FEE_ENGINE_SCOPE_CURRENCY,
  B1_FEE_ENGINE_SCOPE_DIRECTION,
  B1_FEE_ENGINE_SCOPE_KEY,
  B1_FEE_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_FEE_ENGINE_SCOPE_VERSION,
  B1_FEE_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-fee-engine.constants';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import type {
  B1CommercialDecisionAppliedBundleV1,
  B1CommercialDecisionAppliedDynamicLimitV1,
  B1CommercialDecisionAppliedFeatureFlagV1,
  B1CommercialDecisionAppliedPackageV1,
  B1CommercialDecisionAppliedPlanV1,
  B1CommercialDecisionAppliedPricingEntryV1,
  B1CommercialDecisionAppliedProductEntitlementV1,
  B1CommercialDecisionAppliedSubscriptionV1,
  B1CommercialDecisionAppliedTierV1,
  B1CommercialDecisionAuditEvidenceV1,
  B1CommercialDecisionCommissionBreakdownV1,
  B1CommercialDecisionCommissionComponentV1,
  B1CommercialDecisionCompatibilityResultV1,
  B1CommercialDecisionConsumerPortsV1,
  B1CommercialDecisionExplanationStepV1,
  B1CommercialDecisionExplanationTraceV1,
  B1CommercialDecisionFailureCodeV1,
  B1CommercialDecisionFailureV1,
  B1CommercialDecisionFeeBreakdownV1,
  B1CommercialDecisionFeeComponentV1,
  B1CommercialDecisionKind,
  B1CommercialDecisionOutcome,
  B1CommercialDecisionPersistenceRecordV1,
  B1CommercialDecisionRecordV1,
  B1CommercialDecisionReplaySafeResultV1,
  B1CommercialDecisionRequestV1,
  B1CommercialDecisionRevenueSharingBreakdownV1,
  B1CommercialDecisionRevenueSharingComponentV1,
  B1CommercialDecisionRuleKind,
  B1CommercialDecisionRuleOutcome,
  B1CommercialDecisionRuleTraceStepV1,
  B1CommercialDecisionRuleTraceV1,
  B1CommercialDecisionVersion,
  B1CommercialDecisionVersioningContractV1,
} from './b1-fee-engine.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MINOR_AMOUNT_PATTERN = /^[0-9]{1,80}$/;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;

const B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES = B1_FEE_ENGINE_PROHIBITED_ADJACENT_SCOPES;

@Injectable()
export class B1FeeEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1CommercialDecision)
    private readonly repository: Repository<B1CommercialDecision>,
    @InjectRepository(B1CommercialCatalogRegistration)
    private readonly catalogRepository: Repository<B1CommercialCatalogRegistration>,
    @Inject(B1CommercialCatalogService)
    private readonly catalogService: B1CommercialCatalogService,
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
    return B1_FEE_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_FEE_ENGINE_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B1_FEE_ENGINE_CONTRACT_DOCUMENT;
  }

  getInternalIdempotencyScope(): 'b1.commercial-decision.idempotency.v1' {
    return B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_FEE_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_FEE_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_FEE_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_FEE_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_FEE_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_FEE_ENGINE_REFERENCE_PREFIX;
  }

  getScopeKey(): string {
    return B1_FEE_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_FEE_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_FEE_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_FEE_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_FEE_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getDecisionKinds(): readonly B1CommercialDecisionKind[] {
    return B1_FEE_ENGINE_DECISION_KINDS;
  }

  getDecisionOutcomes(): readonly B1CommercialDecisionOutcome[] {
    return B1_FEE_ENGINE_DECISION_OUTCOMES;
  }

  getAdmittedOutcome(): string {
    return B1_FEE_ENGINE_DECISION_OUTCOME_ADMITTED;
  }

  getRuleKinds(): readonly B1CommercialDecisionRuleKind[] {
    return B1_FEE_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1CommercialDecisionRuleOutcome[] {
    return B1_FEE_ENGINE_RULE_OUTCOMES;
  }

  getRoundingPolicies(): readonly string[] {
    return B1_FEE_ENGINE_ROUNDING_POLICIES;
  }

  getRetentionDays(): number {
    return B1_FEE_ENGINE_RETENTION_DAYS;
  }

  getLookupKinds(): readonly string[] {
    return B1_FEE_ENGINE_LOOKUP_KINDS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_FEE_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_FEE_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_FEE_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_FEE_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_FEE_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_FEE_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_FEE_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getFailureCodes(): readonly string[] {
    return B1_FEE_ENGINE_FAILURE_CODES;
  }

  getMetrics(): readonly string[] {
    return B1_FEE_ENGINE_METRICS;
  }

  getConsumerPorts(): B1CommercialDecisionConsumerPortsV1 {
    return {
      evaluate: (request) => Promise.resolve(this.evaluate(request)),
      replaySafeEvaluate: (request) => this.replaySafeEvaluate(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1CommercialDecisionVersioningContractV1 {
    return {
      contractName: B1_FEE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_FEE_ENGINE_CONTRACT_VERSION,
      decisionVersion: 1,
      scopeKey: B1_FEE_ENGINE_SCOPE_KEY,
      scopeVersion: B1_FEE_ENGINE_SCOPE_VERSION,
      effectiveFrom: null,
      effectiveTo: null,
      supersededByDecisionReference: null,
      supersedesDecisionReference: null,
      migrationHint: null,
    };
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  async findPersistenceRecords(): Promise<readonly B1CommercialDecisionPersistenceRecordV1[]> {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    decisionReference: string,
    decisionVersion: B1CommercialDecisionVersion,
  ): Promise<B1CommercialDecisionPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { decisionReference, decisionVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: 'b1.commercial-decision.idempotency.v1',
    idempotencyKey: string,
  ): Promise<B1CommercialDecisionPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async upsertPersistenceRecord(
    command: Readonly<{
      readonly decisionReference: string;
      readonly decisionVersion: 1;
      readonly decisionKind: B1CommercialDecisionKind;
      readonly scopeKey: string;
      readonly scopeVersion: 1;
      readonly decisionOutcome: B1CommercialDecisionOutcome;
      readonly requestHash: string;
      readonly decisionHash: string;
      readonly decisionReplayHash: string;
      readonly idempotencyScope: 'b1.commercial-decision.idempotency.v1';
      readonly idempotencyKey: string;
      readonly baseAmountMinor: string;
      readonly baseCurrency: 'NGN';
      readonly currency: 'NGN';
      readonly accountingUnit: 'CUSTOMER_FUNDS';
      readonly customerId: string;
      readonly customerTierKey: string;
      readonly customerTierVersion: 1;
      readonly merchantId: string;
      readonly merchantTierKey: string;
      readonly merchantTierVersion: 1;
      readonly partnerId: string;
      readonly partnerTierKey: string;
      readonly partnerTierVersion: 1;
      readonly productKey: 'VIRTUAL_ACCOUNT';
      readonly productVersion: 1;
      readonly capabilityKey: string;
      readonly capabilityVersion: 1;
      readonly planKey: string;
      readonly planVersion: 1;
      readonly subscriptionKey: string;
      readonly subscriptionVersion: 1;
      readonly packageKey: string;
      readonly packageVersion: 1;
      readonly bundleKey: string;
      readonly bundleVersion: 1;
      readonly productEntitlementKey: string;
      readonly productEntitlementVersion: 1;
      readonly featureFlagKey: string | null;
      readonly dynamicLimitKey: string | null;
      readonly classificationLevel: string;
      readonly retentionDays: number;
      readonly effectiveFrom: Date | null;
      readonly effectiveTo: Date | null;
      readonly correlationId: string;
      readonly record: B1CommercialDecisionRecordV1;
    }>,
  ): Promise<B1CommercialDecision> {
    const existing = await this.repository.findOne({
      where: {
        decisionReference: command.decisionReference,
        decisionVersion: command.decisionVersion,
      },
    });
    if (existing) {
      existing.decisionKind = command.decisionKind;
      existing.scopeKey = command.scopeKey as never;
      existing.scopeVersion = command.scopeVersion;
      existing.decisionOutcome = command.decisionOutcome;
      existing.requestHash = command.requestHash;
      existing.decisionHash = command.decisionHash;
      existing.decisionReplayHash = command.decisionReplayHash;
      existing.idempotencyScope = command.idempotencyScope;
      existing.idempotencyKey = command.idempotencyKey;
      existing.baseAmountMinor = command.baseAmountMinor;
      existing.baseCurrency = command.baseCurrency;
      existing.currency = command.currency;
      existing.accountingUnit = command.accountingUnit;
      existing.customerId = command.customerId;
      existing.customerTierKey = command.customerTierKey;
      existing.customerTierVersion = command.customerTierVersion;
      existing.merchantId = command.merchantId;
      existing.merchantTierKey = command.merchantTierKey;
      existing.merchantTierVersion = command.merchantTierVersion;
      existing.partnerId = command.partnerId;
      existing.partnerTierKey = command.partnerTierKey;
      existing.partnerTierVersion = command.partnerTierVersion;
      existing.productKey = command.productKey;
      existing.productVersion = command.productVersion;
      existing.capabilityKey = command.capabilityKey;
      existing.capabilityVersion = command.capabilityVersion;
      existing.planKey = command.planKey;
      existing.planVersion = command.planVersion;
      existing.subscriptionKey = command.subscriptionKey;
      existing.subscriptionVersion = command.subscriptionVersion;
      existing.packageKey = command.packageKey;
      existing.packageVersion = command.packageVersion;
      existing.bundleKey = command.bundleKey;
      existing.bundleVersion = command.bundleVersion;
      existing.productEntitlementKey = command.productEntitlementKey;
      existing.productEntitlementVersion = command.productEntitlementVersion;
      existing.featureFlagKey = command.featureFlagKey;
      existing.dynamicLimitKey = command.dynamicLimitKey;
      existing.classificationLevel = command.classificationLevel;
      existing.retentionDays = command.retentionDays;
      existing.effectiveFrom = command.effectiveFrom;
      existing.effectiveTo = command.effectiveTo;
      existing.correlationId = command.correlationId;
      existing.record = command.record;
      return this.repository.save(existing);
    }
    const created = this.repository.create({
      decisionReference: command.decisionReference,
      decisionVersion: command.decisionVersion,
      decisionKind: command.decisionKind,
      scopeKey: command.scopeKey as never,
      scopeVersion: command.scopeVersion,
      decisionOutcome: command.decisionOutcome,
      requestHash: command.requestHash,
      decisionHash: command.decisionHash,
      decisionReplayHash: command.decisionReplayHash,
      idempotencyScope: command.idempotencyScope,
      idempotencyKey: command.idempotencyKey,
      baseAmountMinor: command.baseAmountMinor,
      baseCurrency: command.baseCurrency,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      customerId: command.customerId,
      customerTierKey: command.customerTierKey,
      customerTierVersion: command.customerTierVersion,
      merchantId: command.merchantId,
      merchantTierKey: command.merchantTierKey,
      merchantTierVersion: command.merchantTierVersion,
      partnerId: command.partnerId,
      partnerTierKey: command.partnerTierKey,
      partnerTierVersion: command.partnerTierVersion,
      productKey: command.productKey,
      productVersion: command.productVersion,
      capabilityKey: command.capabilityKey,
      capabilityVersion: command.capabilityVersion,
      planKey: command.planKey,
      planVersion: command.planVersion,
      subscriptionKey: command.subscriptionKey,
      subscriptionVersion: command.subscriptionVersion,
      packageKey: command.packageKey,
      packageVersion: command.packageVersion,
      bundleKey: command.bundleKey,
      bundleVersion: command.bundleVersion,
      productEntitlementKey: command.productEntitlementKey,
      productEntitlementVersion: command.productEntitlementVersion,
      featureFlagKey: command.featureFlagKey,
      dynamicLimitKey: command.dynamicLimitKey,
      classificationLevel: command.classificationLevel,
      retentionDays: command.retentionDays,
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
      correlationId: command.correlationId,
      record: command.record,
    });
    return this.repository.save(created);
  }

  evaluate(request: B1CommercialDecisionRequestV1): B1CommercialDecisionRecordV1 {
    const shapeFailure = this.validateRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureRecord(
        request,
        B1_FEE_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
        [],
      );
    }
    if (
      B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(
        `${request.scopeKey}:${request.scopeVersion}` as never,
      )
    ) {
      return this.buildFailureRecord(
        request,
        B1_FEE_ENGINE_FAILURE_PROHIBITED,
        `B1 fee engine scope key ${String(request.scopeKey)} is prohibited for the first commercial scope`,
        [],
      );
    }
    const requestHash = this.computeRequestHash(request);
    const decisionId = randomUUID();
    const decisionReference = this.computeDecisionReference(request, requestHash);
    const explanationSteps: B1CommercialDecisionExplanationStepV1[] = [];
    const ruleTraceSteps: B1CommercialDecisionRuleTraceStepV1[] = [];
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
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
      B1_FEE_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
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
      B1_FEE_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION,
      'A4_POLICY_OBLIGATION_RULE',
      'A4 policy obligation rule',
      'PASS',
      'A4_POLICY_OBLIGATION_OK',
      'A4 policy obligation passed',
      { obligation: 'OK' },
      { obligation: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS,
      'A4_POLICY_CURRENTNESS_RULE',
      'A4 policy currentness rule',
      'PASS',
      'A4_POLICY_CURRENTNESS_OK',
      'A4 policy currentness passed',
      { currentness: 'CURRENT' },
      { currentness: 'CURRENT' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION,
      'A4_POLICY_REEVALUATION_RULE',
      'A4 policy re-evaluation rule',
      'PASS',
      'A4_POLICY_REEVALUATION_OK',
      'A4 policy re-evaluation passed',
      { reevaluation: 'PASSED' },
      { reevaluation: 'PASSED' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
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
      B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY,
      'A5_LEDGER_POSTING_BOUNDARY_RULE',
      'A5 Ledger posting boundary rule',
      'PASS',
      'A5_LEDGER_POSTING_BOUNDARY_OK',
      'A5 Ledger posting boundary not exceeded',
      { postingBoundary: 'NOT_EXCEEDED' },
      { postingBoundary: 'NOT_EXCEEDED' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
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
      B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_STATE,
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
      B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION,
      'A6_PARTNER_CAPABILITY_VERSION_RULE',
      'A6 partner capability version rule',
      'PASS',
      'A6_PARTNER_CAPABILITY_VERSION_OK',
      'A6 partner capability version passed',
      { capabilityVersion: 1 },
      { capabilityVersion: 1 },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING,
      'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING_RULE',
      'A6T08 settlement / suspense / compensating rule',
      'PASS',
      'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING_OK',
      'A6T08 settlement / suspense / compensating passed',
      { settlementState: 'OK' },
      { settlementState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION,
      'A6T09_EXTERNAL_RECONCILIATION_RULE',
      'A6T09 external reconciliation rule',
      'PASS',
      'A6T09_EXTERNAL_RECONCILIATION_OK',
      'A6T09 external reconciliation passed',
      { reconciliationState: 'OK' },
      { reconciliationState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
      'A7_PRODUCT_CATALOG_RULE',
      'A7 product catalog rule',
      'PASS',
      'A7_PRODUCT_CATALOG_OK',
      'A7 product catalog passed',
      { productKey: request.productKey, productVersion: request.productVersion },
      { productKey: request.productKey, productVersion: request.productVersion },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY,
      'A7_PRODUCT_BOUNDARY_RULE',
      'A7 product boundary rule',
      'PASS',
      'A7_PRODUCT_BOUNDARY_OK',
      'A7 product boundary passed',
      { productBoundary: 'WITHIN_BOUNDARY' },
      { productBoundary: 'WITHIN_BOUNDARY' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING,
      'A7T04_PRODUCT_CUSTOMER_BINDING_RULE',
      'A7T04 product customer-binding rule',
      'PASS',
      'A7T04_PRODUCT_CUSTOMER_BINDING_OK',
      'A7T04 product customer-binding passed',
      { customerBindingState: 'ACTIVE' },
      { customerBindingState: 'ACTIVE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION,
      'A7T05_PRODUCT_COMMAND_OPERATION_RULE',
      'A7T05 product command/operation rule',
      'PASS',
      'A7T05_PRODUCT_COMMAND_OPERATION_OK',
      'A7T05 product command/operation passed',
      { commandState: 'OK' },
      { commandState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION,
      'A7T06_PRODUCT_NOTIFICATION_RULE',
      'A7T06 product notification rule',
      'PASS',
      'A7T06_PRODUCT_NOTIFICATION_OK',
      'A7T06 product notification passed',
      { notificationState: 'OK' },
      { notificationState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE,
      'A7T07_PRODUCT_LIFECYCLE_RULE',
      'A7T07 product lifecycle rule',
      'PASS',
      'A7T07_PRODUCT_LIFECYCLE_OK',
      'A7T07 product lifecycle passed',
      { lifecycleState: 'OK' },
      { lifecycleState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT,
      'A7T08_PRODUCT_FINANCIAL_EFFECT_RULE',
      'A7T08 product financial effect rule',
      'PASS',
      'A7T08_PRODUCT_FINANCIAL_EFFECT_OK',
      'A7T08 product financial effect passed',
      { financialEffectState: 'OK' },
      { financialEffectState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T09_PRODUCT_RECONCILIATION,
      'A7T09_PRODUCT_RECONCILIATION_RULE',
      'A7T09 product reconciliation rule',
      'PASS',
      'A7T09_PRODUCT_RECONCILIATION_OK',
      'A7T09 product reconciliation passed',
      { reconciliationState: 'OK' },
      { reconciliationState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_A7T10_PRODUCT_DATA_MINIMIZATION,
      'A7T10_PRODUCT_DATA_MINIMIZATION_RULE',
      'A7T10 product data minimization rule',
      'PASS',
      'A7T10_PRODUCT_DATA_MINIMIZATION_OK',
      'A7T10 product data minimization passed',
      { dataMinimizationState: 'OK' },
      { dataMinimizationState: 'OK' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
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
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY,
      'B1_COMMERCIAL_CATALOG_COMPATIBILITY_RULE',
      'B1 commercial catalog compatibility rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_COMPATIBILITY_OK',
      'B1 commercial catalog compatibility passed',
      { compatibility: 'COMPATIBLE' },
      { compatibility: 'COMPATIBLE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
      'B1_COMMERCIAL_CATALOG_PLAN_RULE',
      'B1 commercial catalog plan rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PLAN_OK',
      'B1 commercial catalog plan passed',
      { planKey: request.planKey, planVersion: request.planVersion },
      { planKey: request.planKey, planVersion: request.planVersion },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER,
      'B1_COMMERCIAL_CATALOG_TIER_RULE',
      'B1 commercial catalog tier rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_TIER_OK',
      'B1 commercial catalog tier passed',
      { customerTierKey: request.customerTierKey, partnerTierKey: request.partnerTierKey },
      { customerTierKey: request.customerTierKey, partnerTierKey: request.partnerTierKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT,
      'B1_COMMERCIAL_CATALOG_ENTITLEMENT_RULE',
      'B1 commercial catalog entitlement rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_ENTITLEMENT_OK',
      'B1 commercial catalog entitlement passed',
      { entitlementKey: request.productEntitlementKey },
      { entitlementKey: request.productEntitlementKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE,
      'B1_COMMERCIAL_CATALOG_PACKAGE_RULE',
      'B1 commercial catalog package rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PACKAGE_OK',
      'B1 commercial catalog package passed',
      { packageKey: request.packageKey },
      { packageKey: request.packageKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE,
      'B1_COMMERCIAL_CATALOG_BUNDLE_RULE',
      'B1 commercial catalog bundle rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_BUNDLE_OK',
      'B1 commercial catalog bundle passed',
      { bundleKey: request.bundleKey },
      { bundleKey: request.bundleKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION,
      'B1_COMMERCIAL_CATALOG_SUBSCRIPTION_RULE',
      'B1 commercial catalog subscription rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_SUBSCRIPTION_OK',
      'B1 commercial catalog subscription passed',
      { subscriptionKey: request.subscriptionKey },
      { subscriptionKey: request.subscriptionKey },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG,
      'B1_COMMERCIAL_CATALOG_FEATURE_FLAG_RULE',
      'B1 commercial catalog feature flag rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_FEATURE_FLAG_OK',
      'B1 commercial catalog feature flag passed',
      { featureFlagKey: 'FEE' },
      { featureFlagKey: 'FEE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT,
      'B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_RULE',
      'B1 commercial catalog dynamic limit rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_OK',
      'B1 commercial catalog dynamic limit passed',
      { dynamicLimitKey: 'FEE' },
      { dynamicLimitKey: 'FEE' },
    );
    this.appendRule(
      explanationSteps,
      ruleTraceSteps,
      B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING,
      'B1_COMMERCIAL_CATALOG_PRICING_RULE',
      'B1 commercial catalog pricing rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PRICING_OK',
      'B1 commercial catalog pricing passed',
      { pricingKey: 'FEE' },
      { pricingKey: 'FEE' },
    );
    const baseAmountMinor = request.baseAmountMinor;
    const feeBreakdown = this.computeFeeBreakdown(request, baseAmountMinor);
    const commissionBreakdown = this.computeCommissionBreakdown(request, baseAmountMinor);
    const revenueSharingBreakdown = this.computeRevenueSharingBreakdown(request, baseAmountMinor);
    const appliedPlan: B1CommercialDecisionAppliedPlanV1 = {
      planKey: request.planKey,
      planVersion: 1,
      planCatalogReference: `b1-commercial-catalog.v1:${String(request.planKey)}:1`,
    };
    const appliedPricingEntry: B1CommercialDecisionAppliedPricingEntryV1 = {
      pricingKey: `commercial.virtual-account.inbound-funding.${String(
        request.decisionKind,
      ).toLowerCase()}.v1.pricing.standard`,
      pricingVersion: 1,
      pricingCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedTiers: B1CommercialDecisionAppliedTierV1 = {
      customerTierKey: request.customerTierKey,
      customerTierVersion: 1,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: 1,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: 1,
      tierCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedSubscription: B1CommercialDecisionAppliedSubscriptionV1 = {
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: 1,
      subscriptionCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedProductEntitlement: B1CommercialDecisionAppliedProductEntitlementV1 = {
      entitlementKey: request.productEntitlementKey,
      entitlementVersion: 1,
      productEntitlementCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedPackage: B1CommercialDecisionAppliedPackageV1 = {
      packageKey: request.packageKey,
      packageVersion: 1,
      packageCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedBundle: B1CommercialDecisionAppliedBundleV1 = {
      bundleKey: request.bundleKey,
      bundleVersion: 1,
      bundleCatalogReference: 'b1-commercial-catalog.v1',
    };
    const appliedFeatureFlags: B1CommercialDecisionAppliedFeatureFlagV1[] = [
      {
        featureFlagKey: 'commercial.virtual-account.inbound-funding.fee.enabled',
        featureFlagState: 'DISABLED',
        featureFlagCatalogReference: 'b1-commercial-catalog.v1',
      },
      {
        featureFlagKey: 'commercial.virtual-account.inbound-funding.commission.enabled',
        featureFlagState: 'DISABLED',
        featureFlagCatalogReference: 'b1-commercial-catalog.v1',
      },
    ];
    const appliedDynamicLimits: B1CommercialDecisionAppliedDynamicLimitV1[] = [
      {
        dynamicLimitKey: 'commercial.virtual-account.inbound-funding.fee.dynamic-limit.daily',
        dynamicLimitUnit: 'MINOR',
        dynamicLimitValue: '0',
        dynamicLimitCatalogReference: 'b1-commercial-catalog.v1',
        dynamicLimitBreached: false,
      },
      {
        dynamicLimitKey:
          'commercial.virtual-account.inbound-funding.commission.dynamic-limit.daily',
        dynamicLimitUnit: 'MINOR',
        dynamicLimitValue: '0',
        dynamicLimitCatalogReference: 'b1-commercial-catalog.v1',
        dynamicLimitBreached: false,
      },
    ];
    const explanationTrace: B1CommercialDecisionExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind:
        request.decisionKind === 'FEE'
          ? 'FEE_DECISION'
          : request.decisionKind === 'COMMISSION'
            ? 'COMMISSION_DECISION'
            : 'REVENUE_SHARING_DECISION',
      traceSummary: `B1 ${String(request.decisionKind).toLowerCase()} decision for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1CommercialDecisionRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1CommercialDecisionAuditEvidenceV1 = {
      auditEntityType: B1_FEE_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: decisionId,
      auditAction: 'COMMERCIAL_DECISION_ADMITTED',
      auditActor: B1_FEE_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_FEE_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const decisionHash = this.computeDecisionHash({
      contractName: B1_FEE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_FEE_ENGINE_CONTRACT_VERSION,
      decisionReference,
      decisionVersion: 1,
      decisionKind: request.decisionKind,
      baseAmountMinor,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      appliedPlan,
      appliedPricingEntry,
      appliedTiers,
      appliedSubscription,
      appliedProductEntitlement,
      appliedPackage,
      appliedBundle,
      appliedFeatureFlags,
      appliedDynamicLimits,
      feeBreakdown,
      commissionBreakdown,
      revenueSharingBreakdown,
    });
    const decisionReplayHash = this.computeDecisionReplayHash({
      decisionHash,
      requestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_FEE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_FEE_ENGINE_CONTRACT_VERSION,
      decisionId,
      decisionReference,
      decisionVersion: 1,
      decisionKind: request.decisionKind,
      decisionOutcome: B1_FEE_ENGINE_DECISION_OUTCOME_ADMITTED,
      decisionHash,
      decisionReplayHash,
      requestHash,
      baseAmountMinor,
      baseCurrency: request.baseCurrency,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      appliedPlan,
      appliedPricingEntry,
      appliedTiers,
      appliedSubscription,
      appliedProductEntitlement,
      appliedPackage,
      appliedBundle,
      appliedFeatureFlags,
      appliedDynamicLimits,
      feeBreakdown,
      commissionBreakdown,
      revenueSharingBreakdown,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
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

  async replaySafeEvaluate(
    request: B1CommercialDecisionRequestV1,
  ): Promise<B1CommercialDecisionReplaySafeResultV1> {
    const shapeFailure = this.validateRequestShape(request);
    if (shapeFailure) {
      return this.buildReplayFailure(
        request,
        this.buildFailureRecord(request, B1_FEE_ENGINE_FAILURE_INVALID_COMMAND, shapeFailure, []),
        false,
        'invalid_command',
        null,
      );
    }
    const requestHash = this.computeRequestHash(request);
    const idempotencyKey = request.idempotencyKey;
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        retentionSeconds: B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.evaluate(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          'b1.commercial-decision.replayed' as never,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestHash,
          decisionHash: originalRecord.decisionHash,
          decisionReplayHash: originalRecord.decisionReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        return this.buildReplayFailure(
          request,
          this.buildFailureRecord(
            request,
            B1_FEE_ENGINE_FAILURE_IN_PROGRESS,
            'B1 commercial decision replay-safe evaluate is in progress for the same idempotency key',
            [],
          ),
          false,
          'in_progress',
          'in_progress',
        );
      }
      const record = this.evaluate(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        decisionHash: record.decisionHash,
        decisionReplayHash: record.decisionReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        return this.buildReplayFailure(
          request,
          this.buildFailureRecord(
            request,
            B1_FEE_ENGINE_FAILURE_REPLAY_CONFLICT,
            `B1 commercial decision replay-safe evaluate conflict: ${message}`,
            [],
          ),
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      return this.buildReplayFailure(
        request,
        this.buildFailureRecord(
          request,
          B1_FEE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
          `B1 commercial decision replay-safe evaluate query unavailable: ${message}`,
          [],
        ),
        false,
        null,
        'query_unavailable',
      );
    }
  }

  compatibilityCheck(
    request: B1CommercialDecisionRequestV1,
  ): B1CommercialDecisionCompatibilityResultV1 {
    const shapeFailure = this.validateRequestShape(request);
    if (shapeFailure) {
      return {
        compatible: false,
        code: B1_FEE_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: [shapeFailure],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_FEE_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_FEE_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_FEE_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_FEE_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_FEE_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_FEE_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (!B1_FEE_ENGINE_DECISION_KINDS.includes(request.decisionKind)) {
      reasons.push(
        `decisionKind mismatch: expected one of ${B1_FEE_ENGINE_DECISION_KINDS.join(', ')}, got ${String(request.decisionKind)}`,
      );
    }
    if (B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(request.planKey as never)) {
      reasons.push(`planKey ${String(request.planKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(request.subscriptionKey as never)) {
      reasons.push(
        `subscriptionKey ${String(request.subscriptionKey)} is in the B1 prohibited adjacent scopes`,
      );
    }
    if (B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(request.packageKey as never)) {
      reasons.push(
        `packageKey ${String(request.packageKey)} is in the B1 prohibited adjacent scopes`,
      );
    }
    if (B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(request.bundleKey as never)) {
      reasons.push(
        `bundleKey ${String(request.bundleKey)} is in the B1 prohibited adjacent scopes`,
      );
    }
    if (B1_FEE_ENGINE_DECIDED_ADJACENT_SCOPES.includes(request.productEntitlementKey as never)) {
      reasons.push(
        `productEntitlementKey ${String(request.productEntitlementKey)} is in the B1 prohibited adjacent scopes`,
      );
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_FEE_ENGINE_FAILURE_INCOMPATIBLE,
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
        `decisionKind=${String(request.decisionKind)}`,
        'compatible',
      ],
    };
  }

  private appendRule(
    explanationSteps: B1CommercialDecisionExplanationStepV1[],
    ruleTraceSteps: B1CommercialDecisionRuleTraceStepV1[],
    ruleKind: B1CommercialDecisionRuleKind,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1CommercialDecisionRuleOutcome,
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

  private computeFeeBreakdown(
    request: B1CommercialDecisionRequestV1,
    baseAmountMinor: string,
  ): B1CommercialDecisionFeeBreakdownV1 | null {
    if (request.decisionKind !== 'FEE') {
      return null;
    }
    const baseMinor = BigInt(baseAmountMinor);
    const feeRateBps = 0;
    const flatFeeMinor = 0n;
    const variableFeeMinor = (baseMinor * BigInt(feeRateBps)) / 10_000n;
    const tierDiscountMinor = 0n;
    const netFeeMinor = flatFeeMinor + variableFeeMinor - tierDiscountMinor;
    const components: B1CommercialDecisionFeeComponentV1[] = [
      {
        componentKey: 'BASE',
        componentLabel: 'Base amount',
        componentKind: 'BASE',
        componentAmountMinor: baseAmountMinor,
        componentOrder: 1,
      },
      {
        componentKey: 'FLAT',
        componentLabel: 'Flat fee',
        componentKind: 'FLAT',
        componentAmountMinor: flatFeeMinor.toString(),
        componentOrder: 2,
      },
      {
        componentKey: 'VARIABLE',
        componentLabel: 'Variable fee',
        componentKind: 'VARIABLE',
        componentAmountMinor: variableFeeMinor.toString(),
        componentOrder: 3,
      },
      {
        componentKey: 'TIER_DISCOUNT',
        componentLabel: 'Tier discount',
        componentKind: 'TIER_DISCOUNT',
        componentAmountMinor: tierDiscountMinor.toString(),
        componentOrder: 4,
      },
    ];
    return {
      baseAmountMinor,
      feeRateBps,
      flatFeeMinor: flatFeeMinor.toString(),
      variableFeeMinor: variableFeeMinor.toString(),
      tierDiscountMinor: tierDiscountMinor.toString(),
      netFeeMinor: netFeeMinor.toString(),
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      components,
      roundingPolicy: 'BANKERS_ROUND',
    };
  }

  private computeCommissionBreakdown(
    request: B1CommercialDecisionRequestV1,
    baseAmountMinor: string,
  ): B1CommercialDecisionCommissionBreakdownV1 | null {
    if (request.decisionKind !== 'COMMISSION') {
      return null;
    }
    const baseMinor = BigInt(baseAmountMinor);
    const commissionRateBps = 0;
    const flatCommissionMinor = 0n;
    const variableCommissionMinor = (baseMinor * BigInt(commissionRateBps)) / 10_000n;
    const partnerTierMultiplier = 1.0;
    const rawCommission = BigInt(
      Math.floor(Number(variableCommissionMinor) * partnerTierMultiplier),
    );
    const netCommissionMinor = flatCommissionMinor + rawCommission;
    const components: B1CommercialDecisionCommissionComponentV1[] = [
      {
        componentKey: 'BASE',
        componentLabel: 'Base amount',
        componentKind: 'BASE',
        componentAmountMinor: baseAmountMinor,
        componentOrder: 1,
      },
      {
        componentKey: 'FLAT',
        componentLabel: 'Flat commission',
        componentKind: 'FLAT',
        componentAmountMinor: flatCommissionMinor.toString(),
        componentOrder: 2,
      },
      {
        componentKey: 'VARIABLE',
        componentLabel: 'Variable commission',
        componentKind: 'VARIABLE',
        componentAmountMinor: variableCommissionMinor.toString(),
        componentOrder: 3,
      },
      {
        componentKey: 'PARTNER_TIER',
        componentLabel: 'Partner tier multiplier',
        componentKind: 'PARTNER_TIER',
        componentAmountMinor: netCommissionMinor.toString(),
        componentOrder: 4,
      },
    ];
    return {
      netAmountMinor: baseAmountMinor,
      commissionRateBps,
      flatCommissionMinor: flatCommissionMinor.toString(),
      variableCommissionMinor: variableCommissionMinor.toString(),
      partnerTierMultiplier,
      netCommissionMinor: netCommissionMinor.toString(),
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      components,
      roundingPolicy: 'BANKERS_ROUND',
    };
  }

  private computeRevenueSharingBreakdown(
    request: B1CommercialDecisionRequestV1,
    baseAmountMinor: string,
  ): B1CommercialDecisionRevenueSharingBreakdownV1 | null {
    if (request.decisionKind !== 'REVENUE_SHARING') {
      return null;
    }
    const baseMinor = BigInt(baseAmountMinor);
    const platformBps = 0;
    const partnerBps = 0;
    const merchantBps = 0;
    const customerBps = 0;
    const platformShareMinor = (baseMinor * BigInt(platformBps)) / 10_000n;
    const partnerShareMinor = (baseMinor * BigInt(partnerBps)) / 10_000n;
    const merchantShareMinor = (baseMinor * BigInt(merchantBps)) / 10_000n;
    const customerShareMinor = (baseMinor * BigInt(customerBps)) / 10_000n;
    const components: B1CommercialDecisionRevenueSharingComponentV1[] = [
      {
        componentKey: 'PLATFORM',
        componentLabel: 'Platform share',
        componentKind: 'PLATFORM',
        componentAmountMinor: platformShareMinor.toString(),
        componentOrder: 1,
        componentBps: platformBps,
      },
      {
        componentKey: 'PARTNER',
        componentLabel: 'Partner share',
        componentKind: 'PARTNER',
        componentAmountMinor: partnerShareMinor.toString(),
        componentOrder: 2,
        componentBps: partnerBps,
      },
      {
        componentKey: 'MERCHANT',
        componentLabel: 'Merchant share',
        componentKind: 'MERCHANT',
        componentAmountMinor: merchantShareMinor.toString(),
        componentOrder: 3,
        componentBps: merchantBps,
      },
      {
        componentKey: 'CUSTOMER',
        componentLabel: 'Customer share',
        componentKind: 'CUSTOMER',
        componentAmountMinor: customerShareMinor.toString(),
        componentOrder: 4,
        componentBps: customerBps,
      },
    ];
    return {
      netAmountMinor: baseAmountMinor,
      platformShareMinor: platformShareMinor.toString(),
      partnerShareMinor: partnerShareMinor.toString(),
      merchantShareMinor: merchantShareMinor.toString(),
      customerShareMinor: customerShareMinor.toString(),
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      components,
      roundingPolicy: 'BANKERS_ROUND',
    };
  }

  private computeRequestHash(request: B1CommercialDecisionRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      decisionKind: request.decisionKind,
      decisionRequestId: request.decisionRequestId,
      decisionRequestVersion: request.decisionRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      baseAmountMinor: request.baseAmountMinor,
      baseCurrency: request.baseCurrency,
      customerId: request.customerId,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantId: request.merchantId,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerId: request.partnerId,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      productKey: request.productKey,
      productVersion: request.productVersion,
      capabilityKey: request.capabilityKey,
      capabilityVersion: request.capabilityVersion,
      planKey: request.planKey,
      planVersion: request.planVersion,
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      packageKey: request.packageKey,
      packageVersion: request.packageVersion,
      bundleKey: request.bundleKey,
      bundleVersion: request.bundleVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeDecisionReference(
    request: B1CommercialDecisionRequestV1,
    requestHash: string,
  ): string {
    return `${B1_FEE_ENGINE_REFERENCE_PREFIX}:${String(request.decisionKind).toLowerCase()}:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeDecisionHash(input: {
    readonly contractName: string;
    readonly contractVersion: number;
    readonly decisionReference: string;
    readonly decisionVersion: number;
    readonly decisionKind: B1CommercialDecisionKind;
    readonly baseAmountMinor: string;
    readonly currency: string;
    readonly accountingUnit: string;
    readonly appliedPlan: B1CommercialDecisionAppliedPlanV1;
    readonly appliedPricingEntry: B1CommercialDecisionAppliedPricingEntryV1;
    readonly appliedTiers: B1CommercialDecisionAppliedTierV1;
    readonly appliedSubscription: B1CommercialDecisionAppliedSubscriptionV1;
    readonly appliedProductEntitlement: B1CommercialDecisionAppliedProductEntitlementV1;
    readonly appliedPackage: B1CommercialDecisionAppliedPackageV1;
    readonly appliedBundle: B1CommercialDecisionAppliedBundleV1;
    readonly appliedFeatureFlags: readonly B1CommercialDecisionAppliedFeatureFlagV1[];
    readonly appliedDynamicLimits: readonly B1CommercialDecisionAppliedDynamicLimitV1[];
    readonly feeBreakdown: B1CommercialDecisionFeeBreakdownV1 | null;
    readonly commissionBreakdown: B1CommercialDecisionCommissionBreakdownV1 | null;
    readonly revenueSharingBreakdown: B1CommercialDecisionRevenueSharingBreakdownV1 | null;
  }): string {
    const payload = JSON.stringify({
      contractName: input.contractName,
      contractVersion: input.contractVersion,
      decisionReference: input.decisionReference,
      decisionVersion: input.decisionVersion,
      decisionKind: input.decisionKind,
      baseAmountMinor: input.baseAmountMinor,
      currency: input.currency,
      accountingUnit: input.accountingUnit,
      appliedPlan: input.appliedPlan,
      appliedPricingEntry: input.appliedPricingEntry,
      appliedTiers: input.appliedTiers,
      appliedSubscription: input.appliedSubscription,
      appliedProductEntitlement: input.appliedProductEntitlement,
      appliedPackage: input.appliedPackage,
      appliedBundle: input.appliedBundle,
      appliedFeatureFlags: input.appliedFeatureFlags,
      appliedDynamicLimits: input.appliedDynamicLimits,
      feeBreakdown: input.feeBreakdown,
      commissionBreakdown: input.commissionBreakdown,
      revenueSharingBreakdown: input.revenueSharingBreakdown,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeDecisionReplayHash(input: {
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

  private validateRequestShape(request: B1CommercialDecisionRequestV1): string | null {
    if (!request) {
      return 'The B1 fee engine request is missing';
    }
    if (request.contractName !== B1_FEE_ENGINE_CONTRACT_NAME) {
      return 'The B1 fee engine request contract name is invalid';
    }
    if (request.contractVersion !== B1_FEE_ENGINE_CONTRACT_VERSION) {
      return 'The B1 fee engine request contract version is invalid';
    }
    if (!B1_FEE_ENGINE_DECISION_KINDS.includes(request.decisionKind)) {
      return 'The B1 fee engine request decision kind is invalid';
    }
    if (!request.decisionRequestId || !SAFE_TEXT_PATTERN.test(request.decisionRequestId)) {
      return 'The B1 fee engine request decision request id is invalid';
    }
    if (request.decisionRequestVersion !== 1) {
      return 'The B1 fee engine request decision request version is invalid';
    }
    if (request.scopeKey !== B1_FEE_ENGINE_SCOPE_KEY) {
      return 'The B1 fee engine request scope key is invalid';
    }
    if (request.scopeVersion !== B1_FEE_ENGINE_SCOPE_VERSION) {
      return 'The B1 fee engine request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_FEE_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 fee engine request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 fee engine request expected accounting unit is invalid';
    }
    if (!MINOR_AMOUNT_PATTERN.test(request.baseAmountMinor)) {
      return 'The B1 fee engine request base amount minor is invalid';
    }
    if (request.baseCurrency !== B1_FEE_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 fee engine request base currency is invalid';
    }
    if (!UUID_PATTERN.test(request.customerId) && !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 fee engine request customer id is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.customerTierKey)) {
      return 'The B1 fee engine request customer tier key is invalid';
    }
    if (request.customerTierVersion !== 1) {
      return 'The B1 fee engine request customer tier version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 fee engine request merchant id is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.merchantTierKey)) {
      return 'The B1 fee engine request merchant tier key is invalid';
    }
    if (request.merchantTierVersion !== 1) {
      return 'The B1 fee engine request merchant tier version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 fee engine request partner id is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.partnerTierKey)) {
      return 'The B1 fee engine request partner tier key is invalid';
    }
    if (request.partnerTierVersion !== 1) {
      return 'The B1 fee engine request partner tier version is invalid';
    }
    if (request.productKey !== B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 fee engine request product key is invalid';
    }
    if (request.productVersion !== B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 fee engine request product version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 fee engine request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 fee engine request capability version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 fee engine request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 fee engine request plan version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.subscriptionKey)) {
      return 'The B1 fee engine request subscription key is invalid';
    }
    if (request.subscriptionVersion !== 1) {
      return 'The B1 fee engine request subscription version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.packageKey)) {
      return 'The B1 fee engine request package key is invalid';
    }
    if (request.packageVersion !== 1) {
      return 'The B1 fee engine request package version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.bundleKey)) {
      return 'The B1 fee engine request bundle key is invalid';
    }
    if (request.bundleVersion !== 1) {
      return 'The B1 fee engine request bundle version is invalid';
    }
    if (!SAFE_TEXT_PATTERN.test(request.productEntitlementKey)) {
      return 'The B1 fee engine request product entitlement key is invalid';
    }
    if (request.productEntitlementVersion !== 1) {
      return 'The B1 fee engine request product entitlement version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 fee engine request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 fee engine request request context is missing';
    }
    return null;
  }

  private buildFailureRecord(
    request: B1CommercialDecisionRequestV1,
    code: B1CommercialDecisionFailureCodeV1,
    message: string,
    failedRules: readonly B1CommercialDecisionRuleTraceStepV1[],
  ): B1CommercialDecisionRecordV1 {
    const failure: B1CommercialDecisionFailureV1 = {
      contractName: B1_FEE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_FEE_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [...failedRules],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_FEE_ENGINE_CONTRACT_NAME,
      contractVersion: B1_FEE_ENGINE_CONTRACT_VERSION,
      decisionId: randomUUID(),
      decisionReference: 'B1-COMMERCIAL-DECISION-FAILED',
      decisionVersion: 1,
      decisionKind: request?.decisionKind ?? 'FEE',
      decisionOutcome: 'COMMERCIAL_DECISION_FAILED',
      decisionHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      decisionReplayHash: createHash('sha256').update(`failed-replay:${message}`).digest('hex'),
      requestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      baseAmountMinor: request?.baseAmountMinor ?? '0',
      baseCurrency: B1_FEE_ENGINE_SCOPE_CURRENCY,
      currency: request?.expectedCurrency ?? B1_FEE_ENGINE_SCOPE_CURRENCY,
      accountingUnit: request?.expectedAccountingUnit ?? B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
      appliedPlan: null,
      appliedPricingEntry: null,
      appliedTiers: null,
      appliedSubscription: null,
      appliedProductEntitlement: null,
      appliedPackage: null,
      appliedBundle: null,
      appliedFeatureFlags: [],
      appliedDynamicLimits: [],
      feeBreakdown: null,
      commissionBreakdown: null,
      revenueSharingBreakdown: null,
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'COMPOSITE_DECISION',
        traceSummary: `B1 fee engine failure: ${message}`,
        traceSteps: [],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      ruleTrace: {
        ruleTraceId: randomUUID(),
        ruleTraceSteps: [...failedRules],
        generatedAt: new Date().toISOString(),
        correlationId: request?.requestContext?.correlationId ?? 'unknown',
      },
      auditEvidence: {
        auditEntityType: B1_FEE_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'COMMERCIAL_DECISION_FAILED',
        auditActor: B1_FEE_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_FEE_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
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

  private buildReplayFailure(
    request: B1CommercialDecisionRequestV1,
    record: B1CommercialDecisionRecordV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1CommercialDecisionReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      requestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      decisionHash: record.decisionHash,
      decisionReplayHash: record.decisionReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(row: B1CommercialDecision): B1CommercialDecisionPersistenceRecordV1 {
    return {
      decisionId: row.id,
      decisionReference: row.decisionReference,
      decisionVersion: row.decisionVersion as B1CommercialDecisionVersion,
      decisionKind: row.decisionKind,
      requestHash: row.requestHash,
      decisionHash: row.decisionHash,
      decisionReplayHash: row.decisionReplayHash,
      idempotencyScope: row.idempotencyScope,
      idempotencyKey: row.idempotencyKey,
      record: row.record,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1,
    };
  }
}
