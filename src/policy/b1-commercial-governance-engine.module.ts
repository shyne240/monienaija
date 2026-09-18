/**
 * B1T10 — B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface NestJS module.
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface module wires the B1 commercial-
 * governance engine service to the canonical upstream authorities
 * (reused) without modification.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1CommercialAnalyticsEngineModule } from './b1-commercial-analytics-engine.module';
import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1CampaignEngineModule } from './b1-campaign-engine.module';
import { B1CampaignDecision } from './b1-campaign-engine.entity';
import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1CommercialGovernanceDecision } from './b1-commercial-governance-engine.entity';
import { B1CommercialGovernanceEngineRepository } from './b1-commercial-governance-engine.repository';
import { B1CommercialGovernanceEngineService } from './b1-commercial-governance-engine.service';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1ReferralEngineModule } from './b1-referral-engine.module';
import { B1ReferralDecision } from './b1-referral-engine.entity';
import { B1RevenueRecognitionDecision } from './b1-revenue-recognition-engine.entity';
import { B1RevenueRecognitionEngineModule } from './b1-revenue-recognition-engine.module';

export const B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1CommercialGovernanceEngineRepository,
  B1CommercialGovernanceEngineService,
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
    B1CommercialAnalyticsEngineModule,
    TypeOrmModule.forFeature([
      B1CommercialGovernanceDecision,
      B1BillingDocument,
      B1CampaignDecision,
      B1ReferralDecision,
      B1RevenueRecognitionDecision,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS as Provider[],
  exports: [B1CommercialGovernanceEngineService, B1CommercialGovernanceEngineRepository],
})
export class B1CommercialGovernanceEngineModule {}
