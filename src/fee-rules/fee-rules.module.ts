import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { FeeRuleDefinition } from './fee-rule.entity';
import { FeeRuleRegistryController } from './fee-rule-registry.controller';
import { FeeRuleRegistryService } from './fee-rule-registry.service';
import { FeeRuleResolverController } from './fee-rule-resolver.controller';
import { FeeRuleResolverService } from './fee-rule-resolver.service';

/**
 * V1-COMMERCIAL-03 — Fee Rule registry module (schema + administration foundation).
 * V1-COMMERCIAL-04 — Fee Rule RESOLUTION foundation: read-only resolver service +
 * workforce-only diagnostic route. Still nothing here calculates or charges fees;
 * the calculation engine (src/fee) stays separate and unwired.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FeeRuleDefinition]), OperationsModule],
  controllers: [FeeRuleRegistryController, FeeRuleResolverController],
  providers: [FeeRuleRegistryService, FeeRuleResolverService],
  exports: [FeeRuleRegistryService, FeeRuleResolverService],
})
export class FeeRulesModule {}
