import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { InstitutionKycLimitPolicyService } from '../limit-catalog/institution-kyc-limit-policy.service';
import {
  fetchApplicableLimitRuleCandidates,
  narrowApplicableLimitRules,
} from '../limit-catalog/limit-rule-applicability';
import { LimitProfileResolverService } from '../limit-catalog/limit-profile-resolver.service';

export interface EffectiveLimitValue {
  dimension: string;
  status: 'RESOLVED' | 'UNLIMITED' | 'MISSING';
  limitValueMinor: string | null;
  limitValueCount: number | null;
  ruleId: string | null;
  profileCode: string | null;
  source: 'ASSIGNMENT' | 'TIER_POLICY' | 'ASSIGNMENT_AND_TIER_POLICY' | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isUnlimited: boolean;
}

export interface EffectiveFeeValue {
  status: 'RESOLVED' | 'ZERO' | 'NOT_CONFIGURED' | 'AMBIGUOUS';
  ruleId: string | null;
  ruleVersion: number | null;
  flatFeeMinor: string | null;
  percentageBps: number | null;
  minimumFeeMinor: string | null;
  maximumFeeMinor: string | null;
  vatBps: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  priority: number | null;
  quote?: {
    amountMinor: string;
    feeMinor: string;
    vatMinor: string;
    totalMinor: string;
  } | null;
  ambiguousRuleIds?: string[];
}

export interface EffectiveProductConfiguration {
  productCode: string;
  productName: string;
  currency: string;
  fee: EffectiveFeeValue;
  limits: EffectiveLimitValue[];
}

