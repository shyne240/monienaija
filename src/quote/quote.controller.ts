import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuoteService } from './quote.service';

@Controller('quotes')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateQuoteDto, @Headers('idempotency-key') headerKey?: string) {
    return this.quoteService.create({
      ...dto,
      idempotencyKey: headerKey ?? dto.idempotencyKey ?? '',
    });
  }

  @Get()
  list() {
    return this.quoteService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.quoteService.get(id);
  }

  @Post(':id/use')
  @HttpCode(HttpStatus.OK)
  use(@Param('id') id: string) {
    return this.quoteService.use(id);
  }
}
