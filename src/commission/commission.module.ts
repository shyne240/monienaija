import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { CommissionRuleRegistryController } from './commission-rule-registry.controller';
import { CommissionRuleRegistryService } from './commission-rule-registry.service';
import { CommissionRuleResolverController } from './commission-rule-resolver.controller';
import { CommissionRuleResolverService } from './commission-rule-resolver.service';
import { CommissionCalculator } from './commission.calculator';
import { CommissionEngine } from './commission.engine';
import { CommissionRuleDefinition } from './commission-rule.entity';

/**
 * V1-COMMISSION-01 — Commission Engine foundation module.
 *
 * Composes the configurable commission MACHINERY:
 *  - commission_rules registry (schema administration; ZERO seeded policy),
 *  - read-only rule resolver + deterministic calculation mechanics,
 *  - decision-representation facade producing the exact Commercial Decision Snapshot
 *    commission shape.
 *
 * Nothing here is wired into any financial flow: no flow calls CommissionEngine, no
 * commission is charged, no commission ledger entry is posted, all V1 snapshots keep
 * commission status NONE. Production enablement awaits an explicitly-approved
 * commission policy (rates/bases/recipients/precedence) AND a separate wiring task.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CommissionRuleDefinition]), OperationsModule],
  controllers: [CommissionRuleRegistryController, CommissionRuleResolverController],
  providers: [CommissionCalculator, CommissionRuleRegistryService, CommissionRuleResolverService, CommissionEngine],
  exports: [CommissionRuleRegistryService, CommissionRuleResolverService, CommissionEngine],
})
export class CommissionModule {}
