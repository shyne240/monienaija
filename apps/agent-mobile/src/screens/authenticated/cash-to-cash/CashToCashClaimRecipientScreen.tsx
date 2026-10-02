import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  describeApiError,
  resolveCustomerRecipient,
  type ResolvedCustomerRecipientView,
} from '../../../services/agent-api';
import { canonicalizePhoneNumber } from './CashToCashRecipientScreen';
import type { RootStackParamList } from '../../../navigation/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cash→Cash Claim Assist — Step 1: Beneficiary Identification & Transfer ID (V1-AGENT-MOBILE-09 / CLM-1..2).
 *
 * The agent enters the beneficiary's phone number and the Transfer ID.
 * Backend recipient resolution endpoint verifies the beneficiary is a registered ACTIVE customer.
 * Only CUSTOMER accounts with ACTIVE status are eligible to claim Cash→Cash transfers.
 * Internal database IDs, ledger accounts, and request hashes are never displayed.
 */
export const CashToCashClaimRecipientScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [phoneInput, setPhoneInput] = useState('');
  const [transferIdInput, setTransferIdInput] = useState('');
  const [clientError, setClientError] = useState('');
  const [customer, setCustomer] = useState<ResolvedCustomerRecipientView | null>(null);

  const resolveMutation = useMutation({
    mutationFn: (canonicalPhone: string) => resolveCustomerRecipient(canonicalPhone),
    onSuccess: (view) => {
      setCustomer(view);
      setClientError('');
    },
    onError: (err) => {
      setCustomer(null);
      setClientError(describeBeneficiaryLookupError(err));
    },
  });

  const handleVerify = () => {
    const canonical = canonicalizePhoneNumber(phoneInput);
    if (!canonical) {
      setClientError('Enter a valid 10-digit Nigerian phone number (e.g. 08012345678)');
      setCustomer(null);
      return;
    }

    const tid = transferIdInput.trim();
    if (!tid || !UUID_PATTERN.test(tid)) {
      setClientError('Enter a valid Transfer ID (UUID format)');
      setCustomer(null);
      return;
    }

    setClientError('');
    resolveMutation.mutate(canonical);
  };

  const handleProceed = () => {
    if (!customer) return;
    if (customer.ownerType !== 'CUSTOMER') {
      setClientError('Only Customer accounts can claim Cash→Cash transfers.');
      return;
    }
    if (customer.status !== 'ACTIVE') {
      setClientError('This customer account is not active and cannot claim transfers.');
      return;
    }
    const tid = transferIdInput.trim();
    if (!tid || !UUID_PATTERN.test(tid)) {
      setClientError('Enter a valid Transfer ID (UUID format)');
      return;
    }
    const canonical = canonicalizePhoneNumber(phoneInput);
    if (!canonical) {
      setClientError('Enter a valid 10-digit Nigerian phone number');
      return;
    }
    navigation.navigate('CashToCashClaimConfirm', {
      customer,
      transferId: tid,
      beneficiaryPhone: canonical,
    });
  };

  const eligible = customer?.ownerType === 'CUSTOMER' && customer?.status === 'ACTIVE';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Cash→Cash Claim Assist</Text>
        <Text style={styles.helper}>
          Assist a beneficiary customer to claim physical cash from an existing Cash→Cash transfer.
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            label="Beneficiary Phone Number"
            placeholder="e.g. 08012345678"
            value={phoneInput}
            maxLength={15}
            testID="c2c-claim-phone-input"
            onChangeText={(text) => {
              setPhoneInput(text);
              setClientError('');
              setCustomer(null);
              resolveMutation.reset();
            }}
          />

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Transfer ID"
            placeholder="e.g. 12345678-1234-1234-1234-1234567890ab"
            value={transferIdInput}
            maxLength={36}
            testID="c2c-claim-transfer-id-input"
            onChangeText={(text) => {
              setTransferIdInput(text);
              setClientError('');
              setCustomer(null);
              resolveMutation.reset();
            }}
          />

          <Button
            loading={resolveMutation.isPending}
            label="Verify Beneficiary"
            onPress={handleVerify}
            testID="c2c-claim-verify-button"
          />
        </Card>

        {(!!clientError || resolveMutation.isError) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} testID="c2c-claim-recipient-error">
              {clientError || describeApiError(resolveMutation.error)}
            </Text>
          </View>
        )}

        {resolveMutation.isPending && (
          <Text style={styles.muted} testID="c2c-claim-resolving">Verifying beneficiary…</Text>
        )}

        {customer && (
          <Card style={styles.card} testID="c2c-claim-customer-card">
            <Text style={styles.sectionTitle}>Beneficiary Customer</Text>
            <Text style={styles.displayName} testID="c2c-claim-customer-display">{customer.display}</Text>
            <Text selectable style={styles.receivingNumber} testID="c2c-claim-customer-number">
              {customer.receivingNumber}
            </Text>
            <Text style={styles.muted} testID="c2c-claim-customer-status">
              Account status: {customer.status}
            </Text>
            {customer.ownerType !== 'CUSTOMER' && (
              <Text style={styles.errorText} testID="c2c-claim-customer-ineligible">
                Only Customer accounts can claim Cash→Cash transfers.
              </Text>
            )}
            {customer.ownerType === 'CUSTOMER' && customer.status !== 'ACTIVE' && (
              <Text style={styles.errorText} testID="c2c-claim-customer-inactive">
                This customer account is not active and cannot claim transfers.
              </Text>
            )}
          </Card>
        )}

        {customer && eligible && (
          <Button label="Continue" onPress={handleProceed} testID="c2c-claim-continue" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

function describeBeneficiaryLookupError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) {
      return 'Beneficiary customer not found. An active customer account is required to claim.';
    }
  }
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
  helper: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  card: {
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.xs,
  },
  displayName: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  receivingNumber: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.5,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
    marginVertical: theme.spacing.xs,
  },
  muted: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 8,
    padding: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
});
