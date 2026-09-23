import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { Customer } from '../../src/customer/customer.entity';
import { CustomerContactMethod } from '../../src/customer/customer-contact-method.entity';
import { CustomerProfile } from '../../src/customer/customer-profile.entity';
import { CustomerAddress } from '../../src/customer/customer-address.entity';
import { CustomerIdentityDocument } from '../../src/customer/customer-identity-document.entity';
import { CustomerComplianceCase } from '../../src/customer-compliance/customer-compliance-case.entity';
import { CustomerComplianceService } from '../../src/customer-compliance/customer-compliance.service';
import { ComplianceCaseAssignment } from '../../src/customer-compliance/compliance-case-assignment.entity';
import { ComplianceCaseComment } from '../../src/customer-compliance/compliance-case-comment.entity';
import { ComplianceCaseEvidence } from '../../src/customer-compliance/compliance-case-evidence.entity';
import { ComplianceCaseHistory } from '../../src/customer-compliance/compliance-case-history.entity';
import { CustomerEligibility } from '../../src/customer-eligibility/customer-eligibility.entity';
import { CustomerEligibilityService } from '../../src/customer-eligibility/customer-eligibility.service';
import { CustomerLimitProfile } from '../../src/customer-eligibility/customer-limit-profile.entity';
import { CustomerProductEnrollment } from '../../src/customer-eligibility/customer-product-enrollment.entity';
import { CustomerOperatingPermission } from '../../src/customer-eligibility/customer-operating-permission.entity';
import { CustomerRestriction } from '../../src/customer-eligibility/customer-restriction.entity';
import { CustomerOnboarding } from '../../src/customer-onboarding/customer-onboarding.entity';
import { CustomerOnboardingService } from '../../src/customer-onboarding/customer-onboarding.service';
import { CustomerAgreement } from '../../src/customer-onboarding/customer-agreement.entity';
import { CustomerApprovalDecision } from '../../src/customer-onboarding/customer-approval-decision.entity';
import { CustomerOnboardingTask } from '../../src/customer-onboarding/customer-onboarding-task.entity';
import { CustomerRiskProfile as OnboardingRiskProfile } from '../../src/customer-onboarding/customer-risk-profile.entity';
import { CustomerFinancialOperationsService } from '../../src/customer-financial-operations/customer-financial-operations.service';
import { CustomerRiskFactor } from '../../src/customer-risk-profile/customer-risk-factor.entity';
import { CustomerRiskProfile } from '../../src/customer-risk-profile/customer-risk-profile.entity';
import { CustomerRiskProfileService } from '../../src/customer-risk-profile/customer-risk-profile.service';
import { CustomerRiskLevel } from '../../src/customer-risk-profile/customer-risk-profile.enums';
import { RiskFactorHistory } from '../../src/customer-risk-profile/risk-factor-history.entity';
import { RiskProfileHistory } from '../../src/customer-risk-profile/risk-profile-history.entity';
import { CustomerReceivingNumber } from '../../src/customer-wallet/customer-receiving-number.entity';
import { CustomerWallet } from '../../src/customer-wallet/customer-wallet.entity';
import { WalletAlias } from '../../src/customer-wallet/wallet-alias.entity';
import { WalletOwnership } from '../../src/customer-wallet/wallet-ownership.entity';
import { CustomerWalletService } from '../../src/customer-wallet/customer-wallet.service';
import { CustomerReceivingNumberService } from '../../src/customer-wallet/customer-receiving-number.service';
import { WalletProvisioningHistory } from '../../src/customer-wallet/wallet-provisioning-history.entity';
import { Deposit } from '../../src/deposit/deposit.entity';
import { DepositService } from '../../src/deposit/deposit.service';
import { LedgerAccount } from '../../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../../src/ledger/ledger-line.entity';
import { LedgerService } from '../../src/ledger/ledger.service';
import { AuditEvent } from '../../src/operations/audit-event.entity';
import { AuditService } from '../../src/operations/audit.service';
import { IdempotencyRecord } from '../../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../../src/operations/idempotency.service';
import { MetricsService } from '../../src/operations/metrics.service';
import { OutboxEvent } from '../../src/operations/outbox-event.entity';
import { OutboxService } from '../../src/operations/outbox.service';
import { PaymentReferenceService } from '../../src/payment/payment-reference.service';
import { SettlementAccountService } from '../../src/payment/settlement-account.service';
import { PilotControl } from '../../src/pilot/pilot-control.entity';
import { PilotControlService } from '../../src/pilot/pilot-control.service';
import { INTERNAL_TRANSFER_PILOT_CONTROL_KEY } from '../../src/pilot/pilot-control.types';
import { TypeOrmPolicyAuditAdapter } from '../../src/policy/capability-policy-audit.adapter';
import {
  A2RuntimeContextSourceEvidenceReader,
  A3AccountBindingSourceEvidenceReader,
  ComplianceSourceEvidenceReader,
  CustomerEligibilitySourceEvidenceReader,
  CustomerLimitProfileSourceEvidenceReader,
  CustomerSourceEvidenceReader,
  OnboardingReadinessSourceEvidenceReader,
  OperatingPermissionSourceEvidenceReader,
  ProductEnrollmentSourceEvidenceReader,
  RiskSourceEvidenceReader,
} from '../../src/policy/capability-policy-source-readers';
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
} from '../../src/policy/capability-policy-evidence.adapters';
import { ImmutableEvidenceSnapshotAttachment } from '../../src/policy/immutable-evidence-snapshot-attachment.entity';
import { PolicyDecisionRecord } from '../../src/policy/policy-decision-record.entity';
import { PolicyProfileVersion } from '../../src/policy/policy-profile-version.entity';
import { PolicySourceEvidenceCoordinator } from '../../src/policy/capability-policy-evidence.coordinator';
import { StaticCapabilityPolicyProfileRegistry } from '../../src/policy/capability-policy.profiles';
import { CapabilityPolicyEvaluationService } from '../../src/policy/capability-policy.service';
import {
  TypeOrmPolicyDecisionRecordRepository,
  TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
  TypeOrmPolicyProfileVersionRepository,
} from '../../src/policy/capability-policy-persistence.repositories';
import { TypeOrmPolicyIdempotencyAdapter } from '../../src/policy/capability-policy-idempotency.adapter';
import { InternalTransferGateService } from '../../src/transfer/internal-transfer-gate.service';
import {
  A3InternalTransferBindingAdapter,
  TypeOrmInternalTransferGateAuditAdapter,
  TypeOrmInternalTransferGateIdempotencyAdapter,
} from '../../src/transfer/internal-transfer-gate.adapters';
import { Transfer } from '../../src/transfer/transfer.entity';
import { TransferLifecycleService } from '../../src/transfer/transfer-lifecycle.service';
import { TransferService } from '../../src/transfer/transfer.service';
import { CustomerRestrictionsSourceEvidenceReader } from '../../src/policy/capability-policy-source-readers';
import { CustomerFinancialAccountReadService } from '../../src/wallet/customer-financial-account-read.service';
import { CustomerFinancialAccountBinding } from '../../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingService } from '../../src/wallet/customer-financial-account-binding.service';
import { CustomerFinancialAccountResolutionService } from '../../src/wallet/customer-financial-account-resolution.service';
import { CustomerRecipientResolutionService } from '../../src/wallet/customer-recipient-resolution.service';
import { WalletAccount } from '../../src/wallet/wallet-account.entity';
import { WalletService } from '../../src/wallet/wallet.service';
import { Withdrawal } from '../../src/withdrawal/withdrawal.entity';
import { WithdrawalService } from '../../src/withdrawal/withdrawal.service';
import { createTransactionPinStack, type TransactionPinStack } from './transaction-pin-harness';

