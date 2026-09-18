/**
 * B1T03 — B1 commercial catalog NestJS module.
 *
 * The B1 commercial catalog module wires the B1 commercial catalog
 * service to the canonical upstream authorities (reused) without
 * modification. The B1 commercial catalog module:
 *
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority) consumed through the B1 commercial
 *    catalog consumer port;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    consumed through the B1 commercial catalog consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority)
 *    consumed through the B1 commercial catalog consumer port;
 *  - reuses the shared `MetricsService` (the only metrics
 *    authority) consumed through the B1 commercial catalog
 *    consumer port;
 *  - reuses the B1 commercial catalog persistence schema (the only
 *    B1 commercial catalog persistence surface);
 *  - reuses the A1 canonical identity authority (the only A1
 *    canonical identity authority) consumed through the B1
 *    commercial catalog read-only consumer boundary;
 *  - reuses the A2 `AuthorizationService` (the only A2
 *    authorization authority) consumed through the B1 commercial
 *    catalog read-only consumer boundary;
 *  - reuses the A3 `CustomerFinancialAccountBindingService` (the
 *    only A3 binding authority) consumed through the B1 commercial
 *    catalog read-only consumer boundary;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the B1 commercial
 *    catalog read-only consumer boundary;
 *  - reuses the A5 `Ledger` service (the only A5 Ledger authority)
 *    consumed through the B1 commercial catalog read-only consumer
 *    boundary;
 *  - reuses the A6 `PartnerAdapter` service (the only A6
 *    partner-adapter authority) consumed through the B1 commercial
 *    catalog read-only consumer boundary;
 *  - reuses the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification authority) consumed through the B1
 *    commercial catalog read-only consumer boundary;
 *  - reuses the A7 product catalog (A7T02; the only A7 product
 *    catalog authority) consumed through the B1 commercial catalog
 *    read-only consumer boundary;
 *  - reuses the `CustomerPreference` service (the only customer
 *    intent authority) consumed through the B1 commercial catalog
 *    read-only consumer boundary.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6 partner-
 * adapter, A6T05 external-operation, A6T06 callback, A6T08
 * settlement / suspense / compensating-entry, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention /
 * legal-hold / secret / disclosure / support-trace / partner-
 * payload validation, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, or `CustomerPreference` authority is introduced.
 * The B1 commercial catalog module does not create a second
 * customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second
 * metrics authority, a second diagnostics authority, a second A6
 * lifecycle authority, a second A6 status-verification authority,
 * a second A6 circuit-breaker authority, a second A6T05
 * external-operation authority, a second A6T08 settlement
 * authority, a second A6T09 external reconciliation authority, a
 * second A6T10 data classification authority, a second A7 product
 * catalog authority, a second A7 product-policy authority, a
 * second A7T04 product customer-binding authority, a second A7T05
 * product command authority, a second A7T06 product notification
 * delivery authority, a second A7T07 product lifecycle authority,
 * a second A7T08 product financial effect authority, a second
 * A7T09 product reconciliation authority, a second A7T10 product
 * data minimization authority, a second A1 canonical identity
 * authority, a second A2 authorization authority, a second A3
 * binding authority, a second A4 product-policy authority, a
 * second A5 Ledger authority, a second A6 partner-adapter
 * authority, a second `CustomerPreference` authority, a second
 * pricing authority, a second fee authority, a second commission
 * authority, a second revenue-sharing authority, a second billing
 * authority, a second invoice authority, a second statement
 * authority, a second campaign authority, a second promotion
 * authority, a second coupon authority, a second referral
 * authority, a second cashback authority, a second loyalty
 * authority, a second revenue-recognition authority, a second tax
 * authority, a second cost-accounting authority, a second
 * profitability authority, a second analytics authority, or a
 * second B1 commercial catalog authority.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1CommercialCatalogRepository } from './b1-commercial-catalog.repository';
import { B1CommercialCatalogService } from './b1-commercial-catalog.service';

/**
 * Provider list for the B1 commercial catalog module. The B1
 * commercial catalog module reuses the shared Operations audit,
 * idempotency, outbox, and metrics services. The B1 commercial
 * catalog service is the single B1-side entry point for the B1
 * first commercial catalog, the B1 first plan catalog, the B1
 * first subscription plan registration, the B1 first customer
 * tier catalog, the B1 first merchant tier catalog, the B1 first
 * partner tier catalog, the B1 first product entitlement catalog,
 * the B1 first commercial package catalog, the B1 first
 * commercial bundle catalog, the catalog versioning contract, the
 * compatibility validation contract, the replay-safe catalog
 * lookup contract, and the read-only consumer boundary surface
 * for later B1 tasks.
 */
export const B1_COMMERCIAL_CATALOG_PROVIDERS: readonly Provider[] = Object.freeze([
  B1CommercialCatalogRepository,
  B1CommercialCatalogService,
]);

/**
 * The B1 commercial catalog NestJS module class. The B1 commercial
 * catalog module imports the canonical upstream modules (reused)
 * and registers the B1 commercial catalog providers. The canonical
 * upstream modules already import `TypeOrmModule.forFeature` for
 * their entities; the B1 commercial catalog module imports
 * `TypeOrmModule.forFeature` for the B1 commercial catalog
 * persistence entity.
 */
@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B1CommercialCatalogRegistration])],
  providers: B1_COMMERCIAL_CATALOG_PROVIDERS as Provider[],
  exports: [B1CommercialCatalogService, B1CommercialCatalogRepository],
})
export class B1CommercialCatalogModule {}
