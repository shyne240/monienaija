/**
 * B1T09 — B1 commercial-analytics engine, profitability engine,
 * and commercial-reconciliation engine NestJS module.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine module wires the B1 commercial-
 * analytics engine, profitability engine, and commercial-
 * reconciliation engine service to the canonical upstream
 * authorities (reused) without modification.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1CampaignEngineModule } from './b1-campaign-engine.module';
import { B1CampaignDecision } from './b1-campaign-engine.entity';
import { B1CommercialAnalyticsDecision } from './b1-commercial-analytics-engine.entity';
import { B1CommercialAnalyticsEngineRepository } from './b1-commercial-analytics-engine.repository';
import { B1CommercialAnalyticsEngineService } from './b1-commercial-analytics-engine.service';
import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1ReferralEngineModule } from './b1-referral-engine.module';
import { B1ReferralDecision } from './b1-referral-engine.entity';
import { B1RevenueRecognitionDecision } from './b1-revenue-recognition-engine.entity';
import { B1RevenueRecognitionEngineModule } from './b1-revenue-recognition-engine.module';

export const B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1CommercialAnalyticsEngineRepository,
  B1CommercialAnalyticsEngineService,
]);

@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    B1FeeEngineModule,
    B1BillingEngineModule,
    B1CampaignEngineModule,
    B1ReferralEngineModule,
    B1RevenueRecognitionEngineModule,
    TypeOrmModule.forFeature([
      B1CommercialAnalyticsDecision,
      B1RevenueRecognitionDecision,
      B1ReferralDecision,
      B1CampaignDecision,
      B1BillingDocument,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS as Provider[],
  exports: [B1CommercialAnalyticsEngineService, B1CommercialAnalyticsEngineRepository],
})
export class B1CommercialAnalyticsEngineModule {}
