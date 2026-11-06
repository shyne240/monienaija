import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { EvaluateLimitDto } from './dto/evaluate-limit.dto';
import { LimitEngine } from './limit.engine';

@Controller('limits')
export class LimitController {
  constructor(private readonly limitEngine: LimitEngine) {}

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  evaluate(@Body() dto: EvaluateLimitDto): Promise<ReturnType<LimitEngine['evaluate']>> {
    try {
      return Promise.resolve(this.limitEngine.evaluate(dto));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
}
