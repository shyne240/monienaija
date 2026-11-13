import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import {
  CustomerAccountApi,
  type CustomerKycProjection,
  type CustomerLimits,
  type CustomerLimitProduct,
} from '../../services/customer-account';
import {
  evidenceLabel,
  formatDateTime,
  formatMinor,
  kycPathwayCopy,
  KYC_LEVEL_LABELS,
  KYC_STATUS_LABELS,
  productLabel,
  statusLabel,
  statusTone,
} from '../../services/presentation';

interface RequirementGroup {
  layer: 'Regulatory' | 'MonieNaija policy';
  all: string[];
  any: string[][];
}

function requirementGroups(projection: CustomerKycProjection | null): RequirementGroup[] {
  if (!projection?.requirements) return [];
  const { regulatory, operator } = projection.requirements;
  const groups: RequirementGroup[] = [
    { layer: 'Regulatory', all: regulatory.all, any: regulatory.any },
    { layer: 'MonieNaija policy', all: operator.all, any: operator.any },
  ];
  return groups.filter((group) => group.all.length > 0 || group.any.length > 0);
}

/**
 * ARENA 4 — verification, tier and limits.
 *
 * Everything here is read from `GET /customers/me/kyc` (tier, status, the approved policy's
 * requirement *shape*, the evidence-assessment state and the upgrade pathway) and
 * `GET /customers/me/limits` (per-product windows and remaining allowances).
 *
 * The screen never derives a tier, never states a regulatory threshold the policy did not publish,
 * and never reports evidence as failed: the backend reports evidence assessment as UNAVAILABLE
 * because MonieNaija has no confirmed identity-evidence source, and that is exactly what is shown.
 */
