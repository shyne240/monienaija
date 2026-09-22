import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { PinInput } from '../../components/PinInput';
import { useAuthStore } from '../../store/auth-store';
import { classifyPinError, resetPin } from '../../services/transaction-pin';

/**
 * Transaction PIN recovery. Recovery authorization reuses the customer's
 * existing account password — knowing the customer ID alone never resets a
 * PIN. The password and PIN are cleared after every submission and never
 * persisted anywhere.
 */
export const ResetPinScreen: React.FC = () => {
  const navigation = useNavigation();
  const { customerId } = useAuthStore();

  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    if (!customerId) {
      setError('Your session expired. Please log in again.');
      return;
    }
    if (!password) {
      setError('Enter your account password to authorize this reset.');
      return;
    }
    if (newPin.length < 4 || newPin.length > 6) {
      setError('Your new transaction PIN must be 4 to 6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('The confirmation PIN does not match.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await resetPin(customerId, password, newPin);
      setSuccess(true);
    } catch (err) {
      setError(classifyPinError(err).message);
    } finally {
      setPassword('');
      setNewPin('');
      setConfirmPin('');
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>🔑</Text>
          <Text style={styles.successTitle}>Transaction PIN Reset</Text>
          <Text style={styles.successDescription}>
            Your new PIN is active immediately, including if your PIN was locked.
          </Text>
        </View>
        <Button label="Back to Profile" style={styles.button} onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Reset Transaction PIN</Text>
          <Text style={styles.subtitle}>
            Authorize with your account password, then choose a new 4–6 digit PIN. This also
            recovers a locked PIN.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Account Password"
            placeholder="Your login password"
            secureTextEntry={true}
            value={password}
            onChangeText={setPassword}
          />
          <PinInput label="New Transaction PIN" value={newPin} onChange={setNewPin} />
          <PinInput label="Confirm New PIN" value={confirmPin} onChange={setConfirmPin} />
          <Button
            disabled={!password || newPin.length < 4 || confirmPin.length < 4}
            loading={isLoading}
            label="Reset PIN"
            style={styles.button}
            onPress={handleReset}
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
  successContainer: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  successContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: theme.spacing.lg,
  },
  successTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  successDescription: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
});

export default ResetPinScreen;
