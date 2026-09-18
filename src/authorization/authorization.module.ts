import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { RuntimeAccessGuard } from './runtime-access.guard';

@Module({
  imports: [
    // RuntimeAccessGuard (provided here) depends on AuthenticationSessionService, which is
    // exported by CustomerAuthenticationModule. That module reaches back to this one through
    // OperationsModule, so the edge must be lazy.
    forwardRef(() => CustomerAuthenticationModule),
    forwardRef(() => OperationsModule),
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
    {
      provide: A2_WORKFORCE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        workforceConfiguration(
          Object.fromEntries(
            [
              'NODE_ENV',
              'A2_WORKFORCE_ENABLED',
              'A2_WORKFORCE_OIDC_ISSUER',
              'A2_WORKFORCE_OIDC_JWKS_URI',
              'A2_WORKFORCE_OIDC_AUDIENCE',
              'A2_WORKFORCE_OIDC_CLIENT_ID',
              'A2_WORKFORCE_INTERNAL_AUDIENCE',
              'A2_WORKFORCE_SESSION_TTL_SECONDS',
              'A2_BOOTSTRAP_ENABLED',
              'A2_BOOTSTRAP_ISSUER',
              'A2_BOOTSTRAP_AUDIENCE',
              'A2_BOOTSTRAP_JWKS_JSON',
              'A2_BOOTSTRAP_ADMIN_SCOPES_JSON',
              'A2_FINANCE_ROLES_JSON',
              'A2_MAKER_CHECKER_RULES_JSON',
              'A2_WORKFORCE_RATE_LIMITS_JSON',
              'A2_TRUSTED_PROXY_ADDRESSES_JSON',
            ].map((name) => {
              const value = config.get<unknown>(name);
              return [
                name,
                typeof value === 'string'
                  ? value
                  : typeof value === 'number' || typeof value === 'boolean'
                    ? `${value}`
                    : undefined,
              ];
            }),
          ),
        ),
    },
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
