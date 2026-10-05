import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Agent } from '../agent/agent.entity';
import { Customer } from '../customer/customer.entity';
import { Aggregator } from '../aggregator/aggregator.entity';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { AdminAgentController } from './admin-agent.controller';
import { AdminCustomerController } from './admin-customer.controller';
import { AdminAggregatorController } from './admin-aggregator.controller';
import { AdminAgentLifecycleController } from './admin-agent-lifecycle.controller';
import { AdminNotificationController } from './admin-notification.controller';
import { AdminAgentCredentialsController } from './admin-agent-credentials.controller';
import { AdminCustomerCredentialsController } from './admin-customer-credentials.controller';
import { AgentAuthenticationModule } from '../agent-authentication/agent-authentication.module';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { AgentModule } from '../agent/agent.module';
import { WalletModule } from '../wallet/wallet.module';
import { SupportModule } from '../support/support.module';
import { SupportAuthenticationModule } from '../support-authentication/support-authentication.module';
import { AdminSupportCredentialsController } from './admin-support-credentials.controller';
import { CustomerTransactionHistoryService } from '../customer-app/customer-transaction-history.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, Customer, Aggregator, WalletAccount, CustomerContactMethod]),
    AgentModule,
    AgentAuthenticationModule,
    CustomerAuthenticationModule,
    NotificationModule,
    OperationsModule,
    WalletModule,
    SupportModule,
    SupportAuthenticationModule,
  ],
  controllers: [
    AdminAgentController,
    AdminCustomerController,
    AdminAggregatorController,
    AdminAgentLifecycleController,
    AdminAgentCredentialsController,
    AdminCustomerCredentialsController,
    AdminSupportCredentialsController,
    AdminNotificationController,
  ],
  providers: [CustomerTransactionHistoryService],
})
export class AdminModule {}
