import { Module } from '@nestjs/common';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { CustomerModule } from '../customer/customer.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { PartnerModule } from '../partner/partner.module';
import { WithdrawalModule } from '../withdrawal/withdrawal.module';
import { FinancialCommitmentController } from './financial-commitment.controller';
import { FinancialCommitmentRepository } from './financial-commitment.repository';
import { FinancialCommitmentService } from './financial-commitment.service';
import {
  WITHDRAWAL_EXECUTION_AUTHORITY,
  UnavailableWithdrawalExecutionAuthority,
} from './withdrawal-execution-authority';

@Module({
  imports: [
    CustomerAuthenticationModule,
    CustomerModule,
    LedgerModule,
    LimitCatalogModule,
    PartnerModule,
    WithdrawalModule,
  ],
  controllers: [FinancialCommitmentController],
  providers: [
    FinancialCommitmentService,
    FinancialCommitmentRepository,
    { provide: WITHDRAWAL_EXECUTION_AUTHORITY, useClass: UnavailableWithdrawalExecutionAuthority },
  ],
  exports: [FinancialCommitmentService],
})
export class FinancialCommitmentModule {}
