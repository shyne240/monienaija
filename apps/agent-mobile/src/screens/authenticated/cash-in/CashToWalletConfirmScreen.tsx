import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  agentCashIn,
  describeApiError,
  type AgentCashInResult,
} from '../../../services/agent-api';
import { formatNairaFromMinor } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Wallet — Step 3: confirm & authorize (V1-AGENT-MOBILE-04).
 *
 * The summary card shows ONLY input/backend-authoritative values (recipient
 * identity returned by the resolver + agent-entered amount). No fee/commission
 * math anywhere on the client (the backend computes none for preview, so none
 * is shown). Transaction PIN is delivered to the backend in the POST body and
 * nowhere else: never persisted, never logged, never in navigation params,
 * state-cleared on every outcome.
 *
 * After success: authoritative transaction queries are invalidated so the
 * transaction surfaces from server (history + financial position) — the
 * client never mutates balances locally.
 */
export const CashToWalletConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToWalletConfirm'>>();
  const { recipient, amountMinor, idempotencyKey } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [pin, setPin] = useState('');
  const [clientError, setClientError] = useState('');

  const cashInMutation = useMutation<AgentCashInResult, unknown, void>({
    mutationFn: () =>
      agentCashIn({
        recipientIdentifier: recipient.receivingNumber,
        amountMinor,
        currency: 'NGN',
        idempotencyKey,
        pin,
      }),
    onSuccess: (result) => {
      setPin('');
      // Server-authoritative refresh: balance and future transaction history.
      void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
      navigation.reset({
        index: 0,
        routes: [{ name: 'CashToWalletSuccess', params: { result, amountMinor } }],
      });
    },
    onError: () => {
      setPin('');
    },
  });

  // Safety: if the screen unmounts for any reason, shed sensitive state.
  useEffect(() => () => setPin(''), []);

  const handleSubmit = () => {
    if (!pin.trim()) {
      setClientError('Enter your transaction PIN');
      return;
    }
    setClientError('');
    // Duplicate-submission guard lives in the mutation (isPending-disabled button).
    cashInMutation.mutate();
  };

  const failureText = clientError
    ? clientError
    : cashInMutation.isError
      ? describeCashInError(cashInMutation.error)
      : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm Cash→Wallet</Text>

        <Card style={styles.card} testID="confirm-summary-card">
          <SummaryRow label="You credit wallet of" value={recipient.display} testID="confirm-recipient" />
          <SummaryRow label="Receiving number" value={recipient.receivingNumber} testID="confirm-number" />
          <SummaryRow label="Amount" value={`${formatNairaFromMinor(amountMinor)} NGN`} testID="confirm-amount" />
          <Text style={styles.note}>
            The server settles this against your Agent float. No fee preview is provided by the
            server for this flow, so none is shown.
          </Text>
        </Card>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="Agent transaction PIN"
            placeholder="••••"
            value={pin}
            maxLength={32}
            testID="pin-input"
            onChangeText={(text) => {
              setPin(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Your transaction PIN authorizes this credit. It is sent to the server and never stored.
          </Text>

          {!!failureText && (
            <Text style={styles.errorText} testID="confirm-error">{failureText}</Text>
          )}

          <Button
            loading={cashInMutation.isPending}
            label={cashInMutation.isPending ? 'Processing…' : 'Credit wallet'}
            onPress={handleSubmit}
            testID="confirm-submit"
            style={styles.button}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

interface SummaryRowProps {
  label: string;
  value: string;
  testID?: string;
}

const SummaryRow: React.FC<SummaryRowProps> = ({ label, value, testID }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} testID={testID}>{value}</Text>
  </View>
);

/**
 * Cash→Wallet-specific error presentation. The backend answers 401 for
 * PIN failures (NOT session expiry) and 403 for authorization/capability
 * failures — both translated to agent-facing meaning without raw reasons.
 */
function describeCashInError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) {
      if (/locked/i.test(error.message)) return 'Your transaction PIN is locked. Contact support.';
      return 'Incorrect transaction PIN. Try again.';
    }
    if (status === 403) {
      return 'You are not permitted to perform Cash→Wallet for this account.';
    }
  }
  // Safe 4xx messages (validation, recipient, limit surfaces) pass through;
  // 5xx/network are sanitized by the shared mapper.
  return describeApiError(error);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  card: {},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  rowLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  rowValue: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    textAlign: 'right',
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
    marginTop: theme.spacing.sm,
  },
  helper: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 17,
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.sm,
  },
  button: { marginTop: theme.spacing.xs },
});
