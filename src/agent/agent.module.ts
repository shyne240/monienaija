import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { Agent } from './agent.entity';
import { AgentApplication } from './agent-application.entity';
import { AgentClass } from './agent-class.entity';
import { AgentApplicationService } from './agent-application.service';
import { AgentClassService } from './agent-class.service';
import { AgentLifecycleService } from './agent-lifecycle.service';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { AgentReceivingNumber } from './agent-receiving-number.entity';
import { RecipientResolutionService } from './recipient-resolution.service';
import { RecipientResolutionController } from './recipient-resolution.controller';
import {
  AgentReceivingNumberController,
  AgentReceivingNumberInternalController,
} from './agent-receiving-number.controller';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentFinancialExecutionService } from './agent-financial-execution.service';
import { AgentCashInService } from './agent-cash-in.service';
import { AgentApplicationAdminController } from './agent-application-admin.controller';
import { AgentApplicationPublicController } from './agent-application-public.controller';
import { AgentClassController } from './agent-class.controller';
import { AgentLifecycleController } from './agent-lifecycle.controller';
import { AgentCashInController } from './agent-cash-in.controller';
import { AgentAuthenticationModule } from '../agent-authentication/agent-authentication.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerModule } from '../customer/customer.module';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { AgentCashOutService } from './agent-cash-out.service';
import { AgentCashOutController } from './agent-cash-out.controller';
import { AgentCashToCashService } from './agent-cash-to-cash.service';
import { AgentCashToCashController } from './agent-cash-to-cash.controller';
import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';
import { AgentCashToCashClaimController } from './agent-cash-to-cash-claim.controller';
import { AgentCashToCashExpiryService } from './agent-cash-to-cash-expiry.service';
import { CashToCashTransfer } from './cash-to-cash.entity';
import { AgentFundingService } from './agent-funding.service';
import { AgentFundingController } from './agent-funding.controller';
import { AgentAppController } from './agent-app.controller';
import { AgentTransactionHistoryService } from './agent-transaction-history.service';
import { OutletModule } from '../outlet/outlet.module';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { CommercialDecisionModule } from '../commercial-decision/commercial-decision.module';
import { FeeRulesModule } from '../fee-rules/fee-rules.module';
import { CommissionModule } from '../commission/commission.module';
import { CommercialAccountingModule } from '../commercial-accounting/commercial-accounting.module';

@Module({
  imports: [
    OperationsModule,
    LedgerModule,
    WalletModule,
    CustomerModule,
    CustomerAuthenticationModule,
    OutletModule,
    LimitCatalogModule,
    // V1-COMMERCIAL-DECISION-03A — CASH_TO_WALLET commercial snapshot wiring (pilot extension):
    // read-only fee resolution + immutable snapshot inside the existing SERIALIZABLE agent
    // financial execution boundary. No charging, no fee engine wiring.
    CommercialDecisionModule,
    FeeRulesModule,
    CommissionModule, // V1-COMMERCIAL-IMPLEMENTATION-02 — CommissionEngine for flow snapshot sites
    CommercialAccountingModule, // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 (inert unless enabled)
    TypeOrmModule.forFeature([Agent, AgentClass, AgentApplication, AgentReceivingNumber, CashToCashTransfer]),
    forwardRef(() => AgentAuthenticationModule),
  ],
  controllers: [
    AgentAppController,
    AgentApplicationPublicController,
    AgentApplicationAdminController,
    AgentClassController,
    AgentLifecycleController,
    AgentReceivingNumberController,
    AgentReceivingNumberInternalController,
    RecipientResolutionController,
    AgentCashInController,
    AgentCashOutController,
    AgentCashToCashController,
    AgentCashToCashClaimController,
    AgentFundingController,
  ],
  providers: [
    AgentClassService,
    AgentApplicationService,
    AgentReceivingNumberService,
    AgentTransactionHistoryService, // V1-AGENT-HISTORY-01 — read-only unified history projection
    RecipientResolutionService,
    AgentServiceCapabilityService,
    AgentTransactionAuthorizationService,
    AgentFinancialExecutionService,
    AgentCashInService,
    AgentCashOutService,
    AgentCashToCashService,
    AgentCashToCashClaimService,
    AgentCashToCashExpiryService,
    AgentLifecycleService,
    AgentFundingService,
  ],
  exports: [
    AgentClassService,
    AgentApplicationService,
    AgentLifecycleService,
    AgentReceivingNumberService,
    RecipientResolutionService,
    AgentServiceCapabilityService,
    AgentTransactionAuthorizationService,
    AgentFinancialExecutionService,
    AgentCashInService,
    AgentCashOutService,
    AgentCashToCashService,
    AgentCashToCashClaimService,
    AgentCashToCashExpiryService,
    AgentFundingService,
  ],
})
export class AgentModule {}
