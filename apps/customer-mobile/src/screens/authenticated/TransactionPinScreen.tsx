import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ApiClient, ApiError } from '../../services/api-client';

const PIN_REGEX = /^\d{4,12}$/;

/**
 * V1-CUSTOMER-02 — Customer Transaction PIN management.
 *
 * Calls the real backend contract `POST /customers/me/transaction-pin`
 * (`CustomerTransactionPinService.setTransactionPin`, PBKDF2-hashed,
 * never returns the hash). The backend exposes a single idempotent "set"
 * operation (it does not require proof of a previous PIN before overwriting
 * it), so this screen does not fabricate a separate "current PIN" step that
 * the backend does not implement.
 *
 * The PIN exists only in local component state: it is never logged, never
 * written to SecureStore/Zustand/navigation params, and is cleared on
 * submit, success, error, and unmount.
 */
export const TransactionPinScreen: React.FC = () => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(
    () => () => {
      setPin('');
      setConfirmPin('');
    },
    [],
  );

  const handleSubmit = async () => {
    setError('');
    setSuccess(false);

    if (!PIN_REGEX.test(pin.trim())) {
      setError('PIN must be 4 to 12 numeric digits.');
      return;
    }
    if (pin.trim() !== confirmPin.trim()) {
      setError('PIN confirmation does not match.');
      return;
    }

    setIsLoading(true);
    try {
      await ApiClient.post('/customers/me/transaction-pin', { pin: pin.trim() });
      setSuccess(true);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message || 'Could not set Transaction PIN.' : 'Could not set Transaction PIN.');
    } finally {
      setPin('');
      setConfirmPin('');
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Transaction PIN</Text>
          <Text style={styles.subtitle}>
            Your Transaction PIN authorizes every Wallet-to-Wallet transfer you send. Keep it secret
            — MonieNaija staff will never ask you for it.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {success && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>Transaction PIN set successfully.</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            maxLength={12}
            label="New Transaction PIN"
            placeholder="••••"
            value={pin}
            onChangeText={(text) => {
              setPin(text);
              if (error) setError('');
            }}
          />

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            maxLength={12}
            label="Confirm Transaction PIN"
            placeholder="••••"
            value={confirmPin}
            onChangeText={(text) => {
              setConfirmPin(text);
              if (error) setError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Set Transaction PIN"
            style={styles.button}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
  },
  header: {
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: theme.spacing.md,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.feedback.error,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
  successBanner: {
    backgroundColor: theme.colors.feedback.successLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.feedback.success,
  },
  successText: {
    color: theme.colors.feedback.success,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
});
