/**
 * A7T06 — A7 product notification delivery NestJS module.
 *
 * The A7 product notification delivery module wires the A7 product
 * notification delivery service to the canonical upstream authorities
 * (reused) without modification. The A7 product notification delivery
 * module:
 *
 *  - reuses the existing `CustomerPreferenceService` (the only customer
 *    intent authority; the A7 product notification delivery service
 *    consumes the `CustomerPreference.notifications` through the
 *    existing `CustomerPreferenceService.getPreferences()` consumer
 *    boundary; the A7 product notification delivery service does NOT
 *    write a new `CustomerPreference` record and does NOT mutate the
 *    `CustomerPreference.notifications` channel flags);
 *  - reuses the A6T10 `ExternalDataClassificationRegistry` (the only
 *    data-classification authority) consumed through the A7 product
 *    notification delivery consumer port;
 *  - reuses the A2 `AuthorizationService` (the only A2 authorization
 *    authority) consumed through the A7 product notification delivery
 *    consumer port;
 *  - reuses the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority) consumed through the A7 product
 *    notification delivery consumer port;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the A7 product
 *    notification delivery consumer port;
 *  - reuses the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority) consumed through the A7 product
 *    notification delivery consumer port; the A6T05 provider
 *    idempotency scope/key is reused (sourced from A6T05), not
 *    duplicated;
 *  - reuses the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority) consumed through the
 *    A7 product notification delivery consumer port;
 *  - reuses the A7T05 `A7ProductCommandService` (the only A7T05
 *    product command/operation authority) consumed through the A7
 *    product notification delivery consumer port;
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority) consumed through the A7 product
 *    notification delivery consumer port;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    consumed through the A7 product notification delivery consumer
 *    port;
 *  - reuses the shared `OutboxService` (the only outbox authority)
 *    consumed through the A7 product notification delivery consumer
 *    port.
 *
 * No new `CustomerPreference`, A2 authorization, A3 binding, A4
 * product-policy, A6T05 external-operation, A6 partner, A5 transfer
 * command, A7 product catalog, A7 product-policy profile, A7T04
 * product customer-binding map, A7T05 product command/operation,
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or notification authority is
 * introduced. The A7 product notification delivery module does not
 * create a second customer intent authority, a second customer-
 * binding system, a second policy engine, a second authorization
 * system, a second settlement authority, a second reconciliation
 * engine, a second audit authority, a second idempotency authority,
 * a second outbox authority, a new product command identity, or a
 * new product notification identity.
 */

import { Module, Provider } from '@nestjs/common';

import { CustomerPreferenceModule } from '../customer-preference/customer-preference.module';
import { OperationsModule } from '../operations/operations.module';
import { PartnerModule } from '../partner/partner.module';
import { WalletModule } from '../wallet/wallet.module';
import { A7ProductNotificationDeliveryRepository } from './a7-product-notification-delivery.repository';
import { A7ProductNotificationDeliveryService } from './a7-product-notification-delivery.service';
import { A7ProductCommandModule } from './a7-product-command.module';
import { A7ProductCustomerBindingModule } from './a7-product-customer-binding.module';
import { A7ProductPolicyModule } from './a7-product-policy.module';

/**
 * Provider list for the A7 product notification delivery module. The
 * A7 product notification delivery module reuses the existing
 * `CustomerPreferenceService`, the A6T10 data-classification matrix,
 * the A2 authorization, A3 binding, A4 product-policy, A6T05
 * external-operation, A7T04 product customer-binding, and A7T05
 * product command/operation services, and the shared Operations
 * audit, idempotency, and outbox services. The A7 product
 * notification delivery service is the single A7-side entry point
 * for the A7 first product's durable notification dispatch
 * identity, dispatch record, request hashing, correlation, and
 * internal/provider idempotency.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductNotificationDeliveryRepository,
  A7ProductNotificationDeliveryService,
]);

/**
 * The A7 product notification delivery NestJS module class. The A7
 * product notification delivery module imports the canonical upstream
 * modules (reused) and registers the A7 product notification delivery
 * providers. The canonical upstream modules already import
 * `TypeOrmModule.forFeature` for their entities; the A7 product
 * notification delivery module does not need to re-import those
 * entities.
 */
@Module({
  imports: [
    CustomerPreferenceModule,
    OperationsModule,
    PartnerModule,
    WalletModule,
    A7ProductPolicyModule,
    A7ProductCustomerBindingModule,
    A7ProductCommandModule,
  ],
  providers: A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDERS as Provider[],
  exports: [A7ProductNotificationDeliveryService, A7ProductNotificationDeliveryRepository],
})
export class A7ProductNotificationDeliveryModule {}
