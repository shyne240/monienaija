import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { LoadingState } from '../../components/LoadingState';
import { ApiClient, ApiError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

const PIN_REGEX = /^\d{4,12}$/;

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionPin'>;

type PinStatus = 'LOADING' | 'NOT_SET' | 'ACTIVE' | 'LOCKED' | 'STATUS_ERROR';

interface PinStatusResponse {
  status: 'NOT_SET' | 'ACTIVE' | 'LOCKED';
  exists: boolean;
  accountLocked: boolean;
  pinVersion?: number;
  lastChangedAt?: string;
}

/**
 * V1-CUSTOMER-05 — Secure Customer Transaction PIN management.
 *
 * Distinguishes three operations against the real backend contract:
 *  - CREATE  (`POST customers/me/transaction-pin`)        — only offered when
 *    `GET customers/me/transaction-pin` reports NOT_SET. The backend now
 *    rejects a second create with 409 if a PIN already exists, so this
 *    screen never lets a create attempt silently overwrite an existing PIN.
 *  - CHANGE  (`POST customers/me/transaction-pin/change`) — only offered
 *    when status is ACTIVE. Requires the current PIN as proof of knowledge
 *    before the server will replace it (same 5-attempt lockout counter used
 *    by Wallet→Wallet authorization).
 *  - LOCKED  — V1 has no secure, out-of-band way to prove identity
 *    independently of the PIN itself, so there is no in-app PIN reset for a
 *    locked PIN. This screen says so plainly and links to Support rather
 *    than presenting a fake "Reset PIN" button.
 *
 * The PIN values exist only in local component state: never logged, never
 * written to SecureStore/Zustand/navigation params, and cleared on submit,
 * success, error, status change, and unmount.
 */
export const TransactionPinScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const [status, setStatus] = useState<PinStatus>('LOADING');
  const [pinVersion, setPinVersion] = useState<number | undefined>(undefined);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearPinFields = useCallback(() => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  }, []);

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const res = await ApiClient.get<PinStatusResponse>('/customers/me/transaction-pin');
      setPinVersion(res.pinVersion);
      setStatus(res.status);
    } catch (err) {
      setStatus('STATUS_ERROR');
      setError(err instanceof ApiError ? err.message || 'Could not load Transaction PIN status.' : 'Could not load Transaction PIN status.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      clearPinFields();
      setSuccess('');
      void loadStatus();
      return () => {
        clearPinFields();
      };
    }, [clearPinFields, loadStatus]),
  );

  useEffect(
    () => () => {
      clearPinFields();
    },
    [clearPinFields],
  );

  const handleCreate = async () => {
    setError('');
    setSuccess('');

    if (!PIN_REGEX.test(newPin.trim())) {
      setError('PIN must be 4 to 12 numeric digits.');
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setError('PIN confirmation does not match.');
      return;
    }

    setIsLoading(true);
    try {
      await ApiClient.post('/customers/me/transaction-pin', { pin: newPin.trim() });
      setSuccess('Transaction PIN created successfully.');
      clearPinFields();
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message || 'Could not create Transaction PIN.' : 'Could not create Transaction PIN.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = async () => {
    setError('');
    setSuccess('');

    if (!PIN_REGEX.test(currentPin.trim())) {
      setError('Current PIN must be 4 to 12 numeric digits.');
      return;
    }
    if (!PIN_REGEX.test(newPin.trim())) {
      setError('New PIN must be 4 to 12 numeric digits.');
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setError('New PIN confirmation does not match.');
      return;
    }
    if (currentPin.trim() === newPin.trim()) {
      setError('New PIN must be different from your current PIN.');
      return;
    }

    setIsLoading(true);
    try {
      await ApiClient.post('/customers/me/transaction-pin/change', {
        currentPin: currentPin.trim(),
        newPin: newPin.trim(),
      });
      setSuccess('Transaction PIN changed successfully.');
      clearPinFields();
      await loadStatus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && /locked/i.test(err.message || '')) {
        // The change attempt itself triggered (or hit) the lockout — refresh status so the
        // screen switches to the LOCKED view instead of re-showing a change form the
        // backend will now always reject.
        clearPinFields();
        await loadStatus();
        return;
      }
      setError(err instanceof ApiError ? err.message || 'Could not change Transaction PIN.' : 'Could not change Transaction PIN.');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'LOADING') {
    return <LoadingState message="Checking Transaction PIN status..." />;
  }

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

        {!!success && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{success}</Text>
          </View>
        )}

        {status === 'STATUS_ERROR' && (
          <View style={styles.form}>
            <Button label="Retry" onPress={() => { setStatus('LOADING'); void loadStatus(); }} />
          </View>
        )}

        {status === 'LOCKED' && (
          <View style={styles.form}>
            <View style={styles.lockedBanner}>
              <Text style={styles.lockedTitle}>Transaction PIN locked</Text>
              <Text style={styles.lockedText}>
                Your Transaction PIN was locked after too many incorrect attempts. For your
                security, MonieNaija does not offer an in-app PIN reset in this version — your
                identity cannot yet be verified by any channel other than the PIN itself. Please
                contact Support to have your PIN unlocked.
              </Text>
            </View>
            <Button
              label="Contact Support"
              style={styles.button}
              onPress={() => navigation.navigate('CreateSupportTicket')}
            />
          </View>
        )}

        {status === 'NOT_SET' && (
          <View style={styles.form}>
            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={12}
              label="New Transaction PIN"
              placeholder="Enter new PIN"
              value={newPin}
              onChangeText={(text) => {
                setNewPin(text);
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
              placeholder="Confirm new PIN"
              value={confirmPin}
              onChangeText={(text) => {
                setConfirmPin(text);
                if (error) setError('');
              }}
            />
            <Button
              loading={isLoading}
              disabled={isLoading}
              label="Create Transaction PIN"
              style={styles.button}
              onPress={handleCreate}
            />
          </View>
        )}

        {status === 'ACTIVE' && (
          <View style={styles.form}>
            <Text style={styles.activeNote}>
              {pinVersion ? `PIN version ${pinVersion} is active.` : 'A Transaction PIN is active on this account.'}
              {' '}Enter your current PIN to set a new one.
            </Text>
            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={12}
              label="Current Transaction PIN"
              placeholder="Enter current PIN"
              value={currentPin}
              onChangeText={(text) => {
                setCurrentPin(text);
                if (error) setError('');
              }}
            />
            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={12}
              label="New Transaction PIN"
              placeholder="Enter new PIN"
              value={newPin}
              onChangeText={(text) => {
                setNewPin(text);
                if (error) setError('');
              }}
            />
            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={12}
              label="Confirm New Transaction PIN"
              placeholder="Confirm new PIN"
              value={confirmPin}
              onChangeText={(text) => {
                setConfirmPin(text);
                if (error) setError('');
              }}
            />
            <Button
              loading={isLoading}
              disabled={isLoading}
              label="Change Transaction PIN"
              style={styles.button}
              onPress={handleChange}
            />
          </View>
        )}
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
  activeNote: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    marginBottom: theme.spacing.md,
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
  lockedBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.feedback.error,
  },
  lockedTitle: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    marginBottom: theme.spacing.xs,
  },
  lockedText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
  },
});