/**
 * The complete live Wallet → Wallet command graph, composed exactly the way
 * the Nest modules compose it at runtime:
 *
 *   CustomerFinancialOperationsService
 *   → InternalTransferGateService (A2 + pilot + A4 + A3, fail-closed)
 *   → TransferLifecycleService (PENDING → PROCESSING → terminal)
 *   → LedgerService
 *
 * Nothing is mocked. The A4 evaluator uses the production default static
 * profile registry (the same CapabilityPolicyProfile definitions shipped in
 * the repository); decisions, snapshots, idempotency, and audit persist to
 * real PostgreSQL, so every control is observable.
 */
export interface CustomerTransferStack {
  dataSource: DataSource;
  ledger: LedgerService;
  audit: AuditService;
  outbox: OutboxService;
  metrics: MetricsService;
  idempotency: IdempotencyService;
  authorization: AuthorizationService;
  customerWallets: CustomerWalletService;
  bindingService: CustomerFinancialAccountBindingService;
  receivingNumbers: CustomerReceivingNumberService;
  transfers: TransferService;
  deposits: DepositService;
  withdrawals: WithdrawalService;
  resolution: CustomerFinancialAccountResolutionService;
  recipientResolution: CustomerRecipientResolutionService;
  pinStack: TransactionPinStack;
  pilot: PilotControlService;
  policy: CapabilityPolicyEvaluationService;
  riskProfiles: CustomerRiskProfileService;
  gate: InternalTransferGateService;
  lifecycle: TransferLifecycleService;
  operations: CustomerFinancialOperationsService;
}

