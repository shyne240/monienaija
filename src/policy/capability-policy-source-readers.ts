import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerEligibilityService } from '../customer-eligibility/customer-eligibility.service';
import { CustomerOnboardingService } from '../customer-onboarding/customer-onboarding.service';
import { CustomerRiskProfileService } from '../customer-risk-profile/customer-risk-profile.service';
import { CustomerComplianceService } from '../customer-compliance/customer-compliance.service';
import { CustomerFinancialAccountReadService } from '../wallet/customer-financial-account-read.service';
import type {
  PolicyEvidenceCollectionContext,
  PolicyEvidenceReadItem,
  PolicyEvidenceReadResult,
  PolicyEvidenceReader,
} from './capability-policy-evidence.types';

@Injectable()
export class CustomerSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(@InjectRepository(Customer) private readonly repository: Repository<Customer>) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    const customer = await this.repository.findOne({
      where: { id: context.customerId },
      withDeleted: true,
    });
    if (!customer) return missing('Customer', observedAt);
    return complete(
      'Customer',
      observedAt,
      [
        record({
          sourceId: customer.id,
          customerId: customer.id,
          sourceVersion: customer.version,
          sourceUpdatedAt: customer.updatedAt.toISOString(),
          deleted: customer.deletedAt !== null,
          normalizedValue: { status: customer.status, version: customer.version },
        }),
      ],
      'Restricted',
    );
  }
}

@Injectable()
export class OnboardingReadinessSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly onboardingService: CustomerOnboardingService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const [onboarding, readiness] = await Promise.all([
        this.onboardingService.getOnboarding(context.customerId),
        this.onboardingService.getReadiness(context.customerId),
      ]);
      return complete(
        'CustomerOnboardingReadiness',
        observedAt,
        [
          record({
            sourceId: onboarding.id,
            sourceVersion: onboarding.version,
            sourceUpdatedAt: onboarding.updatedAt.toISOString(),
            normalizedValue: {
              status: onboarding.status,
              version: onboarding.version,
              readinessStatus: readiness.status,
              readinessEvaluatedAt: readiness.evaluatedAt,
              approvedAt: onboarding.approvedAt?.toISOString() ?? null,
              completedAt: onboarding.completedAt?.toISOString() ?? null,
            },
          }),
        ],
        'Restricted',
      );
    } catch (error) {
      return error instanceof NotFoundException
        ? missing('CustomerOnboardingReadiness', observedAt)
        : unavailable('CustomerOnboardingReadiness', observedAt, 'ONBOARDING_READ_FAILED');
    }
  }
}

@Injectable()
export class CustomerEligibilitySourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const eligibility = await this.eligibilityService.getEligibility(context.customerId);
      return complete(
        'CustomerEligibility',
        observedAt,
        [
          record({
            sourceId: eligibility.id,
            sourceVersion: eligibility.version,
            sourceUpdatedAt: eligibility.updatedAt.toISOString(),
            normalizedValue: {
              status: eligibility.status,
              version: eligibility.version,
              statusChangedAt: eligibility.statusChangedAt.toISOString(),
            },
          }),
        ],
        'Restricted',
      );
    } catch (error) {
      return error instanceof NotFoundException
        ? missing('CustomerEligibility', observedAt)
        : unavailable('CustomerEligibility', observedAt, 'ELIGIBILITY_READ_FAILED');
    }
  }
}

@Injectable()
export class CustomerRestrictionsSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const restrictions = await this.eligibilityService.listRestrictions(context.customerId);
      return complete(
        'CustomerRestriction',
        observedAt,
        restrictions.map((restriction) =>
          record({
            sourceId: restriction.id,
            sourceVersion: restriction.version,
            sourceUpdatedAt: restriction.updatedAt.toISOString(),
            normalizedValue: {
              type: restriction.type,
              active: restriction.isActive,
              version: restriction.version,
            },
          }),
        ),
        'Restricted',
      );
    } catch {
      return unavailable('CustomerRestriction', observedAt, 'RESTRICTION_READ_FAILED');
    }
  }
}

