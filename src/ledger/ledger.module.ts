import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerAccount } from './ledger-account.entity';
import { LedgerController } from './ledger.controller';
import { LedgerJournal } from './ledger-journal.entity';
import { LedgerLine } from './ledger-line.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerAccount, LedgerJournal, LedgerLine])],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService, TypeOrmModule],
})
export class LedgerModule {}
