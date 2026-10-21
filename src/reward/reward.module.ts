import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { RewardRuleRegistryController } from './reward-rule-registry.controller';
import { RewardRuleRegistryService } from './reward-rule-registry.service';
import { RewardRuleResolverController } from './reward-rule-resolver.controller';
import { RewardRuleResolverService } from './reward-rule-resolver.service';
import { RewardCalculator } from './reward.calculator';
import { RewardEngine } from './reward.engine';
import { RewardRuleDefinition } from './reward-rule.entity';

/**
 * V1-REWARD-01 — Reward Engine foundation module.
 *
 * Composes the configurable reward MACHINERY:
 *  - reward_rules registry (schema administration; ZERO seeded policy),
 *  - read-only rule resolver + deterministic calculation mechanics,
 *  - decision-representation facade producing the exact Commercial Decision Snapshot
 *    reward shape (grants + ruleRefs).
 *
 * Nothing here is wired into any financial flow: no flow calls RewardEngine, no reward
 * is credited, no reward ledger entry is posted, all V1 snapshots keep reward status
 * NONE. Production enablement awaits an explicitly-approved reward policy (rates/
 * eligibility/precedence/funding/accounting) AND a separate wiring task.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RewardRuleDefinition]), OperationsModule],
  controllers: [RewardRuleRegistryController, RewardRuleResolverController],
  providers: [RewardCalculator, RewardRuleRegistryService, RewardRuleResolverService, RewardEngine],
  exports: [RewardRuleRegistryService, RewardRuleResolverService, RewardEngine],
})
export class RewardModule {}
