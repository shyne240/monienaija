import { Module, forwardRef } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { FeeController } from './fee.controller';
import { FeeEngine } from './fee.engine';

@Module({
  imports: [forwardRef(() => AuthorizationModule)],
  controllers: [FeeController],
  providers: [FeeEngine],
  exports: [FeeEngine],
})
export class FeeModule {}
