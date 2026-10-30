import React, { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { formatNairaFromMinor, newIdempotencyKey, parseNairaInputToMinor } from '../../../utils/format';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Wallet — Step 2: amount (V1-AGENT-MOBILE-04).
 *
 * NGN only, numeric keypad. Client validation blocks empty/zero/negative
 * amounts; kobo derivation is a PURE unit conversion — fees, limits and
 * authorization remain exclusively server-side. A single idempotency key is
 * minted here and kept for the whole attempt so double-executions cannot
 * duplicate.
 */
export const CashToWalletAmountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToWalletAmount'>>();
  const recipient = route.params.recipient;

  const [nairaInput, setNairaInput] = useState('');
  const [error, setError] = useState('');
  // Exactly ONE idempotency key per attempt (survives navigation + retries).
  const idempotencyKeyRef = useRef<string>(route.params.amountMinor ? '' : newIdempotencyKey('c2w'));
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey('c2w');

  const amountMinor = useMemo(() => parseNairaInputToMinor(nairaInput), [nairaInput]);

  const handleContinue = () => {
    if (!amountMinor) {
      setError('Enter an amount greater than zero (up to 2 decimal places)');
      return;
    }
    setError('');
    navigation.navigate('CashToWalletConfirm', {
      recipient,
      amountMinor,
      idempotencyKey: idempotencyKeyRef.current,
    });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>How much cash did you receive?</Text>
        <Text style={styles.helper}>
          Crediting wallet of <Text style={styles.strong}>{recipient.display}</Text> (
          {recipient.receivingNumber}).
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            label="Amount (NGN)"
            placeholder="0.00"
            value={nairaInput}
            testID="amount-input"
            onChangeText={(text) => {
              setNairaInput(text);
              setError('');
            }}
          />

          {amountMinor && (
            <Text style={styles.preview} testID="amount-preview">
              You will credit {formatNairaFromMinor(amountMinor)} NGN
            </Text>
          )}
          {!!error && <Text style={styles.errorText} testID="amount-error">{error}</Text>}

          <Button label="Continue" onPress={handleContinue} testID="amount-continue" style={styles.button} />
        </Card>

        <Text style={styles.footerNote}>
          The physical cash remains outside the electronic ledger — MonieNaija records only the
          electronic credit. Fees, limits and authorization are decided by the server.
        </Text>
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
  strong: { fontWeight: theme.typography.weights.bold, color: theme.colors.neutral.charcoal },
  card: {},
  preview: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.xs,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.xs,
  },
  button: { marginTop: theme.spacing.xs },
  footerNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
  },
});
