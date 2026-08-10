import { Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { B2FFinanceAccountingPeriod } from './b2f-accounting-period.entity';
import { B2FFinanceControlModule } from './b2f-finance-control.module';
import { B2FFiscalPeriodRepository } from './b2f-fiscal-period.repository';
import { B2FFiscalPeriodService } from './b2f-fiscal-period.service';
import { B2FFinanceFiscalYear } from './b2f-fiscal-year.entity';

export const B2F_FISCAL_PERIOD_PROVIDERS: readonly Provider[] = Object.freeze([
  B2FFiscalPeriodRepository,
  B2FFiscalPeriodService,
]);

@Module({
  imports: [
    OperationsModule,
    AuthorizationModule,
    B2FFinanceControlModule,
    TypeOrmModule.forFeature([B2FFinanceFiscalYear, B2FFinanceAccountingPeriod]),
  ],
  providers: B2F_FISCAL_PERIOD_PROVIDERS as Provider[],
  exports: [B2FFiscalPeriodRepository, B2FFiscalPeriodService],
})
export class B2FFiscalPeriodModule {}
