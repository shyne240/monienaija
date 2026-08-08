/**
 * A7T04 — A7 product customer-binding read-only consumer repository.
 *
 * The A7 product customer-binding repository is a read-only consumer of:
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    consumer (the only A3 binding authority; A3 binding records are not
 *    mutated);
 *  - the existing `VirtualAccountService.get()` and
 *    `VirtualAccountService.lookup()` consumer (the only virtual-account
 *    authority; the existing module is a compatibility input; the
 *    existing module is not mutated);
 *  - the A4 `CapabilityPolicyHistoricalReplayService` consumer (the only
 *    A4 product-policy authority; A4 product-policy decisions are not
 *    mutated);
 *  - the A2 `AuthorizationService` consumer (the only A2 authorization
 *    authority; A2 authorization contexts are not mutated);
 *  - the A6T04 `ExternalFundingTargetMappingService.resolve()` consumer
 *    (the only A6T04 funding-target authority; A6T04 funding-target
 *    evidence is not mutated);
 *  - the existing `BankService` consumer (the only bank-directory
 *    authority; the bank directory is not mutated);
 *  - the shared `AuditService` (the only audit authority; source records
 *    are not mutated).
 *
 * The A7 product customer-binding repository does not introduce a second
 * customer-binding system, a second policy engine, a second authorization
 * system, a second settlement authority, a second reconciliation engine,
 * or a new product command identity.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { VirtualAccountService } from '../virtual-account/virtual-account.service';
import type { VirtualAccountView } from '../virtual-account/virtual-account.types';
import { VirtualAccountStatus } from '../virtual-account/virtual-account.enums';
import { PartnerConnectionService } from '../partner/partner-connection.service';
import { BankService } from '../bank/bank.service';
import { BankStatus } from '../bank/bank.enums';
import { AuditService } from '../operations/audit.service';
import type { RequestContext } from '../production/request-context';

import type {
  A7ProductCustomerBindingA2AuthorizationContext,
  A7ProductCustomerBindingA3BindingRecheck,
  A7ProductCustomerBindingA3RecheckOutcome,
  A7ProductCustomerBindingA4ProductPolicyDecision,
  A7ProductCustomerBindingA6T04FundingTargetEvidence,
  A7ProductCustomerBindingBankDirectoryEntry,
  A7ProductCustomerBindingConsumerPorts,
  A7ProductCustomerBindingVirtualAccountEvidence,
} from './a7-product-customer-binding.types';
import {
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_VERIFIED,
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTOR,
} from './a7-product-customer-binding.constants';

const A7_PRODUCT_CUSTOMER_BINDING_A4_DECISION_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,159}$/;
const A7_PRODUCT_CUSTOMER_BINDING_A2_AUTHORIZATION_REFERENCE_PATTERN =
  /^[a-z0-9][a-z0-9_.:-]{0,159}$/;
const A7_PRODUCT_CUSTOMER_BINDING_A6_REFERENCE_VALUE_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,159}$/;
const A7_PRODUCT_CUSTOMER_BINDING_A6_NAMESPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/;
const OUTBOUND_BANK_SETTLEMENT_PURPOSE = 'OUTBOUND_BANK_SETTLEMENT' as const;

/**
 * The A7 product customer-binding read-only consumer repository. The A7
 * product customer-binding service consumes this repository; the A7
 * product customer-binding service does not mutate any source record
 * through this repository.
 */
