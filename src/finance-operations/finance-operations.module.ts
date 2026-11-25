import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { BankingModule } from '../banking/banking.module';
import { InstitutionModule } from '../institution/institution.module';
import { FinanceOperationsController } from './finance-operations.controller';
import { FinanceOperationsService } from './finance-operations.service';

/**
 * Finance Operations read model.
 *
 * It imports the institution scope service (authoritative assignment rows) and banking readiness
 * (per-institution provider state) rather than re-deriving either. It declares no controller for a
 * financial write: reversals are delegated to `LedgerReversalGovernanceService`, exceptions to the
 * existing banking decision route.
 */
@Module({
  imports: [AuthorizationModule, InstitutionModule, BankingModule],
  controllers: [FinanceOperationsController],
  providers: [FinanceOperationsService],
  exports: [FinanceOperationsService],
})
export class FinanceOperationsModule {}
