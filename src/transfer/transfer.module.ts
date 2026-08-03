import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { LedgerJournal } from '../ledger/ledger-journal.entity';
import { Transfer } from './transfer.entity';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { WalletTransactionController } from './wallet-transaction.controller';

@Module({
  imports: [LedgerModule, TypeOrmModule.forFeature([Transfer, WalletAccount, LedgerJournal])],
  controllers: [TransferController, WalletTransactionController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