export function createCustomerTransferStack(dataSource: DataSource): CustomerTransferStack {
  const repository = <T extends object>(entity: new () => T) => dataSource.getRepository(entity);

  const audit = new AuditService(repository(AuditEvent));
  const outbox = new OutboxService(repository(OutboxEvent));
  const metrics = new MetricsService(dataSource);
  const idempotency = new IdempotencyService(repository(IdempotencyRecord));
  const ledger = new LedgerService(
    repository(LedgerAccount),
    repository(LedgerJournal),
    repository(LedgerLine),
    dataSource,
  );
  const walletAccounts = new WalletService(repository(WalletAccount), dataSource, ledger);
  const authorization = new AuthorizationService(dataSource, audit);
  const bindingService = new CustomerFinancialAccountBindingService(
    repository(CustomerFinancialAccountBinding),
    repository(Customer),
    repository(CustomerWallet),
    repository(WalletOwnership),
    repository(WalletAccount),
    repository(LedgerAccount),
    repository(LedgerLine),
    dataSource,
    walletAccounts,
    authorization,
    audit,
    idempotency,
  );
  const receivingNumbers = new CustomerReceivingNumberService(dataSource, audit);
  const customerWallets = new CustomerWalletService(
    repository(CustomerWallet),
    repository(WalletProvisioningHistory),
    repository(WalletAlias),
    repository(WalletOwnership),
    repository(Customer),
    repository(CustomerOnboarding),
    repository(CustomerEligibility),
    dataSource,
    audit,
    bindingService,
    receivingNumbers,
  );
  const references = new PaymentReferenceService();
  const settlement = new SettlementAccountService();
  const transfers = new TransferService(
    repository(Transfer),
    repository(WalletAccount),
    repository(LedgerJournal),
    dataSource,
    ledger,
    references,
    audit,
    outbox,
    metrics,
  );
  const deposits = new DepositService(
    repository(Deposit),
    dataSource,
    ledger,
    references,
    settlement,
    audit,
    outbox,
    metrics,
  );
  const withdrawals = new WithdrawalService(
    repository(Withdrawal),
    dataSource,
    ledger,
    references,
    settlement,
    audit,
    outbox,
    metrics,
  );
  const resolution = new CustomerFinancialAccountResolutionService(
    repository(CustomerFinancialAccountBinding),
    repository(WalletAccount),
  );
  const recipientResolution = new CustomerRecipientResolutionService(
    repository(CustomerContactMethod),
    repository(Customer),
    repository(CustomerProfile),
    repository(CustomerWallet),
    repository(CustomerReceivingNumber),
    repository(CustomerFinancialAccountBinding),
    repository(WalletAccount),
    repository(LedgerAccount),
  );
  const pinStack = createTransactionPinStack(dataSource, audit);

  // A5 pilot control: real service against the seeded (disabled) control row.
  const pilot = new PilotControlService(
    repository(PilotControl),
    dataSource,
    authorization,
    audit,
    idempotency,
    metrics,
    new ConfigService(),
  );

  // A4 capability policy: real evaluator + real persistence adapters + real
  // evidence readers, with the production default static profile registry.
  const onboardingService = new CustomerOnboardingService(
    repository(CustomerOnboarding),
    repository(CustomerAgreement),
    repository(OnboardingRiskProfile),
    repository(CustomerOnboardingTask),
    repository(CustomerApprovalDecision),
    repository(Customer),
    repository(CustomerProfile),
    repository(CustomerAddress),
    repository(CustomerIdentityDocument),
    dataSource,
    audit,
  );
  const eligibilityService = new CustomerEligibilityService(
    repository(CustomerEligibility),
    repository(CustomerLimitProfile),
    repository(CustomerProductEnrollment),
    repository(CustomerOperatingPermission),
    repository(CustomerRestriction),
    repository(Customer),
    repository(CustomerOnboarding),
    dataSource,
    audit,
  );
  const riskService = new CustomerRiskProfileService(
    repository(CustomerRiskProfile),
    repository(CustomerRiskFactor),
    repository(RiskProfileHistory),
    repository(RiskFactorHistory),
    repository(Customer),
    dataSource,
    audit,
  );
  const complianceService = new CustomerComplianceService(
    repository(CustomerComplianceCase),
    repository(ComplianceCaseHistory),
    repository(ComplianceCaseAssignment),
    repository(ComplianceCaseComment),
    repository(ComplianceCaseEvidence),
    repository(Customer),
    dataSource,
    audit,
  );
  const accountRead = new CustomerFinancialAccountReadService(
    repository(CustomerFinancialAccountBinding),
    repository(Customer),
    repository(CustomerWallet),
    repository(WalletAccount),
    repository(LedgerAccount),
    repository(CustomerReceivingNumber),
    ledger,
    authorization,
  );
  const evidenceCoordinator = new PolicySourceEvidenceCoordinator([
    new CustomerPolicyEvidenceAdapter(new CustomerSourceEvidenceReader(repository(Customer))),
    new OnboardingReadinessPolicyEvidenceAdapter(
      new OnboardingReadinessSourceEvidenceReader(onboardingService),
    ),
    new CustomerEligibilityPolicyEvidenceAdapter(
      new CustomerEligibilitySourceEvidenceReader(eligibilityService),
    ),
    new CustomerRestrictionsPolicyEvidenceAdapter(
      new CustomerRestrictionsSourceEvidenceReader(eligibilityService),
    ),
    new CustomerLimitProfilePolicyEvidenceAdapter(
      new CustomerLimitProfileSourceEvidenceReader(eligibilityService),
    ),
    new ProductEnrollmentPolicyEvidenceAdapter(
      new ProductEnrollmentSourceEvidenceReader(eligibilityService),
    ),
    new OperatingPermissionPolicyEvidenceAdapter(
      new OperatingPermissionSourceEvidenceReader(eligibilityService),
    ),
    new RiskPolicyEvidenceAdapter(new RiskSourceEvidenceReader(riskService)),
    new CompliancePolicyEvidenceAdapter(new ComplianceSourceEvidenceReader(complianceService)),
    new A2RuntimeContextPolicyEvidenceAdapter(new A2RuntimeContextSourceEvidenceReader()),
    new A3AccountBindingPolicyEvidenceAdapter(
      new A3AccountBindingSourceEvidenceReader(accountRead),
    ),
  ]);
  const profileVersions = new TypeOrmPolicyProfileVersionRepository(
    repository(PolicyProfileVersion),
  );
  const snapshotAttachments = new TypeOrmPolicyEvidenceSnapshotAttachmentRepository(
    repository(ImmutableEvidenceSnapshotAttachment),
  );
  const decisionRecords = new TypeOrmPolicyDecisionRecordRepository(
    repository(PolicyDecisionRecord),
    profileVersions,
    snapshotAttachments,
    dataSource,
    audit,
  );
  const policyIdempotency = new TypeOrmPolicyIdempotencyAdapter(
    dataSource,
    idempotency,
    decisionRecords,
  );
  const policyAudit = new TypeOrmPolicyAuditAdapter(dataSource, audit);
  const policy = new CapabilityPolicyEvaluationService(
    authorization,
    new StaticCapabilityPolicyProfileRegistry(),
    decisionRecords,
    policyIdempotency,
    policyAudit,
  );

  const gate = new InternalTransferGateService(
    authorization,
    pilot,
    policy,
    evidenceCoordinator,
    new A3InternalTransferBindingAdapter(bindingService),
    new TypeOrmInternalTransferGateIdempotencyAdapter(dataSource, idempotency),
    new TypeOrmInternalTransferGateAuditAdapter(dataSource, audit),
  );
  const lifecycle = new TransferLifecycleService(
    repository(Transfer),
    dataSource,
    ledger,
    audit,
    outbox,
    idempotency,
  );
  const operations = new CustomerFinancialOperationsService(
    resolution,
    transfers,
    deposits,
    withdrawals,
    recipientResolution,
    pinStack.authorization,
    gate,
    lifecycle,
    idempotency,
    dataSource,
  );

  return {
    dataSource,
    ledger,
    audit,
    outbox,
    metrics,
    idempotency,
    authorization,
    customerWallets,
    bindingService,
    receivingNumbers,
    transfers,
    deposits,
    withdrawals,
    resolution,
    recipientResolution,
    pinStack,
    pilot,
    policy,
    riskProfiles: riskService,
    gate,
    lifecycle,
    operations,
  };
}

