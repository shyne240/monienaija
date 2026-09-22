import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { PinInput } from '../../components/PinInput';
import { useAuthStore } from '../../store/auth-store';
import { classifyPinError, createPin } from '../../services/transaction-pin';

/** Creates the customer's transaction PIN. PINs live only in component state
 * and are cleared after every submission; they are never persisted anywhere. */
export const CreatePinScreen: React.FC = () => {
  const navigation = useNavigation();
  const { customerId } = useAuthStore();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleCreate = async () => {
    if (!customerId) {
      setError('Your session expired. Please log in again.');
      return;
    }
    if (pin.length < 4 || pin.length > 6) {
      setError('Your transaction PIN must be 4 to 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError('The confirmation PIN does not match.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await createPin(customerId, pin);
      setSuccess(true);
    } catch (err) {
      const classified = classifyPinError(err);
      setError(classified.message);
    } finally {
      // Never retain plaintext PINs after a submission attempt.
      setPin('');
      setConfirmPin('');
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>🔐</Text>
          <Text style={styles.successTitle}>Transaction PIN Created</Text>
          <Text style={styles.successDescription}>
            You will now authorize transfers and withdrawals with this PIN.
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
          <Text style={styles.title}>Create Transaction PIN</Text>
          <Text style={styles.subtitle}>
            Your 4–6 digit PIN authorizes money that leaves your wallet. It is stored securely and
            never displayed again.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <PinInput label="Enter Transaction PIN" value={pin} onChange={setPin} />
          <PinInput label="Confirm Transaction PIN" value={confirmPin} onChange={setConfirmPin} />
          <Button
            disabled={pin.length < 4 || confirmPin.length < 4}
            loading={isLoading}
            label="Create PIN"
            style={styles.button}
            onPress={handleCreate}
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

export default CreatePinScreen;
