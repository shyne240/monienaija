import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { useAuthStore } from '../../store/auth-store';

/**
 * Mandatory first-login credential rotation (spec §7):
 * POST /agents/credentials/rotate {agentId, currentPassword, newPassword}.
 * The temporary (workforce-issued) password proves possession; the new password
 * (min 8 chars) becomes the agent's credential. On success, the backend issues
 * the agent's first real session and the app enters the authenticated
 * experience. Neither the temporary nor the new password is persisted or logged.
 */
export const RotateCredentialScreen: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const { rotateCredentials, isLoading, error, clearError } = useAuthStore();

  const handleRotation = async () => {
    if (!currentPassword) {
      setValidationError('Your current (temporary) password is required');
      return;
    }
    if (newPassword.length < 8) {
      setValidationError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError('New password and confirmation do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setValidationError('New password must differ from the temporary password');
      return;
    }

    setValidationError('');
    clearError();

    try {
      await rotateCredentials(currentPassword, newPassword);
    } catch {
      // Error surfaces through the store's error state.
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Set Your New Password</Text>
          <Text style={styles.subtitle}>
            Your temporary password must be replaced before continuing. This is required before
            any Agent activity.
          </Text>
        </View>

        <Card variant="flat" style={styles.infoBanner} testID="rotation-security-note">
          <Text style={styles.infoText}>
            For your security: never share your password. MoneyNaija staff will never ask for it.
          </Text>
        </Card>

        {(!!validationError || !!error) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{validationError || error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            label="Temporary password"
            placeholder="Issued temporary password"
            value={currentPassword}
            testID="current-password-input"
            onChangeText={(text) => {
              setCurrentPassword(text);
              if (validationError) setValidationError('');
            }}
          />

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            label="New password"
            placeholder="Minimum 8 characters"
            value={newPassword}
            testID="new-password-input"
            onChangeText={(text) => {
              setNewPassword(text);
              if (validationError) setValidationError('');
            }}
          />

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            label="Confirm new password"
            placeholder="Repeat the new password"
            value={confirmPassword}
            testID="confirm-password-input"
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (validationError) setValidationError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Set New Password"
            style={styles.button}
            testID="rotate-button"
            onPress={handleRotation}
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
    justifyContent: 'center',
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
    lineHeight: 22,
  },
  infoBanner: {
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.md,
  },
  infoText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 8,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: theme.spacing.sm,
  },
});
