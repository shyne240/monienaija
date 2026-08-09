/**
 * B1T08 — B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine service.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine service is the single B1-side entry point
 * for the B1 commercial-financial-recognition runtime. The B1
 * revenue-recognition engine, tax / VAT engine, and cost-
 * accounting engine service is a read-only service that exposes
 * the B1 revenue-recognition decision generate, the B1 revenue-
 * recognition decision replay-safe generate, the B1 tax / VAT
 * decision generate, the B1 tax / VAT decision replay-safe
 * generate, the B1 cost-accounting decision generate, the B1
 * cost-accounting decision replay-safe generate, the B1 revenue-
 * recognition engine compatibility check, the B1 revenue-
 * recognition engine versioning contract, the B1 revenue-
 * recognition engine read-only consumer boundary surface, the B1
 * revenue-recognition engine persistence accessors, and the B1
 * revenue-recognition engine audit / idempotency / outbox /
 * metrics identity.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine service NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    redeems cashback, awards loyalty balances, redeems loyalty
 *    balances, executes referral rewards, creates financial
 *    effects, repairs a binding, changes A4 policy / source
 *    records, or dispatches a notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - modifies invoices, statements, commercial decisions, pricing
 *    catalogs, product state, policy, customer bindings, or
 *    customer preferences;
 *  - dispatches notifications, executes settlements, performs
 *    payouts, performs reconciliation, or communicates with
 *    external partners.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine service IS:
 *  - the single B1-side B1 commercial-financial-recognition
 *    authority for revenue-recognition, tax / VAT, and cost-
 *    accounting decisions;
 *  - the single B1-side B1 commercial-financial-recognition read-
 *    only consumer boundary surface for later B1 tasks (B1T09
 *    commercial analytics / profitability / commercial
 *    reconciliation engine; B1T10 commercial data classification /
 *    commercial disclosure / commercial support-trace surface;
 *    B1T11 commercial release gate);
 *  - the single B1-side B1 commercial-financial-recognition
 *    compatibility validation authority;
 *  - the single B1-side B1 commercial-financial-recognition replay-
 *    safe decision authority;
 *  - the single B1-side B1 commercial-financial-recognition
 *    versioning authority.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine service reuses (without modification) the
 * A1 canonical identity, A2 authorization, A3 binding, A4 product-
 * policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation,
 * A6T08 settlement, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command /
 * operation, A7T06 product notification delivery, A7T07 product
 * lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, B1T03
 * commercial catalog, B1T04 commercial decision, B1T05 billing
 * engine, B1T06 campaign engine, B1T07 referral engine,
 * `CustomerPreference`, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, and Reconciliation authorities. The B1
 * revenue-recognition engine, tax / VAT engine, and cost-
 * accounting engine service emits B1 commercial-financial-
 * recognition audit facts through the shared Operations
 * `AuditService` (the only audit authority), reserves B1
 * commercial-financial-recognition idempotency records through
 * the shared Operations `IdempotencyService` (the only internal
 * idempotency authority), enqueues B1 commercial-financial-
 * recognition outbox events through the shared Operations
 * `OutboxService` (the only outbox authority), and records B1
 * commercial-financial-recognition metrics through the shared
 * Operations `MetricsService` (the only metrics authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * no notification dispatch, no settlement, no payout, no
 * cashback redemption, no reward execution, no loyalty balance
 * award, no loyalty balance redemption, no referral reward
 * execution, and no external financial correction outside
 * Ledger/Finance ownership is introduced by B1T08.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR,
  B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE,
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-revenue-recognition-engine.constants';
import { B1RevenueRecognitionEngineRepository } from './b1-revenue-recognition-engine.repository';
import type {
  B1CostAccountingDecisionReplaySafeResultV1,
  B1CostAccountingDecisionV1,
  B1CostAccountingRequestV1,
  B1RevenueRecognitionDecisionReplaySafeResultV1,
  B1RevenueRecognitionDecisionV1,
  B1RevenueRecognitionDocumentPersistenceRecordV1,
  B1RevenueRecognitionDocumentVersioningContractV1,
  B1RevenueRecognitionEngineCompatibilityResultV1,
  B1RevenueRecognitionEngineConsumerPortsV1,
  B1RevenueRecognitionRequestV1,
  B1TaxVatDecisionReplaySafeResultV1,
  B1TaxVatDecisionV1,
  B1TaxVatRequestV1,
} from './b1-revenue-recognition-engine.types';

@Injectable()
export class B1RevenueRecognitionEngineService {
  constructor(
    @Inject(B1RevenueRecognitionEngineRepository)
    private readonly repository: B1RevenueRecognitionEngineRepository,
  ) {}

  getContractName(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1RevenueRecognitionEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateRevenueRecognitionDecision(
    request: B1RevenueRecognitionRequestV1,
  ): B1RevenueRecognitionDecisionV1 {
    return this.repository.generateRevenueRecognitionDecision(request);
  }

  async replaySafeGenerateRevenueRecognitionDecision(
    request: B1RevenueRecognitionRequestV1,
  ): Promise<B1RevenueRecognitionDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateRevenueRecognitionDecision(request);
  }

  generateTaxVatDecision(request: B1TaxVatRequestV1): B1TaxVatDecisionV1 {
    return this.repository.generateTaxVatDecision(request);
  }

  async replaySafeGenerateTaxVatDecision(
    request: B1TaxVatRequestV1,
  ): Promise<B1TaxVatDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateTaxVatDecision(request);
  }

  generateCostAccountingDecision(request: B1CostAccountingRequestV1): B1CostAccountingDecisionV1 {
    return this.repository.generateCostAccountingDecision(request);
  }

  async replaySafeGenerateCostAccountingDecision(
    request: B1CostAccountingRequestV1,
  ): Promise<B1CostAccountingDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCostAccountingDecision(request);
  }

  compatibilityCheck(
    request: B1RevenueRecognitionRequestV1 | B1TaxVatRequestV1 | B1CostAccountingRequestV1,
  ): B1RevenueRecognitionEngineCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1RevenueRecognitionDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<readonly B1RevenueRecognitionDocumentPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1RevenueRecognitionDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1RevenueRecognitionDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getRevenueRecognitionIdempotencyScope(): string {
    return this.repository.getRevenueRecognitionIdempotencyScope();
  }

  getTaxVatIdempotencyScope(): string {
    return this.repository.getTaxVatIdempotencyScope();
  }

  getCostAccountingIdempotencyScope(): string {
    return this.repository.getCostAccountingIdempotencyScope();
  }

  getIdempotencyRetentionSeconds(): number {
    return this.repository.getIdempotencyRetentionSeconds();
  }

  getReferencePrefix(): string {
    return this.repository.getReferencePrefix();
  }

  getScopeKey(): string {
    return this.repository.getScopeKey();
  }

  getScopeVersion(): 1 {
    return this.repository.getScopeVersion();
  }

  getScopeCurrency(): 'NGN' {
    return this.repository.getScopeCurrency();
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return this.repository.getScopeAccountingUnit();
  }

  getScopeDirection(): 'inbound' {
    return this.repository.getScopeDirection();
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return this.repository.getScopeProductDependency();
  }

  getScopeProductDependencyVersion(): 1 {
    return this.repository.getScopeProductDependencyVersion();
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return this.repository.getScopePartnerDependency();
  }

  getPeriodKey(): string {
    return this.repository.getPeriodKey();
  }

  getRetentionDays(): number {
    return this.repository.getRetentionDays();
  }

  getRevenueRecognitionStates(): readonly string[] {
    return this.repository.getRevenueRecognitionStates();
  }

  getTaxVatStates(): readonly string[] {
    return this.repository.getTaxVatStates();
  }

  getCostAccountingStates(): readonly string[] {
    return this.repository.getCostAccountingStates();
  }

  getDecisionKinds(): readonly string[] {
    return this.repository.getDecisionKinds();
  }

  getDecisionOutcomes(): readonly string[] {
    return this.repository.getDecisionOutcomes();
  }

  getDocumentKinds(): readonly string[] {
    return this.repository.getDocumentKinds();
  }

  getRuleKinds(): readonly string[] {
    return this.repository.getRuleKinds();
  }

  getRuleOutcomes(): readonly string[] {
    return this.repository.getRuleOutcomes();
  }

  getAccountingBases(): readonly string[] {
    return this.repository.getAccountingBases();
  }

  getRecognitionMethods(): readonly string[] {
    return this.repository.getRecognitionMethods();
  }

  getTaxCategories(): readonly string[] {
    return this.repository.getTaxCategories();
  }

  getTaxJurisdictions(): readonly string[] {
    return this.repository.getTaxJurisdictions();
  }

  getCostCategories(): readonly string[] {
    return this.repository.getCostCategories();
  }

  getCostAllocationMethods(): readonly string[] {
    return this.repository.getCostAllocationMethods();
  }

  getClassificationLevels(): readonly string[] {
    return this.repository.getClassificationLevels();
  }

  getDataControlClassifications(): readonly string[] {
    return this.repository.getDataControlClassifications();
  }

  getCompatibilityRuleIds(): readonly string[] {
    return this.repository.getCompatibilityRuleIds();
  }

  getConsumerContractIds(): readonly string[] {
    return this.repository.getConsumerContractIds();
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return this.repository.getVersionNegotiationRuleIds();
  }

  getReplayRuleIds(): readonly string[] {
    return this.repository.getReplayRuleIds();
  }

  getDeclaredDependencies(): readonly string[] {
    return this.repository.getDeclaredDependencies();
  }

  getProhibitedDependencies(): readonly string[] {
    return this.repository.getProhibitedDependencies();
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return this.repository.getProhibitedAdjacentScopes();
  }

  getFailureCodes(): readonly string[] {
    return this.repository.getFailureCodes();
  }

  getMetrics(): readonly string[] {
    return this.repository.getMetrics();
  }
}
