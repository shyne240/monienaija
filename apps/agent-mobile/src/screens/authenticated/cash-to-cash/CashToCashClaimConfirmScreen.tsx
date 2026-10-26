import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { MfaChallengeCard } from '../../../components/MfaChallengeCard';
import {
  agentCashToCashClaim,
  describeApiError,
  describeCashToCashClaimError,
  getAgentCashToCashClaim,
  type AgentCashToCashClaimResult,
  type AgentMfaChallenge,
} from '../../../services/agent-api';
import { newIdempotencyKey } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash Claim Assist — Step 2: Confirm & Multi-party Verification (V1-AGENT-MOBILE-09 / CLM-2..5).
 *
 * Requirements:
 * 1. Customer OTP issued via backend challenge (POST /agents/me/mfa-challenges with CASH_TO_CASH_CLAIM).
 * 2. Secret transfer code provided by beneficiary.
 * 3. Customer OTP entered on the device.
 *
 * All credentials are sent directly in the POST body to /agents/cash-to-cash/claim.
 * Transfer code and OTP are NEVER persisted, NEVER logged, NEVER put in navigation params,
 * and always wiped on success, error, or screen unmount.
 */
export const CashToCashClaimConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashClaimConfirm'>>();
  const { customer, transferId, beneficiaryPhone } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [challenge, setChallenge] = useState<AgentMfaChallenge | null>(null);
  const [transferCode, setTransferCode] = useState('');
  const [otp, setOtp] = useState('');
  const [redemptionMethod, setRedemptionMethod] = useState<'CUSTOMER_WALLET' | 'AGENT_CASH'>('CUSTOMER_WALLET');
  const [agentPin, setAgentPin] = useState('');
  const [clientError, setClientError] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<'CHECKING' | 'READY' | 'ERROR'>('CHECKING');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  // Exactly ONE idempotency key per attempt (survives navigation + retries).
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey('c2c-claim'));

  const claimMutation = useMutation<AgentCashToCashClaimResult, unknown, void>({
    mutationFn: () => {
      if (!challenge) {
        throw new Error('Beneficiary verification challenge missing');
      }
      return agentCashToCashClaim({
        transferId,
        beneficiaryPhone,
        transferCode: transferCode.trim(),
        customerId: customer.customerId,
        mfaChallengeId: challenge.challengeId,
        otp: otp.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        redemptionMethod,
        ...(redemptionMethod === 'AGENT_CASH' ? { agentPin } : {}),
      });
    },
    onSuccess: (result) => {
      setTransferCode('');
      setOtp('');
      setAgentPin('');
      // Server-authoritative query invalidation
      void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
      void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'CashToCashClaimSuccess',
            params: {
              result,
              customerDisplay: customer.display,
              customerReceivingNumber: customer.receivingNumber,
            },
          },
        ],
      });
    },
    onError: () => {
      setTransferCode('');
      setOtp('');
      setAgentPin('');
    },
  });

  // Recover a committed claim before enabling another submission. The server returns a
  // receipt only when this authenticated Agent is the actor on the immutable claim audit row;
  // a 404 means there is no committed claim to recover for this Agent.
  useEffect(() => {
    let active = true;
    setRecoveryStatus('CHECKING');
    setRecoveryError('');

    if (!agentId) {
      setRecoveryStatus('ERROR');
      setRecoveryError('Agent session is unavailable. Sign in again before processing a claim.');
      return () => { active = false; };
    }

    void getAgentCashToCashClaim(transferId)
      .then((result) => {
        if (!active) return;
        setTransferCode('');
        setOtp('');
        void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
        void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
        void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
        navigation.reset({
          index: 0,
          routes: [{
            name: 'CashToCashClaimSuccess',
            params: {
              result,
              customerDisplay: customer.display,
              customerReceivingNumber: customer.receivingNumber,
            },
          }],
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (isApiNotFound(error)) {
          setRecoveryStatus('READY');
          return;
        }
        setRecoveryStatus('ERROR');
        setRecoveryError(
          `${describeApiError(error)} Confirm the previous claim status before submitting; do not start a replacement while the outcome is unknown.`,
        );
      });

    return () => { active = false; };
  }, [agentId, customer, navigation, queryClient, recoveryAttempt, transferId]);

  // Safety: shed sensitive credentials when screen unmounts.
  useEffect(() => () => {
    setTransferCode('');
    setOtp('');
    setAgentPin('');
  }, []);

  const handleSubmit = () => {
    if (!challenge) {
      setClientError('Send beneficiary verification code first');
      return;
    }
    if (!transferCode.trim()) {
      setClientError('Enter the secret transfer code');
      return;
    }
    if (!otp.trim()) {
      setClientError('Enter the customer one-time verification code');
      return;
    }
    if (redemptionMethod === 'AGENT_CASH' && !agentPin.trim()) {
      setClientError('Enter your Agent transaction PIN for cash payout');
      return;
    }
    setClientError('');
    claimMutation.mutate();
  };

  const failureText = clientError
    ? clientError
    : claimMutation.isError
      ? describeCashToCashClaimError(claimMutation.error)
      : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm Cash→Cash Claim</Text>

        <Card style={styles.card} testID="c2c-claim-summary-card">
          <SummaryRow label="Beneficiary" value={customer.display} testID="c2c-claim-summary-customer" />
          <SummaryRow label="Beneficiary Phone" value={customer.receivingNumber} testID="c2c-claim-summary-phone" />
          <SummaryRow label="Transfer ID" value={transferId} testID="c2c-claim-summary-transfer-id" />
          <Text style={styles.note} testID="c2c-redemption-method-intro">
            Select the beneficiary&apos;s payout method below. Cash payout requires an authorized current KYC approval and your Agent transaction PIN.
          </Text>
        </Card>

        <Card style={styles.card} testID="c2c-claim-redemption-method-card">
          <Text style={styles.methodTitle}>Beneficiary payout method</Text>
          <View style={styles.methodOptions}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: redemptionMethod === 'CUSTOMER_WALLET' }}
              style={[
                styles.methodOption,
                redemptionMethod === 'CUSTOMER_WALLET' && styles.methodOptionSelected,
              ]}
              onPress={() => {
                setRedemptionMethod('CUSTOMER_WALLET');
                setAgentPin('');
                setClientError('');
              }}
              testID="c2c-claim-method-wallet"
            >
              <Text style={styles.methodOptionTitle}>Customer wallet</Text>
              <Text style={styles.methodOptionText}>Credit the beneficiary&apos;s NGN wallet.</Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: redemptionMethod === 'AGENT_CASH' }}
              style={[
                styles.methodOption,
                redemptionMethod === 'AGENT_CASH' && styles.methodOptionSelected,
              ]}
              onPress={() => {
                setRedemptionMethod('AGENT_CASH');
                setClientError('');
              }}
              testID="c2c-claim-method-cash"
            >
              <Text style={styles.methodOptionTitle}>Agent cash payout</Text>
              <Text style={styles.methodOptionText}>Credit this Agent&apos;s NGN float; cash handover is separate.</Text>
            </Pressable>
          </View>
          <Text style={styles.methodNotice} testID="c2c-claim-method-notice">
            {redemptionMethod === 'AGENT_CASH'
              ? 'Cash payout requires a current approved Customer KYC assessment by an authorized workforce reviewer. A stored identity-document row alone is not enough. After settlement, hand the physical cash to the verified beneficiary separately.'
              : 'Wallet redemption credits the beneficiary Customer wallet. No physical cash is paid as part of this settlement.'}
          </Text>
        </Card>

        {recoveryStatus === 'CHECKING' && (
          <Text style={styles.helper} testID="c2c-claim-recovery-checking">
            Checking whether this Agent already completed the claim…
          </Text>
        )}
        {recoveryStatus === 'ERROR' && (
          <Card style={styles.card} testID="c2c-claim-recovery-error-card">
            <Text style={styles.errorText} testID="c2c-claim-recovery-error">{recoveryError}</Text>
            <Button
              label="Check claim status again"
              variant="outline"
              onPress={() => setRecoveryAttempt((attempt) => attempt + 1)}
              testID="c2c-claim-recovery-retry"
            />
          </Card>
        )}

        {recoveryStatus === 'READY' && (
          <>
            <Text style={styles.helper} testID="c2c-claim-wallet-only-note">
              {redemptionMethod === 'AGENT_CASH'
                ? 'Cash payout is available only with current approved KYC and your transaction PIN. Cash handover is separate from the float-credit ledger entry.'
                : 'Wallet credit only. No physical cash is paid as part of this settlement.'}
            </Text>

            {/* Step 2A: Customer OTP Challenge */}
            <MfaChallengeCard
          customerId={customer.customerId}
          purpose="CASH_TO_CASH_CLAIM"
          onChallengeReady={(issued) => {
            setChallenge(issued);
            setClientError('');
          }}
          testID="c2c-claim-mfa-card"
        />

        {/* Step 2B: Credentials & Authorization */}
        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="Secret Transfer Code"
            placeholder="••••••••"
            value={transferCode}
            maxLength={20}
            testID="c2c-claim-code-input"
            onChangeText={(text) => {
              setTransferCode(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Ask the beneficiary for the secret transfer code given to them by the sender.
          </Text>

          {redemptionMethod === 'AGENT_CASH' && (
            <>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                label="Agent transaction PIN"
                placeholder="Enter your PIN"
                value={agentPin}
                maxLength={255}
                testID="c2c-claim-agent-pin-input"
                onChangeText={(text) => {
                  setAgentPin(text);
                  setClientError('');
                }}
              />
              <Text style={styles.helper} testID="c2c-claim-agent-pin-note">
                Required to authorize cash redemption. It is sent securely for verification and is never included in the receipt.
              </Text>
            </>
          )}

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Beneficiary verification code (OTP)"
            placeholder="e.g. 123456"
            value={otp}
            maxLength={10}
            testID="c2c-claim-otp-input"
            onChangeText={(text) => {
              setOtp(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper}>
            Ask the beneficiary for the verification code sent to their registered phone number.
          </Text>

          {!!failureText && (
            <Text style={styles.errorText} testID="c2c-claim-confirm-error">{failureText}</Text>
          )}

          <Button
            loading={claimMutation.isPending}
            label={claimMutation.isPending ? 'Processing Claim…' : 'Execute Claim'}
            onPress={handleSubmit}
            testID="c2c-claim-submit"
            style={styles.button}
          />
            </Card>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

function isApiNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ApiError' &&
    (error as Error & { status?: number }).status === 404
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
  methodTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.sm,
  },
  methodOptions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  methodOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  methodOptionSelected: {
    borderColor: theme.colors.primary.main,
    backgroundColor: '#eff6ff',
  },
  methodOptionTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  methodOptionText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 16,
  },
  methodNotice: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 17,
    marginTop: theme.spacing.sm,
  },
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
