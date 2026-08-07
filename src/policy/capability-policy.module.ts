import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationService } from '../authorization/authorization.service';
import { CustomerModule } from '../customer/customer.module';
import { CustomerComplianceModule } from '../customer-compliance/customer-compliance.module';
import { CustomerEligibilityModule } from '../customer-eligibility/customer-eligibility.module';
import { CustomerOnboardingModule } from '../customer-onboarding/customer-onboarding.module';
import { CustomerRiskProfileModule } from '../customer-risk-profile/customer-risk-profile.module';
import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { WalletModule } from '../wallet/wallet.module';
import {
  A2RuntimeContextPolicyEvidenceAdapter,
  A3AccountBindingPolicyEvidenceAdapter,
  CompliancePolicyEvidenceAdapter,
  CustomerEligibilityPolicyEvidenceAdapter,
  CustomerLimitProfilePolicyEvidenceAdapter,
  CustomerPolicyEvidenceAdapter,
  CustomerRestrictionsPolicyEvidenceAdapter,
  OnboardingReadinessPolicyEvidenceAdapter,
  OperatingPermissionPolicyEvidenceAdapter,
  ProductEnrollmentPolicyEvidenceAdapter,
  RiskPolicyEvidenceAdapter,
} from './capability-policy-evidence.adapters';
import { TypeOrmPolicyAuditAdapter } from './capability-policy-audit.adapter';
import { CapabilityPolicyHistoricalReplayService } from './capability-policy-historical-replay.service';
import { CapabilityPolicyEvaluationService } from './capability-policy.service';
import { CapabilityPolicyRecoveryService } from './capability-policy-recovery.service';
import { TypeOrmPolicyIdempotencyAdapter } from './capability-policy-idempotency.adapter';
import { PolicySourceEvidenceCoordinator } from './capability-policy-evidence.coordinator';
import type { PolicyEvidenceAdapter } from './capability-policy-evidence.types';
import {
  A2RuntimeContextSourceEvidenceReader,
  A3AccountBindingSourceEvidenceReader,
  ComplianceSourceEvidenceReader,
  CustomerEligibilitySourceEvidenceReader,
  CustomerLimitProfileSourceEvidenceReader,
  CustomerRestrictionsSourceEvidenceReader,
  CustomerSourceEvidenceReader,
  OnboardingReadinessSourceEvidenceReader,
  OperatingPermissionSourceEvidenceReader,
  ProductEnrollmentSourceEvidenceReader,
  RiskSourceEvidenceReader,
} from './capability-policy-source-readers';
import {
  TypeOrmPolicyDecisionPersistenceService,
  TypeOrmPolicyDecisionRecordRepository,
  TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
  TypeOrmPolicyProfileVersionRepository,
} from './capability-policy-persistence.repositories';
import { ImmutableEvidenceSnapshotAttachment } from './immutable-evidence-snapshot-attachment.entity';
import { PolicyDecisionRecord } from './policy-decision-record.entity';
import { PolicyProfileVersion } from './policy-profile-version.entity';

export const A4_POLICY_EVIDENCE_ADAPTERS = 'A4_POLICY_EVIDENCE_ADAPTERS';

