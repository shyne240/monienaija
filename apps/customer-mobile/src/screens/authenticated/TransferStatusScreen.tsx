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
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime, formatMinor, statusLabel } from '../../services/presentation';
import { BankingApi, type TransferStatus } from '../../services/banking';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TransferStatus'>;

/**
 * Bank transfer status and recovery.
 *
 * This screen exists for one situation: a customer sent money, is not sure whether it worked, and is
 * about to make it worse by sending it again. Its most important job is the `UNKNOWN` state, where the
 * honest answer is "we submitted this and have not yet confirmed the outcome". Telling that customer to
 * retry risks paying twice; telling them it failed when it may have succeeded is worse. So the copy for
 * `UNKNOWN` is explicit that they must not retry, and there is no button that would resubmit.
 *
 * Statuses are rendered from the server's vocabulary, never inferred. The screen never says "successful"
 * unless the provider gave an authoritative outcome, and it never invents a receipt reference.
 */
export const TransferStatusScreen: React.FC<Props> = ({ route, navigation }) => {
  const { operationReference } = route.params;
  const [status, setStatus] = useState<TransferStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setStatus(await BankingApi.transferStatus(operationReference));
    } catch {
      setStatus(null);
      setError(
        'We could not check this transfer right now. This does not mean it failed — check again before doing anything else.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [operationReference]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary.main} />
        <Text style={styles.loadingText}>Checking your transfer…</Text>
      </View>
    );
  }

  const state = status?.state;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Transfer status</Text>
        <Text style={styles.title}>
          {state === 'SUCCESSFUL'
            ? 'Transfer completed'
            : state === 'FAILED'
              ? 'Transfer failed'
              : state === 'REVERSED'
                ? 'Transfer reversed'
                : state === 'UNKNOWN'
                  ? 'Still confirming'
                  : state === 'SUBMITTING'
                    ? 'Sending'
                    : 'Pending'}
        </Text>

        {!!error && (
          <View style={styles.banner} accessibilityRole="alert">
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {status ? (
          <View style={styles.card}>
            {/*
              The UNKNOWN warning comes first and is the most prominent element on the screen, because
              it is the only thing that prevents a duplicate payment.
            */}
            {state === 'UNKNOWN' ? (
              <View style={styles.warningCard} accessibilityLiveRegion="polite">
                <Text style={styles.warningTitle}>Do not send this again</Text>
                <Text style={styles.warningBody}>
                  We sent your transfer to the bank but have not received a final answer yet.
                  Sending it again could pay the recipient twice. This screen updates automatically
                  when the bank confirms.
                </Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Amount</Text>
              <Text style={styles.rowValue}>{formatMinor(status.amountMinor)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Status</Text>
              {/*
                StatusBadge only accepts its known vocabulary; UNKNOWN and SUBMITTING are real states that
                it cannot render, and forcing them into PENDING would misstate what is happening. The
                heading and the warning card carry those states instead.
              */}
              {status.state === 'SUCCESSFUL' ||
              status.state === 'FAILED' ||
              status.state === 'REVERSED' ||
              status.state === 'PENDING' ? (
                <StatusBadge status={status.state === 'SUCCESSFUL' ? 'SUCCESS' : status.state} />
              ) : (
                <Text style={styles.rowValue}>{statusLabel(status.state)}</Text>
              )}
            </View>
            {status.destinationAccountNumber ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Sent to</Text>
                <Text style={styles.rowValue} selectable>
                  {status.destinationBankName ?? 'Bank'} · {status.destinationAccountNumber}
                </Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Reference</Text>
              <Text style={styles.rowValue} selectable>
                {status.operationReference}
              </Text>
            </View>
            {status.providerReference ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Bank reference</Text>
                <Text style={styles.rowValue} selectable>
                  {status.providerReference}
                </Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Started</Text>
              <Text style={styles.rowValue}>{formatDateTime(status.createdAt)}</Text>
            </View>

            {state === 'FAILED' ? (
              <Text style={styles.hint}>
                {status.failureCode === 'INSUFFICIENT_FUNDS'
                  ? 'The transfer failed because there were not enough funds. Nothing was taken from your wallet.'
                  : 'The bank did not complete this transfer. If your balance changed, contact support with the reference above.'}
              </Text>
            ) : null}
            {state === 'REVERSED' ? (
              <Text style={styles.hint}>
                The bank reversed this transfer. Any debit is returned to your wallet; contact
                support with the reference above if you do not see it.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Refresh is the only action. There is deliberately no "try again" control. */}
        <Button label="Check again" onPress={() => void load()} />

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => navigation.navigate('Support')}
          style={styles.supportLink}
        >
          <Text style={styles.supportText}>Something looks wrong — contact support</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface.cream },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  loadingText: { color: theme.colors.neutral.slate, fontSize: theme.typography.sizes.sm },
  eyebrow: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  card: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 16,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  warningCard: {
    backgroundColor: theme.colors.feedback.warningLight,
    borderRadius: 10,
    padding: theme.spacing.md,
    gap: 6,
    marginBottom: theme.spacing.sm,
  },
  warningTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.warning,
  },
  warningBody: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: 20,
    color: theme.colors.neutral.slate,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rowLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.neutral.slate },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
  },
  hint: { fontSize: theme.typography.sizes.xs, lineHeight: 18, color: theme.colors.neutral.slate },
  banner: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 10,
    padding: theme.spacing.md,
  },
  bannerText: { fontSize: theme.typography.sizes.sm, color: theme.colors.feedback.error },
  supportLink: { alignItems: 'center', paddingVertical: theme.spacing.sm },
  supportText: { fontSize: theme.typography.sizes.sm, color: theme.colors.primary.main },
});
