import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Bank } from './bank.entity';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';

@Module({
  imports: [TypeOrmModule.forFeature([Bank])],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