@Module({
  imports: [
    AuthorizationModule,
    CustomerModule,
    CustomerOnboardingModule,
    CustomerEligibilityModule,
    CustomerRiskProfileModule,
    CustomerComplianceModule,
    WalletModule,
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      PolicyProfileVersion,
      PolicyDecisionRecord,
      ImmutableEvidenceSnapshotAttachment,
    ]),
  ],
  providers: [
    TypeOrmPolicyProfileVersionRepository,
    TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
    TypeOrmPolicyDecisionRecordRepository,
    TypeOrmPolicyDecisionPersistenceService,
    TypeOrmPolicyIdempotencyAdapter,
    TypeOrmPolicyAuditAdapter,
    {
      provide: CapabilityPolicyEvaluationService,
      useFactory: (
        authorization: AuthorizationService,
        profiles: TypeOrmPolicyProfileVersionRepository,
        decisions: TypeOrmPolicyDecisionRecordRepository,
        idempotency: TypeOrmPolicyIdempotencyAdapter,
        audit: TypeOrmPolicyAuditAdapter,
      ) =>
        new CapabilityPolicyEvaluationService(
          authorization,
          profiles,
          decisions,
          idempotency,
          audit,
        ),
      inject: [
        AuthorizationService,
        TypeOrmPolicyProfileVersionRepository,
        TypeOrmPolicyDecisionRecordRepository,
        TypeOrmPolicyIdempotencyAdapter,
        TypeOrmPolicyAuditAdapter,
      ],
    },
    {
      provide: CapabilityPolicyRecoveryService,
      useFactory: (
        evaluator: CapabilityPolicyEvaluationService,
        profiles: TypeOrmPolicyProfileVersionRepository,
        decisions: TypeOrmPolicyDecisionRecordRepository,
        idempotency: TypeOrmPolicyIdempotencyAdapter,
        audit: TypeOrmPolicyAuditAdapter,
      ) => new CapabilityPolicyRecoveryService(evaluator, profiles, decisions, idempotency, audit),
      inject: [
        CapabilityPolicyEvaluationService,
        TypeOrmPolicyProfileVersionRepository,
        TypeOrmPolicyDecisionRecordRepository,
        TypeOrmPolicyIdempotencyAdapter,
        TypeOrmPolicyAuditAdapter,
      ],
    },
    {
      provide: CapabilityPolicyHistoricalReplayService,
      useFactory: (
        decisions: TypeOrmPolicyDecisionRecordRepository,
        evaluator: CapabilityPolicyEvaluationService,
      ) => new CapabilityPolicyHistoricalReplayService(decisions, evaluator),
      inject: [TypeOrmPolicyDecisionRecordRepository, CapabilityPolicyEvaluationService],
    },
    CustomerSourceEvidenceReader,
    OnboardingReadinessSourceEvidenceReader,
    CustomerEligibilitySourceEvidenceReader,
    CustomerRestrictionsSourceEvidenceReader,
    CustomerLimitProfileSourceEvidenceReader,
    ProductEnrollmentSourceEvidenceReader,
    OperatingPermissionSourceEvidenceReader,
    RiskSourceEvidenceReader,
    ComplianceSourceEvidenceReader,
    A2RuntimeContextSourceEvidenceReader,
    A3AccountBindingSourceEvidenceReader,
    {
      provide: A4_POLICY_EVIDENCE_ADAPTERS,
      useFactory: (
        customer: CustomerSourceEvidenceReader,
        onboarding: OnboardingReadinessSourceEvidenceReader,
        eligibility: CustomerEligibilitySourceEvidenceReader,
        restrictions: CustomerRestrictionsSourceEvidenceReader,
        limits: CustomerLimitProfileSourceEvidenceReader,
        enrollment: ProductEnrollmentSourceEvidenceReader,
        permissions: OperatingPermissionSourceEvidenceReader,
        risk: RiskSourceEvidenceReader,
        compliance: ComplianceSourceEvidenceReader,
        authorization: A2RuntimeContextSourceEvidenceReader,
        binding: A3AccountBindingSourceEvidenceReader,
      ): readonly PolicyEvidenceAdapter[] => [
        new CustomerPolicyEvidenceAdapter(customer),
        new OnboardingReadinessPolicyEvidenceAdapter(onboarding),
        new CustomerEligibilityPolicyEvidenceAdapter(eligibility),
        new CustomerRestrictionsPolicyEvidenceAdapter(restrictions),
        new CustomerLimitProfilePolicyEvidenceAdapter(limits),
        new ProductEnrollmentPolicyEvidenceAdapter(enrollment),
        new OperatingPermissionPolicyEvidenceAdapter(permissions),
        new RiskPolicyEvidenceAdapter(risk),
        new CompliancePolicyEvidenceAdapter(compliance),
        new A2RuntimeContextPolicyEvidenceAdapter(authorization),
        new A3AccountBindingPolicyEvidenceAdapter(binding),
      ],
      inject: [
        CustomerSourceEvidenceReader,
        OnboardingReadinessSourceEvidenceReader,
        CustomerEligibilitySourceEvidenceReader,
        CustomerRestrictionsSourceEvidenceReader,
        CustomerLimitProfileSourceEvidenceReader,
        ProductEnrollmentSourceEvidenceReader,
        OperatingPermissionSourceEvidenceReader,
        RiskSourceEvidenceReader,
        ComplianceSourceEvidenceReader,
        A2RuntimeContextSourceEvidenceReader,
        A3AccountBindingSourceEvidenceReader,
      ],
    },
    {
      provide: PolicySourceEvidenceCoordinator,
      useFactory: (adapters: readonly PolicyEvidenceAdapter[]) =>
        new PolicySourceEvidenceCoordinator(adapters),
      inject: [A4_POLICY_EVIDENCE_ADAPTERS],
    },
  ],
  exports: [
    TypeOrmPolicyProfileVersionRepository,
    TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
    TypeOrmPolicyDecisionRecordRepository,
    TypeOrmPolicyDecisionPersistenceService,
    TypeOrmPolicyIdempotencyAdapter,
    TypeOrmPolicyAuditAdapter,
    CapabilityPolicyEvaluationService,
    CapabilityPolicyRecoveryService,
    CapabilityPolicyHistoricalReplayService,
    PolicySourceEvidenceCoordinator,
  ],
})
export class CapabilityPolicyModule {}
