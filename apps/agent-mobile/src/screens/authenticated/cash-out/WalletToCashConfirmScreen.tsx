import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { MfaChallengeCard } from '../../../components/MfaChallengeCard';
import {
  agentCashOut,
  recoverAgentCashOut,
  cancelPendingAgentCashOut,
  requestAgentMfaChallenge,
  getCashOutReplacementStatus,
  handoffCashOutReconciliation,
  describeCashOutError,
  isAmbiguousOperationOutcome,
  type AgentCashOutResult,
  type AgentMfaChallenge,
} from '../../../services/agent-api';
import { isChallengeExpired } from '../../../services/mfa-challenge';
import { formatNairaFromMinor } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import {
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  matchesPendingAgentOperation,
  savePendingAgentOperation,
  type PendingAgentOperation,
} from '../../../services/pending-operation';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Wallet→Cash Method 1 — Step 3: Confirm & Authorize (V1-AGENT-MOBILE-08).
 *
 * Multi-party authorization:
 * 1. Customer OTP issued via backend challenge (POST /agents/me/mfa-challenges).
 * 2. Customer transaction PIN entered on the device.
 * 3. Agent transaction PIN entered on the device.
 *
 * All credentials are sent directly in the POST body to /agents/cash-out.
 * Credentials are NEVER persisted, NEVER logged, NEVER put in navigation params,
 * and always wiped on success, error, or screen unmount.
 *
 * A pending operation is persisted before submission without credentials. Ambiguous
 * outcomes require read-only recovery before another authorization can be attempted.
 */
