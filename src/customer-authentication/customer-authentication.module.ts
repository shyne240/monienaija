import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import {
  CUSTOMER_AUTH_RATE_LIMIT_RULES,
  customerAuthenticationRateLimits,
} from './customer-authentication-rate-limit.config';
import { AuthenticationExecutionService } from './authentication-execution.service';
import { AuthenticationSession } from './authentication-session.entity';
import { AuthenticationSessionService } from './authentication-session.service';
import { CustomerAuthenticationRuntimeService } from './customer-authentication-runtime.service';
import { CustomerAuthenticationController } from './customer-authentication.controller';
import { CustomerSessionController } from './customer-session.controller';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import { CustomerAuthenticationService } from './customer-authentication.service';
import { PasswordHashVerificationService } from './password-hash-verification.service';
import { MfaChallenge } from './mfa-challenge.entity';
import { MfaEnrollment } from './mfa-enrollment.entity';
import { MfaExecutionService } from './mfa-execution.service';
import { MfaMethod } from './mfa-method.entity';
import { PasswordHistory } from './password-history.entity';
import { PasswordResetRequest } from './password-reset-request.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RecoveryCode } from './recovery-code.entity';
import { SecurityEventHistory } from './security-event-history.entity';
import { TrustedDevice } from './trusted-device.entity';

@Module({
  imports: [
    forwardRef(() => OperationsModule),
    // A2SecurityRateLimitService provides the platform's existing DB-backed token bucket used to
    // throttle customer credential exchange. The edge is lazy because AuthorizationModule reaches
    // back here for AuthenticationSessionService.
    forwardRef(() => AuthorizationModule),
    TypeOrmModule.forFeature([
      Customer,
      CustomerAuthenticationCredential,
      AuthenticationSession,
      MfaChallenge,
      PasswordHistory,
      PasswordResetRequest,
      PasswordResetToken,
      MfaEnrollment,
      MfaMethod,
      TrustedDevice,
      RecoveryCode,
      SecurityEventHistory,
    ]),
  ],
  controllers: [CustomerAuthenticationController, CustomerSessionController],
  providers: [
    {
      provide: CUSTOMER_AUTH_RATE_LIMIT_RULES,
      useFactory: () =>
        customerAuthenticationRateLimits(process.env.CUSTOMER_AUTH_RATE_LIMITS_JSON),
    },
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    PasswordHashVerificationService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
    MfaExecutionService,
  ],
  exports: [
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
    MfaExecutionService,
  ],
})
export class CustomerAuthenticationModule {}
