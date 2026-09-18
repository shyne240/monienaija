/**
 * A7T09 — A7 product reconciliation, certification, and support
 * trace NestJS module.
 *
 * The A7 product reconciliation module wires the A7 product
 * reconciliation service to the canonical upstream authorities
 * (reused) without modification. The A7 product reconciliation
 * module:
 *
 *  - reuses the A2 `AuthorizationService` (the only A2 authorization
 *    authority) consumed through the A7 product reconciliation
 *    read-only consumer port;
 *  - reuses the A3 `CustomerFinancialAccountBindingService` (the
 *    only A3 binding authority; not directly read by the A7
 *    product reconciliation service; the A7 product
 *    reconciliation service reads the A3 binding evidence
 *    indirectly through the A7T05 product command / A7T04 product
 *    customer-binding / A6T05 external-operation consumer
 *    boundaries);
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the A6T08 `ExternalSettlementService` (the only
 *    settlement / suspense / compensating-entry authority;
 *    read-only) consumed through the A7 product reconciliation
 *    read-only consumer port;
 *  - reuses the A6T09 `ExternalReconciliationService` (the only
 *    external reconciliation authority) consumed through the A7
 *    product reconciliation read-only consumer port;
 *  - reuses the A5 `LedgerService` (the only financial value
 *    authority; read-only) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the A7 product-policy service (A7T03; the only A7
 *    product-policy authority) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority; read-only) consumed through the A7
 *    product reconciliation read-only consumer port;
 *  - reuses the shared `AuditService` (the only audit authority;
 *    read-only) consumed through the A7 product reconciliation
 *    read-only consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority;
 *    read-only) consumed through the A7 product reconciliation
 *    read-only consumer port;
 *  - reuses the shared `MetricsService` (the only metrics
 *    authority);
 *  - reuses the shared `DiagnosticsService` (the only diagnostics
 *    authority; read-only) consumed through the A7 product
 *    reconciliation read-only consumer port;
 *  - reuses the shared `DataSource` (the A7 product reconciliation
 *    REPEATABLE READ, read-only TypeORM transaction).
 *
 * No new A2 authorization, A3 binding, A4 product-policy, A6
 * lifecycle, A6 circuit-breaker, A6T05 external-operation, A6
 * partner, A5 transfer command, A7 product catalog, A7 product-
 * policy profile, A7T04 product customer-binding map, A7T05
 * product command/operation, A7T06 product notification delivery,
 * A7T07 product lifecycle, A7T08 product financial effect, A6T08
 * settlement, A5 Ledger, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, or `CustomerPreference`
 * authority is introduced.
 */

import { Module, Provider } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OperationsModule } from '../operations/operations.module';
import { PartnerModule } from '../partner/partner.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { WalletModule } from '../wallet/wallet.module';

import { A7ProductCommandModule } from './a7-product-command.module';
import { A7ProductCustomerBindingModule } from './a7-product-customer-binding.module';
import { A7ProductLifecycleModule } from './a7-product-lifecycle.module';
import { A7ProductNotificationDeliveryModule } from './a7-product-notification-delivery.module';
import { A7ProductFinancialEffectModule } from './a7-product-financial-effect.module';
import { A7ProductPolicyModule } from './a7-product-policy.module';
import { A7ProductReconciliationRepository } from './a7-product-reconciliation.repository';
import { A7ProductReconciliationService } from './a7-product-reconciliation.service';

/**
 * Provider list for the A7 product reconciliation module. The A7
 * product reconciliation module reuses the A2 authorization, A3
 * binding, A4 product-policy, A6 lifecycle, A6 status-verification,
 * A6 circuit-breaker, A6T05 external-operation, A6T08 settlement /
 * suspense / compensating-entry, A6T09 external reconciliation, A5
 * Ledger, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T07 product lifecycle, A7T08 product
 * financial effect, and the shared Operations audit,
 * idempotency, outbox, and metrics services. The A7 product
 * reconciliation service is the single A7-side entry point for
 * the A7 first product's runtime read-only reconciliation,
 * certification, and support-trace authority.
 */
export const A7_PRODUCT_RECONCILIATION_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductReconciliationRepository,
  A7ProductReconciliationService,
]);

/**
 * The A7 product reconciliation NestJS module class. The A7
 * product reconciliation module imports the canonical upstream
 * modules (reused) and registers the A7 product reconciliation
 * providers. The canonical upstream modules already import
 * `TypeOrmModule.forFeature` for their entities; the A7 product
 * reconciliation module does not need to re-import those
 * entities.
 */
@Module({
  imports: [
    OperationsModule,
    PartnerModule,
    ReconciliationModule,
    LedgerModule,
    WalletModule,
    AuthorizationModule,
    A7ProductPolicyModule,
    A7ProductCustomerBindingModule,
    A7ProductCommandModule,
    A7ProductLifecycleModule,
    A7ProductNotificationDeliveryModule,
    A7ProductFinancialEffectModule,
  ],
  providers: A7_PRODUCT_RECONCILIATION_PROVIDERS as Provider[],
  exports: [A7ProductReconciliationService, A7ProductReconciliationRepository],
})
export class A7ProductReconciliationModule {}
