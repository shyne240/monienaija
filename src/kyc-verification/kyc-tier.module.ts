import { forwardRef, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationService } from '../authorization/authorization.service';
import { OperationsModule } from '../operations/operations.module';
import { AuditService } from '../operations/audit.service';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { KycTierPolicyService } from './kyc-tier-policy.service';
import { KycTierPolicyController } from './kyc-tier-policy.controller';
import { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { KycTierTransitionService } from './kyc-tier-transition.service';
import { KycTierReviewController } from './kyc-tier-review.controller';
import { CustomerFinancialEligibilityService } from './customer-financial-eligibility.service';
import { KycTierWorker } from './kyc-tier-worker.service';
@Module({
  imports: [
    forwardRef(() => AuthorizationModule),
    forwardRef(() => OperationsModule),
    forwardRef(() => CustomerAuthenticationModule),
  ],
  controllers: [KycTierPolicyController, KycTierReviewController],
  providers: [
    CustomerFinancialEligibilityService,
    {
      provide: KycTierPolicyService,
      inject: [DataSource, AuthorizationService],
      useFactory: (db: DataSource, auth: AuthorizationService) =>
        new KycTierPolicyService(db, auth),
    },
    { provide: KycTierEvidenceReader, useFactory: () => new KycTierEvidenceReader() },
    {
      provide: KycTierTransitionService,
      inject: [
        DataSource,
        KycTierPolicyService,
        KycTierEvidenceReader,
        AuditService,
        AuthorizationService,
        AuthenticationSessionService,
      ],
      useFactory: (
        db: DataSource,
        policies: KycTierPolicyService,
        reader: KycTierEvidenceReader,
        audit: AuditService,
        auth: AuthorizationService,
        sessions: AuthenticationSessionService,
      ) => new KycTierTransitionService(db, policies, reader, audit, auth, sessions),
    },
    {
      provide: KycTierWorker,
      inject: [DataSource, KycTierTransitionService, KycTierPolicyService],
      useFactory: (
        db: DataSource,
        transitions: KycTierTransitionService,
        policies: KycTierPolicyService,
      ) => new KycTierWorker(db, transitions, policies),
    },
  ],
  exports: [KycTierTransitionService, CustomerFinancialEligibilityService],
})
export class KycTierModule {}
