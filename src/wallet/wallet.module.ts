import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { WalletAccount } from './wallet-account.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    LedgerModule,
    TypeOrmModule.forFeature([WalletAccount, CustomerFinancialAccountBinding]),
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
