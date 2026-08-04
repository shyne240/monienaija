import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { BeneficiaryHistory } from './beneficiary-history.entity';
import { BeneficiaryOwnership } from './beneficiary-ownership.entity';
import { BeneficiaryVerification } from './beneficiary-verification.entity';
import { CustomerBeneficiary } from './customer-beneficiary.entity';
import { CustomerBeneficiaryController } from './customer-beneficiary.controller';
import { CustomerBeneficiaryService } from './customer-beneficiary.service';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerBeneficiary,
      BeneficiaryOwnership,
      BeneficiaryVerification,
      BeneficiaryHistory,
    ]),
  ],
  controllers: [CustomerBeneficiaryController],
  providers: [CustomerBeneficiaryService],
  exports: [CustomerBeneficiaryService],
})
export class CustomerBeneficiaryModule {}
