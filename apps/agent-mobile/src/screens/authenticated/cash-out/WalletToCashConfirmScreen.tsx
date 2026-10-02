import React, { useEffect, useState } from 'react';
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
  describeCashOutError,
  type AgentCashOutResult,
  type AgentMfaChallenge,
} from '../../../services/agent-api';
import { formatNairaFromMinor } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
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
 */
export const WalletToCashConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WalletToCashConfirm'>>();
  const { customer, amountMinor, idempotencyKey } = route.params;
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [challenge, setChallenge] = useState<AgentMfaChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [customerPin, setCustomerPin] = useState('');
  const [agentPin, setAgentPin] = useState('');
  const [clientError, setClientError] = useState('');

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
        idempotencyKey,
        agentPin,
      });
    },
    onSuccess: (result) => {
      setCustomerPin('');
      setAgentPin('');
      setOtp('');
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
    onError: () => {
      setCustomerPin('');
      setAgentPin('');
      setOtp('');
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

  const handleSubmit = () => {
    if (!challenge) {
      setClientError('Send customer verification code first');
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
    setClientError('');
    cashOutMutation.mutate();
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

        {/* Step 3A: Customer OTP Challenge */}
        <MfaChallengeCard
          customerId={customer.customerId}
          purpose="WALLET_TO_CASH"
          onChallengeReady={(issued) => {
            setChallenge(issued);
            setClientError('');
          }}
          testID="w2c-mfa-card"
        />

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
