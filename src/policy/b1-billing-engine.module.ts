/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine NestJS module.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine module wires the B1 billing engine, invoice engine, and
 * statement-generation engine service to the canonical upstream
 * authorities (reused) without modification.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B1CommercialCatalogModule } from './b1-commercial-catalog.module';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1CommercialDecision } from './b1-fee-engine.entity';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1BillingEngineRepository } from './b1-billing-engine.repository';
import { B1BillingEngineService } from './b1-billing-engine.service';

export const B1_BILLING_ENGINE_PROVIDERS: readonly Provider[] = Object.freeze([
  B1BillingEngineRepository,
  B1BillingEngineService,
]);

@Module({
  imports: [
    OperationsModule,
    B1CommercialCatalogModule,
    B1FeeEngineModule,
    TypeOrmModule.forFeature([
      B1BillingDocument,
      B1CommercialDecision,
      B1CommercialCatalogRegistration,
    ]),
  ],
  providers: B1_BILLING_ENGINE_PROVIDERS as Provider[],
  exports: [B1BillingEngineService, B1BillingEngineRepository],
})
export class B1BillingEngineModule {}
