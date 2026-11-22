import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalReadService } from '../authorization/privileged-action-approval-read.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CommissionModule } from '../commission/commission.module';
import { FeeRulesModule } from '../fee-rules/fee-rules.module';
import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { ProductCatalogModule } from '../product-catalog/product-catalog.module';
import { RewardModule } from '../reward/reward.module';

import { CommercialChangeHistoryController } from './commercial-change-history.controller';
import { EffectiveConfigurationPreviewController } from './effective-configuration-preview.controller';
import { EffectiveConfigurationPreviewService } from './effective-configuration-preview.service';

/**
 * Arena 3 — governed commercial configuration.
 *
 * A pure COMPOSITION module: it owns no table, no rule and no financial logic. It wires the
 * existing resolvers into the read-only effective-configuration preview and the read-only governed
 * change history.
 *
 * `PrivilegedActionApproval` is registered here (rather than re-exported from AuthorizationModule)
 * because `PrivilegedActionApprovalReadService` injects its repository. That repository is a read
 * projection of the approval ledger; the writer path stays owned by AuthorizationModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PrivilegedActionApproval]),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => LimitCatalogModule),
    forwardRef(() => KycTierModule),
    forwardRef(() => FeeRulesModule),
    forwardRef(() => CommissionModule),
    forwardRef(() => RewardModule),
    forwardRef(() => ProductCatalogModule),
  ],
  controllers: [EffectiveConfigurationPreviewController, CommercialChangeHistoryController],
  providers: [
    EffectiveConfigurationPreviewService,
    PrivilegedActionApprovalReadService,
    // AuthorizationService is provided by AuthorizationModule; referenced here so the DI graph is
    // explicit for the read service. `forwardRef` above resolves the circular module import.
    AuthorizationService,
  ],
  exports: [EffectiveConfigurationPreviewService],
})
export class CommercialConfigurationModule {}
