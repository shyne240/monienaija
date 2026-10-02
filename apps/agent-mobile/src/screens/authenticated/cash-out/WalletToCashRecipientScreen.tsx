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
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Wallet→Cash Method 1 — Step 1: Customer identification (V1-AGENT-MOBILE-08).
 *
 * The agent enters the customer's MonieNaija receiving number / phone number.
 * Backend recipient resolution endpoint returns the authoritative customer identity.
 * Only CUSTOMER wallets with ACTIVE status are eligible for Wallet→Cash.
 * Internal database IDs, wallet UUIDs, and ledger IDs are never rendered.
 */
export const WalletToCashRecipientScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [identifier, setIdentifier] = useState('');
  const [clientError, setClientError] = useState('');
  const [customer, setCustomer] = useState<ResolvedCustomerRecipientView | null>(null);

  const resolveMutation = useMutation({
    mutationFn: () => resolveCustomerRecipient(identifier),
    onSuccess: (view) => {
      setCustomer(view);
      setClientError('');
    },
    onError: (err) => {
      setCustomer(null);
      setClientError(describeCustomerLookupError(err));
    },
  });

  const sanitizeForLookup = (value: string) => value.replace(/[\s-]/g, '');

  const handleVerify = () => {
    const cleaned = sanitizeForLookup(identifier);
    if (!/^(\+?\d{10,13})$/.test(cleaned)) {
      setClientError('Enter the 10-digit MonieNaija receiving number (or phone number)');
      setCustomer(null);
      return;
    }
    setClientError('');
    resolveMutation.mutate();
  };

  const handleProceed = () => {
    if (!customer) return;
    if (customer.ownerType !== 'CUSTOMER') {
      setClientError('Only Customer wallets can perform Wallet→Cash cash-outs.');
      return;
    }
    if (customer.status !== 'ACTIVE') {
      setClientError('This customer wallet is not active and cannot perform cash-out.');
      return;
    }
    navigation.navigate('WalletToCashAmount', { customer });
  };

  const eligible = customer?.ownerType === 'CUSTOMER' && customer?.status === 'ACTIVE';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Cash-out / Customer Wallet→Cash</Text>
        <Text style={styles.helper}>
          Enter the customer&apos;s MonieNaija receiving number or phone number to look up their
          wallet.
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Customer MonieNaija number"
            placeholder="e.g. 8000000001"
            value={identifier}
            maxLength={15}
            testID="w2c-recipient-input"
            onChangeText={(text) => {
              setIdentifier(text);
              setClientError('');
              setCustomer(null);
              resolveMutation.reset();
            }}
          />
          <Button
            loading={resolveMutation.isPending}
            label="Verify customer"
            onPress={handleVerify}
            testID="w2c-recipient-verify-button"
          />
        </Card>

        {(!!clientError || resolveMutation.isError) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} testID="w2c-recipient-error">
              {clientError || describeApiError(resolveMutation.error)}
            </Text>
          </View>
        )}

        {resolveMutation.isPending && (
          <Text style={styles.muted} testID="w2c-recipient-resolving">
            Verifying customer…
          </Text>
        )}

        {customer && (
          <Card style={styles.card} testID="w2c-customer-identity-card">
            <Text style={styles.sectionTitle}>Customer wallet</Text>
            <Text style={styles.displayName} testID="w2c-customer-display">
              {customer.display}
            </Text>
            <Text selectable style={styles.receivingNumber} testID="w2c-customer-number">
              {customer.receivingNumber}
            </Text>
            <Text style={styles.muted} testID="w2c-customer-status">
              Wallet status: {customer.status}
            </Text>
            {customer.ownerType !== 'CUSTOMER' && (
              <Text style={styles.errorText} testID="w2c-customer-ineligible">
                Only Customer wallets can perform Wallet→Cash cash-outs.
              </Text>
            )}
            {customer.ownerType === 'CUSTOMER' && customer.status !== 'ACTIVE' && (
              <Text style={styles.errorText} testID="w2c-customer-inactive">
                This customer wallet is not active and cannot perform cash-out.
              </Text>
            )}
          </Card>
        )}

        {customer && eligible && (
          <Button label="Continue" onPress={handleProceed} testID="w2c-recipient-continue" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

function describeCustomerLookupError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) {
      return 'Customer not found. Wallet→Cash requires an active customer wallet.';
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
  card: {},
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
