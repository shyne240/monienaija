import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { AuthenticationExecutionService } from './authentication-execution.service';
import { AuthenticationSession } from './authentication-session.entity';
import { AuthenticationSessionService } from './authentication-session.service';
import { CustomerAuthenticationRuntimeService } from './customer-authentication-runtime.service';
import { CustomerAuthenticationController } from './customer-authentication.controller';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import { CustomerAuthenticationService } from './customer-authentication.service';
import { PasswordHashVerificationService } from './password-hash-verification.service';
import { MfaEnrollment } from './mfa-enrollment.entity';
import { MfaMethod } from './mfa-method.entity';
import { PasswordHistory } from './password-history.entity';
import { PasswordResetRequest } from './password-reset-request.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RecoveryCode } from './recovery-code.entity';
import { SecurityEventHistory } from './security-event-history.entity';
import { TrustedDevice } from './trusted-device.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerAuthenticationCredential,
      AuthenticationSession,
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
  controllers: [CustomerAuthenticationController],
  providers: [
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    PasswordHashVerificationService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
  ],
  exports: [
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
  ],
})
export class CustomerAuthenticationModule {}
