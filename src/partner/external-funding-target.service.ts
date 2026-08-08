import { createHash } from 'node:crypto';

import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPolicy } from '../authorization/authorization.types';
import { BankService } from '../bank/bank.service';
import { BankStatus } from '../bank/bank.enums';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { CustomerBeneficiaryService } from '../customer-beneficiary/customer-beneficiary.service';
import type { CustomerBeneficiaryView } from '../customer-beneficiary/customer-beneficiary.types';
import {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../customer-beneficiary/customer-beneficiary.enums';
import { CustomerFundingInstrumentService } from '../customer-funding-instrument/customer-funding-instrument.service';
import type { CustomerFundingInstrumentView } from '../customer-funding-instrument/customer-funding-instrument.types';
import {
  CustomerFundingInstrumentStatus,
  CustomerFundingInstrumentType,
  FundingInstrumentVerificationState,
} from '../customer-funding-instrument/customer-funding-instrument.enums';
import { AuditService } from '../operations/audit.service';
import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { PartnerConnectionService } from './partner-connection.service';
import {
  EXTERNAL_TARGET_USE_ACTION,
  EXTERNAL_TARGET_USE_PURPOSE,
  EXTERNAL_TARGET_USE_RESOURCE,
  type ExternalFundingTargetConsentAssertion,
  type ExternalFundingTargetMappingCommand,
  type ExternalFundingTargetMappingErrorCode,
  type ExternalFundingTargetMappingResult,
  type ExternalFundingTargetPolicyAssertion,
  type ExternalFundingTargetSource,
} from './external-funding-target.types';
import { EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY } from './partner-adapter.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/;
const BANK_CODE_PATTERN = /^[A-Z0-9]{3,20}$/;
const MAX_REFERENCE_LENGTH = 160;

export const EXTERNAL_FUNDING_TARGET_USE_POLICY_BASE: AuthorizationPolicy = {
  resourceType: EXTERNAL_TARGET_USE_RESOURCE,
  action: EXTERNAL_TARGET_USE_ACTION,
};

export class ExternalFundingTargetMappingException extends ConflictException {
  constructor(
    readonly code: ExternalFundingTargetMappingErrorCode,
    message: string,
  ) {
    super({ code, message });
  }
}

interface NormalizedMappingCommand
  extends Omit<
    ExternalFundingTargetMappingCommand,
    | 'amountMinor'
    | 'currency'
    | 'accountingUnit'
    | 'customerId'
    | 'sourceCustomerWalletId'
    | 'target'
  > {
  customerId: string;
  sourceCustomerWalletId: string;
  amountMinor: string;
  currency: 'NGN';
  accountingUnit: 'CUSTOMER_FUNDS';
  target: {
    source: ExternalFundingTargetSource;
    targetId: string;
    version: number;
    institutionCode: string;
    targetCurrency: string | null;
  };
}

interface ResolvedTarget {
  source: ExternalFundingTargetSource;
  sourceId: string;
  sourceVersion: number;
  sourceReference: string;
  institutionCode: string;
  targetType: 'BANK_ACCOUNT';
  verificationReference: string;
}

@Injectable()
export class ExternalFundingTargetMappingService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly bindingService: CustomerFinancialAccountBindingService,
    private readonly fundingInstrumentService: CustomerFundingInstrumentService,
    private readonly beneficiaryService: CustomerBeneficiaryService,
    private readonly bankService: BankService,
    private readonly partnerConnectionService: PartnerConnectionService,
    private readonly auditService: AuditService,
  ) {}

  async resolve(
    command: ExternalFundingTargetMappingCommand,
  ): Promise<ExternalFundingTargetMappingResult> {
    const normalized = this.normalizeCommand(command);
    const authorization = await this.authorize(normalized);
    const policy = this.validatePolicy(normalized.policy, normalized);
    const profile = this.partnerConnectionService.getProfile();
    if (
      !profile.enabled ||
      profile.partnerKey !== 'NIBSS_NIP' ||
      profile.capabilityKey !== EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY ||
      profile.operationType !== 'OUTBOUND_BANK_SETTLEMENT'
    ) {
      throw new ExternalFundingTargetMappingException(
        'PARTNER_CAPABILITY_UNAVAILABLE',
        'The selected A6 partner capability is not enabled for external target use',
      );
    }

    const binding = await this.validateBinding(normalized);
    const target = await this.resolveTarget(normalized);
    this.validateConsent(normalized.consent, normalized, target);
    const mappingReference = this.mappingReference(normalized, target);
    const targetReference = `a6-target:${mappingReference}`;

    return {
      mappingVersion: 1,
      mappingReference,
      partner: {
        partnerKey: profile.partnerKey,
        capabilityKey: profile.capabilityKey,
        operationType: profile.operationType,
      },
      customerId: normalized.customerId,
      internalAccount: {
        customerWalletId: normalized.sourceCustomerWalletId,
        bindingId: normalized.sourceBindingId,
        bindingVersion: binding.bindingVersion,
        walletAccountId: normalized.sourceWalletAccountId,
        ledgerAccountId: normalized.sourceLedgerAccountId,
        currency: normalized.currency,
        accountingUnit: normalized.accountingUnit,
      },
      target: {
        source: target.source,
        sourceId: target.sourceId,
        sourceVersion: target.sourceVersion,
        targetType: target.targetType,
        institutionCode: target.institutionCode,
        targetReferenceHash: this.sha256(targetReference),
        consentReference: normalized.consent.reference,
        consentVersion: normalized.consent.version,
        externalTarget: {
          targetType: target.targetType,
          institutionCode: target.institutionCode,
          targetReference,
          targetReferenceType: target.source,
          targetVersion: target.sourceVersion,
          targetCurrency: normalized.currency,
          verificationReference: target.verificationReference,
        },
      },
      money: {
        amountMinor: normalized.amountMinor,
        currency: normalized.currency,
        accountingUnit: normalized.accountingUnit,
      },
      policy: {
        decision: policy.decision,
        decisionReference: policy.decisionReference,
        policyVersion: policy.policyVersion,
        expiresAt: policy.expiresAt,
      },
      authorization: {
        principalType: authorization.principalType!,
        principalId: authorization.principalId!,
        evaluatedAt: authorization.evaluatedAt.toISOString(),
      },
      requestContext: normalized.requestContext,
    };
  }

  async resolveAndAudit(
    manager: Parameters<AuditService['record']>[0],
    command: ExternalFundingTargetMappingCommand,
  ): Promise<ExternalFundingTargetMappingResult> {
    try {
      const result = await this.resolve(command);
      await this.auditService.record(manager, {
        entityType: 'A6_EXTERNAL_TARGET_MAPPING',
        entityId: result.customerId,
        action: 'MAPPED',
        actor: result.authorization.principalId,
        correlationId: result.requestContext.correlationId,
        requestId: result.requestContext.requestId,
        newValues: {
          mappingReference: result.mappingReference,
          customerId: result.customerId,
          customerWalletId: result.internalAccount.customerWalletId,
          bindingId: result.internalAccount.bindingId,
          walletAccountId: result.internalAccount.walletAccountId,
          ledgerAccountId: result.internalAccount.ledgerAccountId,
          targetSource: result.target.source,
          targetSourceId: result.target.sourceId,
          targetVersion: result.target.sourceVersion,
          targetReferenceHash: result.target.targetReferenceHash,
          institutionCode: result.target.institutionCode,
          currency: result.money.currency,
          accountingUnit: result.money.accountingUnit,
          consentReference: result.target.consentReference,
          consentVersion: result.target.consentVersion,
          policyDecisionReference: result.policy.decisionReference,
          policyVersion: result.policy.policyVersion,
          partnerKey: result.partner.partnerKey,
          capabilityKey: result.partner.capabilityKey,
        },
      });
      return result;
    } catch (error) {
      try {
        await this.auditService.record(manager, {
          entityType: 'A6_EXTERNAL_TARGET_MAPPING',
          entityId: this.safeUuid(command.customerId),
          action: 'REJECTED',
          actor: command.principal?.principalId ?? 'unknown',
          correlationId: command.requestContext?.correlationId,
          requestId: command.requestContext?.requestId,
          newValues: {
            customerId: command.customerId,
            targetSource: command.target?.source ?? null,
            targetId: command.target?.beneficiaryId ?? command.target?.fundingInstrumentId ?? null,
            code: this.failureCode(error),
          },
        });
      } catch {
        throw new ExternalFundingTargetMappingException(
          'OPERATIONS_EVIDENCE_UNAVAILABLE',
          'The external target mapping audit evidence could not be recorded',
        );
      }
      throw error;
    }
  }

  private async authorize(command: NormalizedMappingCommand) {
    const policy: AuthorizationPolicy =
      command.principal.type === 'CUSTOMER'
        ? {
            ...EXTERNAL_FUNDING_TARGET_USE_POLICY_BASE,
            allowedPrincipalTypes: ['CUSTOMER'],
            customerAccess: 'SELF',
          }
        : {
            ...EXTERNAL_FUNDING_TARGET_USE_POLICY_BASE,
            allowedPrincipalTypes: ['SERVICE', 'OPERATOR', 'PRIVILEGED'],
            requiredScopes: [EXTERNAL_TARGET_USE_ACTION],
            customerAccess: 'ASSIGNED',
          };
    let decision;
    try {
      decision = await this.authorizationService.authorize(command.principal, policy, {
        type: EXTERNAL_TARGET_USE_RESOURCE,
        id: command.target.targetId,
        customerId: command.customerId,
        scope: `${command.sourceWalletAccountId}:${command.target.targetId}`,
      });
    } catch {
      throw new ExternalFundingTargetMappingException(
        'OPERATIONS_EVIDENCE_UNAVAILABLE',
        'A2 authorization evidence could not be established',
      );
    }
    if (!decision.allowed || !decision.principalId || !decision.principalType) {
      throw new ExternalFundingTargetMappingException(
        'AUTHORIZATION_REQUIRED',
        `A2 authorization denied: ${decision.reason ?? 'UNKNOWN'}`,
      );
    }
    return decision;
  }

  private validatePolicy(
    policy: ExternalFundingTargetPolicyAssertion,
    command: NormalizedMappingCommand,
  ): ExternalFundingTargetPolicyAssertion {
    if (
      policy.customerId !== command.customerId ||
      policy.capability !== EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY ||
      policy.action !== 'create' ||
      policy.currency !== command.currency ||
      !SAFE_REFERENCE_PATTERN.test(policy.decisionReference) ||
      !SAFE_REFERENCE_PATTERN.test(policy.policyVersion)
    ) {
      throw new ExternalFundingTargetMappingException(
        'POLICY_NOT_EXECUTABLE',
        'The A4 external settlement policy assertion does not match the mapping command',
      );
    }
    if (policy.decision !== 'ALLOW' && policy.decision !== 'ALLOW_WITH_LIMITS') {
      throw new ExternalFundingTargetMappingException(
        'POLICY_NOT_EXECUTABLE',
        'The A4 policy decision is not executable for external target use',
      );
    }
    this.assertFutureTimestamp(policy.expiresAt, 'policy expiry');
    if (policy.reviewAt) {
      this.assertFutureTimestamp(policy.reviewAt, 'policy review');
    }
    if (policy.decision === 'ALLOW_WITH_LIMITS') {
      if (
        !policy.maxAmountMinor ||
        parsePositiveMinorUnits(policy.maxAmountMinor) <
          parsePositiveMinorUnits(command.amountMinor)
      ) {
        throw new ExternalFundingTargetMappingException(
          'POLICY_NOT_EXECUTABLE',
          'The A4 external settlement limit does not cover the requested amount',
        );
      }
    }
    return policy;
  }

  private async validateBinding(
    command: NormalizedMappingCommand,
  ): Promise<Extract<CustomerFinancialAccountBindingValidation, { valid: true }>> {
    let validation;
    try {
      validation = await this.bindingService.validateActiveBinding({
        customerId: command.customerId,
        customerWalletId: command.sourceCustomerWalletId,
        bindingId: command.sourceBindingId,
        walletAccountId: command.sourceWalletAccountId,
        ledgerAccountId: command.sourceLedgerAccountId,
        expectedCurrency: command.currency,
        expectedAccountingUnit: 'CUSTOMER_FUNDS',
        expectedBindingVersion: command.sourceBindingVersion,
      });
    } catch {
      throw new ExternalFundingTargetMappingException(
        'ACCOUNT_BINDING_NOT_ACTIVE',
        'The A3 internal account binding could not be validated',
      );
    }
    if (!validation.valid) {
      throw new ExternalFundingTargetMappingException(
        'ACCOUNT_BINDING_NOT_ACTIVE',
        validation.message,
      );
    }
    return validation;
  }

  private async resolveTarget(command: NormalizedMappingCommand): Promise<ResolvedTarget> {
    const banks = await this.loadSupportedBanks();
    const bank = banks.find((candidate) => candidate.bankCode === command.target.institutionCode);
    if (!bank) {
      throw new ExternalFundingTargetMappingException(
        'BANK_NOT_FOUND',
        'The requested active NIP-supported bank is not present in the authoritative bank directory',
      );
    }
    if (bank.status !== BankStatus.ACTIVE) {
      throw new ExternalFundingTargetMappingException(
        'BANK_NOT_ACTIVE',
        'The requested bank is not ACTIVE in the authoritative bank directory',
      );
    }
    if (!bank.nipSupported) {
      throw new ExternalFundingTargetMappingException(
        'BANK_NOT_SUPPORTED',
        'The requested bank is not marked as NIP-supported in the authoritative bank directory',
      );
    }
    if (command.target.targetCurrency && command.target.targetCurrency !== command.currency) {
      throw new ExternalFundingTargetMappingException(
        'CURRENCY_UNSUPPORTED',
        'The external target currency does not match the selected NGN capability',
      );
    }

    if (command.target.source === 'CUSTOMER_BENEFICIARY') {
      const beneficiaryId = command.target.targetId;
      let beneficiary: CustomerBeneficiaryView;
      try {
        beneficiary = await this.beneficiaryService.getBeneficiary(
          command.customerId,
          beneficiaryId,
        );
      } catch {
        throw new ExternalFundingTargetMappingException(
          'TARGET_NOT_FOUND',
          'The customer beneficiary could not be read from its authoritative owner',
        );
      }
      if (beneficiary.type !== CustomerBeneficiaryType.BANK_ACCOUNT) {
        throw new ExternalFundingTargetMappingException(
          'TARGET_TYPE_UNSUPPORTED',
          'Only BANK_ACCOUNT beneficiaries are permitted for the selected A6 capability',
        );
      }
      if (!beneficiary.verified) {
        throw new ExternalFundingTargetMappingException(
          'TARGET_NOT_VERIFIED',
          'The customer bank-account beneficiary is not verified',
        );
      }
      if (beneficiary.status !== CustomerBeneficiaryStatus.ACTIVE) {
        throw new ExternalFundingTargetMappingException(
          'TARGET_NOT_ACTIVE',
          'The customer bank-account beneficiary is not ACTIVE',
        );
      }
      if (beneficiary.version !== command.target.version) {
        throw new ExternalFundingTargetMappingException(
          'TARGET_VERSION_STALE',
          'The customer bank-account beneficiary version is stale',
        );
      }
      if (
        beneficiary.destinationInstitution &&
        !this.institutionMatchesBank(
          beneficiary.destinationInstitution,
          bank.bankCode,
          bank.bankName,
          bank.shortName,
        )
      ) {
        throw new ExternalFundingTargetMappingException(
          'TARGET_MAPPING_CONFLICT',
          'The beneficiary institution does not match the selected authoritative bank',
        );
      }
      return {
        source: command.target.source,
        sourceId: beneficiary.id,
        sourceVersion: beneficiary.version,
        sourceReference: beneficiary.destinationIdentifier,
        institutionCode: bank.bankCode,
        targetType: 'BANK_ACCOUNT',
        verificationReference: `beneficiary:${beneficiary.id}:v${beneficiary.version}`,
      };
    }

    const instrumentId = command.target.targetId;
    let instrument: CustomerFundingInstrumentView;
    try {
      instrument = await this.fundingInstrumentService.getInstrument(
        command.customerId,
        instrumentId,
      );
    } catch {
      throw new ExternalFundingTargetMappingException(
        'TARGET_NOT_FOUND',
        'The customer funding instrument could not be read from its authoritative owner',
      );
    }
    if (instrument.type !== CustomerFundingInstrumentType.BANK_ACCOUNT) {
      throw new ExternalFundingTargetMappingException(
        'TARGET_TYPE_UNSUPPORTED',
        'Only BANK_ACCOUNT funding instruments are permitted for the selected A6 capability',
      );
    }
    if (
      instrument.status !== CustomerFundingInstrumentStatus.VERIFIED ||
      instrument.verificationState !== FundingInstrumentVerificationState.VERIFIED
    ) {
      throw new ExternalFundingTargetMappingException(
        'TARGET_NOT_VERIFIED',
        'The customer bank-account funding instrument is not VERIFIED',
      );
    }
    if (instrument.version !== command.target.version) {
      throw new ExternalFundingTargetMappingException(
        'TARGET_VERSION_STALE',
        'The customer bank-account funding instrument version is stale',
      );
    }
    return {
      source: command.target.source,
      sourceId: instrument.id,
      sourceVersion: instrument.version,
      sourceReference: instrument.reference,
      institutionCode: bank.bankCode,
      targetType: 'BANK_ACCOUNT',
      verificationReference: `funding-instrument:${instrument.id}:v${instrument.version}`,
    };
  }

  private async loadSupportedBanks() {
    try {
      return await this.bankService.list(undefined, BankStatus.ACTIVE);
    } catch {
      throw new ExternalFundingTargetMappingException(
        'TARGET_SOURCE_UNAVAILABLE',
        'The authoritative bank directory could not be read',
      );
    }
  }

  private validateConsent(
    consent: ExternalFundingTargetConsentAssertion,
    command: NormalizedMappingCommand,
    target: ResolvedTarget,
  ): void {
    if (
      !SAFE_REFERENCE_PATTERN.test(consent.reference) ||
      consent.customerId !== command.customerId ||
      consent.targetSource !== target.source ||
      consent.targetId !== target.sourceId ||
      consent.purpose !== EXTERNAL_TARGET_USE_PURPOSE ||
      !consent.grantedBy.trim() ||
      consent.version < 1
    ) {
      throw new ExternalFundingTargetMappingException(
        'CONSENT_INVALID',
        'The external funding-target consent assertion is invalid or mismatched',
      );
    }
    const grantedAt = this.parseTimestamp(consent.grantedAt, 'consent grantedAt');
    const expiresAt = this.parseTimestamp(consent.expiresAt, 'consent expiresAt');
    const now = Date.now();
    if (grantedAt.getTime() > now || expiresAt.getTime() <= now || expiresAt <= grantedAt) {
      throw new ExternalFundingTargetMappingException(
        'CONSENT_INVALID',
        'The external funding-target consent assertion is not currently valid',
      );
    }
  }

  private normalizeCommand(command: ExternalFundingTargetMappingCommand): NormalizedMappingCommand {
    if (
      !command ||
      !command.principal ||
      !command.requestContext ||
      !command.target ||
      !command.consent ||
      !command.policy
    ) {
      throw new ExternalFundingTargetMappingException(
        'COMMAND_INVALID',
        'The external funding-target mapping command is incomplete',
      );
    }
    const customerId = this.normalizeUuid(command.customerId, 'customerId');
    const sourceCustomerWalletId = this.normalizeUuid(
      command.sourceCustomerWalletId,
      'sourceCustomerWalletId',
    );
    const sourceBindingId = this.normalizeUuid(command.sourceBindingId, 'sourceBindingId');
    const sourceWalletAccountId = this.normalizeUuid(
      command.sourceWalletAccountId,
      'sourceWalletAccountId',
    );
    const sourceLedgerAccountId = this.normalizeUuid(
      command.sourceLedgerAccountId,
      'sourceLedgerAccountId',
    );
    const amountMinor = parsePositiveMinorUnits(command.amountMinor).toString();
    let currency: 'NGN';
    try {
      const normalizedCurrency = normalizeCurrency(command.currency);
      if (normalizedCurrency !== 'NGN') {
        throw new Error('unsupported currency');
      }
      currency = 'NGN';
    } catch {
      throw new ExternalFundingTargetMappingException(
        'CURRENCY_UNSUPPORTED',
        'The selected A6 external settlement capability supports NGN only',
      );
    }
    if (command.accountingUnit !== 'CUSTOMER_FUNDS') {
      throw new ExternalFundingTargetMappingException(
        'ACCOUNTING_UNIT_MISMATCH',
        'The external target mapping requires CUSTOMER_FUNDS accounting unit',
      );
    }
    const targetId = this.normalizeTarget(command.target);
    const institutionCode = this.normalizeInstitutionCode(command.target.institutionCode);
    const targetCurrency = command.target.targetCurrency
      ? normalizeCurrency(command.target.targetCurrency)
      : null;
    if (targetCurrency && targetCurrency !== currency) {
      throw new ExternalFundingTargetMappingException(
        'CURRENCY_UNSUPPORTED',
        'The external target currency does not match NGN',
      );
    }
    const requestContext = {
      requestId: this.normalizeSafeText(command.requestContext.requestId, 'requestId'),
      correlationId: this.normalizeSafeText(command.requestContext.correlationId, 'correlationId'),
      traceId: this.normalizeSafeText(command.requestContext.traceId, 'traceId'),
    };
    return {
      ...command,
      customerId,
      sourceCustomerWalletId,
      sourceBindingId,
      sourceWalletAccountId,
      sourceLedgerAccountId,
      amountMinor,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      target: {
        source: command.target.source,
        targetId,
        version: this.normalizeVersion(command.target.version, 'target.version'),
        institutionCode,
        targetCurrency,
      },
      requestContext,
    };
  }

  private normalizeTarget(target: ExternalFundingTargetMappingCommand['target']): string {
    const hasBeneficiary = Boolean(target.beneficiaryId);
    const hasFundingInstrument = Boolean(target.fundingInstrumentId);
    if (
      (target.source === 'CUSTOMER_BENEFICIARY' && !hasBeneficiary) ||
      (target.source === 'FUNDING_INSTRUMENT' && !hasFundingInstrument) ||
      hasBeneficiary === hasFundingInstrument
    ) {
      throw new ExternalFundingTargetMappingException(
        'TARGET_MAPPING_AMBIGUOUS',
        'Exactly one permitted external target source must be supplied',
      );
    }
    const targetId =
      target.source === 'CUSTOMER_BENEFICIARY' ? target.beneficiaryId : target.fundingInstrumentId;
    return this.normalizeUuid(targetId!, 'targetId');
  }

  private normalizeInstitutionCode(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!BANK_CODE_PATTERN.test(normalized)) {
      throw new ExternalFundingTargetMappingException(
        'TARGET_MAPPING_AMBIGUOUS',
        'institutionCode must be an explicit bank-directory code',
      );
    }
    return normalized;
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ExternalFundingTargetMappingException('COMMAND_INVALID', `${field} must be a UUID`);
    }
    return normalized;
  }

  private normalizeVersion(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ExternalFundingTargetMappingException(
        'COMMAND_INVALID',
        `${field} must be a positive integer`,
      );
    }
    return value;
  }

  private normalizeSafeText(value: string, field: string): string {
    const normalized = value.trim();
    if (
      !normalized ||
      normalized.length > MAX_REFERENCE_LENGTH ||
      !/^[\x20-\x7E]+$/.test(normalized)
    ) {
      throw new ExternalFundingTargetMappingException('COMMAND_INVALID', `${field} is invalid`);
    }
    return normalized;
  }

  private institutionMatchesBank(
    value: string,
    bankCode: string,
    bankName: string,
    shortName: string,
  ): boolean {
    const normalized = value.trim().toUpperCase();
    return [bankCode, bankName, shortName].some(
      (candidate) => candidate.trim().toUpperCase() === normalized,
    );
  }

  private assertFutureTimestamp(value: string, field: string): Date {
    const parsed = this.parseTimestamp(value, field);
    if (parsed.getTime() <= Date.now()) {
      throw new ExternalFundingTargetMappingException(
        'POLICY_NOT_EXECUTABLE',
        `The ${field} is expired`,
      );
    }
    return parsed;
  }

  private parseTimestamp(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ExternalFundingTargetMappingException('COMMAND_INVALID', `${field} is invalid`);
    }
    return parsed;
  }

  private mappingReference(command: NormalizedMappingCommand, target: ResolvedTarget): string {
    return this.sha256(
      [
        'a6-external-target-mapping-v1',
        command.customerId,
        target.source,
        target.sourceId,
        target.sourceVersion,
        target.institutionCode,
        this.sha256(target.sourceReference),
        command.currency,
        command.accountingUnit,
        command.policy.decisionReference,
        command.policy.policyVersion,
        command.consent.reference,
        command.consent.version,
      ].join('|'),
    );
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeUuid(value: string | undefined): string {
    return value && UUID_PATTERN.test(value)
      ? value.toLowerCase()
      : '00000000-0000-4000-8000-000000000000';
  }

  private failureCode(error: unknown): string {
    if (error instanceof ExternalFundingTargetMappingException) {
      return error.code;
    }
    if (error instanceof ForbiddenException) {
      return 'AUTHORIZATION_REQUIRED';
    }
    return 'TARGET_SOURCE_UNAVAILABLE';
  }
}
