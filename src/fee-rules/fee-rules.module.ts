import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { FeeRuleCalculatorService } from './fee-rule-calculator.service';
import { FeeRuleDefinition } from './fee-rule.entity';
import { FeeRuleRegistryController } from './fee-rule-registry.controller';
import { FeeRuleRegistryService } from './fee-rule-registry.service';
import { FeeRuleResolverController } from './fee-rule-resolver.controller';
import { FeeRuleResolverService } from './fee-rule-resolver.service';

/**
 * V1-COMMERCIAL-03 — Fee Rule registry module (schema + administration foundation).
 * V1-COMMERCIAL-04 — Fee Rule RESOLUTION foundation: read-only resolver service +
 * workforce-only diagnostic route.
 * V1-COMMERCIAL-IMPLEMENTATION-01 — Runtime fee COMPUTATION: FeeRuleCalculatorService is
 * now provided/exported so the seven wired flows can compute resolver results into the
 * commercial decision snapshot (decision-layer only; journals stay principal-only while
 * the fee-revenue account family is unprovisioned). The legacy engine (src/fee) stays
 * separate and unwired.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FeeRuleDefinition]), OperationsModule],
  controllers: [FeeRuleRegistryController, FeeRuleResolverController],
  providers: [FeeRuleRegistryService, FeeRuleResolverService, FeeRuleCalculatorService],
  exports: [FeeRuleRegistryService, FeeRuleResolverService, FeeRuleCalculatorService],
})
export class FeeRulesModule {}
