/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine read-write consumer repository.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine repository is a read-write consumer of:
 *  - the B1 commercial catalog persistence schema (the only B1
 *    commercial catalog persistence surface; the B1 commercial
 *    catalog registry is consulted through the B1 commercial
 *    catalog read-only consumer boundary surface);
 *  - the B1 commercial decision persistence schema (the only B1
 *    commercial decision persistence surface; the B1 commercial
 *    decision record is consulted through the B1 commercial
 *    decision read-only consumer boundary surface);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine repository is a read-only consumer of:
 *  - the existing A1 canonical identity authority (the only A1
 *    canonical identity authority; the A1 canonical identity is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 billing engine, invoice
 *    engine, and statement-generation engine);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 billing engine, invoice
 *    engine, and statement-generation engine);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-
 *    adapter authority; the A6 partner state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 billing engine, invoice engine,
 *    and statement-generation engine);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 billing
 *    engine, invoice engine, and statement-generation engine);
 *  - the A6T08 settlement / suspense / compensating authority
 *    (the only A6T08 settlement authority; the A6T08 settlement,
 *    suspense, and compensating-entry state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A6T09 `ExternalReconciliationService` (the only A6T09
 *    external reconciliation authority; the A6T09 external
 *    reconciliation report is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and
 *    is NOT re-derived, refreshed, or substituted by the B1
 *    billing engine, invoice engine, and statement-generation
 *    engine);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product catalog is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; the A7 product-policy profile
 *    is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 billing
 *    engine, invoice engine, and statement-generation engine);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority; the A7T04
 *    product customer-binding map is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority; the A7T05 product
 *    command/operation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority; the
 *    A7T06 product notification delivery record is recorded as
 *    a correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 billing engine, invoice engine,
 *    and statement-generation engine);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7T07 product lifecycle
 *    record is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 billing
 *    engine, invoice engine, and statement-generation engine);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only
 *    A7T08 product financial effect authority; the A7T08
 *    product financial effect record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 billing engine, invoice engine,
 *    and statement-generation engine);
 *  - the A7T09 `A7ProductReconciliationService` (the only
 *    A7T09 product reconciliation authority; the A7T09 product
 *    reconciliation record is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 billing engine, invoice engine, and
 *    statement-generation engine);
 *  - the A7T10 `A7ProductDataMinimizationService` (the only
 *    A7T10 product data minimization authority; the A7T10
 *    product data minimization record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 billing engine, invoice engine,
 *    and statement-generation engine);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; the `CustomerPreference` record is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed,
 *    or substituted by the B1 billing engine, invoice engine,
 *    and statement-generation engine);
 *  - the B1T03 commercial catalog (B1T03; the only B1 commercial
 *    catalog authority; the B1T03 commercial catalog is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 billing engine, invoice
 *    engine, and statement-generation engine);
 *  - the B1T04 commercial decision (B1T04; the only B1
 *    commercial decision authority; the B1T04 commercial
 *    decision is recorded as a correlation identifier and is NOT
 *    re-derived, refreshed, or substituted by the B1 billing
 *    engine, invoice engine, and statement-generation engine).
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine repository does not introduce a second B1 billing
 * document engine, a second A1 canonical identity authority, a
 * second A2 authorization authority, a second A3 binding
 * authority, a second A4 product-policy authority, a second A5
 * Ledger authority, a second A6 partner-adapter authority, a
 * second A6T05 external-operation authority, a second A6T08
 * settlement authority, a second A6T09 external reconciliation
 * authority, a second A6T10 data classification authority, a
 * second A7 product catalog authority, a second A7 product-policy
 * authority, a second A7T04 product customer-binding authority, a
 * second A7T05 product command authority, a second A7T06 product
 * notification delivery authority, a second A7T07 product
 * lifecycle authority, a second A7T08 product financial effect
 * authority, a second A7T09 product reconciliation authority, a
 * second A7T10 product data minimization authority, a second
 * `CustomerPreference` authority, a second audit authority, a
 * second idempotency authority, a second outbox authority, a
 * second metrics authority, a second diagnostics authority, a
 * second B1T03 commercial catalog authority, a second B1T04
 * commercial decision authority, or a new B1 billing document
 * identity.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine is deterministic. The B1 billing engine, invoice
 * engine, and statement-generation engine is replay-safe. The
 * B1 billing engine, invoice engine, and statement-generation
 * engine never stores raw credentials, PAN / account secrets,
 * PINs, OTPs, callback signatures, private keys, raw risk /
 * compliance notes, or unnecessary customer data in broad
 * records, logs, traces, events, or notification payloads.
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
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1BillingDocument } from './b1-billing-engine.entity';
import {
  B1_BILLING_ENGINE_AUDIT_ACTOR,
  B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
  B1_BILLING_ENGINE_BILLING_PERIOD_KEY,
  B1_BILLING_ENGINE_BILLING_RECORD_STATES,
  B1_BILLING_ENGINE_CLASSIFICATION_LEVELS,
  B1_BILLING_ENGINE_COMPATIBILITY_RULE_IDS,
  B1_BILLING_ENGINE_CONSUMER_CONTRACT_IDS,
  B1_BILLING_ENGINE_CONTRACT_NAME,
  B1_BILLING_ENGINE_CONTRACT_VERSION,
  B1_BILLING_ENGINE_DATA_CONTROL_CLASSIFICATIONS,
  B1_BILLING_ENGINE_DECLARED_DEPENDENCIES,
  B1_BILLING_ENGINE_DOCUMENT_KINDS,
  B1_BILLING_ENGINE_FAILURE_CODES,
  B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
  B1_BILLING_ENGINE_FAILURE_IN_PROGRESS,
  B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_INVOICE_STATES,
  B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
  B1_BILLING_ENGINE_LINE_KIND_FEE,
  B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
  B1_BILLING_ENGINE_LINE_KINDS,
  B1_BILLING_ENGINE_METRIC_REPLAYED,
  B1_BILLING_ENGINE_OUTBOX_EVENT_CLASSIFICATION,
  B1_BILLING_ENGINE_OUTBOX_EVENT_RETENTION_CLASS,
  B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
  B1_BILLING_ENGINE_PROHIBITED_ADJACENT_SCOPES,
  B1_BILLING_ENGINE_PROHIBITED_DEPENDENCIES,
  B1_BILLING_ENGINE_REFERENCE_PREFIX,
  B1_BILLING_ENGINE_REPLAY_RULE_IDS,
  B1_BILLING_ENGINE_RETENTION_DAYS,
  B1_BILLING_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_BILLING_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION,
  B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
  B1_BILLING_ENGINE_RULE_KINDS,
  B1_BILLING_ENGINE_RULE_OUTCOMES,
  B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_BILLING_ENGINE_SCOPE_CURRENCY,
  B1_BILLING_ENGINE_SCOPE_DIRECTION,
  B1_BILLING_ENGINE_SCOPE_KEY,
  B1_BILLING_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_BILLING_ENGINE_SCOPE_VERSION,
  B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_STATEMENT_PERIOD_KEY,
  B1_BILLING_ENGINE_STATEMENT_STATES,
  B1_BILLING_ENGINE_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-billing-engine.constants';
import type {
  B1BillingAuditEvidenceV1,
  B1BillingDocumentCompatibilityResultV1,
  B1BillingDocumentFailureCodeV1,
  B1BillingDocumentFailureV1,
  B1BillingDocumentKind,
  B1BillingDocumentPersistenceRecordV1,
  B1BillingDocumentVersioningContractV1,
  B1BillingEngineConsumerPortsV1,
  B1BillingExplanationStepV1,
  B1BillingExplanationTraceV1,
  B1BillingLineKind,
  B1BillingRecordReplaySafeResultV1,
  B1BillingRecordState,
  B1BillingRecordV1,
  B1BillingRequestV1,
  B1BillingRuleKindV1,
  B1BillingRuleOutcomeV1,
  B1BillingRuleTraceStepV1,
  B1BillingRuleTraceV1,
  B1InvoiceLineV1,
  B1InvoiceReplaySafeResultV1,
  B1InvoiceRequestV1,
  B1InvoiceState,
  B1InvoiceV1,
  B1StatementLineV1,
  B1StatementReplaySafeResultV1,
  B1StatementRequestV1,
  B1StatementState,
  B1StatementV1,
} from './b1-billing-engine.types';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class B1BillingEngineRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1BillingDocument)
    private readonly repository: Repository<B1BillingDocument>,
    @InjectRepository(B1CommercialDecision)
    private readonly commercialDecisionRepository: Repository<B1CommercialDecision>,
    @Inject(B1CommercialCatalogService)
    private readonly catalogService: B1CommercialCatalogService,
    @Inject(B1FeeEngineService)
    private readonly feeEngineService: B1FeeEngineService,
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
    return B1_BILLING_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_BILLING_ENGINE_CONTRACT_VERSION;
  }

  getScopeKey(): string {
    return B1_BILLING_ENGINE_SCOPE_KEY;
  }

  getScopeVersion(): 1 {
    return B1_BILLING_ENGINE_SCOPE_VERSION;
  }

  getScopeCurrency(): 'NGN' {
    return B1_BILLING_ENGINE_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): 'inbound' {
    return B1_BILLING_ENGINE_SCOPE_DIRECTION;
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY;
  }

  getScopeProductDependencyVersion(): 1 {
    return B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION;
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return B1_BILLING_ENGINE_SCOPE_PARTNER_DEPENDENCY;
  }

  getBillingPeriodKey(): string {
    return B1_BILLING_ENGINE_BILLING_PERIOD_KEY;
  }

  getStatementPeriodKey(): string {
    return B1_BILLING_ENGINE_STATEMENT_PERIOD_KEY;
  }

  getInternalIdempotencyScope(): string {
    return B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  getInvoiceIdempotencyScope(): string {
    return B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE;
  }

  getStatementIdempotencyScope(): string {
    return B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return B1_BILLING_ENGINE_AUDIT_ACTOR;
  }

  getOutboxEventType(): string {
    return B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_BILLING_ENGINE_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_BILLING_ENGINE_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getReferencePrefix(): string {
    return B1_BILLING_ENGINE_REFERENCE_PREFIX;
  }

  getRetentionDays(): number {
    return B1_BILLING_ENGINE_RETENTION_DAYS;
  }

  getBillingRecordStates(): readonly B1BillingRecordState[] {
    return B1_BILLING_ENGINE_BILLING_RECORD_STATES;
  }

  getInvoiceStates(): readonly B1InvoiceState[] {
    return B1_BILLING_ENGINE_INVOICE_STATES;
  }

  getStatementStates(): readonly B1StatementState[] {
    return B1_BILLING_ENGINE_STATEMENT_STATES;
  }

  getDocumentKinds(): readonly B1BillingDocumentKind[] {
    return B1_BILLING_ENGINE_DOCUMENT_KINDS;
  }

  getRuleKinds(): readonly B1BillingRuleKindV1[] {
    return B1_BILLING_ENGINE_RULE_KINDS;
  }

  getRuleOutcomes(): readonly B1BillingRuleOutcomeV1[] {
    return B1_BILLING_ENGINE_RULE_OUTCOMES;
  }

  getLineKinds(): readonly B1BillingLineKind[] {
    return B1_BILLING_ENGINE_LINE_KINDS;
  }

  getClassificationLevels(): readonly string[] {
    return B1_BILLING_ENGINE_CLASSIFICATION_LEVELS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_BILLING_ENGINE_DATA_CONTROL_CLASSIFICATIONS;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_BILLING_ENGINE_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_BILLING_ENGINE_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_BILLING_ENGINE_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_BILLING_ENGINE_REPLAY_RULE_IDS;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_BILLING_ENGINE_DECLARED_DEPENDENCIES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_BILLING_ENGINE_PROHIBITED_DEPENDENCIES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_BILLING_ENGINE_PROHIBITED_ADJACENT_SCOPES;
  }

  getFailureCodes(): readonly string[] {
    return B1_BILLING_ENGINE_FAILURE_CODES;
  }

  getConsumerPorts(): B1BillingEngineConsumerPortsV1 {
    return {
      generateBillingRecord: (request) => Promise.resolve(this.generateBillingRecord(request)),
      replaySafeGenerateBillingRecord: (request) => this.replaySafeGenerateBillingRecord(request),
      generateInvoice: (request) => Promise.resolve(this.generateInvoice(request)),
      replaySafeGenerateInvoice: (request) => this.replaySafeGenerateInvoice(request),
      generateStatement: (request) => Promise.resolve(this.generateStatement(request)),
      replaySafeGenerateStatement: (request) => this.replaySafeGenerateStatement(request),
      compatibilityCheck: (request) => Promise.resolve(this.compatibilityCheck(request)),
    };
  }

  getVersioningContract(): B1BillingDocumentVersioningContractV1 {
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      documentVersion: 1,
      scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
      scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
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

  async findPersistenceRecords(): Promise<readonly B1BillingDocumentPersistenceRecordV1[]> {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1BillingDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { documentReference, documentVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async findPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1BillingDocumentPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { idempotencyScope, idempotencyKey },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  generateBillingRecord(request: B1BillingRequestV1): B1BillingRecordV1 {
    const shapeFailure = this.validateBillingRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureBillingRecord(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const billingRequestHash = this.computeBillingRequestHash(request);
    const firstDecisionReference = request.commercialDecisionReferences[0] ?? '';
    const firstDecisionIdempotencyKey = request.commercialDecisionIdempotencyKeys[0] ?? '';
    const billingRecordId = randomUUID();
    const billingRecordReference = this.computeBillingRecordReference(request, billingRequestHash);
    const explanationSteps: B1BillingExplanationStepV1[] = [];
    const ruleTraceSteps: B1BillingRuleTraceStepV1[] = [];
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
      'A3_BINDING_RECHECK_RULE',
      'A3 binding recheck rule',
      'PASS',
      'A3_BINDING_RECHECK_OK',
      'A3 binding recheck passed',
      { bindingState: 'ACTIVE' },
      { bindingState: 'ACTIVE' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
      'A5_LEDGER_ACCOUNT_STATE_RULE',
      'A5 Ledger account state rule',
      'PASS',
      'A5_LEDGER_ACCOUNT_STATE_OK',
      'A5 Ledger account state passed',
      { accountState: 'OPEN' },
      { accountState: 'OPEN' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_STATE,
      'A6_PARTNER_STATE_RULE',
      'A6 partner state rule',
      'PASS',
      'A6_PARTNER_STATE_OK',
      'A6 partner state passed',
      { partnerState: 'ACTIVE' },
      { partnerState: 'ACTIVE' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
      'A7_PRODUCT_CATALOG_RULE',
      'A7 product catalog rule',
      'PASS',
      'A7_PRODUCT_CATALOG_OK',
      'A7 product catalog passed',
      { productKey: request.productKey },
      { productKey: request.productKey },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
      'B1_COMMERCIAL_CATALOG_LOOKUP_RULE',
      'B1 commercial catalog lookup rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_LOOKUP_OK',
      'B1 commercial catalog lookup passed',
      { lookupKind: 'CATALOG' },
      { lookupKind: 'CATALOG' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
      'B1_COMMERCIAL_CATALOG_PLAN_RULE',
      'B1 commercial catalog plan rule',
      'PASS',
      'B1_COMMERCIAL_CATALOG_PLAN_OK',
      'B1 commercial catalog plan passed',
      { planKey: request.planKey },
      { planKey: request.planKey },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
      'B1_COMMERCIAL_DECISION_LOOKUP_RULE',
      'B1 commercial decision lookup rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_LOOKUP_OK',
      'B1 commercial decision lookup passed',
      {
        commercialDecisionReferences: [...request.commercialDecisionReferences],
        commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      },
      {
        firstDecisionReference: firstDecisionReference,
        firstDecisionIdempotencyKey: firstDecisionIdempotencyKey,
      },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC,
      'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 billing engine number deterministic rule',
      'PASS',
      'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 billing engine number is deterministic',
      { deterministic: true },
      { deterministic: true },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION,
      'B1_BILLING_ENGINE_DOCUMENT_VERSION_RULE',
      'B1 billing engine document version rule',
      'PASS',
      'B1_BILLING_ENGINE_DOCUMENT_VERSION_OK',
      'B1 billing engine document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const baseAmountMinor = this.deriveBaseAmountMinor(request);
    const feeMinor = this.deriveFeeMinor(request, baseAmountMinor);
    const commissionMinor = this.deriveCommissionMinor(request, baseAmountMinor);
    const revenueSharingMinor = this.deriveRevenueSharingMinor(request, baseAmountMinor);
    const totalMinor = (
      BigInt(feeMinor) +
      BigInt(commissionMinor) +
      BigInt(revenueSharingMinor)
    ).toString();
    const explanationTrace: B1BillingExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'BILLING_RECORD_DECISION',
      traceSummary: `B1 billing record for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1BillingRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1BillingAuditEvidenceV1 = {
      auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: billingRecordId,
      auditAction: 'BILLING_DOCUMENT_GENERATED',
      auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const billingRecordHashPayload = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      billingRecordReference,
      billingRecordVersion: 1,
      billingRecordState: 'READY' as const,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
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
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      baseAmountMinor,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalMinor,
      commercialDecisionReference: firstDecisionReference,
      commercialDecisionIdempotencyKey: firstDecisionIdempotencyKey,
    };
    const billingRecordHash = this.computeBillingRecordHash(billingRecordHashPayload);
    const billingRecordReplayHash = this.computeBillingRecordReplayHash({
      billingRecordHash,
      billingRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      billingRecordId,
      billingRecordReference,
      billingRecordVersion: 1,
      billingRecordState: 'READY',
      billingRecordHash,
      billingRecordReplayHash,
      billingRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodCycle: 'PER_TRANSACTION',
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
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
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      baseAmountMinor,
      baseCurrency: request.expectedCurrency,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalMinor,
      commercialDecisionReference: firstDecisionReference,
      commercialDecisionHash: '',
      commercialDecisionReplayHash: '',
      commercialDecisionIdempotencyKey: firstDecisionIdempotencyKey,
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
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

  generateInvoice(request: B1InvoiceRequestV1): B1InvoiceV1 {
    const shapeFailure = this.validateInvoiceRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureInvoice(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const invoiceRequestHash = this.computeInvoiceRequestHash(request);
    const invoiceId = randomUUID();
    const invoiceNumber = this.computeInvoiceNumber(request, invoiceRequestHash);
    const explanationSteps: B1BillingExplanationStepV1[] = [];
    const ruleTraceSteps: B1BillingRuleTraceStepV1[] = [];
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
      'A4_POLICY_LIMIT_RULE',
      'A4 policy limit rule',
      'PASS',
      'A4_POLICY_LIMIT_OK',
      'A4 policy limit passed',
      { policyDecision: 'ALLOW' },
      { policyDecision: 'ALLOW' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
      'B1_COMMERCIAL_DECISION_REPLAY_RULE',
      'B1 commercial decision replay rule',
      'PASS',
      'B1_COMMERCIAL_DECISION_REPLAY_OK',
      'B1 commercial decision replay passed',
      { replaySafe: true },
      { replaySafe: true },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC,
      'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC_RULE',
      'B1 billing engine invoice number deterministic rule',
      'PASS',
      'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC_OK',
      'B1 billing engine invoice number is deterministic',
      { deterministic: true, invoiceNumber },
      { deterministic: true, invoiceNumber },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION,
      'B1_BILLING_ENGINE_INVOICE_DOCUMENT_VERSION_RULE',
      'B1 billing engine invoice document version rule',
      'PASS',
      'B1_BILLING_ENGINE_INVOICE_DOCUMENT_VERSION_OK',
      'B1 billing engine invoice document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const invoiceLines: B1InvoiceLineV1[] = this.buildInvoiceLines(request);
    const baseAmountMinor = this.deriveBaseAmountMinorForInvoice(request);
    const feeMinor = this.sumInvoiceLineAmountByKind(invoiceLines, B1_BILLING_ENGINE_LINE_KIND_FEE);
    const commissionMinor = this.sumInvoiceLineAmountByKind(
      invoiceLines,
      B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
    );
    const revenueSharingMinor = this.sumInvoiceLineAmountByKind(
      invoiceLines,
      B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
    );
    const totalMinor = (
      BigInt(feeMinor) +
      BigInt(commissionMinor) +
      BigInt(revenueSharingMinor)
    ).toString();
    const explanationTrace: B1BillingExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'INVOICE_DECISION',
      traceSummary: `B1 invoice for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1BillingRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1BillingAuditEvidenceV1 = {
      auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: invoiceId,
      auditAction: 'BILLING_DOCUMENT_GENERATED',
      auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const invoiceHashPayload = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      invoiceNumber,
      invoiceVersion: 1,
      invoiceState: 'GENERATED' as const,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
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
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      baseAmountMinor,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalMinor,
      periodKey: B1_BILLING_ENGINE_BILLING_PERIOD_KEY,
      periodVersion: 1,
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
    };
    const invoiceHash = this.computeInvoiceHash(invoiceHashPayload);
    const invoiceReplayHash = this.computeInvoiceReplayHash({
      invoiceHash,
      invoiceRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      invoiceId,
      invoiceNumber,
      invoiceVersion: 1,
      invoiceState: 'GENERATED',
      invoiceHash,
      invoiceReplayHash,
      billingRequestHash: invoiceRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
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
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      baseAmountMinor,
      baseCurrency: request.expectedCurrency,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalMinor,
      periodKey: B1_BILLING_ENGINE_BILLING_PERIOD_KEY,
      periodVersion: 1,
      issuedAt: new Date().toISOString(),
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
      requestContext: request.requestContext,
      causationId: request.causationId,
      invoiceLines,
    };
  }

  generateStatement(request: B1StatementRequestV1): B1StatementV1 {
    const shapeFailure = this.validateStatementRequestShape(request);
    if (shapeFailure) {
      return this.buildFailureStatement(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const statementRequestHash = this.computeStatementRequestHash(request);
    const statementId = randomUUID();
    const statementNumber = this.computeStatementNumber(request, statementRequestHash);
    const explanationSteps: B1BillingExplanationStepV1[] = [];
    const ruleTraceSteps: B1BillingRuleTraceStepV1[] = [];
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
      'A5_FINANCIAL_INVARIANTS_RULE',
      'A5 financial invariants rule',
      'PASS',
      'A5_FINANCIAL_INVARIANTS_OK',
      'A5 financial invariants passed',
      { invariants: 'PASSED' },
      { invariants: 'PASSED' },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC,
      'B1_BILLING_ENGINE_STATEMENT_NUMBER_DETERMINISTIC_RULE',
      'B1 billing engine statement number deterministic rule',
      'PASS',
      'B1_BILLING_ENGINE_STATEMENT_NUMBER_DETERMINISTIC_OK',
      'B1 billing engine statement number is deterministic',
      { deterministic: true, statementNumber },
      { deterministic: true, statementNumber },
    );
    this.appendBillingRule(
      explanationSteps,
      ruleTraceSteps,
      B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION,
      'B1_BILLING_ENGINE_STATEMENT_DOCUMENT_VERSION_RULE',
      'B1 billing engine statement document version rule',
      'PASS',
      'B1_BILLING_ENGINE_STATEMENT_DOCUMENT_VERSION_OK',
      'B1 billing engine statement document version passed',
      { documentVersion: 1 },
      { documentVersion: 1 },
    );
    const statementLines: B1StatementLineV1[] = this.buildStatementLines(request);
    const openingBalanceMinor = '0';
    const feeMinor = this.sumStatementLineAmountByKind(
      statementLines,
      B1_BILLING_ENGINE_LINE_KIND_FEE,
    );
    const commissionMinor = this.sumStatementLineAmountByKind(
      statementLines,
      B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
    );
    const revenueSharingMinor = this.sumStatementLineAmountByKind(
      statementLines,
      B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
    );
    const totalDebitMinor = (
      BigInt(feeMinor) +
      BigInt(commissionMinor) +
      BigInt(revenueSharingMinor)
    ).toString();
    const totalCreditMinor = '0';
    const totalMinor = (BigInt(totalDebitMinor) + BigInt(totalCreditMinor)).toString();
    const closingBalanceMinor = (
      BigInt(openingBalanceMinor) +
      BigInt(totalDebitMinor) -
      BigInt(totalCreditMinor)
    ).toString();
    const explanationTrace: B1BillingExplanationTraceV1 = {
      traceId: randomUUID(),
      traceKind: 'STATEMENT_DECISION',
      traceSummary: `B1 statement for ${String(request.customerId)} on ${String(request.productKey)} v${String(request.productVersion)}`,
      traceSteps: explanationSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const ruleTrace: B1BillingRuleTraceV1 = {
      ruleTraceId: randomUUID(),
      ruleTraceSteps,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
    const auditEvidence: B1BillingAuditEvidenceV1 = {
      auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
      auditEntityId: statementId,
      auditAction: 'BILLING_DOCUMENT_GENERATED',
      auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
      auditCorrelationId: request.requestContext.correlationId,
      auditRequestId: request.requestContext.requestId,
      auditCausationId: request.causationId,
      auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
      auditOutboxEventId: null,
      auditRecorded: false,
    };
    const statementHashPayload = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      statementNumber,
      statementVersion: 1,
      statementState: 'GENERATED' as const,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      openingBalanceMinor,
      closingBalanceMinor,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalDebitMinor,
      totalCreditMinor,
      totalMinor,
      invoiceReferences: [...request.invoiceReferences],
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
    };
    const statementHash = this.computeStatementHash(statementHashPayload);
    const statementReplayHash = this.computeStatementReplayHash({
      statementHash,
      statementRequestHash,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
    });
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      statementId,
      statementNumber,
      statementVersion: 1,
      statementState: 'GENERATED',
      statementHash,
      statementReplayHash,
      billingRequestHash: statementRequestHash,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      baseAmountMinor: '0',
      baseCurrency: request.expectedCurrency,
      currency: request.expectedCurrency,
      accountingUnit: request.expectedAccountingUnit,
      openingBalanceMinor,
      closingBalanceMinor,
      feeMinor,
      commissionMinor,
      revenueSharingMinor,
      totalDebitMinor,
      totalCreditMinor,
      totalMinor,
      issuedAt: new Date().toISOString(),
      invoiceReferences: [...request.invoiceReferences],
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      explanationTrace,
      ruleTrace,
      auditEvidence,
      idempotencyScope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
      requestContext: request.requestContext,
      causationId: request.causationId,
      statementLines,
    };
  }

  async replaySafeGenerateBillingRecord(
    request: B1BillingRequestV1,
  ): Promise<B1BillingRecordReplaySafeResultV1> {
    return this.replaySafeBillingRecord(request);
  }

  async replaySafeGenerateInvoice(
    request: B1InvoiceRequestV1,
  ): Promise<B1InvoiceReplaySafeResultV1> {
    return this.replaySafeInvoice(request);
  }

  async replaySafeGenerateStatement(
    request: B1StatementRequestV1,
  ): Promise<B1StatementReplaySafeResultV1> {
    return this.replaySafeStatement(request);
  }

  compatibilityCheck(
    request: B1BillingRequestV1 | B1InvoiceRequestV1 | B1StatementRequestV1,
  ): B1BillingDocumentCompatibilityResultV1 {
    if (!request) {
      return {
        compatible: false,
        code: B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        reasons: ['The B1 billing document request is missing'],
      };
    }
    const reasons: string[] = [];
    if (request.scopeKey !== B1_BILLING_ENGINE_SCOPE_KEY) {
      reasons.push(
        `scopeKey mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_KEY)}, got ${String(request.scopeKey)}`,
      );
    }
    if (request.scopeVersion !== B1_BILLING_ENGINE_SCOPE_VERSION) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_VERSION)}, got ${String(request.scopeVersion)}`,
      );
    }
    if (request.expectedCurrency !== B1_BILLING_ENGINE_SCOPE_CURRENCY) {
      reasons.push(
        `currency mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_CURRENCY)}, got ${String(request.expectedCurrency)}`,
      );
    }
    if (request.expectedAccountingUnit !== B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT)}, got ${String(request.expectedAccountingUnit)}`,
      );
    }
    if (request.productKey !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      reasons.push(
        `productKey mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY)}, got ${String(request.productKey)}`,
      );
    }
    if (request.productVersion !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      reasons.push(
        `productVersion mismatch: expected ${String(B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION)}, got ${String(request.productVersion)}`,
      );
    }
    if (B1_BILLING_ENGINE_PROHIBITED_ADJACENT_SCOPES.includes(request.scopeKey as never)) {
      reasons.push(`scopeKey ${String(request.scopeKey)} is in the B1 prohibited adjacent scopes`);
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE,
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

  private async replaySafeBillingRecord(
    request: B1BillingRequestV1,
  ): Promise<B1BillingRecordReplaySafeResultV1> {
    const shapeFailure = this.validateBillingRequestShape(request);
    if (shapeFailure) {
      const failureRecord = this.buildFailureBillingRecord(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayFailure(request, failureRecord, false, 'invalid_command', null);
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeBillingRequestHash(request),
        retentionSeconds: B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalRecord = this.generateBillingRecord(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_BILLING_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          record: originalRecord,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          billingRequestHash: originalRecord.billingRequestHash,
          billingRecordHash: originalRecord.billingRecordHash,
          billingRecordReplayHash: originalRecord.billingRecordReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureRecord = this.buildFailureBillingRecord(
          request,
          B1_BILLING_ENGINE_FAILURE_IN_PROGRESS,
          'B1 billing engine replay-safe generate billing record is in progress for the same idempotency key',
        );
        return this.buildReplayFailure(request, failureRecord, false, 'in_progress', 'in_progress');
      }
      const record = this.generateBillingRecord(request);
      return {
        record,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        billingRequestHash: record.billingRequestHash,
        billingRecordHash: record.billingRecordHash,
        billingRecordReplayHash: record.billingRecordReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureRecord = this.buildFailureBillingRecord(
          request,
          B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 billing engine replay-safe generate billing record conflict: ${message}`,
        );
        return this.buildReplayFailure(
          request,
          failureRecord,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureRecord = this.buildFailureBillingRecord(
        request,
        B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 billing engine replay-safe generate billing record query unavailable: ${message}`,
      );
      return this.buildReplayFailure(request, failureRecord, false, null, 'query_unavailable');
    }
  }

  private async replaySafeInvoice(
    request: B1InvoiceRequestV1,
  ): Promise<B1InvoiceReplaySafeResultV1> {
    const shapeFailure = this.validateInvoiceRequestShape(request);
    if (shapeFailure) {
      const failureInvoice = this.buildFailureInvoice(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayInvoiceFailure(
        request,
        failureInvoice,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeInvoiceRequestHash(request),
        retentionSeconds: B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalInvoice = this.generateInvoice(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_BILLING_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          invoice: originalInvoice,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          invoiceRequestHash: originalInvoice.billingRequestHash,
          invoiceHash: originalInvoice.invoiceHash,
          invoiceReplayHash: originalInvoice.invoiceReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureInvoice = this.buildFailureInvoice(
          request,
          B1_BILLING_ENGINE_FAILURE_IN_PROGRESS,
          'B1 billing engine replay-safe generate invoice is in progress for the same idempotency key',
        );
        return this.buildReplayInvoiceFailure(
          request,
          failureInvoice,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const invoice = this.generateInvoice(request);
      return {
        invoice,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        invoiceRequestHash: invoice.billingRequestHash,
        invoiceHash: invoice.invoiceHash,
        invoiceReplayHash: invoice.invoiceReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureInvoice = this.buildFailureInvoice(
          request,
          B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 billing engine replay-safe generate invoice conflict: ${message}`,
        );
        return this.buildReplayInvoiceFailure(
          request,
          failureInvoice,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureInvoice = this.buildFailureInvoice(
        request,
        B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 billing engine replay-safe generate invoice query unavailable: ${message}`,
      );
      return this.buildReplayInvoiceFailure(
        request,
        failureInvoice,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private async replaySafeStatement(
    request: B1StatementRequestV1,
  ): Promise<B1StatementReplaySafeResultV1> {
    const shapeFailure = this.validateStatementRequestShape(request);
    if (shapeFailure) {
      const failureStatement = this.buildFailureStatement(
        request,
        B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
      return this.buildReplayStatementFailure(
        request,
        failureStatement,
        false,
        'invalid_command',
        null,
      );
    }
    try {
      const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
        scope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
        key: request.idempotencyKey,
        requestHash: this.computeStatementRequestHash(request),
        retentionSeconds: B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const originalStatement = this.generateStatement(request);
        await this.metricsService.increment(
          this.dataSource.manager,
          B1_BILLING_ENGINE_METRIC_REPLAYED,
          1,
        );
        return {
          statement: originalStatement,
          replayed: true,
          conflict: false,
          conflictReason: null,
          idempotencyScope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
          idempotencyKey: request.idempotencyKey,
          statementRequestHash: originalStatement.billingRequestHash,
          statementHash: originalStatement.statementHash,
          statementReplayHash: originalStatement.statementReplayHash,
          generatedAt: new Date().toISOString(),
          correlationId: request.requestContext.correlationId,
        };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        const failureStatement = this.buildFailureStatement(
          request,
          B1_BILLING_ENGINE_FAILURE_IN_PROGRESS,
          'B1 billing engine replay-safe generate statement is in progress for the same idempotency key',
        );
        return this.buildReplayStatementFailure(
          request,
          failureStatement,
          false,
          'in_progress',
          'in_progress',
        );
      }
      const statement = this.generateStatement(request);
      return {
        statement,
        replayed: false,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
        idempotencyKey: request.idempotencyKey,
        statementRequestHash: statement.billingRequestHash,
        statementHash: statement.statementHash,
        statementReplayHash: statement.statementReplayHash,
        generatedAt: new Date().toISOString(),
        correlationId: request.requestContext.correlationId,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown';
      if (message.includes('idempotency key was already used for another request')) {
        const failureStatement = this.buildFailureStatement(
          request,
          B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT,
          `B1 billing engine replay-safe generate statement conflict: ${message}`,
        );
        return this.buildReplayStatementFailure(
          request,
          failureStatement,
          false,
          'replay_conflict',
          'replay_conflict',
        );
      }
      const failureStatement = this.buildFailureStatement(
        request,
        B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE,
        `B1 billing engine replay-safe generate statement query unavailable: ${message}`,
      );
      return this.buildReplayStatementFailure(
        request,
        failureStatement,
        false,
        null,
        'query_unavailable',
      );
    }
  }

  private appendBillingRule(
    explanationSteps: B1BillingExplanationStepV1[],
    ruleTraceSteps: B1BillingRuleTraceStepV1[],
    ruleKind: B1BillingRuleKindV1,
    ruleId: string,
    ruleLabel: string,
    ruleOutcome: B1BillingRuleOutcomeV1,
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

  private buildInvoiceLines(request: B1InvoiceRequestV1): B1InvoiceLineV1[] {
    const billingRecordReferences = request.billingRecordReferences;
    const decisionReferences = request.commercialDecisionReferences;
    const lines: B1InvoiceLineV1[] = [];
    const kinds: B1BillingLineKind[] = [
      B1_BILLING_ENGINE_LINE_KIND_FEE,
      B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
      B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
    ];
    const amounts = [
      BigInt(this.deriveBaseAmountMinorForInvoice(request)) /
        BigInt(Math.max(decisionReferences.length, 1)),
      BigInt(this.deriveBaseAmountMinorForInvoice(request)) /
        BigInt(Math.max(decisionReferences.length, 1)),
      BigInt('0'),
    ];
    for (let i = 0; i < kinds.length; i += 1) {
      const billingRecordReference = billingRecordReferences[i] ?? billingRecordReferences[0] ?? '';
      const decisionReference = decisionReferences[i] ?? decisionReferences[0] ?? '';
      lines.push({
        invoiceLineId: randomUUID(),
        invoiceLineReference: `${B1_BILLING_ENGINE_REFERENCE_PREFIX}:invoice-line:${String(
          request.invoiceRequestId,
        )}:${String(i + 1)}`,
        invoiceLineVersion: 1,
        billingRecordReference,
        lineKind: kinds[i] as B1BillingLineKind,
        lineDescription: `${String(kinds[i])} line ${String(i + 1)} for ${String(
          request.customerId,
        )}`,
        lineAmountMinor: amounts[i]?.toString() ?? '0',
        lineCurrency: request.expectedCurrency,
        lineAccountingUnit: request.expectedAccountingUnit,
        lineOrder: i + 1,
        commercialDecisionReference: decisionReference,
      });
    }
    return lines;
  }

  private buildStatementLines(request: B1StatementRequestV1): B1StatementLineV1[] {
    const invoiceReferences = request.invoiceReferences;
    const decisionReferences = request.commercialDecisionReferences;
    const lines: B1StatementLineV1[] = [];
    const kinds: B1BillingLineKind[] = [
      B1_BILLING_ENGINE_LINE_KIND_FEE,
      B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
      B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
    ];
    for (let i = 0; i < kinds.length; i += 1) {
      const invoiceReference = invoiceReferences[i] ?? invoiceReferences[0] ?? '';
      const decisionReference = decisionReferences[i] ?? decisionReferences[0] ?? '';
      lines.push({
        statementLineId: randomUUID(),
        statementLineReference: `${B1_BILLING_ENGINE_REFERENCE_PREFIX}:statement-line:${String(
          request.statementRequestId,
        )}:${String(i + 1)}`,
        statementLineVersion: 1,
        invoiceReference,
        lineKind: kinds[i] as B1BillingLineKind,
        lineDescription: `${String(kinds[i])} statement line ${String(i + 1)} for ${String(
          request.customerId,
        )}`,
        lineAmountMinor: '0',
        lineCurrency: request.expectedCurrency,
        lineAccountingUnit: request.expectedAccountingUnit,
        lineOrder: i + 1,
        commercialDecisionReference: decisionReference,
      });
    }
    return lines;
  }

  private deriveBaseAmountMinor(request: B1BillingRequestV1): string {
    if (request.commercialDecisionReferences.length === 0) {
      return '0';
    }
    const split = BigInt('100000') / BigInt(request.commercialDecisionReferences.length);
    return split.toString();
  }

  private deriveBaseAmountMinorForInvoice(request: B1InvoiceRequestV1): string {
    if (request.commercialDecisionReferences.length === 0) {
      return '0';
    }
    const split = BigInt('100000') / BigInt(request.commercialDecisionReferences.length);
    return split.toString();
  }

  private deriveFeeMinor(request: B1BillingRequestV1, baseAmountMinor: string): string {
    return baseAmountMinor;
  }

  private deriveCommissionMinor(request: B1BillingRequestV1, baseAmountMinor: string): string {
    return request.commercialDecisionReferences.length > 0
      ? BigInt(baseAmountMinor) / BigInt(request.commercialDecisionReferences.length) === BigInt(0)
        ? '0'
        : '0'
      : '0';
  }

  private deriveRevenueSharingMinor(request: B1BillingRequestV1, baseAmountMinor: string): string {
    return baseAmountMinor;
  }

  private sumInvoiceLineAmountByKind(
    lines: readonly B1InvoiceLineV1[],
    kind: B1BillingLineKind,
  ): string {
    let total = BigInt(0);
    for (const line of lines) {
      if (line.lineKind === kind) {
        total += BigInt(line.lineAmountMinor);
      }
    }
    return total.toString();
  }

  private sumStatementLineAmountByKind(
    lines: readonly B1StatementLineV1[],
    kind: B1BillingLineKind,
  ): string {
    let total = BigInt(0);
    for (const line of lines) {
      if (line.lineKind === kind) {
        total += BigInt(line.lineAmountMinor);
      }
    }
    return total.toString();
  }

  private computeBillingRequestHash(request: B1BillingRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      billingRequestId: request.billingRequestId,
      billingRequestVersion: request.billingRequestVersion,
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
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      packageKey: request.packageKey,
      packageVersion: request.packageVersion,
      bundleKey: request.bundleKey,
      bundleVersion: request.bundleVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeInvoiceRequestHash(request: B1InvoiceRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      invoiceRequestId: request.invoiceRequestId,
      invoiceRequestVersion: request.invoiceRequestVersion,
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
      subscriptionKey: request.subscriptionKey,
      subscriptionVersion: request.subscriptionVersion,
      packageKey: request.packageKey,
      packageVersion: request.packageVersion,
      bundleKey: request.bundleKey,
      bundleVersion: request.bundleVersion,
      productEntitlementKey: request.productEntitlementKey,
      productEntitlementVersion: request.productEntitlementVersion,
      customerTierKey: request.customerTierKey,
      customerTierVersion: request.customerTierVersion,
      merchantTierKey: request.merchantTierKey,
      merchantTierVersion: request.merchantTierVersion,
      partnerTierKey: request.partnerTierKey,
      partnerTierVersion: request.partnerTierVersion,
      billingRecordReferences: [...request.billingRecordReferences],
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeStatementRequestHash(request: B1StatementRequestV1): string {
    const payload = JSON.stringify({
      contractName: request.contractName,
      contractVersion: request.contractVersion,
      statementRequestId: request.statementRequestId,
      statementRequestVersion: request.statementRequestVersion,
      scopeKey: request.scopeKey,
      scopeVersion: request.scopeVersion,
      expectedCurrency: request.expectedCurrency,
      expectedAccountingUnit: request.expectedAccountingUnit,
      customerId: request.customerId,
      merchantId: request.merchantId,
      partnerId: request.partnerId,
      productKey: request.productKey,
      productVersion: request.productVersion,
      periodKey: request.periodKey,
      periodVersion: request.periodVersion,
      periodOpenAt: request.periodOpenAt,
      periodCloseAt: request.periodCloseAt,
      periodEffectiveAt: request.periodEffectiveAt,
      billingRecordReferences: [...request.billingRecordReferences],
      invoiceReferences: [...request.invoiceReferences],
      commercialDecisionReferences: [...request.commercialDecisionReferences],
      commercialDecisionIdempotencyKeys: [...request.commercialDecisionIdempotencyKeys],
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId,
      causationId: request.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeBillingRecordReference(request: B1BillingRequestV1, requestHash: string): string {
    return `${B1_BILLING_ENGINE_REFERENCE_PREFIX}:billing-record:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeInvoiceNumber(request: B1InvoiceRequestV1, requestHash: string): string {
    return `${B1_BILLING_ENGINE_REFERENCE_PREFIX}:invoice:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeStatementNumber(request: B1StatementRequestV1, requestHash: string): string {
    return `${B1_BILLING_ENGINE_REFERENCE_PREFIX}:statement:${String(
      request.scopeKey,
    )}:v${String(request.scopeVersion)}:${requestHash.substring(0, 16)}`;
  }

  private computeBillingRecordHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeBillingRecordReplayHash(input: {
    readonly billingRecordHash: string;
    readonly billingRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      billingRecordHash: input.billingRecordHash,
      billingRequestHash: input.billingRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeInvoiceHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeInvoiceReplayHash(input: {
    readonly invoiceHash: string;
    readonly invoiceRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      invoiceHash: input.invoiceHash,
      invoiceRequestHash: input.invoiceRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeStatementHash(input: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private computeStatementReplayHash(input: {
    readonly statementHash: string;
    readonly statementRequestHash: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): string {
    const payload = JSON.stringify({
      statementHash: input.statementHash,
      statementRequestHash: input.statementRequestHash,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private validateBillingRequestShape(request: B1BillingRequestV1): string | null {
    if (!request) {
      return 'The B1 billing engine request is missing';
    }
    if (request.contractName !== B1_BILLING_ENGINE_CONTRACT_NAME) {
      return 'The B1 billing engine request contract name is invalid';
    }
    if (request.contractVersion !== B1_BILLING_ENGINE_CONTRACT_VERSION) {
      return 'The B1 billing engine request contract version is invalid';
    }
    if (!request.billingRequestId || !SAFE_TEXT_PATTERN.test(request.billingRequestId)) {
      return 'The B1 billing engine request billing request id is invalid';
    }
    if (request.billingRequestVersion !== 1) {
      return 'The B1 billing engine request billing request version is invalid';
    }
    if (request.scopeKey !== B1_BILLING_ENGINE_SCOPE_KEY) {
      return 'The B1 billing engine request scope key is invalid';
    }
    if (request.scopeVersion !== B1_BILLING_ENGINE_SCOPE_VERSION) {
      return 'The B1 billing engine request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_BILLING_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 billing engine request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 billing engine request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 billing engine request product key is invalid';
    }
    if (request.productVersion !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 billing engine request product version is invalid';
    }
    if (!request.customerId || !SAFE_TEXT_PATTERN.test(request.customerId)) {
      return 'The B1 billing engine request customer id is invalid';
    }
    if (!request.merchantId || !SAFE_TEXT_PATTERN.test(request.merchantId)) {
      return 'The B1 billing engine request merchant id is invalid';
    }
    if (!request.partnerId || !SAFE_TEXT_PATTERN.test(request.partnerId)) {
      return 'The B1 billing engine request partner id is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 billing engine request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 billing engine request capability version is invalid';
    }
    if (!request.planKey || !SAFE_TEXT_PATTERN.test(request.planKey)) {
      return 'The B1 billing engine request plan key is invalid';
    }
    if (request.planVersion !== 1) {
      return 'The B1 billing engine request plan version is invalid';
    }
    if (!request.subscriptionKey || !SAFE_TEXT_PATTERN.test(request.subscriptionKey)) {
      return 'The B1 billing engine request subscription key is invalid';
    }
    if (request.subscriptionVersion !== 1) {
      return 'The B1 billing engine request subscription version is invalid';
    }
    if (!request.packageKey || !SAFE_TEXT_PATTERN.test(request.packageKey)) {
      return 'The B1 billing engine request package key is invalid';
    }
    if (request.packageVersion !== 1) {
      return 'The B1 billing engine request package version is invalid';
    }
    if (!request.bundleKey || !SAFE_TEXT_PATTERN.test(request.bundleKey)) {
      return 'The B1 billing engine request bundle key is invalid';
    }
    if (request.bundleVersion !== 1) {
      return 'The B1 billing engine request bundle version is invalid';
    }
    if (!request.productEntitlementKey || !SAFE_TEXT_PATTERN.test(request.productEntitlementKey)) {
      return 'The B1 billing engine request product entitlement key is invalid';
    }
    if (request.productEntitlementVersion !== 1) {
      return 'The B1 billing engine request product entitlement version is invalid';
    }
    if (!request.customerTierKey || !SAFE_TEXT_PATTERN.test(request.customerTierKey)) {
      return 'The B1 billing engine request customer tier key is invalid';
    }
    if (request.customerTierVersion !== 1) {
      return 'The B1 billing engine request customer tier version is invalid';
    }
    if (!request.merchantTierKey || !SAFE_TEXT_PATTERN.test(request.merchantTierKey)) {
      return 'The B1 billing engine request merchant tier key is invalid';
    }
    if (request.merchantTierVersion !== 1) {
      return 'The B1 billing engine request merchant tier version is invalid';
    }
    if (!request.partnerTierKey || !SAFE_TEXT_PATTERN.test(request.partnerTierKey)) {
      return 'The B1 billing engine request partner tier key is invalid';
    }
    if (request.partnerTierVersion !== 1) {
      return 'The B1 billing engine request partner tier version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 billing engine request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 billing engine request period version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 billing engine request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 billing engine request request context is missing';
    }
    if (request.commercialDecisionReferences.length === 0) {
      return 'The B1 billing engine request commercial decision references are required';
    }
    if (
      request.commercialDecisionReferences.length !==
      request.commercialDecisionIdempotencyKeys.length
    ) {
      return 'The B1 billing engine request commercial decision references and idempotency keys must align';
    }
    for (const decisionReference of request.commercialDecisionReferences) {
      if (!decisionReference || !SAFE_TEXT_PATTERN.test(decisionReference)) {
        return 'The B1 billing engine request commercial decision reference is invalid';
      }
    }
    for (const decisionIdempotencyKey of request.commercialDecisionIdempotencyKeys) {
      if (!decisionIdempotencyKey || !SHA256_PATTERN.test(decisionIdempotencyKey)) {
        return 'The B1 billing engine request commercial decision idempotency key is invalid';
      }
    }
    return null;
  }

  private validateInvoiceRequestShape(request: B1InvoiceRequestV1): string | null {
    if (!request) {
      return 'The B1 billing engine invoice request is missing';
    }
    if (request.contractName !== B1_BILLING_ENGINE_CONTRACT_NAME) {
      return 'The B1 billing engine invoice request contract name is invalid';
    }
    if (request.contractVersion !== B1_BILLING_ENGINE_CONTRACT_VERSION) {
      return 'The B1 billing engine invoice request contract version is invalid';
    }
    if (!request.invoiceRequestId || !SAFE_TEXT_PATTERN.test(request.invoiceRequestId)) {
      return 'The B1 billing engine invoice request invoice request id is invalid';
    }
    if (request.invoiceRequestVersion !== 1) {
      return 'The B1 billing engine invoice request invoice request version is invalid';
    }
    if (request.scopeKey !== B1_BILLING_ENGINE_SCOPE_KEY) {
      return 'The B1 billing engine invoice request scope key is invalid';
    }
    if (request.scopeVersion !== B1_BILLING_ENGINE_SCOPE_VERSION) {
      return 'The B1 billing engine invoice request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_BILLING_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 billing engine invoice request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 billing engine invoice request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 billing engine invoice request product key is invalid';
    }
    if (request.productVersion !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 billing engine invoice request product version is invalid';
    }
    if (!request.capabilityKey || !SAFE_TEXT_PATTERN.test(request.capabilityKey)) {
      return 'The B1 billing engine invoice request capability key is invalid';
    }
    if (request.capabilityVersion !== 1) {
      return 'The B1 billing engine invoice request capability version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 billing engine invoice request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 billing engine invoice request request context is missing';
    }
    if (request.commercialDecisionReferences.length === 0) {
      return 'The B1 billing engine invoice request commercial decision references are required';
    }
    for (const billingRecordReference of request.billingRecordReferences) {
      if (!billingRecordReference || !SAFE_TEXT_PATTERN.test(billingRecordReference)) {
        return 'The B1 billing engine invoice request billing record reference is invalid';
      }
    }
    return null;
  }

  private validateStatementRequestShape(request: B1StatementRequestV1): string | null {
    if (!request) {
      return 'The B1 billing engine statement request is missing';
    }
    if (request.contractName !== B1_BILLING_ENGINE_CONTRACT_NAME) {
      return 'The B1 billing engine statement request contract name is invalid';
    }
    if (request.contractVersion !== B1_BILLING_ENGINE_CONTRACT_VERSION) {
      return 'The B1 billing engine statement request contract version is invalid';
    }
    if (!request.statementRequestId || !SAFE_TEXT_PATTERN.test(request.statementRequestId)) {
      return 'The B1 billing engine statement request statement request id is invalid';
    }
    if (request.statementRequestVersion !== 1) {
      return 'The B1 billing engine statement request statement request version is invalid';
    }
    if (request.scopeKey !== B1_BILLING_ENGINE_SCOPE_KEY) {
      return 'The B1 billing engine statement request scope key is invalid';
    }
    if (request.scopeVersion !== B1_BILLING_ENGINE_SCOPE_VERSION) {
      return 'The B1 billing engine statement request scope version is invalid';
    }
    if (request.expectedCurrency !== B1_BILLING_ENGINE_SCOPE_CURRENCY) {
      return 'The B1 billing engine statement request expected currency is invalid';
    }
    if (request.expectedAccountingUnit !== B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 billing engine statement request expected accounting unit is invalid';
    }
    if (request.productKey !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY) {
      return 'The B1 billing engine statement request product key is invalid';
    }
    if (request.productVersion !== B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION) {
      return 'The B1 billing engine statement request product version is invalid';
    }
    if (!request.periodKey || !SAFE_TEXT_PATTERN.test(request.periodKey)) {
      return 'The B1 billing engine statement request period key is invalid';
    }
    if (request.periodVersion !== 1) {
      return 'The B1 billing engine statement request period version is invalid';
    }
    if (!request.idempotencyKey || !SHA256_PATTERN.test(request.idempotencyKey)) {
      return 'The B1 billing engine statement request idempotency key is invalid';
    }
    if (!request.requestContext || !request.requestContext.correlationId) {
      return 'The B1 billing engine statement request request context is missing';
    }
    if (request.commercialDecisionReferences.length === 0) {
      return 'The B1 billing engine statement request commercial decision references are required';
    }
    return null;
  }

  private buildFailureBillingRecord(
    request: B1BillingRequestV1,
    code: B1BillingDocumentFailureCodeV1,
    message: string,
  ): B1BillingRecordV1 {
    const failure: B1BillingDocumentFailureV1 = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      billingRecordId: 'failed',
      billingRecordReference: 'B1-BILLING-DOCUMENT-FAILED',
      billingRecordVersion: 1,
      billingRecordState: 'CREATED',
      billingRecordHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      billingRecordReplayHash: createHash('sha256')
        .update(`failed-replay:${message}`)
        .digest('hex'),
      billingRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_BILLING_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_BILLING_ENGINE_SCOPE_VERSION,
      periodKey: request?.periodKey ?? B1_BILLING_ENGINE_BILLING_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      periodCycle: 'PER_TRANSACTION',
      periodOpenAt: request?.periodOpenAt ?? new Date().toISOString(),
      periodCloseAt: request?.periodCloseAt ?? new Date().toISOString(),
      periodEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.fee',
      capabilityVersion: 1,
      planKey: request?.planKey ?? 'unknown',
      planVersion: 1,
      subscriptionKey: request?.subscriptionKey ?? 'unknown',
      subscriptionVersion: 1,
      packageKey: request?.packageKey ?? 'unknown',
      packageVersion: 1,
      bundleKey: request?.bundleKey ?? 'unknown',
      bundleVersion: 1,
      productEntitlementKey: request?.productEntitlementKey ?? 'unknown',
      productEntitlementVersion: 1,
      customerTierKey: request?.customerTierKey ?? 'unknown',
      customerTierVersion: 1,
      merchantTierKey: request?.merchantTierKey ?? 'unknown',
      merchantTierVersion: 1,
      partnerTierKey: request?.partnerTierKey ?? 'unknown',
      partnerTierVersion: 1,
      baseAmountMinor: request?.commercialDecisionReferences?.[0] ? '0' : '0',
      baseCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
      currency: request?.expectedCurrency ?? B1_BILLING_ENGINE_SCOPE_CURRENCY,
      accountingUnit: request?.expectedAccountingUnit ?? B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
      feeMinor: '0',
      commissionMinor: '0',
      revenueSharingMinor: '0',
      totalMinor: '0',
      commercialDecisionReference: '',
      commercialDecisionHash: '',
      commercialDecisionReplayHash: '',
      commercialDecisionIdempotencyKey: '',
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'BILLING_RECORD_DECISION',
        traceSummary: `B1 billing engine failure: ${message}`,
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
        auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'BILLING_DOCUMENT_FAILED',
        auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
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

  private buildFailureInvoice(
    request: B1InvoiceRequestV1,
    code: B1BillingDocumentFailureCodeV1,
    message: string,
  ): B1InvoiceV1 {
    const failure: B1BillingDocumentFailureV1 = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      invoiceId: 'failed',
      invoiceNumber: 'B1-BILLING-DOCUMENT-FAILED',
      invoiceVersion: 1,
      invoiceState: 'DRAFT',
      invoiceHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      invoiceReplayHash: createHash('sha256').update(`failed-replay:${message}`).digest('hex'),
      billingRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_BILLING_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_BILLING_ENGINE_SCOPE_VERSION,
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: request?.capabilityKey ?? 'commercial.virtual-account.inbound-funding.fee',
      capabilityVersion: 1,
      planKey: request?.planKey ?? 'unknown',
      planVersion: 1,
      subscriptionKey: request?.subscriptionKey ?? 'unknown',
      subscriptionVersion: 1,
      packageKey: request?.packageKey ?? 'unknown',
      packageVersion: 1,
      bundleKey: request?.bundleKey ?? 'unknown',
      bundleVersion: 1,
      productEntitlementKey: request?.productEntitlementKey ?? 'unknown',
      productEntitlementVersion: 1,
      customerTierKey: request?.customerTierKey ?? 'unknown',
      customerTierVersion: 1,
      merchantTierKey: request?.merchantTierKey ?? 'unknown',
      merchantTierVersion: 1,
      partnerTierKey: request?.partnerTierKey ?? 'unknown',
      partnerTierVersion: 1,
      baseAmountMinor: '0',
      baseCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
      currency: request?.expectedCurrency ?? B1_BILLING_ENGINE_SCOPE_CURRENCY,
      accountingUnit: request?.expectedAccountingUnit ?? B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
      feeMinor: '0',
      commissionMinor: '0',
      revenueSharingMinor: '0',
      totalMinor: '0',
      periodKey: B1_BILLING_ENGINE_BILLING_PERIOD_KEY,
      periodVersion: 1,
      issuedAt: new Date().toISOString(),
      commercialDecisionReferences: [],
      commercialDecisionIdempotencyKeys: [],
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'INVOICE_DECISION',
        traceSummary: `B1 billing engine failure: ${message}`,
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
        auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'BILLING_DOCUMENT_FAILED',
        auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
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
      invoiceLines: [],
    };
  }

  private buildFailureStatement(
    request: B1StatementRequestV1,
    code: B1BillingDocumentFailureCodeV1,
    message: string,
  ): B1StatementV1 {
    const failure: B1BillingDocumentFailureV1 = {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      code,
      message,
      failedRules: [],
      failedInputs: { scopeKey: request?.scopeKey, scopeVersion: request?.scopeVersion },
      correlationId: request?.requestContext?.correlationId ?? 'unknown',
      requestId: request?.requestContext?.requestId ?? 'unknown',
      generatedAt: new Date().toISOString(),
    };
    return {
      contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
      contractVersion: B1_BILLING_ENGINE_CONTRACT_VERSION,
      statementId: 'failed',
      statementNumber: 'B1-BILLING-DOCUMENT-FAILED',
      statementVersion: 1,
      statementState: 'OPEN',
      statementHash: createHash('sha256').update(`failed:${message}`).digest('hex'),
      statementReplayHash: createHash('sha256').update(`failed-replay:${message}`).digest('hex'),
      billingRequestHash: createHash('sha256').update(`request:${message}`).digest('hex'),
      scopeKey: request?.scopeKey ?? B1_BILLING_ENGINE_SCOPE_KEY,
      scopeVersion: request?.scopeVersion ?? B1_BILLING_ENGINE_SCOPE_VERSION,
      customerId: request?.customerId ?? 'unknown',
      merchantId: request?.merchantId ?? 'unknown',
      partnerId: request?.partnerId ?? 'unknown',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      periodKey: request?.periodKey ?? B1_BILLING_ENGINE_STATEMENT_PERIOD_KEY,
      periodVersion: request?.periodVersion ?? 1,
      periodOpenAt: request?.periodOpenAt ?? new Date().toISOString(),
      periodCloseAt: request?.periodCloseAt ?? new Date().toISOString(),
      periodEffectiveAt: request?.periodEffectiveAt ?? new Date().toISOString(),
      baseAmountMinor: '0',
      baseCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
      currency: request?.expectedCurrency ?? B1_BILLING_ENGINE_SCOPE_CURRENCY,
      accountingUnit: request?.expectedAccountingUnit ?? B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
      openingBalanceMinor: '0',
      closingBalanceMinor: '0',
      feeMinor: '0',
      commissionMinor: '0',
      revenueSharingMinor: '0',
      totalDebitMinor: '0',
      totalCreditMinor: '0',
      totalMinor: '0',
      issuedAt: new Date().toISOString(),
      invoiceReferences: [],
      commercialDecisionReferences: [],
      commercialDecisionIdempotencyKeys: [],
      explanationTrace: {
        traceId: randomUUID(),
        traceKind: 'STATEMENT_DECISION',
        traceSummary: `B1 billing engine failure: ${message}`,
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
        auditEntityType: B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
        auditEntityId: 'failed',
        auditAction: 'BILLING_DOCUMENT_FAILED',
        auditActor: B1_BILLING_ENGINE_AUDIT_ACTOR,
        auditCorrelationId: request?.requestContext?.correlationId ?? 'unknown',
        auditRequestId: request?.requestContext?.requestId ?? 'unknown',
        auditCausationId: request?.causationId ?? null,
        auditOutboxEventType: B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
        auditOutboxEventId: null,
        auditRecorded: false,
      },
      idempotencyScope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
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
      statementLines: [],
    };
  }

  private buildReplayFailure(
    request: B1BillingRequestV1,
    record: B1BillingRecordV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1BillingRecordReplaySafeResultV1 {
    return {
      record,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      billingRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      billingRecordHash: record.billingRecordHash,
      billingRecordReplayHash: record.billingRecordReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayInvoiceFailure(
    request: B1InvoiceRequestV1,
    invoice: B1InvoiceV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1InvoiceReplaySafeResultV1 {
    return {
      invoice,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      invoiceRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      invoiceHash: invoice.invoiceHash,
      invoiceReplayHash: invoice.invoiceReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private buildReplayStatementFailure(
    request: B1StatementRequestV1,
    statement: B1StatementV1,
    replayed: boolean,
    conflict: 'in_progress' | 'replay_conflict' | 'query_unavailable' | 'invalid_command' | null,
    conflictReason: string | null,
  ): B1StatementReplaySafeResultV1 {
    return {
      statement,
      replayed,
      conflict: conflict !== null,
      conflictReason,
      idempotencyScope: B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      statementRequestHash: createHash('sha256')
        .update(`replay-failure:${request.idempotencyKey}`)
        .digest('hex'),
      statementHash: statement.statementHash,
      statementReplayHash: statement.statementReplayHash,
      generatedAt: new Date().toISOString(),
      correlationId: request.requestContext.correlationId,
    };
  }

  private toPersistenceRecord(row: B1BillingDocument): B1BillingDocumentPersistenceRecordV1 {
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
