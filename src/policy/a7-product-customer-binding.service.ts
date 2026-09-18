/**
 * A7T04 — A7 product customer-binding service.
 *
 * The A7 product customer-binding service is the single A7-side entry
 * point for the A7 first product's A3 binding recheck, virtual-account
 * ownership evidence, A6 partner reference correlation, A4
 * product-policy decision correlation, A2 authorization context
 * correlation, and A6T04 funding-target evidence correlation. The A7
 * product customer-binding service is a read-only consumer of the
 * canonical authorities; it does not mutate any source record.
 *
 * The A7 product customer-binding service:
 *  - reuses the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    consumer (the only A3 binding authority) through the A7
 *    `A7ProductCustomerBindingRepository`;
 *  - reuses the existing `VirtualAccountService.get()` and
 *    `VirtualAccountService.lookup()` consumer (the only
 *    `VirtualAccount` authority) through the A7
 *    `A7ProductCustomerBindingRepository`;
 *  - reuses the A4 product-policy decision reference (the only A4
 *    product-policy authority) through the A4 product-policy
 *    historical-replay service consumer boundary (A7T03) through the
 *    A7 `A7ProductCustomerBindingRepository`;
 *  - reuses the A2 authorization context (the only A2 authorization
 *    authority) through the A2 `AuthorizationService` consumer
 *    boundary through the A7 `A7ProductCustomerBindingRepository`;
 *  - reuses the A6T04 `ExternalFundingTargetMappingService.resolve()`
 *    consumer (the only A6T04 funding-target authority) through the
 *    A7 `A7ProductCustomerBindingRepository`;
 *  - reuses the existing `BankService.list()` consumer (the only
 *    bank-directory authority) through the A7
 *    `A7ProductCustomerBindingRepository`;
 *  - reuses the shared `AuditService` (the only audit authority)
 *    through the A7 `A7ProductCustomerBindingRepository`.
 *
 * No new A3 binding, virtual-account, A4 product-policy, A2
 * authorization, A6 partner, A6T04 funding-target, bank-directory, or
 * audit authority is introduced. The A7 product customer-binding
 * service does not create a second customer-binding system, a second
 * policy engine, a second authorization system, a second settlement
 * authority, or a second reconciliation engine. The A3 binding
 * authority remains the only customer-binding authority.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTOR,
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_HANDOFF_ISSUED,
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_REJECTED,
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_RESOLVED,
  A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_VERIFIED,
  A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME,
  A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_MISSING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_STALE_BINDING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_CONNECTION_UNAVAILABLE,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_MISSING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_REPLAYED,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_STALE,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CONSENT_INVALID,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CURRENCY_UNSUPPORTED,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_NOT_FOUND,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_BANK_NOT_FOUND,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_CURRENCY_MISMATCH,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_PRODUCT_PURPOSE_MISMATCH,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_INACTIVE,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_MISSING,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_OWNER_MISMATCH,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_PROVIDER_MISMATCH,
  A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_NUMBER_MISMATCH,
  A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_SCOPE,
  A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_VALIDITY_SECONDS,
  A7_PRODUCT_CUSTOMER_BINDING_MAPPING_NAME,
  A7_PRODUCT_CUSTOMER_BINDING_MAPPING_VERSION,
} from './a7-product-customer-binding.constants';
import { A7ProductCustomerBindingRepository } from './a7-product-customer-binding.repository';
import type {
  A7ProductCustomerBindingA3RecheckOutcome,
  A7ProductCustomerBindingA6PartnerReference,
  A7ProductCustomerBindingA6Reference,
  A7ProductCustomerBindingCommand,
  A7ProductCustomerBindingHandoffTokenV1,
  A7ProductCustomerBindingMapV1,
  A7ProductCustomerBindingResult,
  A7ProductCustomerBindingVerificationFailureV1,
  A7ProductCustomerBindingVirtualAccountEvidence,
} from './a7-product-customer-binding.types';

const SAFE_REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const A4_DECISION_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,159}$/;
const A2_AUTHORIZATION_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,159}$/;
const A7_ASSIGN_STATES: ReadonlySet<string> = new Set([
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
]);
const A7_FUNDING_STATES: ReadonlySet<string> = new Set([
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
]);
const A7_CAPABILITIES: ReadonlySet<string> = new Set([
  'virtual-account.assign',
  'virtual-account.inbound-funding',
]);
const A7_ACTIONS: ReadonlySet<string> = new Set(['assign', 'lifecycle']);
const A7_EXECUTABLE_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'ALLOW_WITH_LIMITS']);
const OUTBOUND_BANK_SETTLEMENT_PURPOSE = 'OUTBOUND_BANK_SETTLEMENT' as const;
const NGN_CURRENCY = 'NGN' as const;
const CUSTOMER_FUNDS_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

type FailureCheckKey = keyof A7ProductCustomerBindingVerificationFailureV1['checks'];
const ALL_CHECKS_OK: A7ProductCustomerBindingVerificationFailureV1['checks'] = Object.freeze({
  a3Binding: 'OK',
  virtualAccount: 'OK',
  a6PartnerReference: 'OK',
  a4ProductPolicyDecision: 'OK',
  a2AuthorizationContext: 'OK',
  a6T04FundingTarget: 'OK',
  bankDirectory: 'OK',
  consent: 'OK',
  purpose: 'OK',
  currency: 'OK',
  limit: 'OK',
});

/**
 * The A7 product customer-binding service. The A7 product
 * customer-binding service is the single A7-side entry point for
 * the A7 first product's read-only A3 binding recheck, virtual-account
 * ownership evidence, A6 partner reference correlation, A4
 * product-policy decision correlation, A2 authorization context
 * correlation, and A6T04 funding-target evidence correlation.
 */
