import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { PinInput } from '../../components/PinInput';
import { useAuthStore } from '../../store/auth-store';
import { classifyPinError, changePin } from '../../services/transaction-pin';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ChangePin'>;

/** Changes the transaction PIN; the current PIN authorizes the change. */
export const ChangePinScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId } = useAuthStore();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = async () => {
    if (!customerId) {
      setError('Your session expired. Please log in again.');
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
    if (currentPin === newPin) {
      setError('Your new PIN must be different from the current PIN.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await changePin(customerId, currentPin, newPin);
      setSuccess(true);
    } catch (err) {
      setError(classifyPinError(err).message);
    } finally {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>Transaction PIN Updated</Text>
          <Text style={styles.successDescription}>
            Use your new PIN to authorize future transfers and withdrawals.
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
          <Text style={styles.title}>Change Transaction PIN</Text>
          <Text style={styles.subtitle}>
            Enter your current PIN to authorize the change.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <PinInput label="Current Transaction PIN" value={currentPin} onChange={setCurrentPin} />
          <PinInput label="New Transaction PIN" value={newPin} onChange={setNewPin} />
          <PinInput label="Confirm New PIN" value={confirmPin} onChange={setConfirmPin} />
          <Button
            disabled={currentPin.length < 4 || newPin.length < 4 || confirmPin.length < 4}
            loading={isLoading}
            label="Change PIN"
            style={styles.button}
            onPress={handleChange}
          />
          <Button
            label="Forgot PIN? Reset with your password"
            style={styles.resetLink}
            variant="outline"
            onPress={() => navigation.navigate('ResetPin')}
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
  resetLink: {
    marginTop: theme.spacing.sm,
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

export default ChangePinScreen;
