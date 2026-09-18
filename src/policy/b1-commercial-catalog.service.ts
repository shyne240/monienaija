/**
 * B1T03 — B1 commercial catalog, plan catalog, subscription plan,
 * customer tier, merchant tier, partner tier, product entitlement,
 * product packaging / bundle catalog, and read-only consumer
 * boundary service.
 *
 * The B1 commercial catalog service is the single B1-side entry
 * point for the B1 first commercial catalog, the B1 first plan
 * catalog, the B1 first subscription plan registration, the B1
 * first customer tier catalog, the B1 first merchant tier catalog,
 * the B1 first partner tier catalog, the B1 first product
 * entitlement catalog, the B1 first commercial package catalog,
 * the B1 first commercial bundle catalog, the catalog versioning
 * contract, the compatibility validation contract, the replay-safe
 * catalog lookup contract, and the read-only consumer boundary
 * surface for later B1 tasks (B1T04 fee / commission / revenue-
 * sharing engine; B1T05 billing / invoice / statement engine;
 * B1T06 campaign / promotion / coupon engine; B1T07 referral /
 * cashback / loyalty engine; B1T08 revenue-recognition / tax /
 * cost-accounting engine; B1T09 commercial analytics /
 * profitability / commercial reconciliation engine; B1T10
 * commercial data classification / commercial idempotency /
 * commercial audit / commercial approval / feature flag surface;
 * B1T11 commercial release gate).
 *
 * The B1 commercial catalog service is a read-only service. The
 * B1 commercial catalog service NEVER:
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects;
 *  - posts a journal, mutates a balance, clears suspense, or edits
 *    a posted journal/line outside Ledger and Finance-approved
 *    correction boundaries;
 *  - dispatches a notification;
 *  - calls a partner, an SMS provider, an email provider, a push
 *    provider, or any external channel;
 *  - mutates the A7 product catalog, the A7 product-policy
 *    profile, the A7T04 product customer-binding, the A7T05
 *    product command/operation, the A7T06 product notification
 *    delivery, the A7T07 product lifecycle, the A7T08 product
 *    financial effect, the A7T09 product reconciliation, or the
 *    A7T10 product data minimization;
 *  - mutates the A2 authorization context, the A3 binding, the A4
 *    policy / source records, the A5 transfer / deposit /
 *    withdrawal, the A6 partner-adapter, the A6T05
 *    external-operation, the A6T08 settlement, suspense, or
 *    compensating entry, the A6T09 external reconciliation, or
 *    the A6T10 data classification, consent, retention, legal-
 *    hold, secret, disclosure, support-trace, or partner-payload
 *    validation;
 *  - activates a commercial plan, pricing scheme, fee structure,
 *    commission model, billing cycle, invoice format, statement
 *    format, campaign, promotion, coupon, referral, cashback,
 *    loyalty, revenue-recognition standard, tax / VAT scheme,
 *    cost-accounting methodology, profitability model, customer /
 *    merchant / partner tier, product entitlement, feature flag,
 *    dynamic limit, subscription plan, product package, bundle,
 *    commercial approval, commercial audit, commercial
 *    idempotency, commercial reconciliation, commercial data
 *    classification, or commercial release gate;
 *  - auto-repairs a catalog failure, auto-clears a catalog
 *    record, auto-issues a catalog record, or auto-publishes a
 *    catalog version;
 *  - takes any write lock or holds any write transaction beyond
 *    the shared Operations `IdempotencyService` reservation for
 *    the B1 commercial catalog replay-safe lookup.
 *
 * The B1 commercial catalog service IS:
 *  - the single B1-side B1 commercial catalog authority;
 *  - the single B1-side B1 commercial catalog read-only consumer
 *    boundary surface for later B1 tasks (B1T04, B1T05, B1T06,
 *    B1T07, B1T08, B1T09, B1T10, B1T11);
 *  - the single B1-side B1 commercial catalog compatibility
 *    validation authority;
 *  - the single B1-side B1 commercial catalog replay-safe catalog
 *    lookup authority;
 *  - the single B1-side B1 commercial catalog versioning
 *    authority.
 *
 * The B1 commercial catalog service reuses (without modification)
 * the A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 Ledger, A6 partner-adapter, A6T05
 * external-operation, A6T08 settlement, A6T09 external
 * reconciliation, A6T10 data classification, A7 product catalog,
 * A7 product-policy profile, A7T04 product customer-binding, A7T05
 * product command, A7T06 product notification, A7T07 product
 * lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization,
 * `CustomerPreference`, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, and Reconciliation authorities. The B1
 * commercial catalog service emits B1 commercial catalog audit
 * facts through the shared Operations `AuditService` (the only
 * audit authority), reserves B1 commercial catalog idempotency
 * records through the shared Operations `IdempotencyService` (the
 * only internal idempotency authority), enqueues B1 commercial
 * catalog outbox events through the shared Operations
 * `OutboxService` (the only outbox authority), and records B1
 * commercial catalog metrics through the shared Operations
 * `MetricsService` (the only metrics authority).
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance,
 * and no external financial correction outside Ledger/Finance
 * ownership is introduced by B1T03.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_COMMERCIAL_CATALOG_AUDIT_ACTOR,
  B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  B1_COMMERCIAL_CATALOG_CONTRACT_VERSION,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE,
} from './b1-commercial-catalog.constants';
import { B1CommercialCatalogRepository } from './b1-commercial-catalog.repository';
import type {
  B1CommercialCatalogConsumerPortsV1,
  B1CommercialCatalogLookupCommandV1,
  B1CommercialCatalogLookupResultV1,
  B1CommercialCatalogPersistenceRecordV1,
  B1CommercialCatalogRegistrationV1,
  B1CommercialCatalogReplaySafeResultV1,
  B1CommercialCatalogVersioningContractV1,
} from './b1-commercial-catalog.types';

@Injectable()
export class B1CommercialCatalogService {
  constructor(
    @Inject(B1CommercialCatalogRepository)
    private readonly repository: B1CommercialCatalogRepository,
  ) {}

  /**
   * Returns the B1 commercial catalog contract name. The B1
   * commercial catalog contract name is the canonical B1
   * commercial catalog contract name.
   */
  getContractName(): string {
    return B1_COMMERCIAL_CATALOG_CONTRACT_NAME;
  }

  /**
   * Returns the B1 commercial catalog contract version. The B1
   * commercial catalog contract version is the canonical B1
   * commercial catalog contract version.
   */
  getContractVersion(): number {
    return B1_COMMERCIAL_CATALOG_CONTRACT_VERSION;
  }

  /**
   * Returns the B1 commercial catalog first commercial scope
   * registration.
   */
  getFirstScopeRegistration(): B1CommercialCatalogRegistrationV1 {
    return this.repository.getFirstScopeRegistration();
  }

  /**
   * Returns the B1 commercial catalog read-only consumer ports.
   * The B1 commercial catalog read-only consumer ports are the
   * canonical read-only consumer boundary surface for later B1
   * tasks (B1T04, B1T05, B1T06, B1T07, B1T08, B1T09, B1T10,
   * B1T11).
   */
  getConsumerPorts(): B1CommercialCatalogConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  /**
   * Runs a B1 commercial catalog lookup. The B1 commercial catalog
   * lookup is read-only; the B1 commercial catalog lookup does NOT
   * mutate any A1-A7 source record.
   */
  lookup(command: B1CommercialCatalogLookupCommandV1): B1CommercialCatalogLookupResultV1 {
    return this.repository.lookup(command);
  }

  /**
   * Runs a B1 commercial catalog replay-safe lookup. The B1
   * commercial catalog replay-safe lookup is read-only; the B1
   * commercial catalog replay-safe lookup does NOT mutate any A1-A7
   * source record.
   */
  replaySafeLookup(
    command: B1CommercialCatalogLookupCommandV1,
  ): Promise<B1CommercialCatalogReplaySafeResultV1> {
    return this.repository.replaySafeLookup(command);
  }

  /**
   * Runs a B1 commercial catalog compatibility check. The B1
   * commercial catalog compatibility check is read-only; the B1
   * commercial catalog compatibility check does NOT mutate any A1-A7
   * source record.
   */
  compatibilityCheck(command: B1CommercialCatalogLookupCommandV1): {
    readonly compatible: true | false;
    readonly code?: string;
    readonly reasons: readonly string[];
  } {
    return this.repository.compatibilityCheck(command);
  }

  /**
   * Returns the B1 commercial catalog versioning contract. The B1
   * commercial catalog versioning contract is the canonical B1
   * commercial catalog versioning contract for the first
   * commercial scope registration.
   */
  getVersioningContract(): B1CommercialCatalogVersioningContractV1 {
    const registration = this.repository.getFirstScopeRegistration();
    return {
      catalogKey: registration.catalogKey,
      catalogVersion: 1,
      scopeKey: registration.scopeKey,
      scopeVersion: registration.scopeVersion,
      effectiveFrom: registration.effectiveFrom,
      effectiveTo: registration.effectiveTo,
      supersededByCatalogKey: null,
      supersedesCatalogKey: null,
      migrationHint: null,
    };
  }

  /**
   * Returns the B1 commercial catalog persistence records. The
   * B1 commercial catalog persistence records are the durable
   * TypeORM records for the B1 first commercial scope
   * registration.
   */
  listPersistenceRecords(): Promise<readonly B1CommercialCatalogPersistenceRecordV1[]> {
    return this.repository.findPersistenceRecords();
  }

  /**
   * Returns the B1 commercial catalog persistence record for the
   * supplied B1 commercial catalog key.
   */
  getPersistenceRecord(
    catalogKey: string,
    catalogVersion: 1,
  ): Promise<B1CommercialCatalogPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByKey(catalogKey, catalogVersion);
  }

  /**
   * Returns the B1 commercial catalog audit actor. The B1
   * commercial catalog audit actor is the canonical B1 commercial
   * catalog audit actor.
   */
  getAuditActor(): string {
    return B1_COMMERCIAL_CATALOG_AUDIT_ACTOR;
  }

  /**
   * Returns the B1 commercial catalog audit entity type. The B1
   * commercial catalog audit entity type is the canonical B1
   * commercial catalog audit entity type.
   */
  getAuditEntityType(): string {
    return B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the B1 commercial catalog outbox event type. The B1
   * commercial catalog outbox event type is the canonical B1
   * commercial catalog outbox event type.
   */
  getOutboxEventType(): string {
    return B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE;
  }

  /**
   * Returns the B1 commercial catalog state vocabulary. The B1
   * commercial catalog state vocabulary is the canonical B1
   * commercial catalog state vocabulary.
   */
  listStates(): readonly string[] {
    return this.repository.getStateVocabulary();
  }

  /**
   * Returns the B1 commercial catalog capabilities. The B1
   * commercial catalog capabilities are the canonical B1
   * commercial catalog capabilities.
   */
  listCapabilities(): readonly string[] {
    return this.repository.getCapabilities();
  }

  /**
   * Returns the B1 commercial catalog plan keys. The B1 commercial
   * catalog plan keys are the canonical B1 commercial catalog plan
   * keys.
   */
  listPlanKeys(): readonly string[] {
    return this.repository.getPlanKeys();
  }

  /**
   * Returns the B1 commercial catalog customer tier keys. The B1
   * commercial catalog customer tier keys are the canonical B1
   * commercial catalog customer tier keys.
   */
  listCustomerTierKeys(): readonly string[] {
    return this.repository.getCustomerTierKeys();
  }

  /**
   * Returns the B1 commercial catalog merchant tier keys. The B1
   * commercial catalog merchant tier keys are the canonical B1
   * commercial catalog merchant tier keys.
   */
  listMerchantTierKeys(): readonly string[] {
    return this.repository.getMerchantTierKeys();
  }

  /**
   * Returns the B1 commercial catalog partner tier keys. The B1
   * commercial catalog partner tier keys are the canonical B1
   * commercial catalog partner tier keys.
   */
  listPartnerTierKeys(): readonly string[] {
    return this.repository.getPartnerTierKeys();
  }

  /**
   * Returns the B1 commercial catalog product entitlement keys.
   * The B1 commercial catalog product entitlement keys are the
   * canonical B1 commercial catalog product entitlement keys.
   */
  listProductEntitlementKeys(): readonly string[] {
    return this.repository.getProductEntitlementKeys();
  }

  /**
   * Returns the B1 commercial catalog package keys. The B1
   * commercial catalog package keys are the canonical B1
   * commercial catalog package keys.
   */
  listPackageKeys(): readonly string[] {
    return this.repository.getPackageKeys();
  }

  /**
   * Returns the B1 commercial catalog bundle keys. The B1
   * commercial catalog bundle keys are the canonical B1
   * commercial catalog bundle keys.
   */
  listBundleKeys(): readonly string[] {
    return this.repository.getBundleKeys();
  }

  /**
   * Returns the B1 commercial catalog subscription plan keys. The
   * B1 commercial catalog subscription plan keys are the canonical
   * B1 commercial catalog subscription plan keys.
   */
  listSubscriptionPlanKeys(): readonly string[] {
    return this.repository.getSubscriptionPlanKeys();
  }

  /**
   * Returns the B1 commercial catalog feature flag keys. The B1
   * commercial catalog feature flag keys are the canonical B1
   * commercial catalog feature flag keys.
   */
  listFeatureFlagKeys(): readonly string[] {
    return this.repository.getFeatureFlagKeys();
  }

  /**
   * Returns the B1 commercial catalog dynamic limit keys. The B1
   * commercial catalog dynamic limit keys are the canonical B1
   * commercial catalog dynamic limit keys.
   */
  listDynamicLimitKeys(): readonly string[] {
    return this.repository.getDynamicLimitKeys();
  }

  /**
   * Returns the B1 commercial catalog pricing keys. The B1
   * commercial catalog pricing keys are the canonical B1
   * commercial catalog pricing keys.
   */
  listPricingKeys(): readonly string[] {
    return this.repository.getPricingKeys();
  }

  /**
   * Returns the B1 commercial catalog billing cycle vocabulary.
   * The B1 commercial catalog billing cycle vocabulary is the
   * canonical B1 commercial catalog billing cycle vocabulary.
   */
  listBillingCycles(): readonly string[] {
    return this.repository.getBillingCycles();
  }

  /**
   * Returns the B1 commercial catalog plan type vocabulary. The
   * B1 commercial catalog plan type vocabulary is the canonical B1
   * commercial catalog plan type vocabulary.
   */
  listPlanTypes(): readonly string[] {
    return this.repository.getPlanTypes();
  }

  /**
   * Returns the B1 commercial catalog classification level
   * vocabulary.
   */
  listClassificationLevels(): readonly string[] {
    return this.repository.getClassificationLevels();
  }

  /**
   * Returns the B1 commercial catalog lookup kind vocabulary.
   */
  listLookupKinds(): readonly string[] {
    return this.repository.getLookupKinds();
  }

  /**
   * Returns the B1 commercial catalog failure code vocabulary.
   */
  listFailureCodes(): readonly string[] {
    return this.repository.getFailureCodes();
  }

  /**
   * Returns the B1 commercial catalog prohibited adjacent scopes.
   */
  listProhibitedAdjacentScopes(): readonly string[] {
    return this.repository.getProhibitedAdjacentScopes();
  }

  /**
   * Returns the B1 commercial catalog prohibited dependencies.
   */
  listProhibitedDependencies(): readonly string[] {
    return this.repository.getProhibitedDependencies();
  }

  /**
   * Returns the B1 commercial catalog declared dependencies.
   */
  listDeclaredDependencies(): readonly string[] {
    return this.repository.getDeclaredDependencies();
  }

  /**
   * Returns the B1 commercial catalog compatibility rule
   * identifiers.
   */
  listCompatibilityRuleIds(): readonly string[] {
    return this.repository.getCompatibilityRuleIds();
  }

  /**
   * Returns the B1 commercial catalog consumer contract
   * identifiers.
   */
  listConsumerContractIds(): readonly string[] {
    return this.repository.getConsumerContractIds();
  }

  /**
   * Returns the B1 commercial catalog version negotiation rule
   * identifiers.
   */
  listVersionNegotiationRuleIds(): readonly string[] {
    return this.repository.getVersionNegotiationRuleIds();
  }

  /**
   * Returns the B1 commercial catalog replay rule identifiers.
   */
  listReplayRuleIds(): readonly string[] {
    return this.repository.getReplayRuleIds();
  }

  /**
   * Returns the B1 commercial catalog data control
   * classifications.
   */
  listDataControlClassifications(): readonly string[] {
    return this.repository.getDataControlClassifications();
  }

  /**
   * Returns the B1 commercial catalog reference prefix.
   */
  getReferencePrefix(): string {
    return this.repository.getReferencePrefix();
  }
}
