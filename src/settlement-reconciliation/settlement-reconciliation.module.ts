import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { InstitutionModule } from '../institution/institution.module';
import { OperationsModule } from '../operations/operations.module';
import { BankStatementReportAdapter } from './adapters/bank-statement-report.adapter';
import { MonnifySettlementReportAdapter } from './adapters/monnify-settlement-report.adapter';
import { NibssSettlementReportAdapter } from './adapters/nibss-report.adapter';
import { SettlementReportAdapterRegistry } from './adapters/settlement-report-adapter.registry';
import { SettlementReconciliationController } from './settlement-reconciliation.controller';
import { SettlementReconciliationService } from './settlement-reconciliation.service';

@Module({
  imports: [AuthorizationModule, InstitutionModule, OperationsModule],
  controllers: [SettlementReconciliationController],
  providers: [
    {
      provide: SettlementReportAdapterRegistry,
      useFactory: () =>
        new SettlementReportAdapterRegistry([
          new MonnifySettlementReportAdapter(),
          new BankStatementReportAdapter(),
          new NibssSettlementReportAdapter(),
        ]),
    },
    SettlementReconciliationService,
  ],
  exports: [SettlementReportAdapterRegistry, SettlementReconciliationService],
})
export class SettlementReconciliationModule {}
