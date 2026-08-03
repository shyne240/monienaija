import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentModule } from '../payment/payment.module';
import { PaymentQuote } from './payment-quote.entity';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';

@Module({
  imports: [PaymentModule, TypeOrmModule.forFeature([PaymentQuote])],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class QuoteModule {}