@Injectable()
export class CustomerLimitProfileSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const profile = await this.eligibilityService.getLimitProfile(context.customerId);
      return complete(
        'CustomerLimitProfile',
        observedAt,
        [
          record({
            sourceId: profile.id,
            sourceVersion: profile.version,
            sourceUpdatedAt: profile.updatedAt.toISOString(),
            normalizedValue: {
              profileVersion: profile.version,
              currency: profile.currency,
              dailyTransactionCount: profile.dailyTransactionCount,
              dailyTransactionAmountMinor: profile.dailyTransactionAmountMinor,
              singleTransactionAmountMinor: profile.singleTransactionAmountMinor,
              monthlyTransactionAmountMinor: profile.monthlyTransactionAmountMinor,
              walletBalanceMinor: profile.walletBalanceMinor,
            },
          }),
        ],
        'Restricted financial/customer data',
      );
    } catch (error) {
      return error instanceof NotFoundException
        ? missing('CustomerLimitProfile', observedAt)
        : unavailable('CustomerLimitProfile', observedAt, 'LIMIT_PROFILE_READ_FAILED');
    }
  }
}

@Injectable()
export class ProductEnrollmentSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const enrollments = await this.eligibilityService.listEnrollments(context.customerId);
      return complete(
        'CustomerProductEnrollment',
        observedAt,
        enrollments.map((enrollment) =>
          record({
            sourceId: enrollment.id,
            sourceVersion: enrollment.version,
            sourceUpdatedAt: enrollment.updatedAt.toISOString(),
            normalizedValue: {
              product: enrollment.product,
              status: enrollment.status,
              version: enrollment.version,
              statusChangedAt: enrollment.statusChangedAt.toISOString(),
            },
          }),
        ),
        'Restricted',
      );
    } catch {
      return unavailable('CustomerProductEnrollment', observedAt, 'ENROLLMENT_READ_FAILED');
    }
  }
}

@Injectable()
export class OperatingPermissionSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const permissions = await this.eligibilityService.listPermissions(context.customerId);
      return complete(
        'CustomerOperatingPermission',
        observedAt,
        permissions.map((permission) =>
          record({
            sourceId: permission.id,
            sourceVersion: permission.version,
            sourceUpdatedAt: permission.updatedAt.toISOString(),
            normalizedValue: {
              type: permission.type,
              enabled: permission.enabled,
              version: permission.version,
            },
          }),
        ),
        'Restricted',
      );
    } catch {
      return unavailable('CustomerOperatingPermission', observedAt, 'PERMISSION_READ_FAILED');
    }
  }
}

@Injectable()
export class RiskSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly riskService: CustomerRiskProfileService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const profile = await this.riskService.getProfile(context.customerId);
      return complete(
        'CustomerRiskProfile',
        observedAt,
        [
          record({
            sourceId: profile.id,
            sourceVersion: profile.version,
            sourceUpdatedAt: profile.updatedAt.toISOString(),
            normalizedValue: {
              sourceKind: 'P1_10_MANUAL',
              status: profile.status,
              riskLevel: profile.overallRiskLevel,
              assessmentDate: profile.assessmentDate.toISOString(),
              reviewDueDate: profile.reviewDueDate.toISOString(),
              factorReferences: profile.factors.map((factor) => factor.id),
              version: profile.version,
            },
          }),
        ],
        'Highly Restricted',
      );
    } catch (error) {
      return error instanceof NotFoundException
        ? missing('CustomerRiskProfile', observedAt)
        : unavailable('CustomerRiskProfile', observedAt, 'RISK_READ_FAILED');
    }
  }
}

@Injectable()
export class ComplianceSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly complianceService: CustomerComplianceService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const cases = await this.complianceService.listCases(context.customerId);
      const items = cases.map((complianceCase) =>
        record({
          sourceId: complianceCase.id,
          sourceVersion: complianceCase.version,
          sourceUpdatedAt: complianceCase.updatedAt.toISOString(),
          normalizedValue: {
            casePresent: true,
            category: complianceCase.category,
            severity: complianceCase.severity,
            status: complianceCase.status,
            resolutionReference: complianceCase.resolution
              ? `case:${complianceCase.id}:resolved`
              : null,
            assignmentReference: complianceCase.assignedTo
              ? `case:${complianceCase.id}:assigned`
              : null,
            version: complianceCase.version,
            openedAt: complianceCase.openedAt.toISOString(),
            updatedAt: complianceCase.updatedAt.toISOString(),
            closedAt: complianceCase.closedAt?.toISOString() ?? null,
          },
        }),
      );
      if (items.length === 0) {
        items.push(
          record({
            sourceId: null,
            normalizedValue: { casePresent: false },
          }),
        );
      }
      return complete('CustomerComplianceCase', observedAt, items, 'Highly Restricted');
    } catch {
      return unavailable('CustomerComplianceCase', observedAt, 'COMPLIANCE_READ_FAILED');
    }
  }
}

