import { Module, forwardRef } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { LimitController } from './limit.controller';
import { LimitEngine } from './limit.engine';

@Module({
  imports: [forwardRef(() => AuthorizationModule)],
  controllers: [LimitController],
  providers: [LimitEngine],
  exports: [LimitEngine],
})
export class LimitModule {}
