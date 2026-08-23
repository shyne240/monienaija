import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { useAuthStore } from '../../store/auth-store';
import { DEV_AUTH_MOCK } from '../../config';

export const LoginScreen: React.FC = () => {
  const [customerId, setCustomerId] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const { login, isLoading, error, clearError } = useAuthStore();

  const handleLogin = async () => {
    if (!customerId.trim()) {
      setValidationError('Customer ID is required');
      return;
    }
    if (!password) {
      setValidationError('Password is required');
      return;
    }

    setValidationError('');
    clearError();

    try {
      await login(customerId, password);
    } catch {
      // Error handled by store error state
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Enter your Customer ID and Password to continue</Text>
        </View>

        {DEV_AUTH_MOCK ? (
          <Card variant="flat" style={styles.devBanner}>
            <Text style={styles.devTitle}>🛠️ Sandbox Development Mode Active</Text>
            <Text style={styles.devText}>
              Standard customer sessions are currently parked under ADR-0019 as future A2 work. Mock credentials will be accepted.
            </Text>
          </Card>
        ) : (
          <Card variant="flat" style={styles.prodWarningBanner}>
            <Text style={styles.prodWarningTitle}>⚠️ Production Mode Active</Text>
            <Text style={styles.prodWarningText}>
              Mock authentication is disabled. Authentication requires backend runtime capability.
            </Text>
          </Card>
        )}

        {(!!validationError || !!error) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{validationError || error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Customer ID (UUID)"
            placeholder="e.g. 1a2b3c4d-5e6f-..."
            value={customerId}
            onChangeText={(text) => {
              setCustomerId(text);
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
            onChangeText={(text) => {
              setPassword(text);
              if (validationError) setValidationError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Log In"
            style={styles.button}
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
  devBanner: {
    backgroundColor: theme.colors.secondary.lightest,
    borderColor: theme.colors.secondary.main,
    borderWidth: 1,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  devTitle: {
    color: theme.colors.secondary.dark,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.sm,
    marginBottom: 4,
  },
  devText: {
    color: theme.colors.neutral.slate,
    fontSize: theme.typography.sizes.xs,
    lineHeight: 16,
  },
  prodWarningBanner: {
    backgroundColor: theme.colors.feedback.warningLight,
    borderColor: theme.colors.feedback.warning,
    borderWidth: 1,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  prodWarningTitle: {
    color: theme.colors.feedback.warning,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.sm,
    marginBottom: 4,
  },
  prodWarningText: {
    color: theme.colors.neutral.slate,
    fontSize: theme.typography.sizes.xs,
    lineHeight: 16,
  },
});

