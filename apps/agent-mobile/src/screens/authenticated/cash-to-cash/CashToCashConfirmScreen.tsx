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
  agentCashToCash,
  describeCashToCashError,
  setPendingTransferCode,
  type AgentCashToCashResult,
  type SafeCashToCashResult,
} from '../../../services/agent-api';
import { formatNairaFromMinor } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash — Step 3: Confirm & Authorize (V1-AGENT-MOBILE-07 / C2C-4).
 *
 * Summary card displays only input/backend-authoritative values (beneficiary phone
 * and amount). No client-side fee/commission calculations.
 *
 * Transaction PIN is delivered in the POST body to the server and nowhere else:
 * never persisted, never logged, never in navigation params, cleared on all outcomes.
 *
 * On success:
 * - Query invalidation triggers server-authoritative balance & history refresh.
 * - transferCode is handed over ephemerally via in-memory single-use storage
 *   (NEVER in navigation params).
 * - Navigation resets to CashToCashSuccess with the safe result.
 */
export const CashToCashConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashConfirm'>>();
  const { beneficiaryPhone, amountMinor, idempotencyKey } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [pin, setPin] = useState('');
  const [clientError, setClientError] = useState('');

  const cashToCashMutation = useMutation<AgentCashToCashResult, unknown, void>({
    mutationFn: () =>
      agentCashToCash({
        beneficiaryPhone,
        amountMinor,
        currency: 'NGN',
        idempotencyKey,
        agentPin: pin,
      }),
    onSuccess: (result) => {
      setPin('');
      // Invalidate authoritative server queries (balance + history)
      void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });

      // Ephemeral single-read handover for the display-once transfer code.
      // NEVER pass transferCode in navigation parameters (SEC-1 / C2C-5 / C2C-6).
      setPendingTransferCode(result.transferCode);

      const { transferCode: _stripped, ...safeResult } = result;
      const safeParams: SafeCashToCashResult = safeResult;

      navigation.reset({
        index: 0,
        routes: [{ name: 'CashToCashSuccess', params: { result: safeParams, amountMinor } }],
      });
    },
    onError: () => {
      setPin('');
    },
  });

  // Shed sensitive state on unmount
  useEffect(() => () => setPin(''), []);

  const handleSubmit = () => {
    if (!pin.trim()) {
      setClientError('Enter your transaction PIN');
      return;
    }
    setClientError('');
    cashToCashMutation.mutate();
  };

  const failureText = clientError
    ? clientError
    : cashToCashMutation.isError
      ? describeCashToCashError(cashToCashMutation.error)
      : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm Cash→Cash Transfer</Text>

        <Card style={styles.card} testID="c2c-confirm-summary-card">
          <SummaryRow label="Beneficiary phone" value={beneficiaryPhone} testID="c2c-confirm-phone" />
          <SummaryRow
            label="Amount to send"
            value={`${formatNairaFromMinor(amountMinor)} NGN`}
            testID="c2c-confirm-amount"
          />
          <Text style={styles.note}>
            The server debits this amount from your Agent float to reserve the funds. The recipient
            can claim cash at any MonieNaija agent with the transfer code.
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
            testID="c2c-pin-input"
            onChangeText={(text) => {
              setPin(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Your transaction PIN authorizes this transfer. It is sent to the server and never stored.
          </Text>

          {!!failureText && (
            <Text style={styles.errorText} testID="c2c-confirm-error">{failureText}</Text>
          )}

          <Button
            loading={cashToCashMutation.isPending}
            label={cashToCashMutation.isPending ? 'Processing…' : 'Authorize & Send Cash'}
            onPress={handleSubmit}
            testID="c2c-confirm-submit"
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
