/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine service.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine service is the single B1-side entry point for the B1
 * billing document runtime. The B1 billing engine, invoice engine,
 * and statement-generation engine service is a read-only service
 * that exposes the B1 billing record generate, the B1 billing
 * record replay-safe generate, the B1 invoice generate, the B1
 * invoice replay-safe generate, the B1 statement generate, the B1
 * statement replay-safe generate, the B1 billing document
 * compatibility check, the B1 billing document versioning
 * contract, the B1 billing document read-only consumer boundary
 * surface, the B1 billing document persistence accessors, and the
 * B1 billing document audit / idempotency / outbox / metrics
 * identity.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine service NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes payouts, creates financial effects, repairs a
 *    binding, changes A4 policy / source records, or dispatches a
 *    notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - modifies pricing catalogs, commercial decisions, product
 *    state, policy, customer bindings, or customer preferences;
 *  - dispatches notifications, executes settlements, performs
 *    payouts, or performs reconciliation.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine service IS:
 *  - the single B1-side B1 billing document authority;
 *  - the single B1-side B1 billing document read-only consumer
 *    boundary surface for later B1 tasks (B1T08 revenue-
 *    recognition / tax / cost-accounting engine; B1T09
 *    commercial analytics / profitability / commercial
 *    reconciliation engine; B1T10 commercial data classification
 *    / commercial disclosure / commercial support-trace surface;
 *    B1T11 commercial release gate);
 *  - the single B1-side B1 billing document compatibility
 *    validation authority;
 *  - the single B1-side B1 billing document replay-safe document
 *    generation authority;
 *  - the single B1-side B1 billing document versioning authority.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine service reuses (without modification) the A1 canonical
 * identity, A2 authorization, A3 binding, A4 product-policy, A5
 * Ledger, A6 partner-adapter, A6T05 external-operation, A6T08
 * settlement, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, B1T03
 * commercial catalog, B1T04 commercial decision,
 * `CustomerPreference`, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, and Reconciliation authorities. The B1
 * billing engine, invoice engine, and statement-generation engine
 * service emits B1 billing document audit facts through the shared
 * Operations `AuditService` (the only audit authority), reserves
 * B1 billing document idempotency records through the shared
 * Operations `IdempotencyService` (the only internal idempotency
 * authority), enqueues B1 billing document outbox events through
 * the shared Operations `OutboxService` (the only outbox
 * authority), and records B1 billing document metrics through the
 * shared Operations `MetricsService` (the only metrics authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * and no external financial correction outside Ledger/Finance
 * ownership is introduced by B1T05.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_BILLING_ENGINE_AUDIT_ACTOR,
  B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE,
  B1_BILLING_ENGINE_CONTRACT_NAME,
  B1_BILLING_ENGINE_CONTRACT_VERSION,
  B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-billing-engine.constants';
import { B1BillingEngineRepository } from './b1-billing-engine.repository';
import type {
  B1BillingDocumentCompatibilityResultV1,
  B1BillingDocumentPersistenceRecordV1,
  B1BillingDocumentVersioningContractV1,
  B1BillingEngineConsumerPortsV1,
  B1BillingRecordReplaySafeResultV1,
  B1BillingRecordV1,
  B1BillingRequestV1,
  B1InvoiceReplaySafeResultV1,
  B1InvoiceRequestV1,
  B1InvoiceV1,
  B1StatementReplaySafeResultV1,
  B1StatementRequestV1,
  B1StatementV1,
} from './b1-billing-engine.types';

@Injectable()
export class B1BillingEngineService {
  constructor(
    @Inject(B1BillingEngineRepository)
    private readonly repository: B1BillingEngineRepository,
  ) {}

  getContractName(): string {
    return B1_BILLING_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_BILLING_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1BillingEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateBillingRecord(request: B1BillingRequestV1): B1BillingRecordV1 {
    return this.repository.generateBillingRecord(request);
  }

  async replaySafeGenerateBillingRecord(
    request: B1BillingRequestV1,
  ): Promise<B1BillingRecordReplaySafeResultV1> {
    return this.repository.replaySafeGenerateBillingRecord(request);
  }

  generateInvoice(request: B1InvoiceRequestV1): B1InvoiceV1 {
    return this.repository.generateInvoice(request);
  }

  async replaySafeGenerateInvoice(
    request: B1InvoiceRequestV1,
  ): Promise<B1InvoiceReplaySafeResultV1> {
    return this.repository.replaySafeGenerateInvoice(request);
  }

  generateStatement(request: B1StatementRequestV1): B1StatementV1 {
    return this.repository.generateStatement(request);
  }

  async replaySafeGenerateStatement(
    request: B1StatementRequestV1,
  ): Promise<B1StatementReplaySafeResultV1> {
    return this.repository.replaySafeGenerateStatement(request);
  }

  compatibilityCheck(
    request: B1BillingRequestV1 | B1InvoiceRequestV1 | B1StatementRequestV1,
  ): B1BillingDocumentCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1BillingDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<readonly B1BillingDocumentPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1BillingDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1BillingDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_BILLING_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getInternalIdempotencyScope(): string {
    return this.repository.getInternalIdempotencyScope();
  }

  getInvoiceIdempotencyScope(): string {
    return this.repository.getInvoiceIdempotencyScope();
  }

  getStatementIdempotencyScope(): string {
    return this.repository.getStatementIdempotencyScope();
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

  getBillingPeriodKey(): string {
    return this.repository.getBillingPeriodKey();
  }

  getStatementPeriodKey(): string {
    return this.repository.getStatementPeriodKey();
  }

  getRetentionDays(): number {
    return this.repository.getRetentionDays();
  }

  getBillingRecordStates(): readonly string[] {
    return this.repository.getBillingRecordStates();
  }

  getInvoiceStates(): readonly string[] {
    return this.repository.getInvoiceStates();
  }

  getStatementStates(): readonly string[] {
    return this.repository.getStatementStates();
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

  getLineKinds(): readonly string[] {
    return this.repository.getLineKinds();
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
}