/** The CUSTOMER principal the runtime access guard builds for /customers/:id. */
export function selfPrincipal(
  customerId: string,
  sessionId = randomUUID(),
): AuthorizationPrincipal {
  return {
    type: 'CUSTOMER',
    principalId: customerId,
    customerId,
    sessionId,
    audience: 'monienaija-customer',
    roles: [],
    scopes: [],
    customerAccess: 'SELF',
    assuranceLevel: 'PASSWORD',
  };
}

/** A workforce principal satisfying PILOT_CONTROL_WRITE_POLICY (pilot:control:write). */
export function pilotWritePrincipal(): AuthorizationPrincipal {
  return {
    type: 'PRIVILEGED',
    principalId: 'integration-harness',
    roles: [],
    scopes: ['pilot:control:write'],
    customerAccess: 'ANY',
  };
}

/** Enables the seeded (disabled) internal transfer pilot control for the live suite. */
export async function enableTransferPilot(
  stack: CustomerTransferStack,
  cohortCustomerIds: string[] = [],
): Promise<void> {
  await stack.pilot.configure({
    controlKey: INTERNAL_TRANSFER_PILOT_CONTROL_KEY,
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    enabled: true,
    cohortCustomerIds: [...new Set(cohortCustomerIds)],
    currency: 'NGN',
    minTransactionAmountMinor: '1',
    maxTransactionAmountMinor: '100000000000',
    dailyTransactionCountLimit: 10000,
    dailyTransactionAmountMinor: '100000000000',
    safetyThresholds: {},
    reason: 'integration suite pilot enablement',
    principal: pilotWritePrincipal(),
    idempotencyKey: `pilot-enable-${randomUUID()}`,
    requestContext: {
      requestId: `pilot-enable-${randomUUID()}`,
      correlationId: `pilot-enable-${randomUUID()}`,
      traceId: `pilot-enable-${randomUUID()}`,
    },
  });
}

