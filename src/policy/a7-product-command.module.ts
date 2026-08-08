/**
 * A7T05 — A7 product command NestJS module.
 *
 * The A7 product command module wires the A7 product command service
 * to the canonical upstream authorities (reused) without modification.
 * The A7 product command module:
 *
 *  - reuses the A2 `AuthorizationService` (the only A2 authorization
 *    authority) consumed through the A7 product command consumer port;
 *  - reuses the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority) consumed through the A7 product
 *    command consumer port;
 *  - reuses the A4 product-policy service (A7T03; the only A4
 *    product-policy authority) consumed through the A7 product command
 *    consumer port;
 *  - reuses the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority) consumed through the A7 product
 *    command consumer port; the A6T05 provider idempotency scope/key
 *    is reused (sourced from A6T05), not duplicated;
 *  - reuses the A7T04 `A7ProductCustomerBindingService` (the only
 *    A7T04 product customer-binding authority) consumed through the A7
 *    product command consumer port;
 *  - reuses the shared `IdempotencyService` (the only internal
 *    idempotency authority) consumed through the A7 product command
 *    consumer port;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    consumed through the A7 product command consumer port;
 *  - reuses the shared `OutboxService` (the only outbox authority)
 *    consumed through the A7 product command consumer port.
 *
 * No new A2 authorization, A3 binding, A4 product-policy, A6T05
 * external-operation, A6 partner, A5 transfer command, A7 product
 * catalog, A7 product-policy profile, A7T04 product customer-binding
 * map, Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced. The A7 product command module does not create a second
 * customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, or a new product
 * command identity.
 */

import { Module, Provider } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module';
import { PartnerModule } from '../partner/partner.module';
import { VirtualAccountModule } from '../virtual-account/virtual-account.module';
import { WalletModule } from '../wallet/wallet.module';
import { A7ProductCommandRepository } from './a7-product-command.repository';
import { A7ProductCommandService } from './a7-product-command.service';
import { A7ProductCustomerBindingModule } from './a7-product-customer-binding.module';
import { A7ProductPolicyModule } from './a7-product-policy.module';

/**
 * Provider list for the A7 product command module. The A7 product
 * command module reuses the A2 authorization, A3 binding, A4
 * product-policy, A6T05 external-operation, A7T04 product
 * customer-binding, and the shared Operations audit, idempotency,
 * and outbox services. The A7 product command service is the single
 * A7-side entry point for the A7 first product's durable product
 * command identity, product operation record, request hashing,
 * correlation, and product/provider idempotency.
 */
export const A7_PRODUCT_COMMAND_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductCommandRepository,
  A7ProductCommandService,
]);

/**
 * The A7 product command NestJS module class. The A7 product command
 * module imports the canonical upstream modules (reused) and registers
 * the A7 product command providers. The canonical upstream modules
 * already import `TypeOrmModule.forFeature` for their entities; the A7
 * product command module does not need to re-import those entities.
 */
@Module({
  imports: [
    OperationsModule,
    PartnerModule,
    VirtualAccountModule,
    WalletModule,
    A7ProductPolicyModule,
    A7ProductCustomerBindingModule,
  ],
  providers: A7_PRODUCT_COMMAND_PROVIDERS as Provider[],
  exports: [A7ProductCommandService, A7ProductCommandRepository],
})
export class A7ProductCommandModule {}
