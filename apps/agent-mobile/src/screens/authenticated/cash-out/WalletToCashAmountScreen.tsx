import React, { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  formatNairaFromMinor,
  newIdempotencyKey,
  parseNairaInputToMinor,
} from '../../../utils/format';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Wallet→Cash Method 1 — Step 2: Amount (V1-AGENT-MOBILE-08).
 *
 * NGN only, numeric keypad. Client validation blocks empty/zero/negative
 * amounts; minor unit conversion is purely decimal formatting — fees, limits
 * and authorization remain exclusively server-side. A single idempotency key
 * is minted here and preserved across retries.
 */
export const WalletToCashAmountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WalletToCashAmount'>>();
  const customer = route.params.customer;

  const [nairaInput, setNairaInput] = useState('');
  const [error, setError] = useState('');
  // Exactly ONE idempotency key per attempt (survives navigation + retries).
  const idempotencyKeyRef = useRef<string>(
    route.params.amountMinor ? '' : newIdempotencyKey('w2c'),
  );
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey('w2c');

  const amountMinor = useMemo(() => parseNairaInputToMinor(nairaInput), [nairaInput]);

  const handleContinue = () => {
    if (!amountMinor) {
      setError('Enter an amount greater than zero (up to 2 decimal places)');
      return;
    }
    setError('');
    navigation.navigate('WalletToCashConfirm', {
      customer,
      amountMinor,
      idempotencyKey: idempotencyKeyRef.current,
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>How much cash does the customer want?</Text>
        <Text style={styles.helper}>
          Debiting customer wallet of <Text style={styles.strong}>{customer.display}</Text> (
          {customer.receivingNumber}).
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            label="Amount (NGN)"
            placeholder="0.00"
            value={nairaInput}
            testID="w2c-amount-input"
            onChangeText={(text) => {
              setNairaInput(text);
              setError('');
            }}
          />

          {amountMinor && (
            <Text style={styles.preview} testID="w2c-amount-preview">
              Customer will withdraw {formatNairaFromMinor(amountMinor)} NGN
            </Text>
          )}
          {!!error && (
            <Text style={styles.errorText} testID="w2c-amount-error">
              {error}
            </Text>
          )}

          <Button
            label="Continue"
            onPress={handleContinue}
            testID="w2c-amount-continue"
            style={styles.button}
          />
        </Card>

        <Text style={styles.footerNote}>
          Once authorized, the customer&apos;s wallet is debited and your agent float is credited.
          You will then hand over the physical cash to the customer.
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
