import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { CustomerFundingInstrument } from './customer-funding-instrument.entity';
import { CustomerFundingInstrumentController } from './customer-funding-instrument.controller';
import { CustomerFundingInstrumentService } from './customer-funding-instrument.service';
import { FundingInstrumentHistory } from './funding-instrument-history.entity';
import { FundingInstrumentOwnership } from './funding-instrument-ownership.entity';
import { FundingInstrumentVerification } from './funding-instrument-verification.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerFundingInstrument,
      FundingInstrumentOwnership,
      FundingInstrumentVerification,
      FundingInstrumentHistory,
    ]),
  ],
  controllers: [CustomerFundingInstrumentController],
  providers: [CustomerFundingInstrumentService],
  exports: [CustomerFundingInstrumentService],
})
export class CustomerFundingInstrumentModule {}
