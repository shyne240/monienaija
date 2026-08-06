import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { SecurityEventHistory } from '../customer-authentication/security-event-history.entity';
import { PrivilegedActionApproval } from './privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationService } from './authorization.service';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([PrivilegedActionApproval, SecurityEventHistory]),
  ],
  providers: [AuthorizationGuard, AuthorizationService, PrivilegedActionApprovalService],
  exports: [AuthorizationGuard, AuthorizationService, PrivilegedActionApprovalService],
})
export class AuthorizationModule {}
