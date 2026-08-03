import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentModule } from '../payment/payment.module';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { VirtualAccount } from './virtual-account.entity';
import { VirtualAccountController } from './virtual-account.controller';
import { VirtualAccountService } from './virtual-account.service';

@Module({
  imports: [PaymentModule, TypeOrmModule.forFeature([VirtualAccount, WalletAccount])],
  controllers: [VirtualAccountController],
  providers: [VirtualAccountService],
  exports: [VirtualAccountService],
})
export class VirtualAccountModule {}
