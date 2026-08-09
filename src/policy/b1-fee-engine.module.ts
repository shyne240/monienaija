/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine NestJS module.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine module wires the B1 fee engine, commission
 * engine, and revenue sharing decision engine service to the
 * canonical upstream authorities (reused) without modification.
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine module:
 *
 *  - reuses the B1T03 `B1CommercialCatalogService` (the only B1
 *    commercial catalog authority; consumed through the B1
 *    commercial catalog read-only consumer boundary);
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority) consumed through the B1 fee engine,
 *    commission engine, and revenue sharing decision engine
 *    consumer port;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    consumed through the B1 fee engine, commission engine, and
 *    revenue sharing decision engine consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority)
 *    consumed through the B1 fee engine, commission engine, and
 *    revenue sharing decision engine consumer port;
 *  - reuses the shared `MetricsService` (the only metrics
 *    authority) consumed through the B1 fee engine, commission
 *    engine, and revenue sharing decision engine consumer port;
 *  - reuses the existing A1 canonical identity authority (the only
 *    A1 canonical identity authority) consumed through the B1
 *    fee engine, commission engine, and revenue sharing decision
 *    engine read-only consumer boundary;
 *  - reuses the A2 `AuthorizationService` (the only A2
 *    authorization authority) consumed through the B1 fee engine,
 *    commission engine, and revenue sharing decision engine
 *    read-only consumer boundary;
 *  - reuses the A3 `CustomerFinancialAccountBindingService` (the
 *    only A3 binding authority) consumed through the B1 fee
 *    engine, commission engine, and revenue sharing decision
 *    engine read-only consumer boundary;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the B1 fee
 *    engine, commission engine, and revenue sharing decision
 *    engine read-only consumer boundary;
 *  - reuses the A5 `Ledger` service (the only A5 Ledger
 *    authority) consumed through the B1 fee engine, commission
 *    engine, and revenue sharing decision engine read-only
 *    consumer boundary;
 *  - reuses the A6 `PartnerAdapter` service (the only A6
 *    partner-adapter authority) consumed through the B1 fee
 *    engine, commission engine, and revenue sharing decision
 *    engine read-only consumer boundary;
 *  - reuses the A6T10 `ExternalDataMinimizationService` (the
 *    only A6T10 data classification authority) consumed through
 *    the B1 fee engine, commission engine, and revenue sharing
 *    decision engine read-only consumer boundary;
 *  - reuses the A7 product catalog (A7T02; the only A7 product
 *    catalog authority) consumed through the B1 fee engine,
 *    commission engine, and revenue sharing decision engine
 *    read-only consumer boundary;
 *  - reuses the `CustomerPreference` service (the only customer
 *    intent authority) consumed through the B1 fee engine,
 *    commission engine, and revenue sharing decision engine
 *    read-only consumer boundary.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6
 * partner-adapter, A6T05 external-operation, A6T06 callback, A6T08
 * settlement / suspense / compensating-entry, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention /
 * legal-hold / secret / disclosure / support-trace / partner-
 * payload validation, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, B1T03 commercial
 * catalog, Wallet, Ledger, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, or `CustomerPreference`
 * authority is introduced. The B1 fee engine, commission engine,
 * and revenue sharing decision engine module does not create a
 * second B1 commercial decision engine, a second customer-binding
 * system, a second policy engine, a second authorization system,
 * a second settlement authority, a second reconciliation engine,
 * a second audit authority, a second idempotency authority, a
 * second outbox authority, a second metrics authority, a second
 * diagnostics authority, a second B1T03 commercial catalog
 * authority, or a new B1 commercial decision identity.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1FeeEngineRepository } from './b1-fee-engine.repository';
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1CommercialDecision } from './b1-fee-engine.entity';

/**
 * Provider list for the B1 fee engine, commission engine, and
 * revenue sharing decision engine module. The B1 fee engine,
 * commission engine, and revenue sharing decision engine module
 * reuses the B1T03 `B1CommercialCatalogService`, the shared
 * Operations audit, idempotency, outbox, and metrics services, the
 * A1 canonical identity authority, the A2 authorization authority,
 * the A3 binding authority, the A4 product-policy authority, the
 * A5 Ledger authority, the A6 partner-adapter authority, the A6T10
 * data classification authority, the A7 product catalog authority,
 * and the `CustomerPreference` authority through the B1 fee engine,
 * commission engine, and revenue sharing decision engine read-only
 * consumer boundary surface.
 */
export const B1_FEE_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1FeeEngineRepository,
  B1FeeEngineService,
]);

/**
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine NestJS module class. The B1 fee engine,
 * commission engine, and revenue sharing decision engine module
 * imports the canonical upstream modules (reused) and registers
 * the B1 fee engine, commission engine, and revenue sharing
 * decision engine providers. The canonical upstream modules
 * already import `TypeOrmModule.forFeature` for their entities;
 * the B1 fee engine, commission engine, and revenue sharing
 * decision engine module imports `TypeOrmModule.forFeature` for
 * the B1 commercial decision persistence entity and the B1
 * commercial catalog persistence entity (the B1 commercial
 * decision persistence entity is the only B1 commercial decision
 * persistence surface; the B1 commercial catalog persistence
 * entity is the only B1 commercial catalog persistence surface).
 */
@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    TypeOrmModule.forFeature([B1CommercialDecision, B1CommercialCatalogRegistration]),
  ],
  providers: B1_FEE_ENGINE_PROVIDERS as Provider[],
  exports: [B1FeeEngineService, B1FeeEngineRepository],
})
export class B1FeeEngineModule {}
