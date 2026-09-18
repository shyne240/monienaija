/**
 * B1T07 — B1 referral engine, cashback engine, and loyalty engine
 * service.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * service is the single B1-side entry point for the B1 commercial-
 * rewards runtime. The B1 referral engine, cashback engine, and
 * loyalty engine service is a read-only service that exposes the
 * B1 referral reward decision generate, the B1 referral reward
 * decision replay-safe generate, the B1 cashback calculation
 * decision generate, the B1 cashback calculation decision replay-
 * safe generate, the B1 loyalty earning decision generate, the B1
 * loyalty earning decision replay-safe generate, the B1 referral
 * engine compatibility check, the B1 referral engine versioning
 * contract, the B1 referral engine read-only consumer boundary
 * surface, the B1 referral engine persistence accessors, and the
 * B1 referral engine audit / idempotency / outbox / metrics
 * identity.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * service NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    credits a wallet, debits a wallet, awards loyalty balances,
 *    redeems loyalty balances, executes referral rewards, creates
 *    financial effects, repairs a binding, changes A4 policy /
 *    source records, or dispatches a notification;
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
 * The B1 referral engine, cashback engine, and loyalty engine
 * service IS:
 *  - the single B1-side B1 commercial-rewards authority for
 *    referral, cashback, and loyalty decisions;
 *  - the single B1-side B1 commercial-rewards read-only consumer
 *    boundary surface for later B1 tasks (B1T08 revenue-
 *    recognition / tax / cost-accounting engine; B1T09 commercial
 *    analytics / profitability / commercial reconciliation engine;
 *    B1T10 commercial data classification / commercial disclosure
 *    / commercial support-trace surface; B1T11 commercial release
 *    gate);
 *  - the single B1-side B1 commercial-rewards compatibility
 *    validation authority;
 *  - the single B1-side B1 commercial-rewards replay-safe decision
 *    authority;
 *  - the single B1-side B1 commercial-rewards versioning authority.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * service reuses (without modification) the A1 canonical
 * identity, A2 authorization, A3 binding, A4 product-policy, A5
 * Ledger, A6 partner-adapter, A6T05 external-operation, A6T08
 * settlement, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command /
 * operation, A7T06 product notification delivery, A7T07 product
 * lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, B1T03
 * commercial catalog, B1T04 commercial decision, B1T05 billing
 * engine, B1T06 campaign engine, `CustomerPreference`, Wallet,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics, and
 * Reconciliation authorities. The B1 referral engine, cashback
 * engine, and loyalty engine service emits B1 referral decision
 * audit facts through the shared Operations `AuditService` (the
 * only audit authority), reserves B1 referral decision idempotency
 * records through the shared Operations `IdempotencyService` (the
 * only internal idempotency authority), enqueues B1 referral
 * decision outbox events through the shared Operations
 * `OutboxService` (the only outbox authority), and records B1
 * referral decision metrics through the shared Operations
 * `MetricsService` (the only metrics authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * no notification dispatch, no settlement, no payout, no
 * cashback redemption, no loyalty balance award, no loyalty
 * balance redemption, no referral reward execution, and no
 * external financial correction outside Ledger/Finance ownership
 * is introduced by B1T07.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_REFERRAL_ENGINE_AUDIT_ACTOR,
  B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE,
  B1_REFERRAL_ENGINE_CONTRACT_NAME,
  B1_REFERRAL_ENGINE_CONTRACT_VERSION,
  B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-referral-engine.constants';
import { B1ReferralEngineRepository } from './b1-referral-engine.repository';
import type {
  B1CashbackCalculationDecisionV1,
  B1CashbackCalculationReplaySafeResultV1,
  B1CashbackRequestV1,
  B1LoyaltyEarningDecisionV1,
  B1LoyaltyEarningReplaySafeResultV1,
  B1LoyaltyEarningRequestV1,
  B1ReferralEngineCompatibilityResultV1,
  B1ReferralDocumentPersistenceRecordV1,
  B1ReferralDocumentVersioningContractV1,
  B1ReferralEngineConsumerPortsV1,
  B1ReferralRequestV1,
  B1ReferralRewardDecisionV1,
  B1ReferralRewardReplaySafeResultV1,
} from './b1-referral-engine.types';

@Injectable()
export class B1ReferralEngineService {
  constructor(
    @Inject(B1ReferralEngineRepository)
    private readonly repository: B1ReferralEngineRepository,
  ) {}

  getContractName(): string {
    return B1_REFERRAL_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_REFERRAL_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1ReferralEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateReferralRewardDecision(request: B1ReferralRequestV1): B1ReferralRewardDecisionV1 {
    return this.repository.generateReferralRewardDecision(request);
  }

  async replaySafeGenerateReferralRewardDecision(
    request: B1ReferralRequestV1,
  ): Promise<B1ReferralRewardReplaySafeResultV1> {
    return this.repository.replaySafeGenerateReferralRewardDecision(request);
  }

  generateCashbackCalculationDecision(
    request: B1CashbackRequestV1,
  ): B1CashbackCalculationDecisionV1 {
    return this.repository.generateCashbackCalculationDecision(request);
  }

  async replaySafeGenerateCashbackCalculationDecision(
    request: B1CashbackRequestV1,
  ): Promise<B1CashbackCalculationReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCashbackCalculationDecision(request);
  }

  generateLoyaltyEarningDecision(request: B1LoyaltyEarningRequestV1): B1LoyaltyEarningDecisionV1 {
    return this.repository.generateLoyaltyEarningDecision(request);
  }

  async replaySafeGenerateLoyaltyEarningDecision(
    request: B1LoyaltyEarningRequestV1,
  ): Promise<B1LoyaltyEarningReplaySafeResultV1> {
    return this.repository.replaySafeGenerateLoyaltyEarningDecision(request);
  }

  compatibilityCheck(
    request: B1ReferralRequestV1 | B1CashbackRequestV1 | B1LoyaltyEarningRequestV1,
  ): B1ReferralEngineCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1ReferralDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<readonly B1ReferralDocumentPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1ReferralDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1ReferralDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_REFERRAL_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_REFERRAL_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getReferralIdempotencyScope(): string {
    return this.repository.getReferralIdempotencyScope();
  }

  getCashbackIdempotencyScope(): string {
    return this.repository.getCashbackIdempotencyScope();
  }

  getLoyaltyIdempotencyScope(): string {
    return this.repository.getLoyaltyIdempotencyScope();
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

  getReferralStates(): readonly string[] {
    return this.repository.getReferralStates();
  }

  getCashbackStates(): readonly string[] {
    return this.repository.getCashbackStates();
  }

  getLoyaltyStates(): readonly string[] {
    return this.repository.getLoyaltyStates();
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

  getRelationshipTypes(): readonly string[] {
    return this.repository.getRelationshipTypes();
  }

  getQualificationStatuses(): readonly string[] {
    return this.repository.getQualificationStatuses();
  }

  getLoyaltyTierStatuses(): readonly string[] {
    return this.repository.getLoyaltyTierStatuses();
  }

  getLoyaltyEarningSources(): readonly string[] {
    return this.repository.getLoyaltyEarningSources();
  }

  getCashbackCalculationBases(): readonly string[] {
    return this.repository.getCashbackCalculationBases();
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
