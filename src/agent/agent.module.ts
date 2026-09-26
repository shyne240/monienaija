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
import { OutletModule } from '../outlet/outlet.module';

@Module({
  imports: [
    OperationsModule,
    LedgerModule,
    WalletModule,
    CustomerModule,
    CustomerAuthenticationModule,
    OutletModule,
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
