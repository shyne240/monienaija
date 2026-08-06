import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { SecurityEventHistory } from '../customer-authentication/security-event-history.entity';
import { PrivilegedActionApproval } from './privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationService } from './authorization.service';
import { RoutePolicyRegistry } from './route-policy-registry';
import { RuntimeAccessGuard } from './runtime-access.guard';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([PrivilegedActionApproval, SecurityEventHistory]),
  ],
  providers: [
    AuthorizationGuard,
    AuthorizationService,
    PrivilegedActionApprovalService,
    RoutePolicyRegistry,
    RuntimeAccessGuard,
  ],
  exports: [
    AuthorizationGuard,
    AuthorizationService,
    PrivilegedActionApprovalService,
    RoutePolicyRegistry,
    RuntimeAccessGuard,
  ],
})
export class AuthorizationModule {}
