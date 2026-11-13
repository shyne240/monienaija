import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { CustomerModule } from '../customer/customer.module';
import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerCredentialRecoveryController } from './customer-credential-recovery.controller';
import { CustomerCredentialRecoveryChallenge } from './customer-credential-recovery.entity';
import { CustomerCredentialRecoveryService } from './customer-credential-recovery.service';

/**
 * ARENA 4 — self-service credential recovery.
 *
 * Depends only on accepted building blocks: the session service, the customer authentication
 * service (credential rotation), the transaction PIN service, the KYC evidence oracle, the shared
 * rate limiter and direct SMS delivery. No new credential or session store is introduced.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerCredentialRecoveryChallenge]),
    AuthorizationModule,
    CustomerAuthenticationModule,
    CustomerModule,
    KycTierModule,
    NotificationModule,
    OperationsModule,
  ],
  controllers: [CustomerCredentialRecoveryController],
  providers: [CustomerCredentialRecoveryService],
  exports: [CustomerCredentialRecoveryService],
})
export class CustomerCredentialRecoveryModule {}
