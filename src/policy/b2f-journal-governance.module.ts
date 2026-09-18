import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OperationsModule } from '../operations/operations.module';
import { B2FAccountMappingModule } from './b2f-account-mapping.module';
import { B2FFinanceControlModule } from './b2f-finance-control.module';
import { B2FFinanceJournalGovernance } from './b2f-finance-journal.entity';
import { B2FFiscalPeriodModule } from './b2f-fiscal-period.module';
import { B2FJournalGovernanceService } from './b2f-journal-governance.service';

@Module({
  imports: [
    OperationsModule,
    B2FAccountMappingModule,
    B2FFinanceControlModule,
    AuthorizationModule,
    LedgerModule,
    B2FFiscalPeriodModule,
    TypeOrmModule.forFeature([B2FFinanceJournalGovernance]),
  ],
  providers: [B2FJournalGovernanceService],
  exports: [B2FJournalGovernanceService],
})
export class B2FJournalGovernanceModule {}