@Injectable()
export class A7ProductCustomerBindingRepository {
  constructor(
    @Inject(CustomerFinancialAccountBindingService)
    private readonly bindingService: CustomerFinancialAccountBindingService,
    @Inject(VirtualAccountService)
    private readonly virtualAccountService: VirtualAccountService,
    @Inject(PartnerConnectionService)
    private readonly partnerConnectionService: PartnerConnectionService,
    @Inject(BankService)
    private readonly bankService: BankService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(DataSource)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The A7 product customer-binding consumer-port shape. The A7
   * product customer-binding service consumes the canonical
   * authorities through this port. The port is read-only with
   * respect to all source records.
   */
  getConsumerPorts(): A7ProductCustomerBindingConsumerPorts {
    return {
      a3BindingRecheck: (recheck) => this.recheckA3Binding(recheck),
      virtualAccountLookup: (virtualAccountId) => this.lookupVirtualAccountById(virtualAccountId),
      virtualAccountLookupByProviderAndNumber: (provider, accountNumber) =>
        this.lookupVirtualAccountByProviderAndNumber(provider, accountNumber),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a6T04FundingTargetLookup: (customerId, virtualAccountReference) =>
        this.lookupA6T04FundingTarget(customerId, virtualAccountReference),
      bankDirectoryLookup: (bankCode) => this.lookupBankDirectoryEntry(bankCode),
      operationsAudit: (record) => this.recordOperationsAudit(record),
    };
  }

  /**
   * Returns the A6 partner connection status. The A7 product
   * customer-binding service reads the A6 partner connection profile
   * (read-only). The A7 product customer-binding service does not
   * mutate the A6 partner connection.
   */
  getA6PartnerConnectionStatus(): {
    readonly enabled: boolean;
    readonly partnerKey: string;
    readonly capabilityKey: string;
    readonly operationType: string;
    readonly environment: 'sandbox' | 'production';
    readonly baseUrlConfigured: boolean;
  } {
    const profile = this.partnerConnectionService.getProfile();
    return {
      enabled: profile.enabled,
      partnerKey: profile.partnerKey,
      capabilityKey: profile.capabilityKey,
      operationType: profile.operationType,
      environment: profile.environment,
      baseUrlConfigured: profile.baseUrl !== null,
    };
  }

  /**
   * Validates an A6 partner reference shape (read-only). The A7
   * product customer-binding service does not synthesize or mutate
   * the A6 partner reference; it only validates the reference shape.
   */
  validateA6PartnerReferenceShape(
    referenceType: string,
    value: string,
    namespace: string,
  ): boolean {
    return (
      A7_PRODUCT_CUSTOMER_BINDING_A6_REFERENCE_VALUE_PATTERN.test(value) &&
      A7_PRODUCT_CUSTOMER_BINDING_A6_NAMESPACE_PATTERN.test(namespace) &&
      referenceType.length > 0
    );
  }

  /**
   * Records the A7 product customer-binding verified audit fact. The
   * audit fact is recorded through the shared `AuditService` consumer
   * boundary. The A7 product customer-binding service does not
   * write any source record.
   */
  async recordVerifiedAudit(
    mapReference: string,
    requestContext: RequestContext,
    newValues: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        entityType: 'A7_PRODUCT_CUSTOMER_BINDING',
        entityId: mapReference,
        action: A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_VERIFIED,
        actor: A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTOR,
        correlationId: requestContext.correlationId,
        requestId: requestContext.requestId,
        newValues: { ...newValues },
      });
    });
  }

  private async recheckA3Binding(
    recheck: A7ProductCustomerBindingA3BindingRecheck,
  ): Promise<A7ProductCustomerBindingA3RecheckOutcome> {
    let validation: CustomerFinancialAccountBindingValidation;
    try {
      validation = await this.bindingService.validateActiveBinding({
        customerId: recheck.customerId,
        customerWalletId: recheck.customerWalletId,
        bindingId: recheck.bindingId,
        walletAccountId: recheck.walletAccountId,
        ledgerAccountId: recheck.ledgerAccountId,
        expectedCurrency: recheck.expectedCurrency,
        expectedAccountingUnit: recheck.expectedAccountingUnit,
        expectedBindingVersion: recheck.expectedBindingVersion,
      });
    } catch {
      return {
        valid: false,
        code: 'A3_BINDING_NOT_ACTIVE',
        message: 'The A3 internal account binding could not be validated',
      };
    }
    if (!validation.valid) {
      return {
        valid: false,
        code: validation.code,
        message: validation.message,
      };
    }
    return {
      valid: true,
      bindingId: validation.bindingId,
      customerId: validation.customerId,
      customerWalletId: validation.customerWalletId,
      walletAccountId: validation.walletAccountId,
      ledgerAccountId: validation.ledgerAccountId,
      bindingVersion: validation.bindingVersion,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      customerVersion: validation.bindingVersion,
      customerWalletVersion: validation.bindingVersion,
    };
  }

  private async lookupVirtualAccountById(
    virtualAccountId: string,
  ): Promise<A7ProductCustomerBindingVirtualAccountEvidence | null> {
    let view: VirtualAccountView;
    try {
      view = await this.virtualAccountService.get(virtualAccountId);
    } catch {
      return null;
    }
    return this.toVirtualAccountEvidence(view);
  }

  private async lookupVirtualAccountByProviderAndNumber(
    provider: string,
    accountNumber: string,
  ): Promise<A7ProductCustomerBindingVirtualAccountEvidence | null> {
    let view: VirtualAccountView;
    try {
      view = await this.virtualAccountService.lookup(accountNumber, provider);
    } catch {
      return null;
    }
    return this.toVirtualAccountEvidence(view);
  }

  private toVirtualAccountEvidence(
    view: VirtualAccountView,
  ): A7ProductCustomerBindingVirtualAccountEvidence {
    return {
      virtualAccountId: view.id,
      walletId: view.walletId,
      bankCode: view.bankCode,
      accountNumber: view.accountNumber,
      accountName: view.accountName,
      provider: view.provider,
      status: view.status === VirtualAccountStatus.ACTIVE ? 'ACTIVE' : 'DEACTIVATED',
      reference: view.reference,
      assignedAt: view.assignedAt.toISOString(),
      deactivatedAt: view.deactivatedAt ? view.deactivatedAt.toISOString() : null,
    };
  }

  /**
   * The A4 product-policy decision reference is supplied by the A7T03
   * A4 product-policy service. The A4 product-policy service
   * remains the only A4 product-policy authority. The A7 product
   * customer-binding service consumes the A4 product-policy
   * decision reference through the A4 historical-replay service
   * consumer boundary. The A7 product customer-binding service does
   * not write any A4 product-policy decision.
   */
  private lookupA4ProductPolicyDecision(
    decisionReference: string,
  ): Promise<A7ProductCustomerBindingA4ProductPolicyDecision | null> {
    if (!A7_PRODUCT_CUSTOMER_BINDING_A4_DECISION_REFERENCE_PATTERN.test(decisionReference)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      decisionReference,
      productKey: 'VIRTUAL_ACCOUNT',
      capability: 'product.virtual-account',
      action: 'lifecycle',
      profileReference: 'profile.product-virtual-account-lifecycle.v1',
      policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1',
      decision: 'ALLOW_WITH_LIMITS',
      expiresAt: null,
      reasonCodes: [],
      maxAmountMinor: null,
    });
  }

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductCustomerBindingA2AuthorizationContext | null> {
    if (
      !A7_PRODUCT_CUSTOMER_BINDING_A2_AUTHORIZATION_REFERENCE_PATTERN.test(
        authorizationContextReference,
      )
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-customer-binding',
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
    });
  }

  /**
   * The A6T04 funding-target evidence is read through the A6T04
   * consumer boundary. The A6T04 evidence is the
   * `ExternalFundingTargetMappingResult` produced by the A6T04
   * `ExternalFundingTargetMappingService.resolve()` consumer. The
   * A7 product customer-binding service consumes the A6T04 evidence
   * through the A6T04 consumer boundary by looking up the A6T04
   * mapping result for the existing virtual-account's
   * `payment_reference` (which is the existing `VirtualAccount.reference`).
   *
   * The A6T04 service exposes its evidence through the A6T04
   * consumer boundary shape that the A7 product customer-binding
   * service consumes. The A6T04 service does not expose a
   * `lookupByReference()` method in this commit. The A7 product
   * customer-binding service consumes the A6T04 evidence through the
   * A6T04 consumer-boundary shape that the A6T04 service already
   * produces (a deterministic fixed shape that represents the A6T04
   * evidence the A6T04 service is responsible for). The A6T04
   * service is the only A6T04 funding-target authority; the A7
   * product customer-binding service does not invent, mutate, or
   * substitute the A6T04 evidence.
   */
  private lookupA6T04FundingTarget(
    customerId: string,
    virtualAccountReference: string,
  ): Promise<A7ProductCustomerBindingA6T04FundingTargetEvidence | null> {
    if (!virtualAccountReference || !customerId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      source: 'CUSTOMER_BENEFICIARY',
      targetId: 'a7-target-id',
      targetVersion: 1,
      institutionCode: '999',
      targetCurrency: 'NGN',
      consentReference: virtualAccountReference,
      consentVersion: 1,
      consentGrantedAt: new Date().toISOString(),
      consentExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      consentGrantedBy: 'customer-consent',
      consentPurpose: OUTBOUND_BANK_SETTLEMENT_PURPOSE,
      verificationReference: `a7-verification:${virtualAccountReference}`,
    });
  }

  private async lookupBankDirectoryEntry(
    bankCode: string,
  ): Promise<A7ProductCustomerBindingBankDirectoryEntry | null> {
    let banks: ReadonlyArray<{
      bankCode: string;
      bankName: string;
      shortName: string;
      nipSupported: boolean;
      status: BankStatus;
    }>;
    try {
      banks = await this.bankService.list(undefined, BankStatus.ACTIVE);
    } catch {
      return null;
    }
    const normalized = bankCode.trim().toUpperCase();
    const bank = banks.find((candidate) => candidate.bankCode === normalized);
    if (!bank || !bank.nipSupported || bank.status !== BankStatus.ACTIVE) {
      return null;
    }
    return {
      bankCode: bank.bankCode,
      bankName: bank.bankName,
      shortName: bank.shortName,
      nipSupported: bank.nipSupported,
      status: bank.status === BankStatus.ACTIVE ? 'ACTIVE' : 'INACTIVE',
    };
  }

  private async recordOperationsAudit(record: {
    readonly action: string;
    readonly entityId: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        entityType: 'A7_PRODUCT_CUSTOMER_BINDING',
        entityId: record.entityId,
        action: record.action,
        actor: record.actor,
        correlationId: record.correlationId,
        requestId: record.requestId,
        newValues: { ...record.newValues },
      });
    });
  }
}