/**
 * Admits a customer into the enabled internal-transfer pilot cohort.
 *
 * The pilot control is deny-by-default per customer: enabling the control is
 * not enough, the customer id must also be inside the cohort. Suites seed
 * customers after enabling the control, so admission is a separate step.
 */
export async function admitToTransferPilot(
  stack: CustomerTransferStack,
  ...customerIds: string[]
): Promise<void> {
  const control = await stack.pilot.get(INTERNAL_TRANSFER_PILOT_CONTROL_KEY);
  const cohort = new Set([...(control?.cohortCustomerIds ?? []), ...customerIds]);
  await enableTransferPilot(stack, [...cohort]);
}

export interface FullyEligibleCustomerOptions {
  label: string;
  /** +234… E.164 (or bare NSN) phone; also drives receiving-number issuance. */
  phoneE164?: string;
  /** Configured A4 limit-profile values (defaults are generous). */
  singleTransactionAmountMinor?: string;
  dailyTransactionAmountMinor?: string;
  monthlyTransactionAmountMinor?: string;
  dailyTransactionCount?: number;
  walletBalanceMinor?: string;
}

/**
 * A complete policy-eligible individual customer: ACTIVE customer, COMPLETED
 * onboarding, ELIGIBLE eligibility, configured limit profile, ACTIVE
 * wallet.transfer enrollment, enabled TRANSFER permission, and a current LOW
 * risk profile. Every row the A4 wallet.transfer profile requires is present
 * and durable; nothing is bypassed.
 */
