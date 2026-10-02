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
  resolveAgentRecipient,
  type ResolvedRecipientView,
} from '../../../services/agent-api';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Wallet — Step 1: recipient (V1-AGENT-MOBILE-04).
 *
 * The agent enters the customer's MonieNaija receiving number / phone and the
 * backend resolution endpoint (GET /recipients/resolve) returns the identity.
 * Only backend-returned identity is shown (display + receiving number +
 * status). AGENT recipients are ineligible for Cash→Wallet per the backend
 * contract, so they are blocked client-side with a clear message. No customer
 * records are searched locally; no internal IDs displayed.
 */
export const CashToWalletRecipientScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [identifier, setIdentifier] = useState('');
  const [clientError, setClientError] = useState('');
  const [recipient, setRecipient] = useState<ResolvedRecipientView | null>(null);

  const resolveMutation = useMutation({
    mutationFn: () => resolveAgentRecipient(identifier),
    onSuccess: (view) => setRecipient(view),
  });

  const sanitizeForLookup = (value: string) => value.replace(/[\s-]/g, '');

  const handleContinue = () => {
    const cleaned = sanitizeForLookup(identifier);
    if (!/^(\+?\d{10,13})$/.test(cleaned)) {
      setClientError('Enter the 10-digit MonieNaija receiving number (or phone number)');
      setRecipient(null);
      return;
    }
    setClientError('');
    resolveMutation.mutate();
  };

  const handleProceed = () => {
    if (!recipient) return;
    if (recipient.ownerType !== 'CUSTOMER') {
      setClientError('Only Customer wallets can receive Cash→Wallet credits');
      return;
    }
    if (recipient.status !== 'ACTIVE') {
      setClientError('This recipient wallet is not active');
      return;
    }
    navigation.navigate('CashToWalletAmount', { recipient });
  };

  const eligible = recipient?.ownerType === 'CUSTOMER' && recipient?.status === 'ACTIVE';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Receive cash / credit a wallet</Text>
        <Text style={styles.helper}>
          Collect the physical cash from the customer first. Then enter the MonieNaija receiving
          number of the wallet you are crediting.
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Recipient MonieNaija number"
            placeholder="e.g. 8000000001"
            value={identifier}
            maxLength={15}
            testID="recipient-input"
            onChangeText={(text) => {
              setIdentifier(text);
              setClientError('');
              setRecipient(null);
              resolveMutation.reset();
            }}
          />
          <Button
            loading={resolveMutation.isPending}
            label="Verify recipient"
            onPress={handleContinue}
            testID="recipient-verify-button"
          />
        </Card>

        {(!!clientError || resolveMutation.isError) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} testID="recipient-error">
              {clientError || describeApiError(resolveMutation.error)}
            </Text>
          </View>
        )}

        {resolveMutation.isPending && (
          <Text style={styles.muted} testID="recipient-resolving">Verifying recipient…</Text>
        )}

        {recipient && (
          <Card style={styles.card} testID="recipient-identity-card">
            <Text style={styles.sectionTitle}>
              {recipient.ownerType === 'CUSTOMER' ? 'Customer wallet' : 'Agent wallet'}
            </Text>
            <Text style={styles.displayName} testID="recipient-display">{recipient.display}</Text>
            <Text selectable style={styles.receivingNumber} testID="recipient-number">
              {recipient.receivingNumber}
            </Text>
            <Text style={styles.muted} testID="recipient-status">
              Wallet status: {recipient.status}
            </Text>
            {recipient.ownerType !== 'CUSTOMER' && (
              <Text style={styles.errorText} testID="recipient-ineligible">
                Agent wallets cannot receive Cash→Wallet credits.
              </Text>
            )}
            {recipient.ownerType === 'CUSTOMER' && recipient.status !== 'ACTIVE' && (
              <Text style={styles.errorText} testID="recipient-inactive">
                This customer wallet is not active and cannot receive credits.
              </Text>
            )}
          </Card>
        )}

        {recipient && eligible && (
          <Button label="Continue" onPress={handleProceed} testID="recipient-continue" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

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
