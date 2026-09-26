import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { Transfer } from '../transfer/transfer.entity';
import { CustomerAppController } from './customer-app.controller';
import { CustomerModule } from '../customer/customer.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransferModule } from '../transfer/transfer.module';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerProfile, CustomerContactMethod, WalletAccount, Transfer]),
    CustomerModule,
    WalletModule,
    TransferModule,
    CustomerAuthenticationModule,
    AgentModule,
  ],
  controllers: [CustomerAppController],
})
export class CustomerAppModule {}