export async function seedFullyEligibleCustomer(
  stack: CustomerTransferStack,
  options: FullyEligibleCustomerOptions,
): Promise<string> {
  const dataSource = stack.dataSource;
  const customerId = randomUUID();
  const now = new Date().toISOString();
  await dataSource.query(
    `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
     VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED')`,
    [customerId, `it.w2w.${options.label}.${randomUUID().slice(0, 8)}`],
  );
  await dataSource.query(
    `INSERT INTO customer_onboardings (id, customer_id, status, completed_at)
     VALUES ($1, $2, 'COMPLETED', $3)`,
    [randomUUID(), customerId, now],
  );
  if (options.phoneE164) {
    // Canonical Nigerian stored form keeps the leading '+' (ADR-style domain
    // contract: +234<10-digit NSN>); receiving-number issuance and PHONE
    // recipient resolution both key off normalized_value.
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1, $2, 'PHONE', $3, $3, TRUE, $4)`,
      [randomUUID(), customerId, options.phoneE164, now],
    );
  }
  await dataSource.query(
    `INSERT INTO customer_eligibilities (id, customer_id, status, reviewed_by, status_changed_at)
     VALUES ($1, $2, 'ELIGIBLE', 'integration-harness', $3)`,
    [randomUUID(), customerId, now],
  );
  await dataSource.query(
    `INSERT INTO customer_limit_profiles
       (id, customer_id, currency, daily_transaction_count, daily_transaction_amount_minor,
        single_transaction_amount_minor, monthly_transaction_amount_minor, wallet_balance_minor)
     VALUES ($1, $2, 'NGN', $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      customerId,
      options.dailyTransactionCount ?? 10000,
      options.dailyTransactionAmountMinor ?? '100000000000',
      options.singleTransactionAmountMinor ?? '1000000000',
      options.monthlyTransactionAmountMinor ?? '100000000000',
      options.walletBalanceMinor ?? '100000000000',
    ],
  );
  await dataSource.query(
    `INSERT INTO customer_product_enrollments (id, customer_id, product, status, status_changed_at)
     VALUES ($1, $2, 'wallet.transfer', 'ACTIVE', $3)`,
    [randomUUID(), customerId, now],
  );
  await dataSource.query(
    `INSERT INTO customer_operating_permissions (id, customer_id, type, enabled)
     VALUES ($1, $2, 'TRANSFER', TRUE)`,
    [randomUUID(), customerId],
  );
  // Risk profile + factors through the real domain service so the A4 risk
  // evidence (CURRENT_REQUIRED incl. factor references) is structurally
  // complete exactly as in production onboarding flows.
  await stack.riskProfiles.createProfile(customerId, {
    assessmentDate: now,
    assessedBy: 'integration-harness',
    assessmentMethod: 'P1_10_MANUAL',
    overallRiskLevel: CustomerRiskLevel.LOW,
    reviewDueDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    factors: [
      { category: 'IDENTITY_VERIFICATION', score: 0, weight: 1, remarks: 'integration seed' },
    ],
    actor: 'integration-harness',
  });
  return customerId;
}
