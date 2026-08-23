import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationsModule } from '../operations/operations.module';
import { PartnerModule } from '../partner/partner.module';
import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1CommercialAnalyticsEngineModule } from './b1-commercial-analytics-engine.module';
import { B1FeeEngineModule } from './b1-fee-engine.module';
import { B1RevenueRecognitionEngineModule } from './b1-revenue-recognition-engine.module';
import { B2FFinanceAccountingTreatment } from './b2f-accounting-treatment.entity';
import { B2FAccountingTreatmentService } from './b2f-accounting-treatment.service';
import { B2FFinanceControlModule } from './b2f-finance-control.module';
import { B2FFiscalPeriodModule } from './b2f-fiscal-period.module';
import { B2FJournalGovernanceModule } from './b2f-journal-governance.module';

@Module({
  imports: [
    OperationsModule,
    PartnerModule,
    B1FeeEngineModule,
    B1BillingEngineModule,
    B1RevenueRecognitionEngineModule,
    B1CommercialAnalyticsEngineModule,
    B2FFinanceControlModule,
    B2FFiscalPeriodModule,
    B2FJournalGovernanceModule,
    TypeOrmModule.forFeature([B2FFinanceAccountingTreatment]),
  ],
  providers: [B2FAccountingTreatmentService],
  exports: [B2FAccountingTreatmentService],
})
export class B2FAccountingTreatmentModule {}
