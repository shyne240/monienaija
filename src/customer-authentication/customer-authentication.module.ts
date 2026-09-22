import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import {
  resolveTransactionPinSecurityPolicy,
  TRANSACTION_PIN_POLICY,
} from './transaction-pin-policy';
import { AuthenticationExecutionService } from './authentication-execution.service';
import { AuthenticationSession } from './authentication-session.entity';
import { AuthenticationSessionService } from './authentication-session.service';
import { CustomerAuthenticationRuntimeService } from './customer-authentication-runtime.service';
import { CustomerAuthenticationController } from './customer-authentication.controller';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import { CustomerAuthenticationService } from './customer-authentication.service';
import { CustomerTransactionPinController } from './customer-transaction-pin.controller';
import { CustomerTransactionPinService } from './customer-transaction-pin.service';
import { PasswordHashVerificationService } from './password-hash-verification.service';
import { PinHashService } from './pin-hash.service';
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
  controllers: [CustomerAuthenticationController, CustomerTransactionPinController],
  providers: [
    // Centralized Transaction PIN security policy, resolved from validated
    // environment configuration (internal V1 defaults when unset).
    {
      provide: TRANSACTION_PIN_POLICY,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        resolveTransactionPinSecurityPolicy(configService),
    },
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    PasswordHashVerificationService,
    PinHashService,
    CustomerTransactionPinService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
    MfaExecutionService,
  ],
  exports: [
    TRANSACTION_PIN_POLICY,
    CustomerAuthenticationService,
    AuthenticationExecutionService,
    PasswordHashVerificationService,
    PinHashService,
    CustomerTransactionPinService,
    AuthenticationSessionService,
    CustomerAuthenticationRuntimeService,
    MfaExecutionService,
  ],
})
export class CustomerAuthenticationModule {}
