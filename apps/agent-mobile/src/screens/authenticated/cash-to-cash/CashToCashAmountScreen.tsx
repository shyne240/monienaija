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
 * Cash→Cash — Step 2: Amount Entry (V1-AGENT-MOBILE-07 / C2C-2).
 *
 * NGN only, decimal keypad. Client validation blocks empty/zero/negative
 * amounts. Conversion to minor units (kobo) is a pure unit conversion.
 * Limits, fees and authorization remain backend-authoritative.
 * Exactly ONE idempotency key is minted here for the attempt.
 */
export const CashToCashAmountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashAmount'>>();
  const { beneficiaryPhone } = route.params;

  const [nairaInput, setNairaInput] = useState('');
  const [error, setError] = useState('');

  // Exactly ONE idempotency key per attempt (survives navigation + retries).
  const idempotencyKeyRef = useRef<string>(route.params.amountMinor ? '' : newIdempotencyKey('c2c'));
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey('c2c');

  const amountMinor = useMemo(() => parseNairaInputToMinor(nairaInput), [nairaInput]);

  const handleContinue = () => {
    if (!amountMinor) {
      setError('Enter an amount greater than zero (up to 2 decimal places)');
      return;
    }
    setError('');
    navigation.navigate('CashToCashConfirm', {
      beneficiaryPhone,
      amountMinor,
      idempotencyKey: idempotencyKeyRef.current,
    });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>How much cash to send?</Text>
        <Text style={styles.helper}>
          Sending to beneficiary phone <Text style={styles.strong}>{beneficiaryPhone}</Text>.
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            label="Amount (NGN)"
            placeholder="0.00"
            value={nairaInput}
            testID="c2c-amount-input"
            onChangeText={(text) => {
              setNairaInput(text);
              setError('');
            }}
          />

          {amountMinor && (
            <Text style={styles.preview} testID="c2c-amount-preview">
              You will send {formatNairaFromMinor(amountMinor)} NGN
            </Text>
          )}
          {!!error && <Text style={styles.errorText} testID="c2c-amount-error">{error}</Text>}

          <Button
            label="Continue"
            onPress={handleContinue}
            testID="c2c-amount-continue"
            style={styles.button}
          />
        </Card>

        <Text style={styles.footerNote}>
          Your Agent balance will be debited and held in unclaimed funds until the recipient
          claims the cash. Limits and authorization are decided by the server.
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
