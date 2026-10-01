import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { useAuthStore } from '../../store/auth-store';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Agent login (spec §6): POST /agents/sessions {agentId, password}.
 * On success the session establishes the authenticated experience.
 * If the backend requests mandatory credential rotation the store enters the
 * pending-rotation state and the navigator gates the app onto the rotation
 * screen — the UI never establishes a session in that branch.
 */
export const LoginScreen: React.FC = () => {
  const [agentId, setAgentId] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const { login, isLoading, error, clearError } = useAuthStore();

  const handleLogin = async () => {
    if (!agentId.trim()) {
      setValidationError('Agent ID is required');
      return;
    }
    if (!UUID_PATTERN.test(agentId.trim())) {
      setValidationError('Agent ID must be a valid UUID');
      return;
    }
    if (!password) {
      setValidationError('Password is required');
      return;
    }

    setValidationError('');
    clearError();

    try {
      // Rotation-required results are handled by the store/navigator.
      await login(agentId, password);
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
          <Text style={styles.brand}>MoneyNaija Agent</Text>
          <Text style={styles.subtitle}>
            Sign in with the Agent ID and password issued to your outlet by MoneyNaija.
          </Text>
        </View>

        <Card variant="flat" style={styles.infoBanner} testID="login-security-note">
          <Text style={styles.infoText}>
            First-time sign in with an issued temporary password will require you to set a new
            password before you can continue.
          </Text>
        </Card>

        {(!!validationError || !!error) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{validationError || error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Agent ID"
            placeholder="Agent UUID"
            value={agentId}
            testID="agent-id-input"
            onChangeText={(text) => {
              setAgentId(text);
              if (validationError) setValidationError('');
            }}
          />

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            label="Password"
            placeholder="••••••••"
            value={password}
            testID="password-input"
            onChangeText={(text) => {
              setPassword(text);
              if (validationError) setValidationError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Log In"
            style={styles.button}
            testID="login-button"
            onPress={handleLogin}
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
  brand: {
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
