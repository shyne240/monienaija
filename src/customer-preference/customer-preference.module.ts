import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { CustomerPreferenceController } from './customer-preference.controller';
import { CustomerPreference } from './customer-preference.entity';
import { CustomerPreferenceService } from './customer-preference.service';
import { PreferenceHistory } from './preference-history.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([Customer, CustomerPreference, PreferenceHistory]),
  ],
  controllers: [CustomerPreferenceController],
  providers: [CustomerPreferenceService],
  exports: [CustomerPreferenceService],
})
export class CustomerPreferenceModule {}
