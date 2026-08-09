/**
 * B1T08 — B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine NestJS module.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine module wires the B1 revenue-recognition
 * engine, tax / VAT engine, and cost-accounting engine service to
 * the canonical upstream authorities (reused) without
 * modification.
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
import { B1ReferralEngineModule } from './b1-referral-engine.module';
import { B1ReferralDecision } from './b1-referral-engine.entity';
import { B1RevenueRecognitionDecision } from './b1-revenue-recognition-engine.entity';
import { B1RevenueRecognitionEngineRepository } from './b1-revenue-recognition-engine.repository';
import { B1RevenueRecognitionEngineService } from './b1-revenue-recognition-engine.service';

export const B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1RevenueRecognitionEngineRepository,
  B1RevenueRecognitionEngineService,
]);

@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    B1FeeEngineModule,
    B1BillingEngineModule,
    B1CampaignEngineModule,
    B1ReferralEngineModule,
    TypeOrmModule.forFeature([
      B1RevenueRecognitionDecision,
      B1CampaignDecision,
      B1ReferralDecision,
      B1BillingDocument,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS as Provider[],
  exports: [B1RevenueRecognitionEngineService, B1RevenueRecognitionEngineRepository],
})
export class B1RevenueRecognitionEngineModule {}
