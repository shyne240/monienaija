import { Module } from '@nestjs/common';

import { LimitController } from './limit.controller';
import { LimitEngine } from './limit.engine';

@Module({
  controllers: [LimitController],
  providers: [LimitEngine],
  exports: [LimitEngine],
})
export class LimitModule {}
