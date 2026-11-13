import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { TransactionRow } from '../../components/TransactionRow';
import { useAuthStore } from '../../store/auth-store';
import {
  CustomerAccountApi,
  type CustomerDashboard,
  type CustomerKycProjection,
} from '../../services/customer-account';
import { mapTransactionToRow } from '../../services/transfer-view';
import {
  HIDDEN_BALANCE,
  formatMinor,
  greetingFor,
  initialsOf,
  kycPathwayCopy,
  KYC_LEVEL_LABELS,
  KYC_STATUS_LABELS,
  statusTone,
} from '../../services/presentation';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

/**
 * ARENA 4 — customer banking dashboard.
 *
 * Reads the authenticated, ownership-scoped `GET /customers/me/dashboard` projection (identity,
 * profile, wallets + balances, receiving identity and the five most recent unified transactions)
 * plus the customer-safe KYC projection. Every figure displayed is a value the backend returned:
 * there is no placeholder balance, no invented account number and no simulated transaction.
 *
 * Where the backend reports nothing, the screen explains the actual state (no wallet provisioned,
 * no receiving number yet, no recent activity) instead of filling the gap with sample data.
 */
export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { logout } = useAuthStore();

  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [kyc, setKyc] = useState<CustomerKycProjection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [kycError, setKycError] = useState('');
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setKycError('');
    try {
      const projection = await CustomerAccountApi.dashboard();
      setDashboard(projection);
    } catch (caught) {
      setDashboard(null);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'We could not load your account just now.',
      );
    }
    try {
      setKyc(await CustomerAccountApi.kyc());
    } catch {
      // The KYC card is supplementary: its failure must not blank the banking dashboard.
      setKyc(null);
      setKycError('Verification status is temporarily unavailable.');
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

  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  const displayName =
    dashboard?.profile?.displayName?.trim() || dashboard?.profile?.legalName?.trim() || 'there';
  const primaryWallet = dashboard?.balance.primary ?? null;
  const receivingNumber = dashboard?.receivingIdentity ?? null;
  const recent = dashboard?.recentTransactions.items ?? [];

  const copyReceivingNumber = useCallback(async () => {
    if (!receivingNumber) return;
    try {
      await Clipboard.setStringAsync(receivingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [receivingNumber]);

  const tierLabel = KYC_LEVEL_LABELS[kyc?.kycLevel ?? ''] ?? 'Tier unavailable';
  const kycStatus = KYC_STATUS_LABELS[kyc?.kycStatus ?? ''] ?? kyc?.kycStatus ?? 'Unknown';
  const pathway = kycPathwayCopy(
    kyc?.upgradePathway.status,
    kyc?.upgradePathway.nextLevel,
    tierLabel,
  );

  if (isLoading && !dashboard) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary.main} />
        <Text style={styles.loadingText}>Loading your MonieNaija account…</Text>
      </View>
    );
  }

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
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(displayName)}</Text>
            </View>
            <View style={styles.greetingBlock}>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open profile and security"
            onPress={() => navigation.navigate('Profile')}
            style={styles.profileButton}
            hitSlop={8}
          >
            <Text style={styles.profileButtonText}>Profile</Text>
          </TouchableOpacity>
        </View>

        {!!error && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={onRefresh} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.retryLink}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {primaryWallet ? (
          <View style={styles.balanceCard}>
            <View style={styles.balanceHeader}>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={balanceVisible ? 'Hide balance' : 'Show balance'}
                onPress={() => setBalanceVisible((visible) => !visible)}
                hitSlop={10}
                style={styles.eyeButton}
              >
                <Text style={styles.eyeText}>{balanceVisible ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.balanceValue} accessibilityLabel="Balance">
              {balanceVisible ? formatMinor(primaryWallet.balanceMinor) : HIDDEN_BALANCE}
            </Text>
            <View style={styles.balanceMeta}>
              <Text style={styles.balanceMetaText}>{primaryWallet.currency} wallet</Text>
              <StatusBadge status={statusTone(primaryWallet.status)} />
            </View>

            <View style={styles.goldRule} />

            <View style={styles.receivingRow}>
              <View style={styles.receivingCopy}>
                <Text style={styles.receivingLabel}>Your receiving number</Text>
                <Text style={styles.receivingValue} selectable>
                  {receivingNumber ?? 'Not issued yet'}
                </Text>
              </View>
              {receivingNumber ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Copy receiving number"
                  onPress={copyReceivingNumber}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {!receivingNumber ? (
              <Text style={styles.receivingHint}>
                Your phone-based receiving number has not been issued for this account yet. Cash-in
                and transfers to you stay unavailable until it exists.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.noWalletCard}>
            <Text style={styles.noWalletTitle}>No wallet provisioned yet</Text>
            <Text style={styles.noWalletBody}>
              {dashboard
                ? 'Your customer record exists, but no wallet is provisioned for it. Balances, transfers and cash operations stay unavailable until MonieNaija provisions one.'
                : 'We could not confirm your wallet. Pull down to retry.'}
            </Text>
            <Button
              label="Contact support"
              variant="outline"
              onPress={() => navigation.navigate('Support')}
            />
          </View>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.actionTile}
            onPress={() => navigation.navigate('SendMoney')}
          >
            <Text style={styles.actionGlyph}>↑</Text>
            <Text style={styles.actionLabel}>Send money</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.actionTile}
            onPress={() => navigation.navigate('AddMoney')}
          >
            <Text style={styles.actionGlyph}>↓</Text>
            <Text style={styles.actionLabel}>Add money</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.actionTile}
            onPress={() => navigation.navigate('Transactions')}
          >
            <Text style={styles.actionGlyph}>≡</Text>
            <Text style={styles.actionLabel}>History</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open verification and limits"
          style={styles.kycCard}
          onPress={() => navigation.navigate('KycStatus')}
        >
          <View style={styles.kycHeader}>
            <View>
              <Text style={styles.kycEyebrow}>Verification</Text>
              <Text style={styles.kycTier}>{tierLabel}</Text>
            </View>
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
          {kycError ? (
            <Text style={styles.kycBody}>{kycError}</Text>
          ) : (
            <>
              <Text style={styles.kycStatusLine}>
                {kycStatus}
                {kyc?.policy.configured ? ` · policy v${kyc.policy.version ?? '-'}` : ''}
              </Text>
              <Text style={styles.kycBody}>{pathway.title}</Text>
            </>
          )}
          <Text style={styles.kycLink}>{pathway.actionLabel ?? 'View verification details'} →</Text>
        </TouchableOpacity>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => navigation.navigate('Transactions')}
            hitSlop={8}
          >
            <Text style={styles.sectionLink}>See all</Text>
          </TouchableOpacity>
        </View>

        {recent.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>
              Wallet transfers, agent cash deposits, withdrawals and funding appear here as soon as
              the backend records them.
            </Text>
          </View>
        ) : (
          recent.map((item) => {
            const row = mapTransactionToRow(item);
            return (
              <View key={item.id} style={styles.rowPressable}>
                <TransactionRow
                  amountMinor={row.amountMinor}
                  createdAt={row.createdAt}
                  currency={row.currency}
                  id={row.id}
                  narration={row.narration}
                  onPress={() =>
                    navigation.navigate('TransactionDetail', {
                      transactionId: item.id,
                      preview: {
                        type: item.type,
                        narration: row.narration,
                        reference: row.reference,
                        amountMinor: row.amountMinor,
                        currency: row.currency,
                        status: item.status,
                        createdAt: row.createdAt,
                      },
                    })
                  }
                  reference={row.reference}
                  sign={row.sign}
                  status={row.status}
                />
              </View>
            );
          })
        )}

        <View style={styles.footer}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => navigation.navigate('Support')}
            style={styles.footerLink}
          >
            <Text style={styles.footerLinkText}>Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => navigation.navigate('TransactionPin')}
            style={styles.footerLink}
          >
            <Text style={styles.footerLinkText}>Security</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void logout()}
            style={styles.footerLink}
          >
            <Text style={styles.footerLinkText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface.cream },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.huge },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.cream,
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.lg,
  },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary.main,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  avatarText: {
    color: theme.colors.surface.goldSoft,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.base,
  },
  greetingBlock: { flex: 1 },
  greeting: { fontSize: theme.typography.sizes.sm, color: theme.colors.neutral.slate },
  name: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  profileButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    backgroundColor: theme.colors.surface.white,
  },
  profileButtonText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 10,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    flex: 1,
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
    marginRight: theme.spacing.sm,
  },
  retryLink: {
    color: theme.colors.feedback.error,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.xs,
  },
  balanceCard: {
    backgroundColor: theme.colors.primary.dark,
    borderRadius: 20,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: {
    color: theme.colors.surface.goldSoft,
    fontSize: theme.typography.sizes.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  eyeButton: { paddingHorizontal: theme.spacing.sm },
  eyeText: {
    color: theme.colors.surface.goldSoft,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
  },
  balanceValue: {
    color: theme.colors.surface.white,
    fontSize: 34,
    fontWeight: theme.typography.weights.bold,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  balanceMeta: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  balanceMetaText: { color: theme.colors.neutral.lightGray, fontSize: theme.typography.sizes.xs },
  goldRule: {
    height: 1,
    backgroundColor: theme.colors.surface.gold,
    opacity: 0.5,
    marginVertical: theme.spacing.lg,
  },
  receivingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receivingCopy: { flex: 1 },
  receivingLabel: { color: theme.colors.neutral.lightGray, fontSize: theme.typography.sizes.xs },
  receivingValue: {
    color: theme.colors.surface.white,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  receivingHint: {
    color: theme.colors.neutral.lightGray,
    fontSize: theme.typography.sizes.xs,
    marginTop: theme.spacing.sm,
    lineHeight: 18,
  },
  copyButton: {
    borderWidth: 1,
    borderColor: theme.colors.surface.gold,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    marginLeft: theme.spacing.md,
  },
  copyText: {
    color: theme.colors.surface.goldSoft,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
  },
  noWalletCard: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  noWalletTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  noWalletBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
    marginBottom: theme.spacing.sm,
  },
  actionsRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  actionTile: {
    flex: 1,
    backgroundColor: theme.colors.surface.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  actionGlyph: {
    fontSize: theme.typography.sizes.lg,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.weights.bold,
  },
  actionLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
    fontWeight: theme.typography.weights.medium,
  },
  kycCard: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.xs,
  },
  kycHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kycEyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: theme.colors.surface.goldInk,
  },
  kycTier: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginTop: 2,
  },
  kycStatusLine: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: theme.spacing.xs,
  },
  kycBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
  kycLink: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginTop: theme.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  sectionLink: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
  },
  emptyState: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  emptyBody: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
  },
  rowPressable: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 12,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface.hairline,
  },
  footerLink: { paddingVertical: theme.spacing.sm },
  footerLinkText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.weights.medium,
  },
});
