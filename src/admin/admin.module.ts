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
import { AgentModule } from '../agent/agent.module';
import { WalletModule } from '../wallet/wallet.module';
import { SupportModule } from '../support/support.module';
import { CustomerTransactionHistoryService } from '../customer-app/customer-transaction-history.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, Customer, Aggregator, WalletAccount]),
    AgentModule,
    WalletModule,
    SupportModule,
  ],
  controllers: [
    AdminAgentController,
    AdminCustomerController,
    AdminAggregatorController,
    AdminAgentLifecycleController,
    AdminNotificationController,
  ],
  providers: [CustomerTransactionHistoryService],
})
export class AdminModule {}