@Injectable()
export class A2RuntimeContextSourceEvidenceReader implements PolicyEvidenceReader {
  read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    const authorization = context.actorContext.authorizationDecision;
    return Promise.resolve(
      complete(
        'A2AuthorizationContext',
        observedAt,
        [
          record({
            sourceId: null,
            customerId: context.customerId,
            normalizedValue: {
              principalType: context.actorContext.principal.type,
              principalId: context.actorContext.principal.principalId,
              customerId: context.actorContext.principal.customerId ?? null,
              audience: context.actorContext.principal.audience ?? null,
              assuranceLevel: context.actorContext.principal.assuranceLevel ?? null,
              allowed: authorization?.allowed ?? true,
              authorizationReference: authorization
                ? `${authorization.resourceType}:${authorization.action}`
                : null,
              evaluatedAt: authorization?.evaluatedAt.toISOString() ?? observedAt,
            },
            sourceReference: 'a2:authorization-context',
          }),
        ],
        'Restricted security context',
      ),
    );
  }
}

@Injectable()
export class A3AccountBindingSourceEvidenceReader implements PolicyEvidenceReader {
  constructor(private readonly accountReadService: CustomerFinancialAccountReadService) {}

  async read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult> {
    const observedAt = new Date().toISOString();
    try {
      const readModel = await this.accountReadService.getCustomerFinancialAccounts({
        customerId: context.customerId,
        principal: context.actorContext.principal,
      });
      const items = readModel.accounts.map((account) =>
        record({
          sourceId: account.bindingId,
          sourceUpdatedAt: readModel.generatedAt,
          normalizedValue: {
            bindingId: account.bindingId,
            customerWalletId: account.customerWalletId,
            walletAccountId: account.walletAccountId,
            ledgerAccountId: account.ledgerAccountId,
            state: account.bindingState ?? account.readState,
            currency: account.currency,
            accountingUnit: account.accountingUnit,
            dimensionsCompatible: account.readState === 'ACTIVE',
            ledgerIsActive: account.readState === 'ACTIVE',
            reconciliationStatus: account.readState === 'ACTIVE' ? 'PASS' : account.readState,
          },
          sourceReference: account.bindingId,
        }),
      );
      if (items.length === 0) {
        items.push(
          record({
            sourceId: null,
            normalizedValue: { state: 'MISSING_BINDING' },
          }),
        );
      }
      return complete(
        'CustomerFinancialAccountBinding',
        observedAt,
        items,
        'Highly Restricted financial/control data',
      );
    } catch {
      return unavailable('CustomerFinancialAccountBinding', observedAt, 'A3_BINDING_READ_FAILED');
    }
  }
}

function record(input: PolicyEvidenceReadItem): PolicyEvidenceReadItem {
  return input;
}

function complete(
  sourceType: string,
  observedAt: string,
  items: readonly PolicyEvidenceReadItem[],
  classification: string,
): PolicyEvidenceReadResult {
  return { status: 'COMPLETE', sourceType, observedAt, items, classification };
}

function missing(sourceType: string, observedAt: string): PolicyEvidenceReadResult {
  return {
    status: 'MISSING',
    sourceType,
    observedAt,
    items: [],
    classification: 'Restricted',
    freshnessReasonCode: 'SOURCE_NOT_FOUND',
  };
}

function unavailable(
  sourceType: string,
  observedAt: string,
  failureReference: string,
): PolicyEvidenceReadResult {
  return {
    status: 'UNAVAILABLE',
    sourceType,
    observedAt,
    items: [],
    classification: 'Restricted',
    failureReference,
  };
}
