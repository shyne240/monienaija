import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Beneficiary } from './beneficiary.entity';
import { BeneficiaryController } from './beneficiary.controller';
import { BeneficiaryService } from './beneficiary.service';

@Module({
  imports: [TypeOrmModule.forFeature([Beneficiary])],
  controllers: [BeneficiaryController],
  providers: [BeneficiaryService],
  exports: [BeneficiaryService],
})
export class BeneficiaryModule {}
