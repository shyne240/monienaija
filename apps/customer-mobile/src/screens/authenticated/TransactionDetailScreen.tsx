import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { CustomerAccountApi, type TransactionDetail } from '../../services/customer-account';
import {
  formatDateTime,
  formatMinor,
  statusLabel,
  statusTone,
  transactionTypeLabel,
} from '../../services/presentation';
import { RootStackParamList } from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'TransactionDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionDetail'>;

const STATUS_EXPLANATIONS: Record<string, string> = {
  COMPLETED:
    'This transaction settled. The amount shown is what actually moved for your wallet after the backend recorded completion.',
  PENDING:
    'This transaction is still in progress. It is not complete, so do not treat the amount as settled yet. It will update here when the backend resolves it.',
  PROCESSING:
    'The backend is processing this transaction. It is not complete yet, and this screen will show the resolved status when there is one.',
  PENDING_RECOVERY:
    'This transaction hit an interruption and is being reconciled. It is unresolved: neither completed nor failed, and it may still change.',
  FAILED: 'This transaction failed. The amount was not moved for this transaction.',
  CANCELLED: 'This transaction was cancelled before completion.',
  EXPIRED: 'This transaction expired before it was completed.',
  REVERSED:
    'This transaction was reversed. The settlement no longer stands as originally recorded.',
};

/**
 * ARENA 4 — transaction detail / receipt.
 *
 * Reads `GET /customers/me/transactions/:transferId`, which is SELF-scoped (a transaction that does
 * not involve one of the caller's wallets is a 404). The receipt presents only what the backend
 * returned, and its wording is driven by the recorded status: a pending or unresolved transaction
 * can never read as settled here.
 */
export const TransactionDetailScreen: React.FC = () => {
  const route = useRoute<ScreenRoute>();
  const navigation = useNavigation<NavigationProp>();
  const { transactionId, preview } = route.params;

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setIsLoading(true);
    try {
      setDetail(await CustomerAccountApi.transaction(transactionId));
    } catch (caught) {
      setDetail(null);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'This receipt could not be loaded.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reference = detail?.reference ?? preview?.reference ?? null;
  const copyReference = useCallback(async () => {
    if (!reference) return;
    try {
      await Clipboard.setStringAsync(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [reference]);

  if (isLoading) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary.main} />
        <Text style={styles.loadingText}>Loading receipt…</Text>
      </View>
    );
  }

  const amountMinor = detail?.amountMinor ?? preview?.amountMinor ?? null;
  const currency = detail?.currency ?? preview?.currency ?? 'NGN';
  const status = detail?.status ?? preview?.status ?? null;
  const narration = detail?.narration ?? preview?.narration ?? null;
  const type = detail?.type ?? preview?.type ?? null;
  const createdAt = detail?.createdAt ?? preview?.createdAt ?? null;
  const settled = (status ?? '').toUpperCase() === 'COMPLETED';
  const explanation = STATUS_EXPLANATIONS[(status ?? '').toUpperCase()];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.receipt}>
          <Text style={styles.eyebrow}>Transaction receipt</Text>
          <Text style={styles.amount}>
            {currency} {formatMinor(amountMinor)}
          </Text>
          <View style={styles.badgeRow}>
            <StatusBadge status={statusTone(status)} />
            <Text style={styles.statusText}>{statusLabel(status)}</Text>
          </View>
          <Text style={styles.narration}>{narration ?? transactionTypeLabel(type)}</Text>

          <View style={styles.rule} />

          <DetailRow label="Type" value={transactionTypeLabel(type)} />
          <DetailRow
            label={settled ? 'Completed at' : 'Recorded at'}
            value={formatDateTime(detail?.completedAt && settled ? detail.completedAt : createdAt)}
          />
          {detail?.counterparty?.displayName || detail?.counterparty?.receivingNumber ? (
            <DetailRow
              label="Counterparty"
              value={detail.counterparty.displayName ?? detail.counterparty.receivingNumber ?? '—'}
            />
          ) : null}
          {detail?.feeMinor ? <DetailRow label="Fee" value={formatMinor(detail.feeMinor)} /> : null}
          {reference ? (
            <View style={styles.referenceRow}>
              <View style={styles.referenceCopy}>
                <Text style={styles.rowLabel}>Reference</Text>
                <Text style={styles.rowValue} selectable>
                  {reference}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Copy reference"
                onPress={copyReference}
                style={styles.copyButton}
              >
                <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {!!explanation && (
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>
              {settled ? 'Settled transaction' : `Status: ${statusLabel(status)}`}
            </Text>
            <Text style={styles.noteBody}>{explanation}</Text>
          </View>
        )}

        {!!detail?.failureMessage && (
          <View style={styles.failureCard}>
            <Text style={styles.failureTitle}>Why it did not go through</Text>
            <Text style={styles.noteBody}>{detail.failureMessage}</Text>
            {detail.failureCode ? (
              <Text style={styles.reasonCode}>{detail.failureCode}</Text>
            ) : null}
          </View>
        )}

        {!!error && (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Text style={styles.noteTitle}>Receipt unavailable</Text>
            <Text style={styles.noteBody}>
              {error} Agent cash operations and wallet funding do not all expose a receipt here yet.
              Your transaction history still shows the recorded status.
            </Text>
            <Button label="Try again" variant="outline" onPress={load} />
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label="Get help with this transaction"
            variant="outline"
            onPress={() =>
              navigation.navigate('CreateSupportTicket', {
                category: type === 'FUNDING' ? 'FUNDING' : 'TRANSFER',
                subject: reference
                  ? `Issue with transaction ${reference}`
                  : 'Issue with a transaction',
                description: [
                  'I have a question about this transaction:',
                  `- Reference: ${reference ?? 'N/A'}`,
                  `- Amount: ${currency} ${formatMinor(amountMinor)}`,
                  `- Status: ${statusLabel(status)}`,
                  '',
                  'Details: ',
                ].join('\n'),
              })
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={2}>
      {value}
    </Text>
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
  loadingText: { marginTop: theme.spacing.md, color: theme.colors.neutral.slate },
  receipt: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.xl,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.colors.surface.goldInk,
  },
  amount: {
    fontSize: 30,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginTop: theme.spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  statusText: { fontSize: theme.typography.sizes.sm, color: theme.colors.neutral.slate },
  narration: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    marginTop: theme.spacing.sm,
  },
  rule: {
    height: 1,
    backgroundColor: theme.colors.surface.hairline,
    marginVertical: theme.spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  rowLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.neutral.slate },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    fontWeight: theme.typography.weights.medium,
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  referenceCopy: { flex: 1 },
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
  noteCard: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  noteTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  noteBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  failureCard: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 14,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  failureTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.error,
  },
  reasonCode: { fontSize: 10, letterSpacing: 0.6, color: theme.colors.neutral.slate },
  errorCard: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  actions: { marginTop: theme.spacing.xl },
});
