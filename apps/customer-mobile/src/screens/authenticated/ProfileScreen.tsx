import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingState } from '../../components/LoadingState';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Profile'>;

interface CustomerIdentity {
  id: string;
  reference: string;
  type: string;
  status: string;
  kycLevel?: string;
  kycStatus?: string;
  createdAt: string;
}

interface CustomerProfileDetail {
  profile?: { displayName?: string | null; legalName?: string | null } | null;
}

interface LimitWindowView {
  dimension: string;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  kind: 'AMOUNT' | 'COUNT';
  limitMinor: string | null;
  limitCount: number | null;
  remainingMinor: string | null;
  remainingCount: number | null;
}

interface LimitProductView {
  product: string;
  direction: 'INCOMING' | 'OUTGOING';
  configured: boolean;
  perTransactionMinMinor: string | null;
  perTransactionMaxMinor: string | null;
  windows: LimitWindowView[];
}

interface CustomerLimitsResponse {
  products: LimitProductView[];
}

// V1-CUSTOMER-08 — friendly, customer-facing labels for the product codes returned by
// GET /customers/me/limits. The backend intentionally returns only machine codes (never
// internal rule/profile/assignment ids); display text is a mobile-only concern.
const PRODUCT_LABELS: Record<string, string> = {
  WALLET_TRANSFER: 'Send to Wallet',
  CASH_TO_WALLET: 'Cash-In via Agent',
  WALLET_TO_CASH: 'Cash-Out via Agent',
  CASH_TO_CASH: 'Cash-to-Cash (Received)',
  CUSTOMER_FUNDING: 'Wallet Funding',
};

const PERIOD_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

