import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { FeeRuleDefinition } from './fee-rule.entity';
import { FeeRuleRegistryController } from './fee-rule-registry.controller';
import { FeeRuleRegistryService } from './fee-rule-registry.service';

/**
 * V1-COMMERCIAL-03 — Fee Rule registry module (schema + administration foundation).
 * The calculation engine (src/fee) stays separate and unwired; nothing here charges fees.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FeeRuleDefinition]), OperationsModule],
  controllers: [FeeRuleRegistryController],
  providers: [FeeRuleRegistryService],
  exports: [FeeRuleRegistryService],
})
export class FeeRulesModule {}
