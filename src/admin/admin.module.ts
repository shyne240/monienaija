import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Agent } from '../agent/agent.entity';
import { Customer } from '../customer/customer.entity';
import { Aggregator } from '../aggregator/aggregator.entity';
import { AdminAgentController } from './admin-agent.controller';
import { AdminCustomerController } from './admin-customer.controller';
import { AdminAggregatorController } from './admin-aggregator.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Agent, Customer, Aggregator])],
  controllers: [AdminAgentController, AdminCustomerController, AdminAggregatorController],
})
export class AdminModule {}
