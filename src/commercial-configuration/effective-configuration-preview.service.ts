import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CommissionRuleResolverService } from '../commission/commission-rule-resolver.service';
import type { CommissionResolution } from '../commission/commission-rule-resolver.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import type { FeeRuleResolution } from '../fee-rules/fee-rule-resolver.service';
import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { InstitutionKycLimitPolicyService } from '../limit-catalog/institution-kyc-limit-policy.service';
import {
  fetchApplicableLimitRuleCandidates,
  narrowApplicableLimitRules,
} from '../limit-catalog/limit-rule-applicability';
import { LimitProfileResolverService } from '../limit-catalog/limit-profile-resolver.service';
import { ProductCatalogService } from '../product-catalog/product-catalog.service';
import { RewardRuleResolverService } from '../reward/reward-rule-resolver.service';
import type { RewardGrantDecision, RewardResolution } from '../reward/reward.types';

import {
  PREVIEW_DISCLAIMER,
  type EffectiveConfigurationPreview,
  type PreviewCustomerClassSection,
  type PreviewExplanation,
  type PreviewFeeSection,
  type PreviewKycRestriction,
  type PreviewLimitRule,
  type PreviewLimitSection,
  type PreviewRestrictedSection,
} from './effective-configuration-preview.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT = /^[A-Z0-9_]{2,80}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface EffectiveConfigurationPreviewQuery {
  productCode?: string;
  currency?: string;
  principalType?: string;
  principalId?: string;
  agentClassId?: string;
  segmentCodes?: string | string[];
  institutionId?: string;
  direction?: string;
  channel?: string;
  amountMinor?: string;
  serviceClass?: string;
  at?: string;
}

/** Internal carrier: the published section plus the code the rest of the preview consumes. */
interface CustomerClassOutcome {
  section: PreviewCustomerClassSection | PreviewRestrictedSection;
  /** Non-null only for a RESOLVED customer class; never inferred. */
  classCode: string | null;
}

/**
 * Which catalogue read function governs each preview section.
 *
 * WHY `limit.view` ALONE MUST NOT GOVERN THE WHOLE PREVIEW
 *   Previously holding `limit.view` was enough to read fee, commission, reward, product,
 *   customer-class and KYC evidence through this route — data each owning registry only exposes
 *   behind `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`,
 *   `institution.view`, `customer.view` and `kyc.view`. A preview that composes those resolvers
 *   must not become a broader read path than the surfaces it summarizes. AGENT_NETWORK_MANAGER,
 *   which holds `limit.view` and none of the others, is the concrete case this protects.
 *
 *   Every function below is an EXISTING catalogue function with existing grants; nothing new is
 *   introduced. `limit.view` remains the route-level gate, so a caller with no limit visibility
 *   cannot reach the route at all.
 */
const SECTION_FUNCTIONS = {
  product: 'product.view',
  institution: 'institution.view',
  customerClass: 'customer.view',
  kyc: 'kyc.view',
  fee: 'fee_rule.view',
  commission: 'commission_rule.view',
  reward: 'reward_rule.view',
} as const;

/**
 * Deliberately says nothing about the configuration itself — not whether rules exist, how many,
 * at what priority, or for which target. Withholding values while revealing presence would still
 * leak the commercial intelligence a missing read function exists to protect.
 */
function restricted(functionCode: string, section: string): PreviewRestrictedSection {
  return {
    status: 'RESTRICTED',
    requiredFunction: functionCode,
    note: `This section was not evaluated: reading effective ${section} configuration requires the ${functionCode} function, which this session does not hold. Nothing about this configuration was disclosed.`,
  };
}

/**
 * Arena 3 Phase 3 — READ-ONLY effective-configuration preview.
 *
 * Composes the *existing* resolvers into one explanation of what would govern a hypothetical
 * operation. It is deliberately a composition and not an engine:
 *
 *  - product      → ProductCatalogService.getProduct
 *  - KYC          → CustomerFinancialEligibilityService.require (trusted gate, inside one tx)
 *  - tier policy  → InstitutionKycLimitPolicyService.resolveWithManager
 *  - limits       → LimitProfileResolverService.resolve + the SHARED selection helpers
 *                   (limit-rule-applicability.ts) so preview and enforcement cannot diverge
 *  - fee          → FeeRuleResolverService.resolve + FeeRuleCalculatorService.compute
 *  - commission   → CommissionRuleResolverService.resolveWithManager
 *  - reward       → RewardRuleResolverService.resolveWithManager
 *  - customer cls → not available here → NOT_APPLICABLE, no inference
 *
 * GUARANTEES
 *  - One REPEATABLE READ READ ONLY transaction. There is no write path in this service.
 *  - `LimitEnforcementService.enforceWithManager` is never called: it reserves usage. Only the
 *    pure selection helpers are shared with it.
 *  - The fee calculator is invoked for its pure arithmetic and explicitly reports
 *    `postsJournalLegs: false`; commission/reward report `accrualPosted`/`creditPosted: false`.
 *  - A missing section is reported, never thrown, and never rendered as "unlimited".
 */