export interface CustomerEffectiveConfiguration {
  customerId: string;
  verifiedTier: string | null;
  assignedClass: {
    classCode: string;
    className: string;
    source: string;
    eligibleForVerifiedTier: boolean | null;
    classId?: string | null;
  } | null;
  products: EffectiveProductConfiguration[];
  evaluatedAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED_DIMENSIONS = [
  'MAX_AMOUNT_PER_TX',
  'DAILY_AMOUNT',
  'WEEKLY_AMOUNT',
  'MONTHLY_AMOUNT',
  'WALLET_BALANCE_MAX',
] as const;

@Injectable()
export class CustomerEffectiveConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly classResolver: CustomerClassResolverService,
    private readonly feeResolver: FeeRuleResolverService,
    private readonly feeCalculator: FeeRuleCalculatorService,
    private readonly limitProfileResolver: LimitProfileResolverService,
    @Optional() private readonly tierLimitPolicies?: InstitutionKycLimitPolicyService,
    @Optional()
    @Inject(forwardRef(() => CustomerFinancialEligibilityService))
    private readonly customerEligibility?: CustomerFinancialEligibilityService,
  ) {}

  async evaluate(customerId: string): Promise<CustomerEffectiveConfiguration> {
    return this.dataSource.transaction((manager) => this.evaluateInManager(manager, customerId));
  }

  async evaluateInManager(
    manager: EntityManager,
    customerId: string,
  ): Promise<CustomerEffectiveConfiguration> {
    // This manager is transaction-scoped to a single PostgreSQL client; do not dispatch
    // concurrent queries through it. Sequential reads avoid pg's overlapping-query warning and
    // keep the class/config snapshot ordered inside the activation transaction.
    const customerRows = await manager.query<Array<{ kyc_level: string }>>(
      `SELECT kyc_level FROM customers WHERE id = $1`,
      [customerId],
    );
    const products = await manager.query<Array<{ code: string; name: string; currency: string }>>(
      `SELECT code, name, currency FROM products
        WHERE domain = 'CUSTOMER' AND status = 'ACTIVE' AND enabled = TRUE
          AND configuration_status = 'CONFIGURED' AND product_scope = 'V1' AND deleted_at IS NULL
        ORDER BY code ASC`,
    );
    const classResolution = await this.classResolver.resolveInManager(manager, customerId);

    const verifiedTier = customerRows[0]?.kyc_level ?? null;
    let classResolutionEffective = classResolution;
    // Fall back to the approved tier default class when no active assignment exists.
    // Activation commits the tier-default assignment at activation time; before that,
    // the approved tier default is the prospective effective class for readiness/config.
    if (
      !classResolutionEffective &&
      verifiedTier &&
      ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(verifiedTier)
    ) {
      const tdRows = await manager.query<
        Array<{
          class_id: string;
          class_code: string;
          class_name: string;
          class_status: string;
          class_enabled: boolean;
          class_configuration_status: string;
          class_deleted_at: Date | null;
        }>
      >(
        `SELECT td.class_id, c.code AS class_code, c.name AS class_name,
                c.status AS class_status, c.enabled AS class_enabled,
                c.configuration_status AS class_configuration_status, c.deleted_at AS class_deleted_at
           FROM customer_tier_default_classes td
           JOIN customer_classes c ON c.id = td.class_id
          WHERE td.tier = $1 AND td.status = 'APPROVED'
          LIMIT 1`,
        [verifiedTier],
      );
      const td = tdRows[0];
      if (
        td &&
        td.class_deleted_at == null &&
        td.class_enabled === true &&
        td.class_status === 'ACTIVE' &&
        td.class_configuration_status === 'CONFIGURED'
      ) {
        classResolutionEffective = {
          customerId,
          assignmentId: '',
          classId: td.class_id,
          classCode: td.class_code,
          className: td.class_name,
          assignmentVersion: 0,
          classVersion: 0,
          source: 'TIER_DEFAULT',
          effectiveFrom: new Date(0),
          effectiveTo: null,
        };
      }
    }

    const classCode = classResolutionEffective?.classCode ?? null;
    let assignedClass: CustomerEffectiveConfiguration['assignedClass'] = null;
    if (classResolutionEffective) {
      let eligibleForVerifiedTier: boolean | null = null;
      if (verifiedTier && ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(verifiedTier)) {
        const tierDefaultRows = await manager.query<Array<{ is_match: boolean }>>(
          `SELECT (class_id = $2 AND status = 'APPROVED') AS is_match
             FROM customer_tier_default_classes
            WHERE tier = $1`,
          [verifiedTier, classResolutionEffective.classId],
        );
        eligibleForVerifiedTier =
          tierDefaultRows.length > 0 ? Boolean(tierDefaultRows[0]?.is_match) : null;
      }
      assignedClass = {
        classCode: classResolutionEffective.classCode,
        className: classResolutionEffective.className,
        source: classResolutionEffective.source,
        eligibleForVerifiedTier,
        classId: classResolutionEffective.classId,
      };
    }

    // Resolve institution and trusted tier for regulatory ceiling application.
    //
    // The attributed wallet is authoritative once one exists, because that is exactly the
    // institution runtime admission reads (`transfer-participant-limit` → `participant.wallet`).
    // Before the wallet exists — i.e. between staff completion and the customer's own claim — a
    // wallet lookup finds nothing, and falling back to "no institution" would show staff the
    // commercial ceiling while the customer's first transfer would be governed by the lower
    // institution cap. The ACTIVE enrolment is the institutional relationship that predates the
    // wallet, so it is the correct fallback: display and enforcement then agree at every stage
    // instead of only after claim.
    const institutionRows = await manager.query<Array<{ institution_id: string | null }>>(
      `SELECT institution_id FROM wallet_accounts
        WHERE lower(customer_id)=lower($1) AND institution_id IS NOT NULL
        ORDER BY created_at ASC, id ASC LIMIT 1`,
      [customerId],
    );
    let institutionId = institutionRows[0]?.institution_id ?? null;
    if (!institutionId && UUID_PATTERN.test(customerId)) {
      const enrolmentRows = await manager.query<Array<{ institution_id: string }>>(
        `SELECT institution_id FROM customer_institution_enrolments
          WHERE customer_id = $1::uuid AND status = 'ACTIVE'
          ORDER BY effective_from ASC, created_at ASC, id ASC LIMIT 1`,
        [customerId],
      );
      institutionId = enrolmentRows[0]?.institution_id ?? null;
    }
    let trustedTier: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null = null;
    if (
      institutionId &&
      this.tierLimitPolicies?.enforcementEnabled &&
      this.customerEligibility &&
      ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(String(verifiedTier))
    ) {
      try {
        trustedTier = await this.customerEligibility.require(manager, customerId, {
          lockMode: 'NONE',
        });
      } catch {
        trustedTier = null;
      }
    }

    const out: EffectiveProductConfiguration[] = [];
    for (const product of products) {
      const productCode = String(product.code).toUpperCase();
      const currency = String(product.currency || 'NGN').toUpperCase();

      const feeResolution = await this.feeResolver.resolveWithManager(manager, {
        productCode,
        currency,
        customerClassCode: classCode ?? undefined,
      });
      let fee: EffectiveFeeValue;
      if (feeResolution.status === 'NOT_CONFIGURED') {
        fee = {
          status: 'NOT_CONFIGURED',
          ruleId: null,
          ruleVersion: null,
          flatFeeMinor: null,
          percentageBps: null,
          minimumFeeMinor: null,
          maximumFeeMinor: null,
          vatBps: null,
          effectiveFrom: null,
          effectiveTo: null,
          priority: null,
          quote: null,
        };
      } else if (feeResolution.status === 'AMBIGUOUS') {
        fee = {
          status: 'AMBIGUOUS',
          ruleId: null,
          ruleVersion: null,
          flatFeeMinor: null,
          percentageBps: null,
          minimumFeeMinor: null,
          maximumFeeMinor: null,
          vatBps: null,
          effectiveFrom: null,
          effectiveTo: null,
          priority: null,
          quote: null,
          ambiguousRuleIds: feeResolution.ambiguousRuleIds,
        };
      } else {
        const rule = feeResolution.rule!;
        const quoteInputAmount = '100000';
        const computed = this.feeCalculator.compute({
          resolution: feeResolution,
          principalAmountMinor: quoteInputAmount,
          currency,
        });
        fee = {
          status: computed.status === 'ZERO' ? 'ZERO' : 'RESOLVED',
          ruleId: rule.ruleId,
          ruleVersion: rule.ruleVersion,
          flatFeeMinor: rule.flatFeeMinor,
          percentageBps: rule.percentageBps,
          minimumFeeMinor: rule.minimumFeeMinor,
          maximumFeeMinor: rule.maximumFeeMinor,
          vatBps: rule.vatBps,
          effectiveFrom: rule.effectiveFrom.toISOString(),
          effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
          priority: rule.priority,
          quote: {
            amountMinor: quoteInputAmount,
            feeMinor: String(computed.feeMinor ?? '0'),
            vatMinor: String(computed.vatMinor ?? '0'),
            totalMinor: String(computed.totalMinor ?? quoteInputAmount),
          },
        };
      }

      const resolved = await this.limitProfileResolver.resolve(manager, {
        principalType: 'CUSTOMER',
        principalId: customerId,
        segmentCodes: classCode ? [classCode] : [],
      });

      let tierProfileCode: string | null = null;
      if (institutionId && trustedTier && this.tierLimitPolicies) {
        try {
          const tierResolution = await this.tierLimitPolicies.resolveWithManager(manager, {
            institutionId,
            product: productCode,
            currency,
            serviceClass: null,
            tier: trustedTier,
          });
          if (tierResolution.mapping.disposition === 'PROFILE') {
            tierProfileCode = tierResolution.mapping.profileCode;
          }
        } catch {
          // Tier policy unavailable: fall back to assignment rules; enforcement remains authoritative.
        }
      }

      const profileCodes = [
        ...new Set([
          ...(resolved ? [resolved.limitProfileCode] : []),
          ...(tierProfileCode ? [tierProfileCode] : []),
        ]),
      ];
      const candidates = profileCodes.length
        ? await fetchApplicableLimitRuleCandidates(manager, {
            profileCodes,
            product: productCode,
            currency,
            now: new Date(),
          })
        : [];
      const applicable = narrowApplicableLimitRules(candidates, {
        direction: 'OUTGOING',
        channel: null,
      });

      const limits: EffectiveLimitValue[] = REQUIRED_DIMENSIONS.map((dim) => {
        const matching = applicable.filter((r) => String(r.dimension).toUpperCase() === dim);
        if (matching.length === 0) {
          return {
            dimension: dim,
            status: 'MISSING',
            limitValueMinor: null,
            limitValueCount: null,
            ruleId: null,
            profileCode: null,
            source: null,
            effectiveFrom: null,
            effectiveTo: null,
            isUnlimited: false,
          };
        }
        // Conjunctive rules: the effective ceiling is the most restrictive applicable rule.
        // An unlimited commercial rule cannot override a finite ceiling.
        let selected = matching[0]!;
        let selectedUnlimited = Boolean(
          (selected as unknown as { is_unlimited?: boolean }).is_unlimited ??
            (selected as unknown as { isUnlimited?: boolean }).isUnlimited,
        );
        let selectedMinor = selected.limit_value_minor ? BigInt(selected.limit_value_minor) : null;
        let selectedCount = selected.limit_value_count ?? null;
        for (const rule of matching.slice(1)) {
          const isUnlimited = Boolean(
            (rule as unknown as { is_unlimited?: boolean }).is_unlimited ??
              (rule as unknown as { isUnlimited?: boolean }).isUnlimited,
          );
          const minor = rule.limit_value_minor ? BigInt(rule.limit_value_minor) : null;
          const count = rule.limit_value_count ?? null;
          if (selectedUnlimited && !isUnlimited) {
            selected = rule;
            selectedUnlimited = false;
            selectedMinor = minor;
            selectedCount = count;
            continue;
          }
          if (isUnlimited) continue;
          if (minor !== null && (selectedMinor === null || minor < selectedMinor)) {
            selected = rule;
            selectedMinor = minor;
            selectedCount = count;
          } else if (
            minor === null &&
            count !== null &&
            (selectedCount === null || count < selectedCount)
          ) {
            selected = rule;
            selectedCount = count;
          }
        }
        const source =
          tierProfileCode && selected.limit_profile_code === tierProfileCode
            ? resolved && resolved.limitProfileCode === tierProfileCode
              ? 'ASSIGNMENT_AND_TIER_POLICY'
              : 'TIER_POLICY'
            : 'ASSIGNMENT';
        return {
          dimension: dim,
          status: selectedUnlimited ? 'UNLIMITED' : 'RESOLVED',
          limitValueMinor: selected.limit_value_minor ?? null,
          limitValueCount: selected.limit_value_count ?? null,
          ruleId: selected.id,
          profileCode: selected.limit_profile_code,
          source,
          effectiveFrom: selected.effective_from
            ? new Date(selected.effective_from).toISOString()
            : null,
          effectiveTo: selected.effective_to ? new Date(selected.effective_to).toISOString() : null,
          isUnlimited: selectedUnlimited,
        };
      });

      out.push({
        productCode,
        productName: String(product.name),
        currency,
        fee,
        limits,
      });
    }

    return {
      customerId,
      verifiedTier,
      assignedClass,
      products: out,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
