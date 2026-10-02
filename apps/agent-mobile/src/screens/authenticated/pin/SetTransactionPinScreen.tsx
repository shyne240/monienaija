import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  describeTransactionPinError,
  setAgentTransactionPin,
  verifyAgentTransactionPin,
} from '../../../services/agent-api';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

const PIN_REGEX = /^\d{4,12}$/;

/**
 * Agent Set / Change Transaction PIN Screen (V1-AGENT-MOBILE-10 / PIN-2..4).
 *
 * Requirements:
 * - Supports initial creation (mode === 'CREATE') and rotation (mode === 'ROTATE').
 * - Validates 4-12 numeric digits client-side.
 * - In ROTATE mode, verifies the current PIN before setting the new PIN.
 * - Strict ephemeral credentials rule: PINs exist ONLY in component state, are never
 *   logged, persisted in SecureStore/Zustand/React Query, or passed in navigation params,
 *   and are cleared on submit, success, error, or unmount.
 */
export const SetTransactionPinScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SetTransactionPin'>>();
  const mode = route.params?.mode ?? 'CREATE';
  const isRotate = mode === 'ROTATE';
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [clientError, setClientError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Safety: wipe sensitive credentials when component unmounts
  useEffect(() => () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  }, []);

  const pinMutation = useMutation<void, unknown, void>({
    mutationFn: async () => {
      if (isRotate) {
        // Step 1: Verify current PIN
        const verifyResult = await verifyAgentTransactionPin(currentPin.trim());
        if (!verifyResult.verified) {
          if (verifyResult.locked || verifyResult.reason === 'PIN_LOCKED') {
            throw new Error('Transaction PIN is locked due to too many failed attempts.');
          }
          throw new Error('Current Transaction PIN is incorrect.');
        }
      }

      // Step 2: Set/Rotate PIN
      await setAgentTransactionPin(newPin.trim(), confirmPin.trim());
    },
    onSuccess: () => {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setClientError('');
      setIsSuccess(true);
      void queryClient.invalidateQueries({ queryKey: ['agent-transaction-pin-status', agentId] });
    },
    onError: () => {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    },
  });

  const handleSubmit = () => {
    setClientError('');

    if (isRotate) {
      if (!currentPin.trim()) {
        setClientError('Enter your current Transaction PIN.');
        return;
      }
      if (!PIN_REGEX.test(currentPin.trim())) {
        setClientError('Current PIN must be 4 to 12 numeric digits.');
        return;
      }
    }

    if (!newPin.trim()) {
      setClientError('Enter your new Transaction PIN.');
      return;
    }

    if (!PIN_REGEX.test(newPin.trim())) {
      setClientError('New PIN must be 4 to 12 numeric digits.');
      return;
    }

    if (isRotate && newPin.trim() === currentPin.trim()) {
      setClientError('New PIN must be different from current PIN.');
      return;
    }

    if (!confirmPin.trim()) {
      setClientError('Confirm your new Transaction PIN.');
      return;
    }

    if (newPin.trim() !== confirmPin.trim()) {
      setClientError('PIN confirmation does not match.');
      return;
    }

    pinMutation.mutate();
  };

  const failureText = clientError
    ? clientError
    : pinMutation.isError
      ? describeTransactionPinError(pinMutation.error)
      : '';

  if (isSuccess) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.successCard} testID="pin-success-card">
          <Text style={styles.checkMark}>✓</Text>
          <Text style={styles.successTitle} testID="pin-success-title">
            {isRotate ? 'Transaction PIN Updated' : 'Transaction PIN Set'}
          </Text>
          <Text style={styles.successMessage} testID="pin-success-message">
            {isRotate
              ? 'Your Agent Transaction PIN has been changed successfully. Use your new PIN for future transaction authorizations.'
              : 'Your Agent Transaction PIN is now active. You will use it to authorize financial transactions.'}
          </Text>
          <Button
            label="Done"
            onPress={() => navigation.navigate('TransactionPinManage')}
            testID="pin-success-done"
            style={styles.button}
          />
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>
          {isRotate ? 'Change Transaction PIN' : 'Set Transaction PIN'}
        </Text>
        <Text style={styles.helper}>
          {isRotate
            ? 'Enter your current Transaction PIN and choose a new 4-12 digit numeric PIN.'
            : 'Choose a 4-12 digit numeric PIN. You will need this PIN to authorize cash-in and cash-to-cash transactions.'}
        </Text>

        <Card style={styles.card}>
          {isRotate && (
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              secureTextEntry
              label="Current Transaction PIN"
              placeholder="••••"
              value={currentPin}
              maxLength={12}
              testID="pin-input-current"
              onChangeText={(text) => {
                setCurrentPin(text);
                setClientError('');
              }}
            />
          )}

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="New Transaction PIN"
            placeholder="••••"
            value={newPin}
            maxLength={12}
            testID="pin-input-new"
            onChangeText={(text) => {
              setNewPin(text);
              setClientError('');
            }}
          />

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            secureTextEntry
            label="Confirm New Transaction PIN"
            placeholder="••••"
            value={confirmPin}
            maxLength={12}
            testID="pin-input-confirm"
            onChangeText={(text) => {
              setConfirmPin(text);
              setClientError('');
            }}
          />

          {!!failureText && (
            <Text style={styles.errorText} testID="pin-form-error">
              {failureText}
            </Text>
          )}

          <Button
            loading={pinMutation.isPending}
            label={
              pinMutation.isPending
                ? 'Processing…'
                : isRotate
                  ? 'Update Transaction PIN'
                  : 'Save Transaction PIN'
            }
            onPress={handleSubmit}
            testID="pin-submit-button"
            style={styles.button}
          />
        </Card>
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
    backgroundColor: theme.colors.neutral.offWhite,
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
  card: {
    gap: theme.spacing.sm,
  },
  successCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  checkMark: {
    fontSize: 48,
    color: theme.colors.feedback.success,
    marginBottom: theme.spacing.xs,
  },
  successTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 20,
    marginHorizontal: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    marginVertical: theme.spacing.xs,
  },
  button: {
    marginTop: theme.spacing.xs,
  },
});
