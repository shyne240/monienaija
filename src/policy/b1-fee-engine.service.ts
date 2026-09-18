/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine service.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine service is the single B1-side entry point for
 * the B1 commercial decision runtime. The B1 fee engine,
 * commission engine, and revenue sharing decision engine service
 * is a read-only service that exposes the B1 commercial decision
 * evaluate, the B1 commercial decision replay-safe evaluate, the
 * B1 commercial decision compatibility check, the B1 commercial
 * decision versioning contract, the B1 commercial decision
 * read-only consumer boundary surface, the B1 commercial decision
 * persistence accessors, and the B1 commercial decision audit /
 * idempotency / outbox / metrics identity.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine service NEVER:
 *  - posts a journal, mutates a balance, repairs a binding,
 *    changes A4 policy / source records, or dispatches a
 *    notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - executes settlements, executes billing, or executes
 *    accounting;
 *  - calls a partner, an SMS provider, an email provider, a push
 *    provider, or any external channel;
 *  - mutates the A1 canonical identity, the A2 authorization
 *    context, the A3 binding, the A4 product-policy decision, the
 *    A5 Ledger account state, the A6 partner-adapter state, the
 *    A6T05 external-operation record, the A6T08 settlement /
 *    suspense / compensating entry, the A6T09 external
 *    reconciliation report, the A6T10 data classification /
 *    consent / retention / legal-hold / secret / disclosure /
 *    support-trace / partner-payload validation, the A7 product
 *    catalog, the A7 product-policy profile, the A7T04 product
 *    customer-binding, the A7T05 product command/operation, the
 *    A7T06 product notification delivery, the A7T07 product
 *    lifecycle, the A7T08 product financial effect, the A7T09
 *    product reconciliation, the A7T10 product data minimization,
 *    the B1T03 commercial catalog registration, the
 *    `CustomerPreference`, the Wallet, the Ledger, the Operations,
 *    the Outbox, the Idempotency, the Metrics, the Diagnostics, or
 *    the Reconciliation authority;
 *  - activates a commercial plan, a pricing scheme, a fee
 *    structure, a commission model, a billing cycle, an invoice
 *    format, a statement format, a campaign, a promotion, a
 *    coupon, a referral, a cashback, a loyalty, a revenue-
 *    recognition standard, a tax / VAT scheme, a cost-accounting
 *    methodology, a profitability model, a customer / merchant /
 *    partner tier, a product entitlement, a feature flag, a
 *    dynamic limit, a subscription plan, a product package, a
 *    bundle, a commercial approval, a commercial audit, a
 *    commercial idempotency, a commercial reconciliation, a
 *    commercial data classification, a commercial retention, a
 *    commercial legal-hold, a commercial secret, a commercial
 *    disclosure, a commercial support-trace, or a commercial
 *    release gate;
 *  - auto-repairs a commercial decision failure, auto-clears a
 *    commercial decision record, auto-issues a commercial
 *    decision record, or auto-publishes a commercial decision
 *    version;
 *  - takes any write lock or holds any write transaction beyond
 *    the shared Operations `IdempotencyService` reservation for
 *    the B1 commercial decision replay-safe evaluate.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine service IS:
 *  - the single B1-side B1 commercial decision authority;
 *  - the single B1-side B1 commercial decision read-only consumer
 *    boundary surface for later B1 tasks (B1T05, B1T06, B1T07,
 *    B1T08, B1T09, B1T10, B1T11);
 *  - the single B1-side B1 commercial decision compatibility
 *    validation authority;
 *  - the single B1-side B1 commercial decision replay-safe
 *    decision authority;
 *  - the single B1-side B1 commercial decision versioning
 *    authority.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine service reuses (without modification) the A1
 * canonical identity, A2 authorization, A3 binding, A4
 * product-policy, A5 Ledger, A6 partner-adapter, A6T05
 * external-operation, A6T08 settlement / suspense / compensating,
 * A6T09 external reconciliation, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, A7T04 product
 * customer-binding, A7T05 product command/operation, A7T06
 * product notification delivery, A7T07 product lifecycle, A7T08
 * product financial effect, A7T09 product reconciliation, A7T10
 * product data minimization, B1T03 commercial catalog,
 * `CustomerPreference`, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, and Reconciliation authorities. The B1
 * fee engine, commission engine, and revenue sharing decision
 * engine service emits B1 commercial decision audit facts through
 * the shared Operations `AuditService` (the only audit authority),
 * reserves B1 commercial decision idempotency records through the
 * shared Operations `IdempotencyService` (the only internal
 * idempotency authority), enqueues B1 commercial decision outbox
 * events through the shared Operations `OutboxService` (the only
 * outbox authority), and records B1 commercial decision metrics
 * through the shared Operations `MetricsService` (the only metrics
 * authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * and no external financial correction outside Ledger/Finance
 * ownership is introduced by B1T04.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_FEE_ENGINE_AUDIT_ACTOR,
  B1_FEE_ENGINE_AUDIT_ENTITY_TYPE,
  B1_FEE_ENGINE_CONTRACT_NAME,
  B1_FEE_ENGINE_CONTRACT_VERSION,
  B1_FEE_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-fee-engine.constants';
import { B1FeeEngineRepository } from './b1-fee-engine.repository';
import type {
  B1CommercialDecisionCompatibilityResultV1,
  B1CommercialDecisionConsumerPortsV1,
  B1CommercialDecisionPersistenceRecordV1,
  B1CommercialDecisionRecordV1,
  B1CommercialDecisionReplaySafeResultV1,
  B1CommercialDecisionRequestV1,
  B1CommercialDecisionVersioningContractV1,
} from './b1-fee-engine.types';

@Injectable()
export class B1FeeEngineService {
  constructor(
    @Inject(B1FeeEngineRepository)
    private readonly repository: B1FeeEngineRepository,
  ) {}

  /**
   * Returns the B1 fee engine, commission engine, and revenue
   * sharing decision engine contract name.
   */
  getContractName(): string {
    return B1_FEE_ENGINE_CONTRACT_NAME;
  }

  /**
   * Returns the B1 fee engine, commission engine, and revenue
   * sharing decision engine contract version.
   */
  getContractVersion(): number {
    return B1_FEE_ENGINE_CONTRACT_VERSION;
  }

  /**
   * Returns the B1 commercial decision read-only consumer ports.
   */
  getConsumerPorts(): B1CommercialDecisionConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  /**
   * Evaluates a B1 commercial decision. The B1 commercial
   * decision evaluate is read-only; the B1 commercial decision
   * evaluate does NOT post a journal, mutate a balance, repair a
   * binding, change A4 policy / source records, or dispatch a
   * notification.
   */
  evaluate(request: B1CommercialDecisionRequestV1): B1CommercialDecisionRecordV1 {
    return this.repository.evaluate(request);
  }

  /**
   * Evaluates a B1 commercial decision with replay safety. The
   * B1 commercial decision replay-safe evaluate is read-only; the
   * B1 commercial decision replay-safe evaluate does NOT post a
   * journal, mutate a balance, repair a binding, change A4
   * policy / source records, or dispatch a notification.
   */
  replaySafeEvaluate(
    request: B1CommercialDecisionRequestV1,
  ): Promise<B1CommercialDecisionReplaySafeResultV1> {
    return this.repository.replaySafeEvaluate(request);
  }

  /**
   * Checks a B1 commercial decision for compatibility. The B1
   * commercial decision compatibility check is read-only; the B1
   * commercial decision compatibility check does NOT post a
   * journal, mutate a balance, repair a binding, change A4 policy
   * / source records, or dispatch a notification.
   */
  compatibilityCheck(
    request: B1CommercialDecisionRequestV1,
  ): B1CommercialDecisionCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  /**
   * Returns the B1 commercial decision versioning contract. The
   * B1 commercial decision versioning contract is the canonical
   * B1 commercial decision versioning contract for the first
   * commercial scope.
   */
  getVersioningContract(): B1CommercialDecisionVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  /**
   * Returns the B1 commercial decision persistence records. The
   * B1 commercial decision persistence records are the durable
   * TypeORM records for the B1 commercial decision.
   */
  listPersistenceRecords(): Promise<readonly B1CommercialDecisionPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  /**
   * Returns the B1 commercial decision persistence record for
   * the supplied B1 commercial decision reference.
   */
  getPersistenceRecordByReference(
    decisionReference: string,
    decisionVersion: 1,
  ): Promise<B1CommercialDecisionPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(decisionReference, decisionVersion);
  }

  /**
   * Returns the B1 commercial decision persistence record for
   * the supplied B1 commercial decision idempotency key.
   */
  getPersistenceRecordByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<B1CommercialDecisionPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(
      B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE_TERM,
      idempotencyKey,
    );
  }

  /**
   * Returns the B1 commercial decision audit actor. The B1
   * commercial decision audit actor is the canonical B1 commercial
   * decision audit actor.
   */
  getAuditActor(): string {
    return B1_FEE_ENGINE_AUDIT_ACTOR;
  }

  /**
   * Returns the B1 commercial decision audit entity type. The B1
   * commercial decision audit entity type is the canonical B1
   * commercial decision audit entity type.
   */
  getAuditEntityType(): string {
    return B1_FEE_ENGINE_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the B1 commercial decision outbox event type. The B1
   * commercial decision outbox event type is the canonical B1
   * commercial decision outbox event type.
   */
  getOutboxEventType(): string {
    return B1_FEE_ENGINE_OUTBOX_EVENT_TYPE;
  }

  /**
   * Returns the B1 commercial decision internal idempotency
   * scope.
   */
  getInternalIdempotencyScope(): string {
    return this.repository.getInternalIdempotencyScope();
  }

  /**
   * Returns the B1 commercial decision internal idempotency
   * retention seconds.
   */
  getIdempotencyRetentionSeconds(): number {
    return this.repository.getIdempotencyRetentionSeconds();
  }

  /**
   * Returns the B1 commercial decision reference prefix.
   */
  getReferencePrefix(): string {
    return this.repository.getReferencePrefix();
  }

  /**
   * Returns the B1 commercial decision scope identity.
   */
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

  getDecisionKinds(): readonly string[] {
    return this.repository.getDecisionKinds();
  }

  getDecisionOutcomes(): readonly string[] {
    return this.repository.getDecisionOutcomes();
  }

  getAdmittedOutcome(): string {
    return this.repository.getAdmittedOutcome();
  }

  getRuleKinds(): readonly string[] {
    return this.repository.getRuleKinds();
  }

  getRuleOutcomes(): readonly string[] {
    return this.repository.getRuleOutcomes();
  }

  getRoundingPolicies(): readonly string[] {
    return this.repository.getRoundingPolicies();
  }

  getRetentionDays(): number {
    return this.repository.getRetentionDays();
  }

  getLookupKinds(): readonly string[] {
    return this.repository.getLookupKinds();
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

  getDataControlClassifications(): readonly string[] {
    return this.repository.getDataControlClassifications();
  }

  getFailureCodes(): readonly string[] {
    return this.repository.getFailureCodes();
  }

  getMetrics(): readonly string[] {
    return this.repository.getMetrics();
  }
}

const B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE_TERM =
  'b1.commercial-decision.idempotency.v1' as const;
