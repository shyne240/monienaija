import { Module } from '@nestjs/common';

import { FeeController } from './fee.controller';
import { FeeEngine } from './fee.engine';

@Module({
  controllers: [FeeController],
  providers: [FeeEngine],
  exports: [FeeEngine],
})
export class FeeModule {}
