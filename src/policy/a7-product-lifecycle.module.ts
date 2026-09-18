/**
 * A7T07 — A7 product lifecycle NestJS module.
 *
 * The A7 product lifecycle module wires the A7 product lifecycle
 * service to the canonical upstream authorities (reused) without
 * modification. The A7 product lifecycle module:
 *
 *  - reuses the A6T05 `ExternalOperationLifecycleService` (the only
 *    A6 lifecycle authority) consumed through the A7 product
 *    lifecycle consumer port;
 *  - reuses the A6T07 `ExternalOperationStatusVerifier` (the only
 *    A6 status-verification authority) consumed through the A7
 *    product lifecycle consumer port;
 *  - reuses the A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority) consumed through the A7 product
 *    lifecycle consumer port;
 *  - reuses the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority) consumed through the A7 product
 *    lifecycle consumer port; the A6T05 provider idempotency
 *    scope/key is reused (sourced from A6T05), not duplicated;
 *  - reuses the A2 `AuthorizationService` (the only A2 authorization
 *    authority) consumed through the A7 product lifecycle consumer
 *    port;
 *  - reuses the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority) consumed through the A7 product
 *    lifecycle consumer port;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the A7 product
 *    lifecycle consumer port;
 *  - reuses the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority) consumed through the
 *    A7 product lifecycle consumer port;
 *  - reuses the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority) consumed through the A7
 *    product lifecycle consumer port;
 *  - reuses the A7T06 `A7ProductNotificationDeliveryService` (the
 *    only A7T06 product notification delivery authority) consumed
 *    through the A7 product lifecycle consumer port;
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority) consumed through the A7 product
 *    lifecycle consumer port;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    consumed through the A7 product lifecycle consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority)
 *    consumed through the A7 product lifecycle consumer port;
 *  - reuses the shared `MetricsService` (the only metrics authority)
 *    consumed through the A7 product lifecycle consumer port.
 *
 * No new A2 authorization, A3 binding, A4 product-policy, A6
 * lifecycle, A6 circuit-breaker, A6T05 external-operation, A6
 * partner, A5 transfer command, A7 product catalog, A7 product-
 * policy profile, A7T04 product customer-binding map, A7T05
 * product command/operation, A7T06 product notification delivery,
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced. The A7 product lifecycle module does not create a
 * second customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second
 * metrics authority, a second diagnostics authority, a second A6
 * lifecycle authority, a second A6 status-verification authority,
 * a second A6 circuit-breaker authority, or a new product lifecycle
 * identity.
 */

import { Module, Provider } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module';
import { PartnerModule } from '../partner/partner.module';
import { WalletModule } from '../wallet/wallet.module';
import { A7ProductLifecycleRepository } from './a7-product-lifecycle.repository';
import { A7ProductLifecycleService } from './a7-product-lifecycle.service';
import { A7ProductCommandModule } from './a7-product-command.module';
import { A7ProductCustomerBindingModule } from './a7-product-customer-binding.module';
import { A7ProductNotificationDeliveryModule } from './a7-product-notification-delivery.module';
import { A7ProductPolicyModule } from './a7-product-policy.module';

/**
 * Provider list for the A7 product lifecycle module. The A7 product
 * lifecycle module reuses the A2 authorization, A3 binding, A4
 * product-policy, A6 lifecycle, A6 status-verification, A6
 * circuit-breaker, A6T05 external-operation, A7T04 product
 * customer-binding, A7T05 product command/operation, A7T06 product
 * notification delivery, and the shared Operations audit,
 * idempotency, outbox, and metrics services. The A7 product
 * lifecycle service is the single A7-side entry point for the A7
 * first product's runtime resilience and lifecycle.
 */
export const A7_PRODUCT_LIFECYCLE_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductLifecycleRepository,
  A7ProductLifecycleService,
]);

/**
 * The A7 product lifecycle NestJS module class. The A7 product
 * lifecycle module imports the canonical upstream modules (reused)
 * and registers the A7 product lifecycle providers. The canonical
 * upstream modules already import `TypeOrmModule.forFeature` for
 * their entities; the A7 product lifecycle module does not need to
 * re-import those entities.
 */
@Module({
  imports: [
    OperationsModule,
    PartnerModule,
    WalletModule,
    A7ProductPolicyModule,
    A7ProductCustomerBindingModule,
    A7ProductCommandModule,
    A7ProductNotificationDeliveryModule,
  ],
  providers: A7_PRODUCT_LIFECYCLE_PROVIDERS as Provider[],
  exports: [A7ProductLifecycleService, A7ProductLifecycleRepository],
})
export class A7ProductLifecycleModule {}
