import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CustomerModule } from '../customer/customer.module';
import { CustomerClassModule } from '../customer-class/customer-class.module';
import { InstitutionModule } from '../institution/institution.module';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { AgentAuthenticationModule } from '../agent-authentication/agent-authentication.module';
import { TransferPinAuthorizationService } from './transfer-pin-authorization.service';
import {
  CustomerSelfTransferQuoteController,
  AgentSelfTransferQuoteController,
} from './self-transfer-quote.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CapabilityPolicyModule } from '../policy/capability-policy.module';
import { OperationsModule } from '../operations/operations.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { PilotControlModule } from '../pilot/pilot-control.module';
import { WalletModule } from '../wallet/wallet.module';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { CommercialDecisionModule } from '../commercial-decision/commercial-decision.module';
import { FeeRulesModule } from '../fee-rules/fee-rules.module';
import { CommissionModule } from '../commission/commission.module';
import { CommercialAccountingModule } from '../commercial-accounting/commercial-accounting.module';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { LedgerJournal } from '../ledger/ledger-journal.entity';
import { Transfer } from './transfer.entity';
import { TransferController } from './transfer.controller';
import {
  A3InternalTransferBindingAdapter,
  TypeOrmInternalTransferGateAuditAdapter,
  TypeOrmInternalTransferGateIdempotencyAdapter,
} from './internal-transfer-gate.adapters';
import { InternalTransferGateService } from './internal-transfer-gate.service';
import { TransferLifecycleService } from './transfer-lifecycle.service';
import {
  INTERNAL_TRANSFER_AUDIT_PORT,
  INTERNAL_TRANSFER_BINDING_PORT,
  INTERNAL_TRANSFER_IDEMPOTENCY_PORT,
} from './internal-transfer-gate.types';
import { TransferService } from './transfer.service';
import { TransferPricingService } from './transfer-pricing.service';
import { TransferQuoteService } from './transfer-quote.service';
import { PaymentQuote } from '../quote/payment-quote.entity';
import { WalletTransactionController } from './wallet-transaction.controller';

@Module({
  imports: [
    AuthorizationModule,
    CustomerModule,
    CustomerClassModule,
    InstitutionModule,
    CustomerAuthenticationModule,
    AgentAuthenticationModule,
    CapabilityPolicyModule,
    LedgerModule,
    OperationsModule,
    PaymentModule,
    PilotControlModule,
    WalletModule,
    LimitCatalogModule,
    // V1-COMMERCIAL-DECISION-02 — pilot snapshot wiring for WALLET_TRANSFER:
    // read-only fee resolution + immutable commercial decision snapshot inside the
    // existing SERIALIZABLE transfer transaction. No charging, no fee engine wiring.
    CommercialDecisionModule,
    FeeRulesModule,
    CommissionModule, // V1-COMMERCIAL-IMPLEMENTATION-02 — CommissionEngine for flow snapshot sites
    CommercialAccountingModule, // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 (inert unless enabled)
    TypeOrmModule.forFeature([Transfer, WalletAccount, LedgerJournal, PaymentQuote]),
  ],
  controllers: [
    TransferController,
    WalletTransactionController,
    CustomerSelfTransferQuoteController,
    AgentSelfTransferQuoteController,
  ],
  providers: [
    TransferService,
    TransferPinAuthorizationService,
    TransferPricingService,
    TransferQuoteService,
    A3InternalTransferBindingAdapter,
    TypeOrmInternalTransferGateAuditAdapter,
    TypeOrmInternalTransferGateIdempotencyAdapter,
    {
      provide: INTERNAL_TRANSFER_BINDING_PORT,
      useExisting: A3InternalTransferBindingAdapter,
    },
    {
      provide: INTERNAL_TRANSFER_AUDIT_PORT,
      useExisting: TypeOrmInternalTransferGateAuditAdapter,
    },
    {
      provide: INTERNAL_TRANSFER_IDEMPOTENCY_PORT,
      useExisting: TypeOrmInternalTransferGateIdempotencyAdapter,
    },
    InternalTransferGateService,
    TransferLifecycleService,
  ],
  exports: [
    TransferService,
    TransferPricingService,
    TransferQuoteService,
    InternalTransferGateService,
    TransferLifecycleService,
  ],
})
export class TransferModule {}
