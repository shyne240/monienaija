/**
 * B1T06 — B1 campaign engine, promotion engine, and coupon engine
 * service.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * service is the single B1-side entry point for the B1 campaign
 * decision runtime. The B1 campaign engine, promotion engine,
 * and coupon engine service is a read-only service that exposes
 * the B1 campaign decision generate, the B1 campaign decision
 * replay-safe generate, the B1 promotion decision generate, the
 * B1 promotion decision replay-safe generate, the B1 coupon
 * decision generate, the B1 coupon decision replay-safe
 * generate, the B1 campaign engine compatibility check, the B1
 * campaign engine versioning contract, the B1 campaign engine
 * read-only consumer boundary surface, the B1 campaign engine
 * persistence accessors, and the B1 campaign engine audit /
 * idempotency / outbox / metrics identity.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * service NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    creates financial effects, repairs a binding, changes A4
 *    policy / source records, or dispatches a notification;
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
 * The B1 campaign engine, promotion engine, and coupon engine
 * service IS:
 *  - the single B1-side B1 commercial-incentive authority for
 *    campaign, promotion, and coupon decisions;
 *  - the single B1-side B1 campaign decision read-only consumer
 *    boundary surface for later B1 tasks (B1T07 referral /
 *    cashback / loyalty engine; B1T08 revenue-recognition / tax /
 *    cost-accounting engine; B1T09 commercial analytics /
 *    profitability / commercial reconciliation engine; B1T10
 *    commercial data classification / commercial disclosure /
 *    commercial support-trace surface; B1T11 commercial release
 *    gate);
 *  - the single B1-side B1 campaign decision compatibility
 *    validation authority;
 *  - the single B1-side B1 campaign decision replay-safe decision
 *    authority;
 *  - the single B1-side B1 campaign decision versioning authority.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
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
 * engine, `CustomerPreference`, Wallet, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, and Reconciliation
 * authorities. The B1 campaign engine, promotion engine, and
 * coupon engine service emits B1 campaign decision audit facts
 * through the shared Operations `AuditService` (the only audit
 * authority), reserves B1 campaign decision idempotency records
 * through the shared Operations `IdempotencyService` (the only
 * internal idempotency authority), enqueues B1 campaign decision
 * outbox events through the shared Operations `OutboxService`
 * (the only outbox authority), and records B1 campaign decision
 * metrics through the shared Operations `MetricsService` (the
 * only metrics authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * no notification dispatch, no settlement, no payout, no
 * cashback execution, no reward execution, and no external
 * financial correction outside Ledger/Finance ownership is
 * introduced by B1T06.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_CAMPAIGN_ENGINE_AUDIT_ACTOR,
  B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE,
  B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
  B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-campaign-engine.constants';
import { B1CampaignEngineRepository } from './b1-campaign-engine.repository';
import type {
  B1CampaignDecisionReplaySafeResultV1,
  B1CampaignDecisionV1,
  B1CampaignEngineCompatibilityResultV1,
  B1CampaignDocumentPersistenceRecordV1,
  B1CampaignDocumentVersioningContractV1,
  B1CampaignEngineConsumerPortsV1,
  B1CampaignRequestV1,
  B1CouponDecisionReplaySafeResultV1,
  B1CouponDecisionV1,
  B1CouponRequestV1,
  B1PromotionDecisionReplaySafeResultV1,
  B1PromotionDecisionV1,
  B1PromotionRequestV1,
} from './b1-campaign-engine.types';

@Injectable()
export class B1CampaignEngineService {
  constructor(
    @Inject(B1CampaignEngineRepository)
    private readonly repository: B1CampaignEngineRepository,
  ) {}

  getContractName(): string {
    return B1_CAMPAIGN_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_CAMPAIGN_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1CampaignEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateCampaignDecision(request: B1CampaignRequestV1): B1CampaignDecisionV1 {
    return this.repository.generateCampaignDecision(request);
  }

  async replaySafeGenerateCampaignDecision(
    request: B1CampaignRequestV1,
  ): Promise<B1CampaignDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCampaignDecision(request);
  }

  generatePromotionDecision(request: B1PromotionRequestV1): B1PromotionDecisionV1 {
    return this.repository.generatePromotionDecision(request);
  }

  async replaySafeGeneratePromotionDecision(
    request: B1PromotionRequestV1,
  ): Promise<B1PromotionDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGeneratePromotionDecision(request);
  }

  generateCouponDecision(request: B1CouponRequestV1): B1CouponDecisionV1 {
    return this.repository.generateCouponDecision(request);
  }

  async replaySafeGenerateCouponDecision(
    request: B1CouponRequestV1,
  ): Promise<B1CouponDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCouponDecision(request);
  }

  compatibilityCheck(
    request: B1CampaignRequestV1 | B1PromotionRequestV1 | B1CouponRequestV1,
  ): B1CampaignEngineCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1CampaignDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<readonly B1CampaignDocumentPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CampaignDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CampaignDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_CAMPAIGN_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_CAMPAIGN_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getCampaignIdempotencyScope(): string {
    return this.repository.getCampaignIdempotencyScope();
  }

  getPromotionIdempotencyScope(): string {
    return this.repository.getPromotionIdempotencyScope();
  }

  getCouponIdempotencyScope(): string {
    return this.repository.getCouponIdempotencyScope();
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

  getCampaignStates(): readonly string[] {
    return this.repository.getCampaignStates();
  }

  getPromotionStates(): readonly string[] {
    return this.repository.getPromotionStates();
  }

  getCouponStates(): readonly string[] {
    return this.repository.getCouponStates();
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

  getPriorities(): readonly string[] {
    return this.repository.getPriorities();
  }

  getStackingRules(): readonly string[] {
    return this.repository.getStackingRules();
  }

  getEligibilities(): readonly string[] {
    return this.repository.getEligibilities();
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
