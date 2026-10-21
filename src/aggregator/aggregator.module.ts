import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { Agent } from '../agent/agent.entity';
import { Aggregator } from './aggregator.entity';
import { AggregatorAgentAssignment } from './aggregator-agent-relationship.entity';
import { AggregatorService } from './aggregator.service';
import { AggregatorAgentRelationshipService } from './aggregator-agent-relationship.service';
import { AggregatorController } from './aggregator.controller';

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([Aggregator, AggregatorAgentAssignment, Agent])],
  controllers: [AggregatorController],
  providers: [AggregatorService, AggregatorAgentRelationshipService],
  exports: [AggregatorService, AggregatorAgentRelationshipService],
})
export class AggregatorModule {}
