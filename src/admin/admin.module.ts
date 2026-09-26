import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Agent } from '../agent/agent.entity';
import { Customer } from '../customer/customer.entity';
import { Aggregator } from '../aggregator/aggregator.entity';
import { AdminAgentController } from './admin-agent.controller';
import { AdminCustomerController } from './admin-customer.controller';
import { AdminAggregatorController } from './admin-aggregator.controller';
import { AdminAgentLifecycleController } from './admin-agent-lifecycle.controller';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [TypeOrmModule.forFeature([Agent, Customer, Aggregator]), AgentModule],
  controllers: [
    AdminAgentController,
    AdminCustomerController,
    AdminAggregatorController,
    AdminAgentLifecycleController,
  ],
})
export class AdminModule {}
