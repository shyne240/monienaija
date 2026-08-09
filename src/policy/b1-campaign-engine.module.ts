/**
 * B1T06 — B1 campaign engine, promotion engine, and coupon engine
 * NestJS module.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * module wires the B1 campaign engine, promotion engine, and
 * coupon engine service to the canonical upstream authorities
 * (reused) without modification.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1CampaignDecision } from './b1-campaign-engine.entity';
import { B1CampaignEngineRepository } from './b1-campaign-engine.repository';
import { B1CampaignEngineService } from './b1-campaign-engine.service';
import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1CommercialDecision } from './b1-fee-engine.entity';

export const B1_CAMPAIGN_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1CampaignEngineRepository,
  B1CampaignEngineService,
]);

@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    B1FeeEngineModule,
    B1BillingEngineModule,
    TypeOrmModule.forFeature([
      B1CampaignDecision,
      B1BillingDocument,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_CAMPAIGN_ENGINE_PROVIDERS as Provider[],
  exports: [B1CampaignEngineService, B1CampaignEngineRepository],
})
export class B1CampaignEngineModule {}
