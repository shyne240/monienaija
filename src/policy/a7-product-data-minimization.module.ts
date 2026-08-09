/**
 * A7T10 — A7 product data minimization, classification, consent,
 * retention, legal-hold, secret, disclosure, support-trace, and
 * partner-payload validation NestJS module.
 *
 * The A7 product data minimization module wires the A7 product data
 * minimization service to the canonical upstream authorities (reused)
 * without modification. The A7 product data minimization module:
 *
 *  - reuses the A2 `AuthorizationService` (the only A2 authorization
 *    authority) consumed through the A7 product data minimization
 *    read-only consumer port;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the A7 product data
 *    minimization read-only consumer port;
 *  - reuses the A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification / consent / retention / legal-hold /
 *    secret / disclosure / support-trace / partner-payload validation
 *    authority) consumed through the A7 product data minimization
 *    read-only consumer port;
 *  - reuses the A6T10 `ExternalDataClassificationRegistry` (the only
 *    A6T10 data classification registry) consumed through the A7
 *    product data minimization read-only consumer port;
 *  - reuses the A7 product catalog (A7T02; the only A7 product
 *    catalog authority) consumed through the A7 product-policy
 *    service consumer boundary;
 *  - reuses the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority) consumed through the A7 product-policy
 *    service consumer boundary;
 *  - reuses the A7T04 product customer-binding map (A7T04) through
 *    the A7 product-policy service consumer boundary (read-only;
 *    the A7 product data minimization service does NOT call the
 *    A7T04 product customer-binding service to mutate any A7T04
 *    record);
 *  - reuses the A7T05 product command/operation identity (A7T05)
 *    through the A7 product-policy service consumer boundary
 *    (read-only; the A7 product data minimization service does NOT
 *    call the A7T05 product command service to mutate any A7T05
 *    record);
 *  - reuses the A7T06 product notification delivery (A7T06) through
 *    the A7 product-policy service consumer boundary (read-only; the
 *    A7 product data minimization service does NOT call the A7T06
 *    product notification delivery service to mutate any A7T06
 *    record);
 *  - reuses the A7T07 product lifecycle (A7T07) through the A7
 *    product-policy service consumer boundary (read-only; the A7
 *    product data minimization service does NOT call the A7T07
 *    product lifecycle service to mutate any A7T07 record);
 *  - reuses the A7T08 product financial effect (A7T08) through the
 *    A7 product-policy service consumer boundary (read-only; the A7
 *    product data minimization service does NOT call the A7T08
 *    product financial effect service to mutate any A7T08 record);
 *  - reuses the A7T09 product reconciliation (A7T09) through the A7
 *    product-policy service consumer boundary (read-only; the A7
 *    product data minimization service does NOT call the A7T09
 *    product reconciliation service to mutate any A7T09 record);
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority; read-only) consumed through the A7
 *    product data minimization read-only consumer port;
 *  - reuses the shared `AuditService` (the only audit authority;
 *    read-only) consumed through the A7 product data minimization
 *    read-only consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority;
 *    read-only) consumed through the A7 product data minimization
 *    read-only consumer port;
 *  - reuses the shared `MetricsService` (the only metrics
 *    authority);
 *  - reuses the shared `DiagnosticsService` (the only diagnostics
 *    authority; read-only) consumed through the A7 product data
 *    minimization read-only consumer port;
 *  - reuses the shared `DataSource` (the A7 product data
 *    minimization REPEATABLE READ, read-only TypeORM transaction).
 *
 * No new A2 authorization, A3 binding, A4 product-policy, A6
 * lifecycle, A6 circuit-breaker, A6T05 external-operation, A6
 * partner, A5 transfer command, A7 product catalog, A7 product-
 * policy profile, A7T04 product customer-binding map, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A6T10 data
 * classification, A6T10 consent, A6T10 retention, A6T10 legal-hold,
 * A6T10 secret, A6T10 disclosure, A6T10 support-trace, A6T10
 * partner-payload validation, A5 Ledger, Wallet, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, Reconciliation, or
 * `CustomerPreference` authority is introduced.
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
import { A7ProductReconciliationModule } from './a7-product-reconciliation.module';
import { A7ProductDataMinimizationRepository } from './a7-product-data-minimization.repository';
import { A7ProductDataMinimizationService } from './a7-product-data-minimization.service';

/**
 * Provider list for the A7 product data minimization module. The A7
 * product data minimization module reuses the A2 authorization, A3
 * binding, A4 product-policy, A6 lifecycle, A6 status-verification,
 * A6 circuit-breaker, A6T05 external-operation, A6T08 settlement /
 * suspense / compensating-entry, A6T09 external reconciliation, A6T10
 * data classification / consent / retention / legal-hold / secret /
 * disclosure / support-trace / partner-payload validation, A5 Ledger,
 * A7T04 product customer-binding, A7T05 product
 * command/operation, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, and the shared
 * Operations audit, idempotency, outbox, and metrics services. The
 * A7 product data minimization service is the single A7-side entry
 * point for the A7 first product's runtime read-only data
 * minimization, classification, consent, retention, legal-hold,
 * secret, disclosure, support-trace, and partner-payload validation
 * authority.
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductDataMinimizationRepository,
  A7ProductDataMinimizationService,
]);

/**
 * The A7 product data minimization NestJS module class. The A7
 * product data minimization module imports the canonical upstream
 * modules (reused) and registers the A7 product data minimization
 * providers. The canonical upstream modules already import
 * `TypeOrmModule.forFeature` for their entities; the A7 product
 * data minimization module does not need to re-import those
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
    A7ProductReconciliationModule,
  ],
  providers: A7_PRODUCT_DATA_MINIMIZATION_PROVIDERS as Provider[],
  exports: [A7ProductDataMinimizationService, A7ProductDataMinimizationRepository],
})
export class A7ProductDataMinimizationModule {}
