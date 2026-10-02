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
  agentCashToCashClaim,
  describeCashToCashClaimError,
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
  const [clientError, setClientError] = useState('');

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
      });
    },
    onSuccess: (result) => {
      setTransferCode('');
      setOtp('');
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
    },
  });

  // Safety: shed sensitive credentials when screen unmounts.
  useEffect(() => () => {
    setTransferCode('');
    setOtp('');
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
          <Text style={styles.note}>
            Authorizing this claim will debit unclaimed funds and credit the beneficiary&apos;s customer wallet.
            You will hand over physical cash once claimed.
          </Text>
        </Card>

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