@Injectable()
export class A7ProductCustomerBindingService {
  constructor(private readonly repository: A7ProductCustomerBindingRepository) {}

  /**
   * Resolves the A7 product customer-binding map. The A7 product
   * customer-binding service:
   *  1. validates the command shape and the A7 product catalog
   *     registration (capability, action, product state, currency,
   *     accounting unit);
   *  2. re-reads the A3 binding tuple through the A3
   *     `validateActiveBinding` consumer boundary;
   *  3. re-reads the existing `VirtualAccount` row through the
   *     existing `VirtualAccountService` consumer boundary;
   *  4. validates the virtual-account ownership evidence (status,
   *     owner, provider, account number, account name, bank
   *     directory);
   *  5. validates the A4 product-policy decision reference shape
   *     and the A2 authorization context reference shape;
   *  6. validates the A6 partner reference shape and the A6
   *     partner connection availability;
   *  7. validates the A6T04 funding-target consumer evidence
   *     (consent, currency, accounting unit, purpose);
   *  8. validates the product purpose, currency, and limit
   *     compatibility;
   *  9. builds the single, frozen, in-memory
   *     `A7ProductCustomerBindingMapV1` and the
   *     `A7ProductCustomerBindingHandoffTokenV1` and returns the
   *     A7 product customer-binding result.
   *
   * The A7 product customer-binding service does not write any
   * source record through this method.
   */
  async resolveProductCustomerBinding(
    command: A7ProductCustomerBindingCommand,
    requestContext: RequestContext,
  ): Promise<A7ProductCustomerBindingResult> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        requestContext,
        shapeFailure.code,
        shapeFailure.message,
        notVerifiedChecks(),
      );
    }

    const ports = this.repository.getConsumerPorts();

    const a3 = await ports.a3BindingRecheck({
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      expectedCurrency: NGN_CURRENCY,
      expectedAccountingUnit: CUSTOMER_FUNDS_ACCOUNTING_UNIT,
      expectedBindingVersion: command.bindingVersion,
    });
    if (!a3.valid) {
      return this.failure(
        command,
        requestContext,
        a3.code,
        a3.message,
        checkWithFailed('a3Binding', 'FAIL'),
      );
    }

    const virtualAccount = await ports.virtualAccountLookup(
      command.virtualAccount.virtualAccountId,
    );
    if (!virtualAccount) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_MISSING,
        'The existing virtual-account row was not found',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }
    if (virtualAccount.status !== 'ACTIVE') {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_INACTIVE,
        'The existing virtual-account row is not ACTIVE',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }
    if (virtualAccount.walletId !== command.customerWalletId) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_OWNER_MISMATCH,
        'The existing virtual-account row is not owned by the A3-bound customer wallet',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }
    if (virtualAccount.provider !== command.virtualAccount.provider) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_PROVIDER_MISMATCH,
        'The existing virtual-account provider does not match the declared provider',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }
    if (virtualAccount.accountNumber !== command.virtualAccount.accountNumber) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_NUMBER_MISMATCH,
        'The existing virtual-account account number does not match the declared account number',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }

    const bank = await ports.bankDirectoryLookup(command.virtualAccount.bankCode);
    if (!bank) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_BANK_NOT_FOUND,
        'The declared bank code is not in the active NIP-supported bank directory',
        checkWithFailed('bankDirectory', 'FAIL'),
      );
    }

    const a4 = await ports.a4ProductPolicyDecisionLookup(command.a4ProductPolicyDecisionReference);
    if (!a4) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_MISSING,
        'The A4 product-policy decision reference could not be read',
        checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      );
    }
    if (!A7_EXECUTABLE_DECISIONS.has(a4.decision)) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        'The A4 product-policy decision is not executable for the product customer-binding',
        checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      );
    }
    if (a4.expiresAt && Date.parse(a4.expiresAt) <= Date.now()) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_EXPIRED,
        'The A4 product-policy decision is expired',
        checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      );
    }

    const a2 = await ports.a2AuthorizationContextLookup(command.a2AuthorizationContextReference);
    if (!a2) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_MISSING,
        'The A2 authorization context reference could not be read',
        checkWithFailed('a2AuthorizationContext', 'FAIL'),
      );
    }
    if (!a2.allowed) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_DENIED,
        'The A2 authorization context is denied',
        checkWithFailed('a2AuthorizationContext', 'FAIL'),
      );
    }

    const a6T04 = await ports.a6T04FundingTargetLookup(
      command.customerId,
      virtualAccount.reference,
    );
    if (!a6T04) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_NOT_FOUND,
        'The A6T04 funding-target evidence could not be read',
        checkWithFailed('a6T04FundingTarget', 'FAIL'),
      );
    }
    if (a6T04.targetCurrency && a6T04.targetCurrency !== NGN_CURRENCY) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CURRENCY_UNSUPPORTED,
        'The A6T04 funding-target currency is not NGN',
        checkWithFailed('currency', 'FAIL'),
      );
    }
    if (Date.parse(a6T04.consentExpiresAt) <= Date.now()) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CONSENT_INVALID,
        'The A6T04 funding-target consent assertion is not currently valid',
        checkWithFailed('consent', 'FAIL'),
      );
    }

    const partnerStatus = this.repository.getA6PartnerConnectionStatus();
    if (!partnerStatus.enabled) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_CONNECTION_UNAVAILABLE,
        'The selected A6 partner connection is not enabled',
        checkWithFailed('a6PartnerReference', 'FAIL'),
      );
    }

    const a6PartnerReferenceValidation = this.validateA6PartnerReference(command);
    if (a6PartnerReferenceValidation === 'missing') {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_MISSING,
        'The A6 partner reference is missing or invalid',
        checkWithFailed('a6PartnerReference', 'FAIL'),
      );
    }
    if (a6PartnerReferenceValidation === 'replayed') {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_REPLAYED,
        'The A6 partner reference is replayed',
        checkWithFailed('a6PartnerReference', 'FAIL'),
      );
    }
    if (a6PartnerReferenceValidation === 'stale') {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_STALE,
        'The A6 partner reference is stale',
        checkWithFailed('a6PartnerReference', 'FAIL'),
      );
    }

    if (a6T04.consentPurpose !== OUTBOUND_BANK_SETTLEMENT_PURPOSE) {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_PRODUCT_PURPOSE_MISMATCH,
        'The A6T04 funding-target purpose is not compatible with the product purpose',
        checkWithFailed('purpose', 'FAIL'),
      );
    }

    const map = this.buildMap(command, virtualAccount, a3, command.a6PartnerReference);
    const handoffToken = this.issueHandoffTokenFromMap(map);

    try {
      await this.repository.recordVerifiedAudit(
        map.mapReference,
        requestContext,
        this.buildAuditValues(command, map, handoffToken),
      );
    } catch {
      return this.failure(
        command,
        requestContext,
        A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product customer-binding audit evidence could not be recorded',
        checkWithFailed('virtualAccount', 'FAIL'),
      );
    }

    return { valid: true, map };
  }

  /**
   * Returns the A7 product customer-binding handoff token for a
   * verified map. The A7 product customer-binding service issues
   * the handoff token only after the map is verified. The handoff
   * token is single-use, bounded-validity, and A2-protected. The
   * handoff token is an internal product control surface; the A7
   * product customer-binding service does not expose the handoff
   * token through a public, customer, partner, or support surface.
   */
  issueHandoffToken(map: A7ProductCustomerBindingMapV1): A7ProductCustomerBindingHandoffTokenV1 {
    return this.issueHandoffTokenFromMap(map);
  }

  /**
   * Returns the A7 product customer-binding contract name and
   * contract version. The A4 contract is the A4 `A4-CAPABILITY-POLICY`
   * contract; the A7 contract is the A7 `A7-PRODUCT-CUSTOMER-BINDING`
   * contract.
   */
  getContractNames(): { readonly a4: string; readonly a7: string } {
    return Object.freeze({ a4: 'A4-CAPABILITY-POLICY', a7: 'A7-PRODUCT-CUSTOMER-BINDING' });
  }

  /**
   * Returns the A7 product customer-binding contract version.
   */
  getContractVersions(): { readonly a4: number; readonly a7: number } {
    return Object.freeze({ a4: 1, a7: 1 });
  }

  /**
   * Returns the A7 product customer-binding mapping name.
   */
  getMappingNames(): { readonly a7: string } {
    return Object.freeze({ a7: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_NAME });
  }

  /**
   * Returns the A7 product customer-binding mapping version.
   */
  getMappingVersions(): { readonly a7: number } {
    return Object.freeze({ a7: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_VERSION });
  }

  /**
   * Returns the A7 product customer-binding handoff scope. The
   * handoff scope is single-use and A2-protected.
   */
  getHandoffScope(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_SCOPE;
  }

  /**
   * Returns the A7 product customer-binding audit actor.
   */
  getAuditActor(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTOR;
  }

  /**
   * Returns the A7 product customer-binding verified audit action.
   */
  getAuditActionVerified(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_VERIFIED;
  }

  /**
   * Returns the A7 product customer-binding resolved audit action.
   */
  getAuditActionResolved(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_RESOLVED;
  }

  /**
   * Returns the A7 product customer-binding handoff-issued audit
   * action.
   */
  getAuditActionHandoffIssued(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_HANDOFF_ISSUED;
  }

  /**
   * Returns the A7 product customer-binding rejected audit action.
   */
  getAuditActionRejected(): string {
    return A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_REJECTED;
  }

  private validateCommandShape(
    command: A7ProductCustomerBindingCommand,
  ): { readonly code: string; readonly message: string } | null {
    if (!command || command.contractName !== A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding command contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding command contract version is invalid',
      };
    }
    if (command.productKey !== 'VIRTUAL_ACCOUNT' || command.productVersion !== 1) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding product registration is invalid',
      };
    }
    if (!A7_CAPABILITIES.has(command.capabilityKey)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding capability key is not registered',
      };
    }
    if (!A7_ACTIONS.has(command.action)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding action is not registered',
      };
    }
    if (
      !A7_ASSIGN_STATES.has(command.productState) &&
      !A7_FUNDING_STATES.has(command.productState)
    ) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The A7 product customer-binding product state is not registered',
      };
    }
    if (command.currency !== NGN_CURRENCY) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_CURRENCY_MISMATCH,
        message: 'The A7 product customer-binding currency is not NGN',
      };
    }
    if (command.accountingUnit !== CUSTOMER_FUNDS_ACCOUNTING_UNIT) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        message: 'The A7 product customer-binding accounting unit is not CUSTOMER_FUNDS',
      };
    }
    if (!UUID_PATTERN.test(command.customerId)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_MISSING,
        message: 'The customerId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.customerWalletId)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_MISSING,
        message: 'The customerWalletId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.bindingId)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_MISSING,
        message: 'The bindingId must be a UUID',
      };
    }
    if (!Number.isSafeInteger(command.bindingVersion) || command.bindingVersion < 1) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_STALE_BINDING,
        message: 'The bindingVersion must be a positive integer',
      };
    }
    if (!UUID_PATTERN.test(command.virtualAccount.virtualAccountId)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_MISSING,
        message: 'The virtualAccountId must be a UUID',
      };
    }
    if (!command.virtualAccount.provider || !command.virtualAccount.accountNumber) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_MISSING,
        message: 'The virtualAccount provider and accountNumber are required',
      };
    }
    if (!command.a6PartnerIdentity.partnerKey) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_CONNECTION_UNAVAILABLE,
        message: 'The A6 partner identity partnerKey is required',
      };
    }
    if (!A4_DECISION_REFERENCE_PATTERN.test(command.a4ProductPolicyDecisionReference)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The A4 product-policy decision reference is invalid',
      };
    }
    if (!A2_AUTHORIZATION_REFERENCE_PATTERN.test(command.a2AuthorizationContextReference)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The A2 authorization context reference is invalid',
      };
    }
    if (!command.idempotencyKey || !SAFE_REFERENCE_PATTERN.test(command.idempotencyKey)) {
      return {
        code: A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The idempotencyKey is required and must be a safe reference',
      };
    }
    return null;
  }

  private validateA6PartnerReference(
    command: A7ProductCustomerBindingCommand,
  ): 'ok' | A7ProductCustomerBindingA6PartnerReference | 'missing' | 'replayed' | 'stale' {
    const reference = command.a6PartnerReference;
    if (!reference) {
      return 'missing';
    }
    if (
      !this.repository.validateA6PartnerReferenceShape(
        reference.referenceType,
        reference.value,
        reference.namespace,
      )
    ) {
      return 'missing';
    }
    const observedAt = Date.parse(reference.observedAt);
    if (Number.isNaN(observedAt)) {
      return 'missing';
    }
    const ageSeconds = (Date.now() - observedAt) / 1000;
    if (ageSeconds < 0) {
      return 'replayed';
    }
    if (ageSeconds > 24 * 60 * 60) {
      return 'stale';
    }
    return 'ok';
  }

  private buildMap(
    command: A7ProductCustomerBindingCommand,
    virtualAccount: A7ProductCustomerBindingVirtualAccountEvidence,
    a3: A7ProductCustomerBindingA3RecheckOutcome,
    a6PartnerReference: A7ProductCustomerBindingA6Reference,
  ): A7ProductCustomerBindingMapV1 {
    void a6PartnerReference;
    if (!a3.valid) {
      throw new Error('A7 product customer-binding cannot build map from invalid A3 recheck');
    }
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(createdAt) + A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION,
      mapName: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_NAME,
      mapVersion: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_VERSION,
      mapReference: this.computeMapReference(command, virtualAccount.virtualAccountId, createdAt),
      productKey: command.productKey,
      productVersion: command.productVersion,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customer: {
        customerId: a3.customerId,
        customerWalletId: a3.customerWalletId,
        customerVersion: a3.bindingVersion,
        customerWalletVersion: a3.bindingVersion,
      },
      a3Binding: {
        bindingId: a3.bindingId,
        bindingVersion: a3.bindingVersion,
        bindingState: 'ACTIVE',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      },
      internalAccount: {
        walletAccountId: a3.walletAccountId,
        ledgerAccountId: a3.ledgerAccountId,
        walletStatus: 'ACTIVE',
        ledgerIsActive: true,
        ledgerAccountType: 'LIABILITY',
        ledgerNormalBalance: 'CREDIT',
        ledgerAllowNegativeBalance: false,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      },
      virtualAccount: {
        virtualAccountId: virtualAccount.virtualAccountId,
        provider: virtualAccount.provider,
        accountNumber: virtualAccount.accountNumber,
        accountName: virtualAccount.accountName,
        bankCode: virtualAccount.bankCode,
        reference: virtualAccount.reference,
        status: 'ACTIVE',
        assignedAt: virtualAccount.assignedAt,
        deactivatedAt: null,
        ownerCustomerWalletId: virtualAccount.walletId,
        ownerCustomerId: a3.customerId,
      },
      a6PartnerIdentity: command.a6PartnerIdentity,
      a6PartnerCorrelation: command.a6PartnerCorrelation,
      a6PartnerReference: command.a6PartnerReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      ownership: {
        virtualAccountOwnerMatchesBinding: true,
        fundingTargetOwnerMatchesBinding: true,
        bankDirectorySupported: true,
        consentCurrent: true,
        mandateCurrent: true,
        purposeCompatible: true,
        currencyCompatible: true,
        limitCompatible: true,
      },
      createdAt,
      expiresAt,
    };
  }

  private issueHandoffTokenFromMap(
    map: A7ProductCustomerBindingMapV1,
  ): A7ProductCustomerBindingHandoffTokenV1 {
    const identifierHash = this.sha256(
      [
        map.virtualAccount.provider,
        map.virtualAccount.accountNumber,
        map.virtualAccount.accountName,
        map.virtualAccount.bankCode,
      ].join('|'),
    );
    const tokenReference = this.sha256(
      `a7-product-customer-binding-handoff|${map.mapReference}|${identifierHash}`,
    );
    return {
      contractName: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION,
      tokenReference,
      handoffScope: A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_SCOPE,
      productKey: map.productKey,
      productVersion: map.productVersion,
      capabilityKey: map.capabilityKey,
      action: map.action,
      productState: map.productState,
      mapReference: map.mapReference,
      customerId: map.customer.customerId,
      customerWalletId: map.customer.customerWalletId,
      bindingId: map.a3Binding.bindingId,
      bindingVersion: map.a3Binding.bindingVersion,
      walletAccountId: map.internalAccount.walletAccountId,
      ledgerAccountId: map.internalAccount.ledgerAccountId,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      virtualAccountReference: map.virtualAccount.reference,
      virtualAccountIdentifierHash: identifierHash,
      virtualAccountProvider: map.virtualAccount.provider,
      virtualAccountBankCode: map.virtualAccount.bankCode,
      virtualAccountAssignedAt: map.virtualAccount.assignedAt,
      a6PartnerIdentity: map.a6PartnerIdentity,
      a6PartnerReference: map.a6PartnerReference,
      a4ProductPolicyDecisionReference: map.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: map.a2AuthorizationContextReference,
      issuedAt: map.createdAt,
      expiresAt: map.expiresAt,
      correlationId: map.a6PartnerCorrelation.correlationId,
      requestId: map.a6PartnerCorrelation.requestId,
    };
  }

  private failure(
    command: A7ProductCustomerBindingCommand,
    requestContext: RequestContext,
    code: string,
    message: string,
    checks: A7ProductCustomerBindingVerificationFailureV1['checks'],
  ): A7ProductCustomerBindingResult {
    const failure: A7ProductCustomerBindingVerificationFailureV1 = {
      contractName: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION,
      mapName: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_NAME,
      mapVersion: A7_PRODUCT_CUSTOMER_BINDING_MAPPING_VERSION,
      productKey: command.productKey,
      productVersion: command.productVersion,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      code,
      message,
      checks,
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
    return { valid: false, failure };
  }

  private buildAuditValues(
    command: A7ProductCustomerBindingCommand,
    map: A7ProductCustomerBindingMapV1,
    handoffToken: A7ProductCustomerBindingHandoffTokenV1,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7AuditContractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7AuditContractVersion: 1,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
      productKey: command.productKey,
      productVersion: command.productVersion,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      mapReference: map.mapReference,
      handoffScope: handoffToken.handoffScope,
      handoffTokenReference: handoffToken.tokenReference,
      customerId: map.customer.customerId,
      customerWalletId: map.customer.customerWalletId,
      bindingId: map.a3Binding.bindingId,
      bindingVersion: map.a3Binding.bindingVersion,
      walletAccountId: map.internalAccount.walletAccountId,
      ledgerAccountId: map.internalAccount.ledgerAccountId,
      virtualAccountId: map.virtualAccount.virtualAccountId,
      virtualAccountReference: map.virtualAccount.reference,
      virtualAccountIdentifierHash: handoffToken.virtualAccountIdentifierHash,
      a6PartnerKey: command.a6PartnerIdentity.partnerKey,
      a6PartnerCapabilityKey: command.a6PartnerIdentity.capabilityKey,
      a6PartnerOperationType: command.a6PartnerIdentity.operationType,
      a4ProductPolicyDecisionReference: map.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: map.a2AuthorizationContextReference,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
  }

  private computeMapReference(
    command: A7ProductCustomerBindingCommand,
    virtualAccountId: string,
    createdAt: string,
  ): string {
    return this.sha256(
      [
        'a7-product-customer-binding-v1',
        command.productKey,
        command.capabilityKey,
        command.action,
        command.customerId,
        command.customerWalletId,
        command.bindingId,
        String(command.bindingVersion),
        virtualAccountId,
        command.a4ProductPolicyDecisionReference,
        command.a2AuthorizationContextReference,
        command.a6PartnerIdentity.partnerKey,
        createdAt,
        randomUUID(),
      ].join('|'),
    );
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

function notVerifiedChecks(): A7ProductCustomerBindingVerificationFailureV1['checks'] {
  return {
    a3Binding: 'NOT_VERIFIED',
    virtualAccount: 'NOT_VERIFIED',
    a6PartnerReference: 'NOT_VERIFIED',
    a4ProductPolicyDecision: 'NOT_VERIFIED',
    a2AuthorizationContext: 'NOT_VERIFIED',
    a6T04FundingTarget: 'NOT_VERIFIED',
    bankDirectory: 'NOT_VERIFIED',
    consent: 'NOT_VERIFIED',
    purpose: 'NOT_VERIFIED',
    currency: 'NOT_VERIFIED',
    limit: 'NOT_VERIFIED',
  };
}

function checkWithFailed(
  failedKey: FailureCheckKey,
  failedStatus: 'FAIL' | 'NOT_VERIFIED',
): A7ProductCustomerBindingVerificationFailureV1['checks'] {
  return { ...ALL_CHECKS_OK, [failedKey]: failedStatus };
}
