import React, { useCallback, useEffect, useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuthStore } from '../../store/auth-store';
import {
  CustomerAccountApi,
  type CustomerDashboard,
  type CustomerLimits,
  type FundingRequestRow,
} from '../../services/customer-account';
import {
  formatDateTime,
  formatMinor,
  productLabel,
  statusLabel,
  statusTone,
} from '../../services/presentation';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddMoney'>;

/**
 * ARENA 4 — "Add money".
 *
 * There is no customer-initiated in-app funding product in this backend lineage: wallet funding is
 * an operator-approved request (`/customers/me/funding-requests` is read-only history) or an agent
 * cash deposit. Rather than simulate a deposit form, this screen states the available channels,
 * shows the customer's real receiving identity so an agent can credit them, and lists the funding
 * requests the backend has already recorded — with their real statuses.
 */
export const AddMoneyScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId } = useAuthStore();

  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [requests, setRequests] = useState<FundingRequestRow[]>([]);
  const [limits, setLimits] = useState<CustomerLimits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [projection, history, limitView] = await Promise.allSettled([
        CustomerAccountApi.dashboard(),
        CustomerAccountApi.fundingRequests(),
        CustomerAccountApi.limits(),
      ]);
      setDashboard(projection.status === 'fulfilled' ? projection.value : null);
      setRequests(history.status === 'fulfilled' ? history.value : []);
      setLimits(limitView.status === 'fulfilled' ? limitView.value : null);
      if (
        projection.status === 'rejected' &&
        history.status === 'rejected' &&
        limitView.status === 'rejected'
      ) {
        setError(
          'Funding information is temporarily unavailable. Nothing has changed on your account.',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void load().finally(() => setIsRefreshing(false));
  }, [load]);

  const receivingNumber = dashboard?.receivingIdentity ?? null;
  const copyReceiving = useCallback(async () => {
    if (!receivingNumber) return;
    try {
      await Clipboard.setStringAsync(receivingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [receivingNumber]);

  const fundingLimits = limits?.products.filter(
    (product) => product.product === 'CUSTOMER_FUNDING' || product.direction === 'INCOMING',
  );

  if (isLoading) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary.main} />
        <Text style={styles.loadingText}>Checking funding options…</Text>
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
            tintColor={theme.colors.primary.main}
          />
        }
      >
        <Text style={styles.eyebrow}>Add money</Text>
        <Text style={styles.title}>Fund your wallet</Text>

        {!!error && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!dashboard?.balance.primary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No wallet to fund yet</Text>
            <Text style={styles.cardBody}>
              {dashboard
                ? 'MonieNaija has not provisioned a wallet for this customer record, so there is nothing to credit. Funding becomes available once a wallet exists.'
                : 'We could not confirm whether a wallet exists. Pull down to retry.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cash through a MonieNaija agent</Text>
              <Text style={styles.cardBody}>
                Give an authorised agent your MonieNaija receiving number. The agent takes your cash
                and posts a wallet deposit against it; the credit appears in your transaction
                history once the backend records it.
              </Text>
              <View style={styles.receivingRow}>
                <View style={styles.receivingCopy}>
                  <Text style={styles.rowLabel}>Receiving number</Text>
                  <Text style={styles.receivingValue} selectable>
                    {receivingNumber ?? 'Not issued yet'}
                  </Text>
                </View>
                {receivingNumber ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Copy receiving number"
                    onPress={copyReceiving}
                    style={styles.copyButton}
                  >
                    <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.rowLabel}>Not issued</Text>
                )}
              </View>
              {!receivingNumber ? (
                <Text style={styles.hint}>
                  Your receiving number has not been issued yet, so an agent cannot credit you.
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Card or bank transfer inside the app</Text>
              <Text style={styles.cardBody}>
                In-app funding is not available in this release. MonieNaija has no
                customer-initiated funding product, so this screen will not take an amount or show a
                payment form that cannot actually move money.
              </Text>
              <Text style={styles.hint}>
                Existing funding requests below are generated by MonieNaija channels and are visible
                here for transparency. They are read-only.
              </Text>
            </View>
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Funding history</Text>
          {requests.length === 0 ? (
            <Text style={styles.cardBody}>No funding requests have been recorded for you yet.</Text>
          ) : (
            requests.map((request) => (
              <View key={request.id} style={styles.requestRow}>
                <View style={styles.requestMain}>
                  <Text style={styles.requestAmount}>
                    {request.currency} {formatMinor(request.amountMinor)}
                  </Text>
                  <Text style={styles.requestMeta}>
                    {request.channel ? productLabel(request.channel) : 'MonieNaija channel'} ·{' '}
                    {formatDateTime(request.createdAt)}
                  </Text>
                  {request.reference ? (
                    <Text style={styles.requestMeta} selectable>
                      Ref: {request.reference}
                    </Text>
                  ) : null}
                  {request.rejectionReason ? (
                    <Text style={styles.rejection}>{request.rejectionReason}</Text>
                  ) : null}
                </View>
                <View style={styles.requestStatus}>
                  <StatusBadge status={statusTone(request.status)} />
                  <Text style={styles.requestMeta}>{statusLabel(request.status)}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {fundingLimits && fundingLimits.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Incoming limits</Text>
            {fundingLimits.map((product) => (
              <View key={`${product.product}-${product.direction}`} style={styles.limitBlock}>
                <Text style={styles.limitTitle}>{productLabel(product.product)}</Text>
                {!product.configured ? (
                  <Text style={styles.cardBody}>No limits are configured for this product.</Text>
                ) : (
                  <>
                    {product.perTransactionMaxMinor ? (
                      <Text style={styles.hint}>
                        Per transaction up to {formatMinor(product.perTransactionMaxMinor)}
                      </Text>
                    ) : null}
                    {product.windows.map((window) => (
                      <Text key={`${window.dimension}-${window.period}`} style={styles.hint}>
                        {window.period.charAt(0) + window.period.slice(1).toLowerCase()}:{' '}
                        {formatMinor(window.remainingMinor)} remaining
                      </Text>
                    ))}
                  </>
                )}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Talk to support about funding"
            variant="outline"
            onPress={() =>
              navigation.navigate('CreateSupportTicket', {
                category: 'FUNDING',
                subject: 'Question about funding my wallet',
                description: `Please help me fund my MonieNaija wallet.\n\nCustomer: ${customerId ?? 'unknown'}\nReceiving number: ${receivingNumber ?? 'not issued'}\n`,
              })
            }
          />
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
  },
  loadingText: { marginTop: theme.spacing.md, color: theme.colors.neutral.slate },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.colors.surface.goldInk,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginTop: theme.spacing.xxs,
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
  cardTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.xs,
  },
  cardBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  hint: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
    marginTop: theme.spacing.sm,
  },
  receivingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.surface.cream,
    borderRadius: 10,
    padding: theme.spacing.md,
  },
  receivingCopy: { flex: 1 },
  rowLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.neutral.slate },
  receivingValue: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
    marginTop: 2,
  },
  copyButton: {
    borderWidth: 1,
    borderColor: theme.colors.primary.main,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  copyText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.weights.semibold,
  },
  requestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface.hairline,
  },
  requestMain: { flex: 1 },
  requestAmount: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
  },
  requestMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: 2,
    lineHeight: 16,
  },
  requestStatus: { alignItems: 'flex-end', gap: theme.spacing.xxs },
  rejection: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.error,
    marginTop: theme.spacing.xs,
  },
  limitBlock: { marginTop: theme.spacing.md },
  limitTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  actions: { marginTop: theme.spacing.md },
});
