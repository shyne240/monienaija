import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { EvaluateLimitDto } from './dto/evaluate-limit.dto';
import { LimitEngine } from './limit.engine';

@Controller('limits')
export class LimitController {
  constructor(private readonly limitEngine: LimitEngine) {}

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  evaluate(@Body() dto: EvaluateLimitDto) {
    return this.limitEngine.evaluate(dto);
  }
}