export const WalletToCashConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WalletToCashConfirm'>>();
  const { customer, amountMinor, idempotencyKey } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [challenge, setChallenge] = useState<AgentMfaChallenge | null>(null);
  const [mfaInvalidatedRevision, setMfaInvalidatedRevision] = useState(0);
  const [otp, setOtp] = useState('');
  const [customerPin, setCustomerPin] = useState('');
  const [agentPin, setAgentPin] = useState('');
  const [clientError, setClientError] = useState('');
  const effectiveKeyRef = useRef<string>(idempotencyKey);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [pendingMismatch, setPendingMismatch] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [pending, setPending] = useState<PendingAgentOperation | null>(null);
  const [replacementChallenge, setReplacementChallenge] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const pending = agentId ? await loadPendingAgentOperation(agentId, 'CASH_OUT') : null;
      const params = { counterpartyId: customer.customerId, amountMinor, currency: 'NGN' };
      const key =
        pending && matchesPendingAgentOperation(pending, params)
          ? pending.idempotencyKey
          : idempotencyKey;
      if (active) {
        setPending(pending);
        setPendingKey(pending?.idempotencyKey ?? null);
        effectiveKeyRef.current = key;
        setOperationKey(key);
        setRecoveryPending(!!pending && matchesPendingAgentOperation(pending, params));
        setPendingMismatch(!!pending && !matchesPendingAgentOperation(pending, params));
      }
    };
    void load().catch(() => {
      if (active)
        setRecoveryError('Secure storage unavailable. Contact support before proceeding.');
    });
    return () => {
      active = false;
    };
  }, [agentId, customer.customerId, amountMinor, idempotencyKey]);
  const submitInFlightRef = useRef(false);

  const recoverReceipt = async () => {
    if (!agentId || !operationKey) return;
    setRecoveryError('');
    try {
      const result = await recoverAgentCashOut(operationKey);
      if (
        result.agentId !== agentId ||
        result.customerId !== customer.customerId ||
        result.amountMinor !== amountMinor ||
        result.currency !== 'NGN' ||
        result.idempotencyKey !== operationKey
      )
        throw new Error('Receipt does not match this transaction');
      await clearPendingAgentOperation(agentId, 'CASH_OUT');
      void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'WalletToCashSuccess',
            params: {
              result,
              amountMinor,
              customerDisplay: customer.display,
              customerReceivingNumber: customer.receivingNumber,
            },
          },
        ],
      });
    } catch {
      setRecoveryError(
        'Receipt is not available yet. Retry recovery or contact support; do not submit a new cash-out.',
      );
    }
  };

  const cancelUncompleted = async () => {
    if (!agentId || !pendingKey || resolving) return;
    setResolving(true);
    setRecoveryError('');
    try {
      const outcome = await cancelPendingAgentCashOut(pendingKey);
      if (outcome.status !== 'CANCELLED') throw new Error('Unresolved');
      await clearPendingAgentOperation(agentId, 'CASH_OUT');
      navigation.reset({ index: 0, routes: [{ name: 'WalletToCash' }] });
    } catch {
      setRecoveryError(
        'Unable to cancel. If completed, recover the receipt; otherwise contact support for reconciliation.',
      );
    } finally {
      setResolving(false);
    }
  };

  const handoff = async () => {
    if (!pendingKey || resolving) return;
    setResolving(true);
    setHandoffMessage('');
    try {
      const reason = pending?.replacement ? 'REPLACEMENT_UNKNOWN' : 'UNKNOWN_OUTCOME';
      const first = await handoffCashOutReconciliation(pendingKey, reason);
      if (pending?.replacement)
        await handoffCashOutReconciliation(pending.replacement.idempotencyKey, reason);
      setHandoffMessage(
        `Sent for reconciliation. Reference: ${first.id}. The pending operation remains protected.`,
      );
    } catch {
      setHandoffMessage(
        'Handoff not confirmed. Retry or contact support; keep the operation reference.',
      );
    } finally {
      setResolving(false);
    }
  };

  const checkReplacement = async () => {
    if (!agentId || !pending?.replacement || resolving) return;
    setResolving(true);
    setRecoveryError('');
    try {
      const result = await getCashOutReplacementStatus(
        pending.idempotencyKey,
        pending.replacement.idempotencyKey,
      );
      if (
        result.status !== 'REPLACED' ||
        result.customerId !== pending.replacement.counterpartyId ||
        result.amountMinor !== pending.replacement.amountMinor ||
        result.currency !== pending.replacement.currency
      )
        throw new Error('Unknown replacement');
      const replacement = {
        ...pending.replacement,
        agentId,
        operationType: 'CASH_OUT' as const,
        createdAt: new Date().toISOString(),
      };
      await savePendingAgentOperation(replacement);
      setPending(replacement);
      setPendingKey(replacement.idempotencyKey);
      const matches = matchesPendingAgentOperation(replacement, {
        counterpartyId: customer.customerId,
        amountMinor,
        currency: 'NGN',
      });
      effectiveKeyRef.current = matches ? replacement.idempotencyKey : idempotencyKey;
      setOperationKey(effectiveKeyRef.current);
      setPendingMismatch(!matches);
      setRecoveryPending(matches);
    } catch {
      setRecoveryError(
        'Replacement not confirmed. Retry later or contact support; do not submit another cash-out.',
      );
    } finally {
      setResolving(false);
    }
  };

  const replacePending = async () => {
    if (
      !agentId ||
      !pending ||
      pending.replacement ||
      resolving ||
      pending.counterpartyId !== customer.customerId ||
      pending.amountMinor === amountMinor ||
      pending.currency !== 'NGN' ||
      idempotencyKey === pending.idempotencyKey
    )
      return;
    setResolving(true);
    setRecoveryError('');
    const replacement = {
      idempotencyKey,
      counterpartyId: customer.customerId,
      amountMinor,
      currency: 'NGN',
    };
    try {
      // Persist both locators before the network request; never overwrite the original
      // identity on an ambiguous response or a process kill.
      const inFlight = { ...pending, replacement };
      await savePendingAgentOperation(inFlight);
      setPending(inFlight);
      const issued = await requestAgentMfaChallenge(
        customer.customerId,
        'WALLET_TO_CASH',
        undefined,
        {
          amountMinor,
          currency: 'NGN',
          operationKey: idempotencyKey,
          supersedesOperationKey: pending.idempotencyKey,
        },
      );
      await savePendingAgentOperation({
        agentId,
        operationType: 'CASH_OUT',
        ...replacement,
        createdAt: new Date().toISOString(),
      });
      setPending(null);
      setPendingKey(null);
      setPendingMismatch(false);
      setRecoveryPending(false);
      effectiveKeyRef.current = idempotencyKey;
      setOperationKey(idempotencyKey);
      setChallenge(issued);
      setReplacementChallenge(true);
    } catch {
      setRecoveryError(
        'Replacement outcome is uncertain. Do not retry or submit; contact support with both operation references.',
      );
    } finally {
      setResolving(false);
    }
  };

  const cashOutMutation = useMutation<AgentCashOutResult, unknown, void>({
    mutationFn: () => {
      if (!challenge) {
        throw new Error('Customer verification challenge missing');
      }
      return agentCashOut({
        customerId: customer.customerId,
        customerPin,
        mfaChallengeId: challenge.challengeId,
        otp: otp.trim(),
        amountMinor,
        currency: 'NGN',
        idempotencyKey: effectiveKeyRef.current,
        agentPin,
      });
    },
    onSuccess: async (result) => {
      setCustomerPin('');
      setAgentPin('');
      setOtp('');
      if (agentId) await clearPendingAgentOperation(agentId, 'CASH_OUT');
      // Server-authoritative query invalidation
      void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'WalletToCashSuccess',
            params: {
              result,
              amountMinor,
              customerDisplay: customer.display,
              customerReceivingNumber: customer.receivingNumber,
            },
          },
        ],
      });
    },
    onError: async (err) => {
      setCustomerPin('');
      setAgentPin('');
      setOtp('');
      if (isOtpChallengeInvalidatedError(err)) {
        setChallenge(null);
        setMfaInvalidatedRevision((rev) => rev + 1);
      }
      if (isAmbiguousOperationOutcome(err)) {
        setPendingKey(effectiveKeyRef.current);
        setRecoveryPending(true);
      } else if (agentId) {
        await clearPendingAgentOperation(agentId, 'CASH_OUT');
      }
    },
  });

  // Safety: shed sensitive credentials when screen unmounts.
  useEffect(
    () => () => {
      setCustomerPin('');
      setAgentPin('');
      setOtp('');
    },
    [],
  );

  const handleSubmit = async () => {
    if (recoveryPending || pendingMismatch) {
      setClientError('Recover the previous receipt before submitting another cash-out.');
      return;
    }
    if (!challenge) {
      setClientError('Send customer verification code first');
      return;
    }
    if (isChallengeExpired(challenge)) {
      setClientError('Customer verification code has expired. Request a new code.');
      return;
    }
    if (!otp.trim()) {
      setClientError('Enter the customer one-time verification code');
      return;
    }
    if (!customerPin.trim()) {
      setClientError('Enter the customer transaction PIN');
      return;
    }
    if (!agentPin.trim()) {
      setClientError('Enter your agent transaction PIN');
      return;
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setClientError('');

    const candidateParams = {
      counterpartyId: customer.customerId,
      amountMinor,
      currency: 'NGN',
    };

    const effectiveKey = effectiveKeyRef.current;

    if (!agentId) {
      submitInFlightRef.current = false;
      setClientError('Agent session unavailable');
      return;
    }
    try {
      if (agentId) {
        await savePendingAgentOperation({
          agentId,
          operationType: 'CASH_OUT',
          idempotencyKey: effectiveKey,
          ...candidateParams,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      submitInFlightRef.current = false;
      setClientError('Secure storage unavailable. Cash-out was not submitted.');
      return;
    }

    cashOutMutation.mutate(undefined, {
      onSettled: () => {
        submitInFlightRef.current = false;
      },
    });
  };

  const failureText = clientError
    ? clientError
    : cashOutMutation.isError
      ? describeCashOutError(cashOutMutation.error)
      : '';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm Wallet→Cash</Text>

        <Card style={styles.card} testID="w2c-confirm-summary-card">
          <SummaryRow label="Customer" value={customer.display} testID="w2c-confirm-customer" />
          <SummaryRow
            label="Receiving number"
            value={customer.receivingNumber}
            testID="w2c-confirm-number"
          />
          <SummaryRow
            label="Amount to cash out"
            value={`${formatNairaFromMinor(amountMinor)} NGN`}
            testID="w2c-confirm-amount"
          />
          <Text style={styles.note}>
            The customer&apos;s wallet will be debited and your agent float credited. You will hand
            over physical cash once authorized.
          </Text>
        </Card>

        {!!recoveryError && !recoveryPending && !pendingMismatch && (
          <Text testID="w2c-storage-error">{recoveryError}</Text>
        )}
        {pendingMismatch && (
          <Card testID="w2c-pending-mismatch">
            <Text>
              Previous cash-out: customer {pending?.counterpartyId}, amount {pending?.amountMinor}{' '}
              minor units {pending?.currency}. Its outcome must be resolved before a new cash-out.
            </Text>
            {pending &&
              !pending.replacement &&
              pending.counterpartyId === customer.customerId &&
              pending.amountMinor !== amountMinor && (
                <>
                  <Text>
                    Replacing cancels the previous pending authorization atomically. Fresh customer
                    authorization is required; a completed transaction cannot be replaced.
                  </Text>
                  <Button
                    label="Replace pending cash-out"
                    testID="w2c-replace"
                    disabled={resolving}
                    onPress={() => {
                      void replacePending();
                    }}
                  />
                </>
              )}
          </Card>
        )}
        {pending?.replacement && (
          <Card testID="w2c-replacement-uncertain">
            <Text>
              Replacement outcome uncertain. Original: {pending.idempotencyKey}. Replacement:{' '}
              {pending.replacement.idempotencyKey}.
            </Text>
            <Button
              label="Check replacement"
              testID="w2c-check-replacement"
              disabled={resolving}
              onPress={() => {
                void checkReplacement();
              }}
            />
          </Card>
        )}
        {(recoveryPending || pendingMismatch) && (
          <Card testID="w2c-resolution-card">
            <Text>
              Only cancel if the customer has not received cash. The server will refuse if the
              transaction completed.
            </Text>
            <Button
              label="Cancel if not completed"
              disabled={resolving || !!pending?.replacement}
              onPress={() => {
                void cancelUncompleted();
              }}
              testID="w2c-cancel-pending"
            />
            <Button
              label="Send for reconciliation"
              testID="w2c-handoff"
              disabled={resolving}
              onPress={() => {
                void handoff();
              }}
            />
            {handoffMessage ? <Text testID="w2c-handoff-message">{handoffMessage}</Text> : null}
            <Button
              label="Contact support"
              onPress={() =>
                navigation.navigate('CreateSupportTicket', {
                  prefillCategory: 'CASH_OUT',
                  prefillDescription: `Please reconcile cash-out operation ${pendingKey ?? ''}${pending?.replacement ? `; replacement ${pending.replacement.idempotencyKey}` : ''}.`,
                })
              }
              testID="w2c-support"
            />
            {pendingMismatch && recoveryError ? <Text>{recoveryError}</Text> : null}
          </Card>
        )}
        {/* Step 3A: Customer OTP Challenge */}
        {recoveryPending && (
          <Card testID="w2c-recovery-card">
            <Text>Check the result of your previous cash-out before starting another.</Text>
            <Button
              label="Recover receipt"
              onPress={() => {
                void recoverReceipt();
              }}
              testID="w2c-recover-button"
            />
            {recoveryError ? <Text testID="w2c-recovery-error">{recoveryError}</Text> : null}
          </Card>
        )}
        {replacementChallenge ? (
          <Text testID="w2c-replacement-ready">
            Fresh customer verification code sent. Enter it below.
          </Text>
        ) : (
          <MfaChallengeCard
            customerId={customer.customerId}
            purpose="WALLET_TO_CASH"
            cashOutContext={
              operationKey
                ? { amountMinor: String(amountMinor), currency: 'NGN', operationKey }
                : undefined
            }
            invalidatedRevision={mfaInvalidatedRevision}
            disabled={
              cashOutMutation.isPending || !operationKey || recoveryPending || pendingMismatch
            }
            onChallengeReady={(issued) => {
              setChallenge(issued);
              setClientError('');
            }}
            onChallengeInvalidated={() => {
              setChallenge(null);
              setOtp('');
            }}
            testID="w2c-mfa-card"
          />
        )}

        {/* Step 3B: Credentials & PIN Authorization */}
        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Customer verification code (OTP)"
            placeholder="e.g. 123456"
            value={otp}
            maxLength={10}
            testID="w2c-otp-input"
            onChangeText={(text) => {
              setOtp(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Ask the customer for the verification code sent to their registered phone number.
          </Text>

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="Customer transaction PIN"
            placeholder="••••"
            value={customerPin}
            maxLength={32}
            testID="w2c-customer-pin-input"
            onChangeText={(text) => {
              setCustomerPin(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Ask the customer to enter their transaction PIN to authorize debiting their wallet.
          </Text>

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="Agent transaction PIN"
            placeholder="••••"
            value={agentPin}
            maxLength={32}
            testID="w2c-agent-pin-input"
            onChangeText={(text) => {
              setAgentPin(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Enter your agent transaction PIN to authorize accepting the float credit.
          </Text>

          {!!failureText && (
            <Text style={styles.errorText} testID="w2c-confirm-error">
              {failureText}
            </Text>
          )}

          <Button
            loading={cashOutMutation.isPending}
            disabled={
              cashOutMutation.isPending || !operationKey || recoveryPending || pendingMismatch
            }
            label={cashOutMutation.isPending ? 'Processing…' : 'Authorize cash-out'}
            onPress={handleSubmit}
            testID="w2c-confirm-submit"
            style={styles.button}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

function isOtpChallengeInvalidatedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ApiError' &&
    (error as Error & { status?: number }).status === 400 &&
    /OTP already used|OTP expired|Invalid OTP challenge/i.test(error.message)
  );
}

interface SummaryRowProps {
  label: string;
  value: string;
  testID?: string;
}

const SummaryRow: React.FC<SummaryRowProps> = ({ label, value, testID }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} testID={testID}>
      {value}
    </Text>
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