@Injectable()
export class EffectiveConfigurationPreviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly products: ProductCatalogService,
    private readonly profileResolver: LimitProfileResolverService,
    private readonly tierPolicies: InstitutionKycLimitPolicyService,
    private readonly customerEligibility: CustomerFinancialEligibilityService,
    private readonly feeResolver: FeeRuleResolverService,
    private readonly feeCalculator: FeeRuleCalculatorService,
    private readonly commissionResolver: CommissionRuleResolverService,
    private readonly rewardResolver: RewardRuleResolverService,
    private readonly customerClasses: CustomerClassResolverService,
  ) {}

  async preview(
    principal: AuthorizationPrincipal,
    input: EffectiveConfigurationPreviewQuery,
  ): Promise<EffectiveConfigurationPreview> {
    const productCode = this.requirePattern(input.productCode, PRODUCT, 'productCode');
    const currency = this.requirePattern(
      (input.currency ?? 'NGN').toUpperCase(),
      CURRENCY,
      'currency',
    );
    const principalType = (input.principalType ?? 'CUSTOMER').toUpperCase();
    if (principalType !== 'CUSTOMER' && principalType !== 'AGENT')
      throw new BadRequestException('principalType must be CUSTOMER or AGENT');
    const direction = (input.direction ?? 'OUTGOING').toUpperCase();
    if (direction !== 'INCOMING' && direction !== 'OUTGOING')
      throw new BadRequestException('direction must be INCOMING or OUTGOING');

    const principalId = this.optionalUuid(input.principalId, 'principalId');
    const agentClassId = this.optionalUuid(input.agentClassId, 'agentClassId');
    const institutionId = this.optionalUuid(input.institutionId, 'institutionId');
    const amountMinor = this.optionalAmount(input.amountMinor);
    const channel = input.channel?.trim() || null;
    const serviceClass = input.serviceClass?.trim() || null;
    const segmentCodes = this.segmentCodes(input.segmentCodes);
    const evaluatedAt = this.instant(input.at);
    const previewedAt = new Date();

    // Which sections this caller may read. Evaluated BEFORE any section is composed, so a
    // withheld section is never resolved at all — no query, no timing difference, no inference
    // from how long the response took.
    const held = this.functionsHeldBy(principal);
    const may = (functionCode: string): boolean => held.has(functionCode);

    const explanation: PreviewExplanation[] = [];

    // The product is the only hard prerequisite, and only for a caller entitled to see it.
    // A caller without `product.view` must not be able to probe which product codes exist, so a
    // non-existent product is reported as RESTRICTED rather than 404 for a withheld caller.
    let product: EffectiveConfigurationPreview['product'] = null;
    let productRestricted: PreviewRestrictedSection | null = null;
    if (may(SECTION_FUNCTIONS.product)) {
      product = this.toPreviewProduct(await this.products.getProduct(productCode));
    } else {
      productRestricted = restricted(SECTION_FUNCTIONS.product, 'product');
      explanation.push(
        withheld('PREVIEW_SECTION_RESTRICTED', 'product', SECTION_FUNCTIONS.product),
      );
    }

    let institution: EffectiveConfigurationPreview['institution'] = null;
    let institutionRestricted: PreviewRestrictedSection | null = null;
    if (institutionId !== null) {
      if (may(SECTION_FUNCTIONS.institution)) {
        institution = await this.institution(institutionId);
      } else {
        institutionRestricted = restricted(SECTION_FUNCTIONS.institution, 'institution');
        explanation.push(
          withheld('PREVIEW_SECTION_RESTRICTED', 'institution', SECTION_FUNCTIONS.institution),
        );
      }
    }

    /*
     * Advisory read. `READ ONLY` here is a DATABASE-LEVEL guarantee, not a convention: PostgreSQL
     * rejects any INSERT/UPDATE/DELETE/TRUNCATE/DDL in this transaction with `read_only_sql_transaction`,
     * so a future edit to any composed resolver cannot start writing from the preview. The mode is
     * asserted back out through `guarantees.databaseTransactionReadOnly`.
     */
    const result = await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const readOnlyRows: Array<{ transaction_read_only: string }> = await manager.query(
        'SHOW transaction_read_only',
      );
      const transactionReadOnly = readOnlyRows[0]?.transaction_read_only === 'on';

      const customerClass = await this.customerClassSection({
        manager,
        mayRead: may(SECTION_FUNCTIONS.customerClass),
        principalType,
        principalId,
        evaluatedAt,
        explanation,
      });

      const kyc = await this.kycRestriction({
        manager,
        enabled: may(SECTION_FUNCTIONS.kyc),
        principalType,
        principalId,
        institutionId,
        institutionVisible: institutionRestricted === null,
        productCode,
        currency,
        serviceClass,
        evaluatedAt,
        explanation,
      });

      const limits = await this.limitSection({
        manager,
        principalType,
        principalId,
        agentClassId,
        segmentCodes: this.withClassSegment(segmentCodes, customerClass),
        institutionId,
        productCode,
        currency,
        direction,
        channel,
        evaluatedAt,
        tierProfileCode: kyc.tierProfileCode,
        tierPolicyVersion: kyc.tierPolicyVersion,
        tierEnforcementActivationEnabled: kyc.tierEnforcementActivationEnabled,
        explanation,
      });

      const fee = await this.feeSection({
        manager,
        enabled: may(SECTION_FUNCTIONS.fee),
        productCode,
        currency,
        amountMinor,
        evaluatedAt,
        customerClassCode: customerClass.classCode,
        agentClassId,
        institutionId,
        explanation,
      });

      const commission = await this.commissionSection({
        manager,
        enabled: may(SECTION_FUNCTIONS.commission),
        productCode,
        currency,
        amountMinor,
        evaluatedAt,
        principalType,
        principalId,
        agentClassId,
        feeMinor: fee.feeMinor,
        explanation,
      });

      const reward = await this.rewardSection({
        manager,
        enabled: may(SECTION_FUNCTIONS.reward),
        productCode,
        currency,
        amountMinor,
        evaluatedAt,
        principalType,
        principalId,
        agentClassId,
        kycLevel: kyc.kycLevel,
        feeMinor: fee.feeMinor,
        explanation,
      });

      return { customerClass, kyc, limits, fee, commission, reward, transactionReadOnly };
    });

    if (principalId === null)
      explanation.push(
        info(
          'PREVIEW_PRINCIPAL_NOT_PROVIDED',
          'No principal was supplied, so limit profiles and customer-scoped eligibility could not be resolved. Supply a principalId to preview that customer or agent.',
        ),
      );

    const ordered = sortExplanation(explanation);

    return {
      previewedAt: previewedAt.toISOString(),
      authoritative: 'BACKEND_RESOLVERS',
      mode: 'ADVISORY',
      disclaimer: PREVIEW_DISCLAIMER,
      request: {
        productCode,
        currency,
        principalType,
        principalId,
        agentClassId,
        segmentCodes,
        institutionId,
        direction,
        channel,
        amountMinor,
        serviceClass,
        evaluatedAt: evaluatedAt.toISOString(),
      },
      product,
      productRestricted,
      institution,
      institutionRestricted,
      customerClass: result.customerClass.section,
      kycRestriction: result.kyc.section,
      limits: result.limits,
      fee: result.fee.section,
      commission: result.commission,
      reward: result.reward,
      explanation: ordered,
      summary: {
        sections: {
          limits: result.limits.status,
          fee: result.fee.section.status,
          commission: result.commission.status,
          reward: result.reward.status,
        },
        blockerCount: ordered.filter((item) => item.severity === 'BLOCKER').length,
        warningCount: ordered.filter((item) => item.severity === 'WARNING').length,
      },
      guarantees: {
        readonly: true,
        writesPerformed: [],
        financialMutations: [],
        databaseTransactionReadOnly: result.transactionReadOnly,
      },
    };
  }

  /** Every catalogue function the principal actually holds. Scopes ARE the function grants. */
  private functionsHeldBy(principal: AuthorizationPrincipal): Set<string> {
    const scopes: unknown = principal.scopes;
    const held: string[] = Array.isArray(scopes)
      ? scopes.filter((scope): scope is string => typeof scope === 'string')
      : [];
    return new Set(held);
  }

  private toPreviewProduct(product: {
    code: string;
    name: string;
    domain: string;
    currency: string;
    productScope: string;
    status: string;
    enabled: boolean;
    configurationStatus: string;
    version: number;
  }): NonNullable<EffectiveConfigurationPreview['product']> {
    return {
      code: product.code,
      name: product.name,
      domain: product.domain,
      currency: product.currency,
      productScope: product.productScope,
      status: product.status,
      enabled: product.enabled,
      configurationStatus: product.configurationStatus,
      version: product.version,
    };
  }

  /**
   * The resolved class code joins the caller-supplied segment codes for limit SEGMENT targeting.
   *
   * This is the consumption pattern Arena 1's contract prescribes (`segmentCodes: [classCode]`).
   * A resolved class is ADDITIVE: it can select a segment assignment the caller did not name, and
   * it can never remove one. A caller-supplied `segmentCodes` value is still honoured because some
   * segment assignments are not customer-class based.
   */
  private withClassSegment(supplied: string[], resolved: CustomerClassOutcome): string[] {
    if (resolved.classCode === null) return supplied;
    return [...new Set([...supplied, resolved.classCode])];
  }

  // ───────────────────────────────────────────────────────────────── customer class

  /**
   * Arena 1 customer-class resolution through the canonical `CustomerClassResolverService`.
   *
   * The previous implementation returned a hardcoded `NOT_APPLICABLE` because no class contract
   * existed. It exists now, so the section resolves. Nothing is ever inferred: a customer with no
   * usable class resolves to `MISSING` (an explicit "no class assigned" state), never to a class
   * guessed from KYC tier, segment code or agent class.
   */
  private async customerClassSection(input: {
    manager: EntityManager;
    mayRead: boolean;
    principalType: string;
    principalId: string | null;
    evaluatedAt: Date;
    explanation: PreviewExplanation[];
  }): Promise<CustomerClassOutcome> {
    const withheldSection: PreviewRestrictedSection = restricted(
      SECTION_FUNCTIONS.customerClass,
      'customer-class',
    );
    if (!input.mayRead) {
      input.explanation.push(
        withheld('PREVIEW_SECTION_RESTRICTED', 'customer-class', SECTION_FUNCTIONS.customerClass),
      );
      return { section: withheldSection, classCode: null };
    }
    if (input.principalType !== 'CUSTOMER' || input.principalId === null) {
      return {
        section: {
          status: 'NOT_APPLICABLE',
          note: 'Customer class applies to customer principals. No customer principal was supplied, so no class resolution was attempted and no class was inferred.',
          effective: null,
        },
        classCode: null,
      };
    }
    const effective = await this.customerClasses.resolveInManager(
      input.manager,
      input.principalId,
      input.evaluatedAt,
    );
    if (!effective) {
      return {
        section: {
          status: 'MISSING',
          note: 'This customer has no usable class of service at the evaluated instant (no live assignment, or the assigned class is disabled, deprecated or unconfigured). No class was inferred from KYC tier, segment code or agent class.',
          effective: null,
        },
        classCode: null,
      };
    }
    return {
      section: {
        status: 'RESOLVED',
        note: null,
        effective: {
          classCode: effective.classCode,
          assignmentId: effective.assignmentId,
          classId: effective.classId,
          className: effective.className,
          assignmentVersion: effective.assignmentVersion,
          classVersion: effective.classVersion,
          source: effective.source,
          effectiveFrom: effective.effectiveFrom.toISOString(),
          effectiveTo: effective.effectiveTo === null ? null : effective.effectiveTo.toISOString(),
        },
      },
      classCode: effective.classCode,
    };
  }

  // ─────────────────────────────────────────────────────────────── KYC & tier restrictions

  private async kycRestriction(input: {
    manager: EntityManager;
    enabled: boolean;
    principalType: string;
    principalId: string | null;
    institutionId: string | null;
    /** False when the caller may not read institution data; no institution policy is then loaded. */
    institutionVisible: boolean;
    productCode: string;
    currency: string;
    serviceClass: string | null;
    evaluatedAt: Date;
    explanation: PreviewExplanation[];
  }): Promise<{
    section: PreviewKycRestriction;
    kycLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null;
    tierProfileCode: string | null;
    tierPolicyVersion: number | null;
    tierEnforcementActivationEnabled: boolean;
  }> {
    if (!input.enabled) {
      input.explanation.push(
        withheld('PREVIEW_SECTION_RESTRICTED', 'KYC eligibility', SECTION_FUNCTIONS.kyc),
      );
      return {
        section: restricted(SECTION_FUNCTIONS.kyc, 'KYC eligibility'),
        kycLevel: null,
        tierProfileCode: null,
        tierPolicyVersion: null,
        tierEnforcementActivationEnabled: false,
      };
    }

    const activationEnabled = this.tierPolicies.enforcementEnabled;
    const section: {
      kycLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null;
      tierEnforcementActivationEnabled: boolean;
      tierMapping: {
        policyVersion: number;
        disposition: string;
        profileCode: string | null;
        profileDigest: string | null;
        serviceClass: string | null;
      } | null;
      note: string | null;
    } = {
      kycLevel: null,
      tierEnforcementActivationEnabled: activationEnabled,
      tierMapping: null,
      note: null,
    };
    let kycLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null = null;
    let tierProfileCode: string | null = null;
    let tierPolicyVersion: number | null = null;

    if (input.principalType !== 'CUSTOMER' || input.principalId === null) {
      section.note =
        'KYC eligibility applies to customers. No customer principal was supplied, so no eligibility decision was made.';
      return {
        section,
        kycLevel,
        tierProfileCode,
        tierPolicyVersion,
        tierEnforcementActivationEnabled: activationEnabled,
      };
    }

    // The trusted gate — the SAME decision an admission makes, with the row lock suppressed.
    // A lock is impossible here by construction: PostgreSQL rejects `SELECT … FOR SHARE` inside a
    // `READ ONLY` transaction. `NONE` is therefore the only mode that is compatible with the
    // database-level read-only guarantee, and it is safe because this result is never used to
    // admit anything — the preview reports eligibility, it does not act on it.
    // A refusal is reported (the operation would be refused), not thrown: the preview's job is to
    // explain, and an ineligible customer is a finding, not a failed request.
    try {
      kycLevel = await this.customerEligibility.require(input.manager, input.principalId, {
        lockMode: 'NONE',
      });
      section.kycLevel = kycLevel;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Customer eligibility could not be established';
      section.note = `The trusted financial-eligibility gate refused this customer: ${message}`;
      input.explanation.push({
        code: 'PREVIEW_KYC_INELIGIBLE',
        message: `This customer is not eligible for financial access (${message}). A real operation would be refused before any limit, fee, commission or reward rule is considered.`,
        severity: 'BLOCKER',
      });
      return {
        section,
        kycLevel: null,
        tierProfileCode,
        tierPolicyVersion,
        tierEnforcementActivationEnabled: activationEnabled,
      };
    }

    if (input.institutionId === null) {
      section.note =
        'No institution was supplied, so no institution tier-limit policy was applied.';
      return {
        section,
        kycLevel,
        tierProfileCode,
        tierPolicyVersion,
        tierEnforcementActivationEnabled: activationEnabled,
      };
    }

    if (!activationEnabled) {
      section.note =
        'Institution tier-limit enforcement is disabled for this backend instance, so the approved tier mapping was not applied.';
      input.explanation.push(
        warning(
          'TIER_ENFORCEMENT_INACTIVE',
          'KYC_TIER_LIMIT_ENFORCEMENT_ENABLED is off for this deployment. The tier profile below was not applied, so only assignment-based limits govern this operation.',
        ),
      );
      return {
        section,
        kycLevel,
        tierProfileCode,
        tierPolicyVersion,
        tierEnforcementActivationEnabled: activationEnabled,
      };
    }

    try {
      const resolved = await this.tierPolicies.resolveWithManager(input.manager, {
        institutionId: input.institutionId,
        product: input.productCode,
        currency: input.currency,
        serviceClass: input.serviceClass,
        tier: kycLevel,
      });
      tierPolicyVersion = resolved.policyVersion;
      section.tierMapping = {
        policyVersion: resolved.policyVersion,
        disposition: resolved.mapping.disposition,
        profileCode: resolved.mapping.profileCode,
        profileDigest: resolved.mapping.profileDigest,
        serviceClass: resolved.mapping.serviceClass,
      };
      if (resolved.mapping.disposition === 'PROFILE') {
        tierProfileCode = resolved.mapping.profileCode;
        section.note = null;
      } else {
        section.note = `The approved institution policy explicitly marks this tier/product/currency/service class as not applicable (disposition ${resolved.mapping.disposition}).`;
        input.explanation.push(
          info(
            'TIER_POLICY_EXPLICIT_NON_APPLICABILITY',
            'The institution tier policy explicitly declares no tier limit for this key. This is a decision on record, not missing configuration.',
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tier policy is unavailable';
      section.note = `The institution tier-limit policy could not be resolved: ${message}`;
      input.explanation.push(
        warning(
          'TIER_POLICY_UNAVAILABLE',
          `The institution tier-limit policy did not resolve (${message}). Tier-bound limits were not applied to this preview.`,
        ),
      );
    }

    return {
      section,
      kycLevel,
      tierProfileCode,
      tierPolicyVersion,
      tierEnforcementActivationEnabled: activationEnabled,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────── limits

  private async limitSection(input: {
    manager: EntityManager;
    principalType: string;
    principalId: string | null;
    agentClassId: string | null;
    segmentCodes: string[];
    institutionId: string | null;
    productCode: string;
    currency: string;
    direction: string;
    channel: string | null;
    evaluatedAt: Date;
    tierProfileCode: string | null;
    tierPolicyVersion: number | null;
    tierEnforcementActivationEnabled: boolean;
    explanation: PreviewExplanation[];
  }): Promise<PreviewLimitSection> {
    const section: PreviewLimitSection = {
      status: 'MISSING',
      note: null,
      assignment: null,
      governingProfileCodes: [],
      assignmentProfileCode: null,
      tierProfileCode: input.tierProfileCode,
      rules: [],
      evaluatedDimensions: [],
      tierEnforcementInactive:
        input.institutionId !== null && !input.tierEnforcementActivationEnabled,
    };

    // Without a principal there is no assignment to resolve. That is "not applicable" rather than
    // "missing configuration": the caller did not ask about anyone.
    if (input.principalId === null) {
      section.status = 'NOT_APPLICABLE';
      section.note =
        'No principal was supplied, so no limit-profile assignment could be resolved. Supply a principalId to preview effective limits.';
      return section;
    }

    // No reservation, no lock: the resolver is a pure read of assignments/profiles.
    const resolved = await this.profileResolver.resolve(input.manager, {
      principalType: input.principalType,
      principalId: input.principalId,
      agentClassId: input.agentClassId,
      segmentCodes: input.segmentCodes,
      now: input.evaluatedAt,
    });

    if (resolved) {
      section.assignment = {
        assignmentId: resolved.assignmentId,
        limitProfileCode: resolved.limitProfileCode,
        subjectType: resolved.subjectType,
        subjectId: resolved.subjectId,
        segmentCode: resolved.segmentCode,
        precedence: resolved.precedence,
      };
      section.assignmentProfileCode = resolved.limitProfileCode;
    }

    const profileCodes = [
      ...new Set([
        ...(resolved ? [resolved.limitProfileCode] : []),
        ...(input.tierProfileCode ? [input.tierProfileCode] : []),
      ]),
    ];
    section.governingProfileCodes = profileCodes;

    if (profileCodes.length === 0) {
      section.status = 'MISSING';
      section.note =
        'No active limit-profile assignment matched this principal and no tier profile applied. A strict financial operation would refuse for missing configuration; this is not an unlimited allowance.';
      input.explanation.push({
        code: 'LIMIT_PROFILE_MISSING',
        message:
          'No effective limit profile is assigned to this principal. A strict financial operation would be refused rather than treated as unlimited.',
        severity: 'BLOCKER',
      });
      return section;
    }

    const candidates = await fetchApplicableLimitRuleCandidates(input.manager, {
      profileCodes,
      product: input.productCode,
      currency: input.currency,
      now: input.evaluatedAt,
    });
    const applicable = narrowApplicableLimitRules(candidates, {
      direction: input.direction,
      channel: input.channel,
    });

    const rules: PreviewLimitRule[] = applicable.map((rule) => ({
      ruleId: rule.id,
      profileCode: rule.limit_profile_code,
      dimension: rule.dimension.trim().toUpperCase(),
      direction: rule.direction,
      channel: rule.channel,
      currency: rule.currency,
      limitValueMinor: rule.limit_value_minor,
      limitValueCount: rule.limit_value_count,
      isUnlimited: Boolean((rule as unknown as { is_unlimited?: boolean }).is_unlimited),
      priority: Number(rule.priority),
      effectiveFrom: toIso(rule.effective_from),
      effectiveTo: rule.effective_to === null ? null : toIso(rule.effective_to),
      source: this.ruleSource(rule.limit_profile_code, section),
    }));
    section.rules = rules;
    section.evaluatedDimensions = [...new Set(rules.map((rule) => rule.dimension))];

    if (rules.length === 0) {
      section.status = 'MISSING';
      section.note = input.tierProfileCode
        ? 'The governing profiles exist but hold no rule for this product, currency, direction, channel and effective window. Enforcement would refuse a strict operation; this is not unlimited.'
        : 'The assigned profile holds no rule matching this product, currency, direction, channel and effective window. Enforcement would refuse a strict operation; this is not unlimited.';
      input.explanation.push({
        code: 'LIMIT_RULE_MISSING',
        message:
          'No applicable limit rule matches this operation. Missing configuration is not an unlimited allowance — a strict financial operation would be refused.',
        severity: 'BLOCKER',
      });
      return section;
    }

    section.status = 'RESOLVED';
    return section;
  }

  private ruleSource(
    profileCode: string,
    section: PreviewLimitSection,
  ): PreviewLimitRule['source'] {
    const fromAssignment = section.assignmentProfileCode === profileCode;
    const fromTier = section.tierProfileCode === profileCode;
    if (fromAssignment && fromTier) return 'ASSIGNMENT_AND_TIER_POLICY';
    if (fromTier) return 'TIER_POLICY';
    return 'ASSIGNMENT';
  }

  // ────────────────────────────────────────────────────────────────────────────────── fee

  private async feeSection(input: {
    manager: EntityManager;
    enabled: boolean;
    productCode: string;
    currency: string;
    amountMinor: string | null;
    evaluatedAt: Date;
    /** Resolved Arena 1 class code, so class-targeted fee rules are not silently skipped. */
    customerClassCode: string | null;
    agentClassId: string | null;
    institutionId: string | null;
    explanation: PreviewExplanation[];
  }): Promise<{ section: PreviewFeeSection; feeMinor: string | null }> {
    if (!input.enabled) {
      input.explanation.push(withheld('PREVIEW_SECTION_RESTRICTED', 'fee', SECTION_FUNCTIONS.fee));
      return { section: restricted(SECTION_FUNCTIONS.fee, 'fee'), feeMinor: null };
    }

    const section: {
      status: 'RESOLVED' | 'MISSING' | 'AMBIGUOUS' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
      note: string | null;
      currency: string;
      evaluatedAt: string;
      rule: {
        ruleId: string;
        ruleVersion: number;
        flatFeeMinor: string | null;
        percentageBps: number | null;
        minimumFeeMinor: string | null;
        maximumFeeMinor: string | null;
        vatBps: number | null;
        priority: number;
        effectiveFrom: string;
        effectiveTo: string | null;
      } | null;
      ambiguousRuleIds: string[] | null;
      ambiguousPriority: number | null;
      computed: {
        status: string;
        feeMinor: string | null;
        vatMinor: string | null;
        totalMinor: string | null;
        calculationModel: string | null;
        postsJournalLegs: false;
      } | null;
    } = {
      status: 'MISSING',
      note: null,
      currency: input.currency,
      evaluatedAt: input.evaluatedAt.toISOString(),
      rule: null,
      ambiguousRuleIds: null,
      ambiguousPriority: null,
      computed: null,
    };

    let resolution: FeeRuleResolution;
    try {
      /*
       * Targeting is passed through verbatim. Previously these three arguments were omitted, so a
       * class-, agent-class- or institution-targeted fee rule could never match and the preview
       * would quietly report the UNTARGETED rule (or MISSING) for a caller who is in fact governed
       * by a targeted one. The resolver's own specificity rule then applies unchanged.
       */
      resolution = await this.feeResolver.resolveWithManager(input.manager, {
        productCode: input.productCode,
        currency: input.currency,
        at: input.evaluatedAt,
        ...(input.customerClassCode !== null ? { customerClassCode: input.customerClassCode } : {}),
        ...(input.agentClassId !== null ? { agentClassId: input.agentClassId } : {}),
        ...(input.institutionId !== null ? { institutionId: input.institutionId } : {}),
      });
    } catch (error) {
      section.status = 'UNAVAILABLE';
      section.note = `The fee resolver could not evaluate this product: ${
        error instanceof Error ? error.message : 'unknown error'
      }`;
      input.explanation.push(warning('FEE_RESOLUTION_UNAVAILABLE', section.note));
      return { section, feeMinor: null };
    }

    if (resolution.status === 'AMBIGUOUS') {
      section.status = 'AMBIGUOUS';
      section.ambiguousRuleIds = resolution.ambiguousRuleIds ?? [];
      section.ambiguousPriority = resolution.ambiguousPriority ?? null;
      section.note = `More than one fee rule shares the highest priority (${resolution.ambiguousPriority}). The resolver refused to choose, so no fee is selected.`;
      input.explanation.push({
        code: 'FEE_RULE_AMBIGUOUS',
        message: `Fee rules ${section.ambiguousRuleIds.join(', ')} share priority ${resolution.ambiguousPriority}; none was selected. Remove the tie before relying on this configuration.`,
        severity: 'BLOCKER',
      });
      return { section, feeMinor: null };
    }

    if (resolution.status === 'NOT_CONFIGURED' || !resolution.rule) {
      section.status = 'MISSING';
      section.note = 'No fee rule is configured for this product and currency at this instant.';
      return { section, feeMinor: null };
    }

    const rule = resolution.rule;
    section.rule = {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      flatFeeMinor: rule.flatFeeMinor,
      percentageBps: rule.percentageBps,
      minimumFeeMinor: rule.minimumFeeMinor,
      maximumFeeMinor: rule.maximumFeeMinor,
      vatBps: rule.vatBps,
      priority: rule.priority,
      effectiveFrom: rule.effectiveFrom.toISOString(),
      effectiveTo: rule.effectiveTo === null ? null : rule.effectiveTo.toISOString(),
    };
    section.status = 'RESOLVED';
    section.note =
      'Highest-priority active fee rule for this product and currency. An equal top priority is refused as ambiguous, never silently resolved.';

    if (input.amountMinor === null) {
      section.note +=
        ' No amount was supplied, so no fee was computed. The rule itself is authoritative.';
      return { section, feeMinor: null };
    }

    // Pure arithmetic. `compute` returns a decision snapshot; it performs no posting.
    const decision = this.feeCalculator.compute({
      resolution,
      principalAmountMinor: input.amountMinor,
      currency: input.currency,
    });
    const computed = decision as unknown as {
      status?: string;
      feeMinor?: string | null;
      vatMinor?: string | null;
      totalMinor?: string | null;
      calculationModel?: string | null;
    };
    section.computed = {
      status: String(computed.status ?? 'COMPUTED'),
      feeMinor: computed.feeMinor ?? null,
      vatMinor: computed.vatMinor ?? null,
      totalMinor: computed.totalMinor ?? null,
      calculationModel: computed.calculationModel ?? null,
      postsJournalLegs: false,
    };
    return { section, feeMinor: section.computed.feeMinor };
  }

  // ───────────────────────────────────────────────────────────────────────────── commission

  private async commissionSection(input: {
    manager: EntityManager;
    enabled: boolean;
    productCode: string;
    currency: string;
    amountMinor: string | null;
    evaluatedAt: Date;
    principalType: string;
    principalId: string | null;
    agentClassId: string | null;
    feeMinor: string | null;
    explanation: PreviewExplanation[];
  }): Promise<EffectiveConfigurationPreview['commission']> {
    if (!input.enabled) {
      input.explanation.push(
        withheld('PREVIEW_SECTION_RESTRICTED', 'commission', SECTION_FUNCTIONS.commission),
      );
      return restricted(SECTION_FUNCTIONS.commission, 'commission');
    }
    if (input.amountMinor === null) {
      return {
        status: 'NOT_APPLICABLE',
        note: 'No amount was supplied, so commission payable on this operation could not be computed. Commission rules may still exist; supply an amountMinor to resolve them.',
        allocations: [],
        accrualPosted: false,
      };
    }

    let resolution: CommissionResolution;
    try {
      resolution = await this.commissionResolver.resolveWithManager(
        input.manager,
        {
          productCode: input.productCode,
          currency: input.currency,
          at: input.evaluatedAt,
          agentId: input.principalType === 'AGENT' ? input.principalId : null,
          agentClassId: input.agentClassId,
        },
        { principalMinor: input.amountMinor, feeMinor: input.feeMinor },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Commission resolution failed';
      input.explanation.push(warning('COMMISSION_RESOLUTION_UNAVAILABLE', message));
      return {
        status: 'UNAVAILABLE',
        note: `Commission could not be resolved: ${message}`,
        allocations: [],
        accrualPosted: false,
      };
    }

    const allocations = resolution.allocations.map((allocation) => ({
      recipientType: String(allocation.recipientType),
      recipientId: allocation.recipientId,
      amountMinor: allocation.amountMinor,
      currency: allocation.currency,
      basis: String(allocation.basis),
      baseAmountMinor: allocation.baseAmountMinor,
      calculationModel: String(allocation.calculationModel),
      ruleId: allocation.ruleId,
      ruleVersion: allocation.ruleVersion,
      priority: allocation.priority,
      effectiveFrom: allocation.effectiveFrom.toISOString(),
      effectiveTo: allocation.effectiveTo === null ? null : allocation.effectiveTo.toISOString(),
      targeting: {
        agentClassId: allocation.targeting.agentClassId,
        agentId: allocation.targeting.agentId,
        aggregatorId: allocation.targeting.aggregatorId,
      },
    }));

    return {
      status: allocations.length > 0 ? 'RESOLVED' : 'MISSING',
      note:
        allocations.length > 0
          ? 'Commission that would be allocated for this operation. Nothing is accrued, settled or posted by this preview.'
          : 'No commission rule applies to this product, currency and targeting.',
      allocations,
      accrualPosted: false,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────────── reward

  private async rewardSection(input: {
    manager: EntityManager;
    enabled: boolean;
    productCode: string;
    currency: string;
    amountMinor: string | null;
    evaluatedAt: Date;
    principalType: string;
    principalId: string | null;
    agentClassId: string | null;
    kycLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null;
    feeMinor: string | null;
    explanation: PreviewExplanation[];
  }): Promise<EffectiveConfigurationPreview['reward']> {
    if (!input.enabled) {
      input.explanation.push(
        withheld('PREVIEW_SECTION_RESTRICTED', 'reward', SECTION_FUNCTIONS.reward),
      );
      return restricted(SECTION_FUNCTIONS.reward, 'reward');
    }
    if (input.amountMinor === null) {
      return {
        status: 'NOT_APPLICABLE',
        note: 'No amount was supplied, so reward value could not be computed. Reward rules may still exist; supply an amountMinor to resolve them.',
        grants: [],
        creditPosted: false,
      };
    }

    let resolution: RewardResolution;
    try {
      resolution = await this.rewardResolver.resolveWithManager(
        input.manager,
        {
          productCode: input.productCode,
          currency: input.currency,
          at: input.evaluatedAt,
          customerId: input.principalType === 'CUSTOMER' ? input.principalId : null,
          customerKycLevel: input.kycLevel,
          agentClassId: input.agentClassId,
          agentId: input.principalType === 'AGENT' ? input.principalId : null,
        },
        { principalMinor: input.amountMinor, feeMinor: input.feeMinor },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reward resolution failed';
      input.explanation.push(warning('REWARD_RESOLUTION_UNAVAILABLE', message));
      return {
        status: 'UNAVAILABLE',
        note: `Reward could not be resolved: ${message}`,
        grants: [],
        creditPosted: false,
      };
    }

    const grants = resolution.grants.map((grant: RewardGrantDecision) => ({
      beneficiaryType: String(grant.beneficiaryType),
      beneficiaryId: grant.beneficiaryId,
      rewardType: String(grant.rewardType),
      amountMinor: grant.amountMinor,
      currency: grant.currency,
      basis: String(grant.basis),
      baseAmountMinor: grant.baseAmountMinor,
      calculationModel: String(grant.calculationModel),
      ruleId: grant.ruleId,
      ruleVersion: grant.ruleVersion,
      priority: grant.priority,
      effectiveFrom: grant.effectiveFrom.toISOString(),
      effectiveTo: grant.effectiveTo === null ? null : grant.effectiveTo.toISOString(),
      campaignCode: grant.campaignCode,
    }));

    return {
      status: grants.length > 0 ? 'RESOLVED' : 'MISSING',
      note:
        grants.length > 0
          ? 'Reward that would be granted for this operation. Nothing is credited or settled by this preview; reward financial execution remains unwired.'
          : 'No reward rule applies to this product, currency and targeting.',
      grants,
      creditPosted: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────── helpers

  private async institution(
    id: string | null,
  ): Promise<EffectiveConfigurationPreview['institution']> {
    if (id === null) return null;
    const rows: Array<{ id: string; name: string | null; status: string | null }> =
      await this.dataSource.query(
        'SELECT id, name, status FROM financial_institutions WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );
    const row = rows[0];
    if (!row)
      return {
        id,
        name: null,
        status: null,
      };
    return { id: row.id, name: row.name, status: row.status };
  }

  private requirePattern(value: string | undefined, pattern: RegExp, field: string): string {
    const normalized = (value ?? '').trim().toUpperCase();
    if (!pattern.test(normalized))
      throw new BadRequestException(
        field === 'productCode'
          ? 'productCode is required and must match ^[A-Z0-9_]{2,80}$'
          : `${field} must be a 3-letter ISO currency code`,
      );
    return normalized;
  }

  private optionalUuid(value: string | undefined, field: string): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (!UUID.test(trimmed)) throw new BadRequestException(`${field} must be a UUID`);
    return trimmed.toLowerCase();
  }

  private optionalAmount(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed))
      throw new BadRequestException('amountMinor must be a non-negative integer of minor units');
    return trimmed;
  }

  private segmentCodes(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    const list = Array.isArray(value) ? value : String(value).split(',');
    return [...new Set(list.map((entry) => entry.trim().toUpperCase()).filter(Boolean))];
  }

  private instant(value: string | undefined): Date {
    if (value === undefined || value.trim() === '') return new Date();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException('at must be an ISO-8601 instant');
    return parsed;
  }
}

// ─────────────────────────────────────────────────────────────────── explanation utilities

const info = (code: string, message: string): PreviewExplanation => ({
  code,
  message,
  severity: 'INFO',
});
const warning = (code: string, message: string): PreviewExplanation => ({
  code,
  message,
  severity: 'WARNING',
});

/**
 * A withheld section is reported as a WARNING, not a BLOCKER: it says nothing about whether the
 * configuration would permit the operation, only that this caller may not see it.
 */
const withheld = (code: string, section: string, functionCode: string): PreviewExplanation => ({
  code,
  message: `The ${section} section was withheld: this session does not hold ${functionCode}. Nothing about it was disclosed.`,
  severity: 'WARNING',
});

/** BLOCKER first, then WARNING, then INFO; input order preserved within a severity. */
function sortExplanation(items: PreviewExplanation[]): PreviewExplanation[] {
  const rank: Record<PreviewExplanation['severity'], number> = {
    BLOCKER: 0,
    WARNING: 1,
    INFO: 2,
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank[a.item.severity] - rank[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
