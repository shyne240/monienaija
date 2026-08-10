import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { SecurityEventHistory } from '../customer-authentication/security-event-history.entity';
import { PrivilegedActionApproval } from './privileged-action-approval.entity';
import {
  A2FinanceRoleAssignment,
  A2SecurityRateBucket,
  A2WorkforceBootstrapConsumption,
  A2WorkforceSession,
} from './workforce-authentication.entity';
import { A2WorkforceAdministrationController } from './workforce-administration.controller';
import { A2FinanceRoleAdministrationService } from './finance-role-administration.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { A2WorkforceOidcService, A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import { A2WorkforceSessionService } from './workforce-session.service';
import { workforceConfiguration } from './workforce-configuration';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationService } from './authorization.service';
import { RoutePolicyRegistry } from './route-policy-registry';
import { RuntimeAccessGuard } from './runtime-access.guard';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      PrivilegedActionApproval,
      SecurityEventHistory,
      A2WorkforceSession,
      A2FinanceRoleAssignment,
      A2WorkforceBootstrapConsumption,
      A2SecurityRateBucket,
    ]),
  ],
  controllers: [A2WorkforceAdministrationController],
  providers: [
    { provide: A2_WORKFORCE_CONFIG, useFactory: () => workforceConfiguration(process.env) },
    A2WorkforceOidcService,
    A2WorkforceSessionService,
    A2FinanceRoleAdministrationService,
    A2SecurityRateLimitService,
    AuthorizationGuard,
    AuthorizationService,
    PrivilegedActionApprovalService,
    RoutePolicyRegistry,
    RuntimeAccessGuard,
  ],
  exports: [
    A2WorkforceOidcService,
    A2WorkforceSessionService,
    A2FinanceRoleAdministrationService,
    A2SecurityRateLimitService,
    AuthorizationGuard,
    AuthorizationService,
    PrivilegedActionApprovalService,
    RoutePolicyRegistry,
    RuntimeAccessGuard,
  ],
})
export class AuthorizationModule {}
