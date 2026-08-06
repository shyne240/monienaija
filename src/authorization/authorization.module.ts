import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationService } from './authorization.service';

@Module({
  imports: [OperationsModule],
  providers: [AuthorizationGuard, AuthorizationService],
  exports: [AuthorizationGuard, AuthorizationService],
})
export class AuthorizationModule {}
