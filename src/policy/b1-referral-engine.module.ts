/**
 * B1T07 — B1 referral engine, cashback engine, and loyalty engine
 * NestJS module.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * module wires the B1 referral engine, cashback engine, and
 * loyalty engine service to the canonical upstream authorities
 * (reused) without modification.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1CampaignEngineModule } from './b1-campaign-engine.module';
import { B1CampaignDecision } from './b1-campaign-engine.entity';
import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1ReferralDecision } from './b1-referral-engine.entity';
import { B1ReferralEngineRepository } from './b1-referral-engine.repository';
import { B1ReferralEngineService } from './b1-referral-engine.service';

export const B1_REFERRAL_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1ReferralEngineRepository,
  B1ReferralEngineService,
]);

@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    B1FeeEngineModule,
    B1BillingEngineModule,
    B1CampaignEngineModule,
    TypeOrmModule.forFeature([
      B1ReferralDecision,
      B1CampaignDecision,
      B1BillingDocument,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_REFERRAL_ENGINE_PROVIDERS as Provider[],
  exports: [B1ReferralEngineService, B1ReferralEngineRepository],
})
export class B1ReferralEngineModule {}
