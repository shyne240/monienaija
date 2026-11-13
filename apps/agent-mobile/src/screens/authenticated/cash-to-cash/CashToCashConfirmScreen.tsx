import React, { useEffect, useRef, useState } from 'react';
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
  recoverCashToCashFunding,
  handoffCashToCashOperation,
  setPendingTransferCode,
  type AgentCashToCashResult,
  type SafeCashToCashResult,
} from '../../../services/agent-api';
import { formatNairaFromMinor } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import {
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  matchesPendingAgentOperation,
  savePendingAgentOperation,
} from '../../../services/pending-operation';
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
 *
 * A durable agent-scoped operation is recorded before submission. Once an outcome is
 * ambiguous, subsequent attempts perform read-only recovery and never submit a second
 * funding request. Missing evidence remains unresolved; no secrets are persisted.
 */
export const CashToCashConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashConfirm'>>();
  const { senderPhone, beneficiaryPhone, amountMinor, idempotencyKey } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [pin, setPin] = useState('');
  const [clientError, setClientError] = useState('');
  const effectiveKeyRef = useRef<string>(idempotencyKey);
  const submitInFlightRef = useRef(false);

  const cashToCashMutation = useMutation<AgentCashToCashResult, unknown, void>({
    mutationFn: () =>
      agentCashToCash({
        senderPhone,
        beneficiaryPhone,
        amountMinor,
        currency: 'NGN',
        idempotencyKey: effectiveKeyRef.current,
        agentPin: pin,
      }),
    onSuccess: async (result) => {
      setPin('');
      if (agentId) await clearPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND');
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
    onError: async () => {
      // A response alone cannot establish that a previous ambiguous attempt did not commit.
      // Keep the key until authoritative recovery or reconciliation can resolve it.
      setPin('');
    },
  });

  // Shed sensitive state on unmount
  useEffect(() => () => setPin(''), []);

  const handleSubmit = async () => {
    if (!pin.trim()) {
      setClientError('Enter your transaction PIN');
      return;
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setClientError('');

    const candidateParams = {
      counterpartyId: `${senderPhone}->${beneficiaryPhone}`,
      amountMinor,
      currency: 'NGN',
    };

    if (!agentId) {
      setPin('');
      setClientError('Sign in again to continue.');
      submitInFlightRef.current = false;
      return;
    }
    let submitted = false;
    try {
      const existing = await loadPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND');
      if (existing) {
        setPin('');
        if (!matchesPendingAgentOperation(existing, candidateParams)) {
          setClientError('A previous transfer is unresolved. Recover it before starting another transfer.');
          return;
        }
        const recovery = await recoverCashToCashFunding(existing.idempotencyKey);
        const reason = recovery.status === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : recovery.status === 'FOUND' && recovery.lifecycleStatus === 'UNCLAIMED' ? 'LOST_TRANSFER_CODE' : 'EVIDENCE_REVIEW';
        const handoff = await handoffCashToCashOperation(existing.idempotencyKey, reason);
        if (recovery.status === 'FOUND') {
          setClientError(`Transfer ${recovery.transferId}: ${recovery.lifecycleStatus}. ${recovery.disposition === 'PENDING' ? 'Funds remain an outstanding obligation; this is not a refund.' : recovery.lifecycleStatus === 'UNCLAIMED' ? 'Funding is recorded, but the one-time code cannot be recovered. Recipient redemption remains unavailable until support resolves this.' : 'Contact support for receipt recovery.'} Support reference: ${handoff.id}.`);
        } else {
          setClientError(`The previous transfer is unresolved. Do not submit a new transfer. Support reference: ${handoff.id}.`);
        }
        return;
      }
      effectiveKeyRef.current = idempotencyKey;
      await savePendingAgentOperation({agentId,operationType:'CASH_TO_CASH_SEND',idempotencyKey,...candidateParams,createdAt:new Date().toISOString()});
      submitted = true;
      cashToCashMutation.mutate(undefined, { onSettled: () => { submitInFlightRef.current = false; } });
      return;
    } catch {
      setPin('');
      setClientError('Recovery or secure storage is unavailable. Do not submit another transfer; contact support.');
    } finally {
      // mutate's in-flight guard remains set until its callback.
      if (!submitted) submitInFlightRef.current = false;
    }
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
          <SummaryRow label="Sender phone" value={senderPhone} testID="c2c-confirm-sender-phone" />
          <SummaryRow label="Beneficiary phone" value={beneficiaryPhone} testID="c2c-confirm-phone" />
          <SummaryRow
            label="Amount to send"
            value={`${formatNairaFromMinor(amountMinor)} NGN`}
            testID="c2c-confirm-amount"
          />
          <Text style={styles.note} testID="c2c-settlement-method-notice">
            Confirm the sender phone carefully — the issued sender phone and 6-digit transfer number
            cannot be edited after sending. The server debits this amount from your Agent float and
            reserves the principal. At claim, settlement can credit the beneficiary Customer wallet or
            the claiming Agent's NGN float for cash payout. Physical cash handover is separate from this
            ledger settlement.
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
            label={cashToCashMutation.isPending ? 'Processing…' : 'Authorize & Reserve Transfer'}
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
