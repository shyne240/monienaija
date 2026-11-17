import { Module } from '@nestjs/common';
import { BankingModule } from '../banking/banking.module';
import { BankingWithdrawalExecutionAuthority } from '../banking/banking-withdrawal-execution-authority';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { CustomerModule } from '../customer/customer.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { PartnerModule } from '../partner/partner.module';
import { WithdrawalModule } from '../withdrawal/withdrawal.module';
import { FinancialCommitmentController } from './financial-commitment.controller';
import { FinancialCommitmentRepository } from './financial-commitment.repository';
import { FinancialCommitmentService } from './financial-commitment.service';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from './withdrawal-execution-authority';

@Module({
  imports: [
    BankingModule,
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
    // ARENA 3D — the execution authority is answered by governed banking configuration. This binding
    // replaces the always-unavailable provider, but is not a relaxation: `BankingWithdrawalExecutionAuthority`
    // returns AUTHORIZED only when an approved, credentialed and operationally-ready provider declares
    // the outbound capability for the wallet's own institution. With banking disabled — the default —
    // it returns UNAVAILABLE, exactly as before.
    { provide: WITHDRAWAL_EXECUTION_AUTHORITY, useExisting: BankingWithdrawalExecutionAuthority },
  ],
  exports: [FinancialCommitmentService],
})
export class FinancialCommitmentModule {}
