import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
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
  imports: [
    TypeOrmModule.forFeature([CommissionRuleDefinition]),
    // Lazy: OperationsModule → ReconciliationModule → PartnerModule → CommissionModule closes a loop
    // once the settlement path consumes this module. An eager edge here would be read before
    // operations.module.ts finished evaluating, which Nest reports as "module at index [1] is undefined".
    forwardRef(() => OperationsModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [CommissionRuleRegistryController, CommissionRuleResolverController],
  providers: [
    CommissionCalculator,
    CommissionRuleRegistryService,
    CommissionRuleResolverService,
    CommissionEngine,
  ],
  exports: [CommissionRuleRegistryService, CommissionRuleResolverService, CommissionEngine],
})
export class CommissionModule {}
