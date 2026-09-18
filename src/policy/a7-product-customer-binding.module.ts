/**
 * A7T04 — A7 product customer-binding NestJS module.
 *
 * The A7 product customer-binding module wires the A7 product
 * customer-binding service to the canonical upstream authorities
 * (reused) without modification. The A7 product customer-binding
 * module:
 *
 *  - reuses the A3 `CustomerFinancialAccountBindingService` (the only
 *    A3 binding authority) wrapped by the A7
 *    `A7ProductCustomerBindingRepository`;
 *  - reuses the existing `VirtualAccountService` (the only
 *    `VirtualAccount` authority) wrapped by the A7
 *    `A7ProductCustomerBindingRepository`;
 *  - reuses the A6 partner-adapter boundary
 *    (`PartnerConnectionService`) for the A6 partner connection
 *    status (the only partner connection authority);
 *  - reuses the existing `BankService` (the only bank-directory
 *    authority) for the bank directory entry;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    for the A7 product customer-binding audit fact.
 *
 * No new A3 binding, virtual-account, A4 product-policy, A2
 * authorization, A6 partner, A6T04 funding-target, bank-directory, or
 * audit authority is introduced. The A7 product customer-binding
 * module does not create a second customer-binding system, a second
 * policy engine, a second authorization system, a second settlement
 * authority, or a second reconciliation engine. The A3 binding
 * authority remains the only customer-binding authority.
 */

import { Module, Provider } from '@nestjs/common';

import { BankModule } from '../bank/bank.module';
import { PartnerModule } from '../partner/partner.module';
import { VirtualAccountModule } from '../virtual-account/virtual-account.module';
import { WalletModule } from '../wallet/wallet.module';
import { A7ProductCustomerBindingRepository } from './a7-product-customer-binding.repository';
import { A7ProductCustomerBindingService } from './a7-product-customer-binding.service';

/**
 * Provider list for the A7 product customer-binding module. The A7
 * product customer-binding module reuses the A3
 * `CustomerFinancialAccountBindingService`, the existing
 * `VirtualAccountService`, the A6 `PartnerConnectionService`, the
 * existing `BankService`, and the shared `AuditService`. The A7
 * `A7ProductCustomerBindingRepository` wraps the canonical
 * authorities as read-only consumer ports; the A7
 * `A7ProductCustomerBindingService` consumes the repository.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductCustomerBindingRepository,
  A7ProductCustomerBindingService,
]);

/**
 * The A7 product customer-binding NestJS module class. The A7 product
 * customer-binding module imports the canonical upstream modules
 * (reused) and registers the A7 product customer-binding providers.
 * The canonical upstream modules already import `TypeOrmModule.forFeature`
 * for their entities; the A7 product customer-binding module does not
 * need to re-import those entities.
 */
@Module({
  imports: [BankModule, PartnerModule, VirtualAccountModule, WalletModule],
  providers: A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS as Provider[],
  exports: [A7ProductCustomerBindingService, A7ProductCustomerBindingRepository],
})
export class A7ProductCustomerBindingModule {}
