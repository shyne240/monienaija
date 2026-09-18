import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { B2FFinanceControlModule } from '../policy/b2f-finance-control.module';
import { A5ArControlAccountProvisioningService } from './ar-control-account-provisioning.service';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerController } from './ledger.controller';
import { LedgerJournal } from './ledger-journal.entity';
import { LedgerLine } from './ledger-line.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    forwardRef(() => OperationsModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => B2FFinanceControlModule),
    TypeOrmModule.forFeature([LedgerAccount, LedgerJournal, LedgerLine]),
  ],
  controllers: [LedgerController],
  providers: [LedgerService, A5ArControlAccountProvisioningService],
  exports: [LedgerService, A5ArControlAccountProvisioningService, TypeOrmModule],
})
export class LedgerModule {}