function formatNaira(minor: string | number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  const value = Number(minor) / 100;
  return `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusStyle(status: string | undefined) {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
      return { color: theme.colors.feedback.success };
    case 'SUSPENDED':
    case 'CLOSED':
      return { color: theme.colors.feedback.error };
    case 'DRAFT':
      return { color: theme.colors.feedback.warning };
    default:
      return { color: theme.colors.neutral.charcoal };
  }
}

function kycStatusStyle(status: string | undefined) {
  switch ((status || '').toUpperCase()) {
    case 'APPROVED':
      return { color: theme.colors.feedback.success };
    case 'REJECTED':
      return { color: theme.colors.feedback.error };
    case 'PENDING':
      return { color: theme.colors.feedback.warning };
    default:
      return { color: theme.colors.neutral.slate };
  }
}

/**
 * V1-CUSTOMER-02 — reads from the authenticated `GET /customers/me` and
 * `GET /customers/me/profile` routes instead of the legacy unauthenticated
 * `GET /customers/:id` route.
 *
 * V1-CUSTOMER-08 — status/KYC are rendered exactly as returned by the backend
 * (never computed or duplicated client-side; see Customer.status /
 * Customer.kycLevel / Customer.kycStatus, the single authoritative source —
 * ProfileScreen never re-derives these). The Transaction Limits section reads
 * GET /customers/me/limits, a read-only customer-safe projection of the
 * authoritative limit-catalog enforcement engine; it is purely informational
 * and never used to gate any action in this app.
 */
export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId, logout } = useAuthStore();
  const [identity, setIdentity] = useState<CustomerIdentity | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [limits, setLimits] = useState<LimitProductView[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const me = await ApiClient.get<CustomerIdentity>('/customers/me');
        setIdentity(me);
        try {
          const detail = await ApiClient.get<CustomerProfileDetail>('/customers/me/profile');
          setDisplayName(detail.profile?.displayName ?? null);
        } catch {
          // Profile detail is optional; identity alone is enough to render the screen.
        }
        try {
          const limitsResponse = await ApiClient.get<CustomerLimitsResponse>('/customers/me/limits');
          setLimits(limitsResponse.products ?? []);
        } catch {
          // Limits are informational only; their absence must never block the profile screen.
          setLimits(null);
        }
      } catch (err: any) {
        setError('Failed to load profile details.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchProfile();
  }, []);

  if (isLoading) {
    return <LoadingState message="Fetching profile details..." />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(displayName || 'M').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{displayName || 'MonieNaija Customer'}</Text>
          <Text style={styles.phone}>Ref: {identity?.reference || 'N/A'}</Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Card variant="elevated" style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Account Information</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Customer ID</Text>
            <Text style={styles.value}>{customerId}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Account Type</Text>
            <Text style={styles.value}>{identity?.type || 'INDIVIDUAL'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, styles.statusBold, statusStyle(identity?.status)]}>
              {identity?.status || '—'}
            </Text>
          </View>

          {identity?.status === 'SUSPENDED' && (
            <View style={styles.restrictionBanner}>
              <Text style={styles.restrictionText}>
                Your account is suspended. Some actions may be unavailable. Please contact Support for help.
              </Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>KYC Level</Text>
            <Text style={styles.value}>{identity?.kycLevel || 'NONE'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>KYC Status</Text>
            <Text style={[styles.value, styles.statusBold, kycStatusStyle(identity?.kycStatus)]}>
              {identity?.kycStatus || 'NOT_STARTED'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Registered On</Text>
            <Text style={styles.value}>
              {identity?.createdAt ? new Date(identity.createdAt).toLocaleDateString('en-NG') : 'N/A'}
            </Text>
          </View>
        </Card>

        {!!limits && limits.some((p) => p.configured) && (
          <Card variant="elevated" style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Transaction Limits</Text>
            {limits
              .filter((p) => p.configured)
              .map((p) => (
                <View key={`${p.product}-${p.direction}`} style={styles.limitBlock}>
                  <Text style={styles.limitProductLabel}>
                    {PRODUCT_LABELS[p.product] || p.product}
                  </Text>
                  {(p.perTransactionMinMinor || p.perTransactionMaxMinor) && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Per transaction</Text>
                      <Text style={styles.value}>
                        {p.perTransactionMinMinor ? `Min ${formatNaira(p.perTransactionMinMinor)} · ` : ''}
                        {p.perTransactionMaxMinor ? `Max ${formatNaira(p.perTransactionMaxMinor)}` : ''}
                      </Text>
                    </View>
                  )}
                  {p.windows
                    .filter((w) => w.kind === 'AMOUNT')
                    .map((w) => (
                      <View style={styles.row} key={w.dimension}>
                        <Text style={styles.label}>{PERIOD_LABELS[w.period] || w.period} remaining</Text>
                        <Text style={styles.value}>
                          {formatNaira(w.remainingMinor)} of {formatNaira(w.limitMinor)}
                        </Text>
                      </View>
                    ))}
                  {p.windows
                    .filter((w) => w.kind === 'COUNT')
                    .map((w) => (
                      <View style={styles.row} key={w.dimension}>
                        <Text style={styles.label}>{PERIOD_LABELS[w.period] || w.period} transactions left</Text>
                        <Text style={styles.value}>
                          {w.remainingCount} of {w.limitCount}
                        </Text>
                      </View>
                    ))}
                </View>
              ))}
            <Text style={styles.limitsFootnote}>
              Limits are set and enforced by MonieNaija and may change. Figures reflect your account as of now.
            </Text>
          </Card>
        )}

        <View style={styles.actionsGroup}>
          <Button
            label="Transaction PIN"
            style={styles.actionBtn}
            variant="outline"
            onPress={() => navigation.navigate('TransactionPin')}
          />
          <Button
            label="Support"
            style={styles.actionBtn}
            variant="outline"
            onPress={() => navigation.navigate('Support')}
          />
        </View>

        <Button
          label="Log Out of Session"
          style={styles.logoutBtn}
          variant="outline"
          onPress={logout}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  content: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginVertical: theme.spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary.main,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  avatarText: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.secondary.main,
  },
  name: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xxs,
  },
  phone: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  detailsCard: {
    width: '100%',
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  value: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
  },
  statusBold: {
    fontWeight: theme.typography.weights.bold,
  },
  restrictionBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.sm,
    borderRadius: 8,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  restrictionText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
  limitBlock: {
    marginBottom: theme.spacing.sm,
  },
  limitProductLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xxs,
  },
  limitsFootnote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    marginTop: theme.spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.neutral.lightGray,
    marginVertical: theme.spacing.xs,
  },
  actionsGroup: {
    width: '100%',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  actionBtn: {
    width: '100%',
  },
  logoutBtn: {
    width: '100%',
    borderColor: theme.colors.feedback.error,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    width: '100%',
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
});
