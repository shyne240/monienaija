import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CalculateFeeDto } from './dto/calculate-fee.dto';
import { FeeEngine } from './fee.engine';

@Controller('fees')
export class FeeController {
  constructor(private readonly feeEngine: FeeEngine) {}

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  calculate(@Body() dto: CalculateFeeDto): Promise<ReturnType<FeeEngine['calculate']>> {
    try {
      return Promise.resolve(this.feeEngine.calculate(dto.amountMinor, dto.currency, dto));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
}
