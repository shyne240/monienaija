/**
 * B1T09 — B1 commercial-analytics engine, profitability engine,
 * and commercial-reconciliation engine service.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine service is the single B1-side
 * entry point for the B1 commercial-analytics and reconciliation
 * runtime. The B1 commercial-analytics engine, profitability
 * engine, and commercial-reconciliation engine service is a
 * read-only service that exposes the B1 commercial-analytics
 * decision generate, the B1 commercial-analytics decision replay-
 * safe generate, the B1 profitability decision generate, the B1
 * profitability decision replay-safe generate, the B1 commercial-
 * reconciliation decision generate, the B1 commercial-reconciliation
 * decision replay-safe generate, the B1 commercial-analytics
 * engine compatibility check, the B1 commercial-analytics engine
 * versioning contract, the B1 commercial-analytics engine read-only
 * consumer boundary surface, the B1 commercial-analytics engine
 * persistence accessors, and the B1 commercial-analytics engine
 * audit / idempotency / outbox / metrics identity.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine service NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    redeems cashback, awards loyalty balances, redeems loyalty
 *    balances, executes referral rewards, creates financial
 *    effects, repairs a binding, changes A4 policy / source
 *    records, auto-repairs discrepancies, or dispatches a
 *    notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - rewrites source records or rewrites history;
 *  - mutates invoices, statements, commercial decisions, pricing
 *    catalogs, product state, policy, customer bindings, or
 *    customer preferences;
 *  - dispatches notifications, executes settlements, performs
 *    payouts, performs reconciliation, or communicates with
 *    external partners.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine service IS:
 *  - the single B1-side B1 commercial-analytics authority for
 *    commercial analytics, profitability, and commercial
 *    reconciliation decisions;
 *  - the single B1-side B1 commercial-analytics read-only
 *    consumer boundary surface for later B1 tasks (B1T10
 *    commercial data classification / commercial disclosure /
 *    commercial support-trace surface; B1T11 commercial release
 *    gate);
 *  - the single B1-side B1 commercial-analytics compatibility
 *    validation authority;
 *  - the single B1-side B1 commercial-analytics replay-safe
 *    decision authority;
 *  - the single B1-side B1 commercial-analytics versioning
 *    authority.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine service reuses (without
 * modification) the A1 canonical identity, A2 authorization, A3
 * binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05
 * external-operation, A6T08 settlement, A6T09 external
 * reconciliation, A6T10 data classification, A7 product catalog, A7
 * product-policy profile, A7T04 product customer-binding, A7T05
 * product command / operation, A7T06 product notification delivery,
 * A7T07 product lifecycle, A7T08 product financial effect, A7T09
 * product reconciliation, A7T10 product data minimization, B1T03
 * commercial catalog, B1T04 commercial decision, B1T05 billing
 * engine, B1T06 campaign engine, B1T07 referral engine, B1T08
 * revenue-recognition engine, `CustomerPreference`, Wallet,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics, and
 * Reconciliation authorities. The B1 commercial-analytics engine,
 * profitability engine, and commercial-reconciliation engine service
 * emits B1 commercial-analytics audit facts through the shared
 * Operations `AuditService` (the only audit authority), reserves
 * B1 commercial-analytics idempotency records through the shared
 * Operations `IdempotencyService` (the only internal idempotency
 * authority), enqueues B1 commercial-analytics outbox events
 * through the shared Operations `OutboxService` (the only outbox
 * authority), and records B1 commercial-analytics metrics through
 * the shared Operations `MetricsService` (the only metrics
 * authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * no notification dispatch, no settlement, no payout, no
 * cashback execution, no reward execution, no loyalty balance
 * award, no loyalty balance redemption, no referral reward
 * execution, no revenue-recognition posting, no tax / VAT posting,
 * no cost-accounting posting, and no external financial
 * correction outside Ledger/Finance ownership is introduced by
 * B1T09.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR,
  B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION,
  B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_IDEMPOTENCY_SCOPE,
} from './b1-commercial-analytics-engine.constants';
import { B1CommercialAnalyticsEngineRepository } from './b1-commercial-analytics-engine.repository';
import type {
  B1CommercialAnalyticsDecisionReplaySafeResultV1,
  B1CommercialAnalyticsDecisionV1,
  B1CommercialAnalyticsDocumentPersistenceRecordV1,
  B1CommercialAnalyticsDocumentVersioningContractV1,
  B1CommercialAnalyticsEngineCompatibilityResultV1,
  B1CommercialAnalyticsEngineConsumerPortsV1,
  B1CommercialAnalyticsRequestV1,
  B1CommercialReconciliationDecisionReplaySafeResultV1,
  B1CommercialReconciliationDecisionV1,
  B1CommercialReconciliationRequestV1,
  B1ProfitabilityDecisionReplaySafeResultV1,
  B1ProfitabilityDecisionV1,
  B1ProfitabilityRequestV1,
} from './b1-commercial-analytics-engine.types';

@Injectable()
export class B1CommercialAnalyticsEngineService {
  constructor(
    @Inject(B1CommercialAnalyticsEngineRepository)
    private readonly repository: B1CommercialAnalyticsEngineRepository,
  ) {}

  getContractName(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1CommercialAnalyticsEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateCommercialAnalyticsDecision(
    request: B1CommercialAnalyticsRequestV1,
  ): B1CommercialAnalyticsDecisionV1 {
    return this.repository.generateCommercialAnalyticsDecision(request);
  }

  async replaySafeGenerateCommercialAnalyticsDecision(
    request: B1CommercialAnalyticsRequestV1,
  ): Promise<B1CommercialAnalyticsDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialAnalyticsDecision(request);
  }

  generateProfitabilityDecision(request: B1ProfitabilityRequestV1): B1ProfitabilityDecisionV1 {
    return this.repository.generateProfitabilityDecision(request);
  }

  async replaySafeGenerateProfitabilityDecision(
    request: B1ProfitabilityRequestV1,
  ): Promise<B1ProfitabilityDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateProfitabilityDecision(request);
  }

  generateCommercialReconciliationDecision(
    request: B1CommercialReconciliationRequestV1,
  ): B1CommercialReconciliationDecisionV1 {
    return this.repository.generateCommercialReconciliationDecision(request);
  }

  async replaySafeGenerateCommercialReconciliationDecision(
    request: B1CommercialReconciliationRequestV1,
  ): Promise<B1CommercialReconciliationDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialReconciliationDecision(request);
  }

  compatibilityCheck(
    request:
      | B1CommercialAnalyticsRequestV1
      | B1ProfitabilityRequestV1
      | B1CommercialReconciliationRequestV1,
  ): B1CommercialAnalyticsEngineCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1CommercialAnalyticsDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<readonly B1CommercialAnalyticsDocumentPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CommercialAnalyticsDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CommercialAnalyticsDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE;
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

  getCommercialAnalyticsStates(): readonly string[] {
    return this.repository.getCommercialAnalyticsStates();
  }

  getProfitabilityStates(): readonly string[] {
    return this.repository.getProfitabilityStates();
  }

  getCommercialReconciliationStates(): readonly string[] {
    return this.repository.getCommercialReconciliationStates();
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

  getKpis(): readonly string[] {
    return this.repository.getKpis();
  }

  getTrends(): readonly string[] {
    return this.repository.getTrends();
  }

  getDiscrepancySeverities(): readonly string[] {
    return this.repository.getDiscrepancySeverities();
  }

  getDiscrepancyOwners(): readonly string[] {
    return this.repository.getDiscrepancyOwners();
  }

  getDiscrepancyRecoveryStates(): readonly string[] {
    return this.repository.getDiscrepancyRecoveryStates();
  }

  getDiscrepancyCategories(): readonly string[] {
    return this.repository.getDiscrepancyCategories();
  }

  getProfitabilityDimensions(): readonly string[] {
    return this.repository.getProfitabilityDimensions();
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
