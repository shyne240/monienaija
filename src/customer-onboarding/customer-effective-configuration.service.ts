import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
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
  ) {}

  async evaluate(customerId: string): Promise<CustomerEffectiveConfiguration> {
    return this.dataSource.transaction((manager) => this.evaluateInManager(manager, customerId));
  }

  async evaluateInManager(
    manager: import('typeorm').EntityManager,
    customerId: string,
  ): Promise<CustomerEffectiveConfiguration> {
    const [customerRows, products, classResolution] = await Promise.all([
      manager.query<Array<{ kyc_level: string }>>(`SELECT kyc_level FROM customers WHERE id = $1`, [
        customerId,
      ]),
      manager.query<Array<{ code: string; name: string; currency: string }>>(
        `SELECT code, name, currency FROM products
          WHERE domain = 'CUSTOMER' AND status = 'ACTIVE' AND enabled = TRUE
            AND configuration_status = 'CONFIGURED' AND product_scope = 'V1' AND deleted_at IS NULL
          ORDER BY code ASC`,
      ),
      this.classResolver.resolveInManager(manager, customerId),
    ]);

    const verifiedTier = customerRows[0]?.kyc_level ?? null;
    const classCode = classResolution?.classCode ?? null;
    let assignedClass: CustomerEffectiveConfiguration['assignedClass'] = null;
    if (classResolution) {
      let eligibleForVerifiedTier: boolean | null = null;
      if (verifiedTier && ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(verifiedTier)) {
        const clsRows = await manager.query<Array<{ eligible_tiers: string[] | null }>>(
          `SELECT eligible_tiers FROM customer_classes WHERE id = $1`,
          [classResolution.classId],
        );
        const tiers = clsRows[0]?.eligible_tiers;
        eligibleForVerifiedTier = Array.isArray(tiers)
          ? tiers.map(String).includes(verifiedTier)
          : null;
      }
      assignedClass = {
        classCode: classResolution.classCode,
        className: classResolution.className,
        source: classResolution.source,
        eligibleForVerifiedTier,
        classId: classResolution.classId,
      };
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
      const profileCodes = resolved ? [resolved.limitProfileCode] : [];
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
        const rule = applicable.find((r) => String(r.dimension).toUpperCase() === dim);
        if (!rule) {
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
        const isUnlimited = Boolean(
          (rule as unknown as { is_unlimited?: boolean; isUnlimited?: boolean }).is_unlimited ??
            (rule as unknown as { isUnlimited?: boolean }).isUnlimited,
        );
        return {
          dimension: dim,
          status: isUnlimited ? 'UNLIMITED' : 'RESOLVED',
          limitValueMinor: rule.limit_value_minor ?? null,
          limitValueCount: rule.limit_value_count ?? null,
          ruleId: rule.id,
          profileCode: rule.limit_profile_code,
          source: resolved && rule.limit_profile_code === resolved.limitProfileCode ? 'ASSIGNMENT' : 'ASSIGNMENT',
          effectiveFrom: rule.effective_from ? new Date(rule.effective_from).toISOString() : null,
          effectiveTo: rule.effective_to ? new Date(rule.effective_to).toISOString() : null,
          isUnlimited,
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