export const KycStatusScreen: React.FC = () => {
  const [kyc, setKyc] = useState<CustomerKycProjection | null>(null);
  const [limits, setLimits] = useState<CustomerLimits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [limitsError, setLimitsError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLimitsError('');
    try {
      setKyc(await CustomerAccountApi.kyc());
    } catch (caught) {
      setKyc(null);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Verification status is temporarily unavailable.',
      );
    }
    try {
      setLimits(await CustomerAccountApi.limits());
    } catch {
      setLimits(null);
      setLimitsError('Transaction limits could not be loaded. This does not change your tier.');
    }
  }, []);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    void load().finally(() => {
      if (live) setIsLoading(false);
    });
    return () => {
      live = false;
    };
  }, [load]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void load().finally(() => setIsRefreshing(false));
  }, [load]);

  if (isLoading) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary.main} />
        <Text style={styles.loadingText}>Loading your verification…</Text>
      </View>
    );
  }

  const tierLabel = KYC_LEVEL_LABELS[kyc?.kycLevel ?? ''] ?? 'Tier unavailable';
  const statusLabelText = KYC_STATUS_LABELS[kyc?.kycStatus ?? ''] ?? kyc?.kycStatus ?? 'Unknown';
  const pathway = kycPathwayCopy(
    kyc?.upgradePathway.status,
    kyc?.upgradePathway.nextLevel,
    tierLabel,
  );
  const groups = requirementGroups(kyc);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary.main]}
            tintColor={theme.colors.primary.main}
          />
        }
      >
        <Text style={styles.eyebrow}>Verification</Text>
        <Text style={styles.title}>{tierLabel}</Text>

        {!!error && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" variant="text" size="small" onPress={onRefresh} />
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Current status</Text>
            <StatusBadge
              status={
                kyc?.kycStatus === 'APPROVED'
                  ? 'ACTIVE'
                  : kyc?.kycStatus === 'REJECTED'
                    ? 'FAILED'
                    : 'PENDING'
              }
            />
          </View>
          <Text style={styles.cardBody}>{statusLabelText}</Text>
          <Text style={styles.cardMeta}>
            {kyc?.policy.configured
              ? `Requirement policy version ${kyc.policy.version ?? '—'} is in effect.`
              : 'No requirement policy is in effect, so no upgrade requirement is published.'}
          </Text>
          {kyc?.assessment ? (
            <View style={styles.assessmentBlock}>
              <Text style={styles.assessmentLine}>
                Latest assessment · {KYC_LEVEL_LABELS[kyc.assessment.level] ?? kyc.assessment.level}
              </Text>
              <Text style={styles.cardMeta}>
                {statusLabel(kyc.assessment.status)}
                {kyc.assessment.expiresAt
                  ? ` · expires ${formatDateTime(kyc.assessment.expiresAt)}`
                  : ''}
              </Text>
            </View>
          ) : null}
          {kyc?.manualHold ? (
            <View style={styles.holdBlock} accessibilityRole="alert">
              <Text style={styles.holdTitle}>Manual review in progress</Text>
              <Text style={styles.holdBody}>
                Opened {formatDateTime(kyc.manualHold.since)}. A compliance reviewer must clear this
                before any tier change. You do not need to resubmit anything.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{pathway.title}</Text>
          <Text style={styles.cardBody}>{pathway.body}</Text>
          <View style={styles.evidenceBlock}>
            <Text style={styles.evidenceTitle}>Evidence assessment</Text>
            <Text style={styles.cardMeta}>
              {kyc?.evidenceAssessment.note ??
                'MonieNaija cannot assess verified identity evidence yet, so no requirement is marked satisfied or missing.'}
            </Text>
            {kyc?.evidenceAssessment.reason ? (
              <Text style={styles.reasonCode}>{kyc.evidenceAssessment.reason}</Text>
            ) : null}
          </View>
          {groups.length > 0 ? (
            <View style={styles.requirementsBlock}>
              <Text style={styles.evidenceTitle}>
                What{' '}
                {kyc?.requirements ? KYC_LEVEL_LABELS[kyc.requirements.level] : 'the next tier'}{' '}
                publishes as its requirements
              </Text>
              {groups.map((group) => (
                <View key={group.layer} style={styles.group}>
                  <Text style={styles.groupLayer}>{group.layer}</Text>
                  {group.all.map((code) => (
                    <Text key={`${group.layer}-all-${code}`} style={styles.requirementRow}>
                      • {evidenceLabel(code)}
                    </Text>
                  ))}
                  {group.any.map((options, index) => (
                    <Text key={`${group.layer}-any-${index}`} style={styles.requirementRow}>
                      • One of: {options.map(evidenceLabel).join(' or ')}
                    </Text>
                  ))}
                </View>
              ))}
              <Text style={styles.cardMeta}>
                Requirement types are published by the approved policy. This list is a description
                of the policy, not a statement about your verification.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transaction limits</Text>
          {limitsError ? <Text style={styles.cardBody}>{limitsError}</Text> : null}
          {!limitsError && (!limits || limits.products.length === 0) ? (
            <Text style={styles.cardBody}>
              No limit products are configured for your account, so there is nothing to display.
              Your tier does not change because of this.
            </Text>
          ) : null}
          {limits?.products.map((product) => (
            <LimitProduct key={`${product.product}-${product.direction}`} product={product} />
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How tiers work here</Text>
          <Text style={styles.cardBody}>
            MonieNaija grants the highest tier whose requirements are all satisfied, using the
            requirement policy in effect at the time. Tier decisions are made by the backend; this
            app never computes or assumes a tier.
          </Text>
          <Text style={styles.cardMeta}>
            {kyc ? `Evaluated ${formatDateTime(kyc.asOf)}` : 'No evaluation time available.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const LimitProduct: React.FC<{ product: CustomerLimitProduct }> = ({ product }) => (
  <View style={styles.productBlock}>
    <View style={styles.productHeader}>
      <Text style={styles.productTitle}>{productLabel(product.product)}</Text>
      <StatusBadge status={product.configured ? statusTone('ACTIVE') : statusTone('PENDING')} />
    </View>
    <Text style={styles.cardMeta}>
      {product.direction === 'INCOMING' ? 'Money in' : 'Money out'} · {product.currency}
    </Text>
    {!product.configured ? (
      <Text style={styles.cardBody}>No limits are configured for this product.</Text>
    ) : (
      <>
        {product.perTransactionMinMinor || product.perTransactionMaxMinor ? (
          <Text style={styles.limitRow}>
            Per transaction: {formatMinor(product.perTransactionMinMinor)} –{' '}
            {formatMinor(product.perTransactionMaxMinor)}
          </Text>
        ) : null}
        {product.walletBalanceMaxMinor ? (
          <Text style={styles.limitRow}>
            Maximum wallet balance: {formatMinor(product.walletBalanceMaxMinor)}
          </Text>
        ) : null}
        {product.windows.map((window) => (
          <Text key={`${window.dimension}-${window.period}`} style={styles.limitRow}>
            {window.period.charAt(0) + window.period.slice(1).toLowerCase()}:{' '}
            {window.kind === 'AMOUNT'
              ? `${formatMinor(window.limitMinor)} limit · ${formatMinor(window.remainingMinor)} remaining`
              : `${window.limitCount ?? '—'} transactions · ${window.remainingCount ?? '—'} remaining`}
          </Text>
        ))}
      </>
    )}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface.cream },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.huge },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.cream,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: theme.colors.neutral.slate,
    fontSize: theme.typography.sizes.sm,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.colors.surface.goldInk,
    marginBottom: theme.spacing.xxs,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.lg,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 10,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: { color: theme.colors.feedback.error, fontSize: theme.typography.sizes.sm },
  card: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  cardTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.xs,
    flexShrink: 1,
  },
  cardBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  cardMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
    marginTop: theme.spacing.xs,
  },
  assessmentBlock: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface.hairline,
  },
  assessmentLine: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  holdBlock: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.feedback.warningLight,
    borderRadius: 10,
    padding: theme.spacing.md,
  },
  holdTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.warning,
  },
  holdBody: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
    lineHeight: 18,
    marginTop: theme.spacing.xxs,
  },
  evidenceBlock: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.surface.cream,
    borderRadius: 10,
    padding: theme.spacing.md,
  },
  evidenceTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  reasonCode: {
    marginTop: theme.spacing.xs,
    fontSize: 10,
    letterSpacing: 0.6,
    color: theme.colors.surface.goldInk,
  },
  requirementsBlock: { marginTop: theme.spacing.md },
  group: { marginTop: theme.spacing.sm },
  groupLayer: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: theme.spacing.xxs,
  },
  requirementRow: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  productBlock: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface.hairline,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xxs,
  },
  productTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  limitRow: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
    marginTop: theme.spacing.xs,
    lineHeight: 18,
  },
});
