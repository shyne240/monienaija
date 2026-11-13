import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useAuthStore } from '../../store/auth-store';
import { ApiError, NetworkError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

interface LoginFeedback {
  title: string;
  body: string;
  tone: 'error' | 'warning';
}

/**
 * Maps an authentication failure to the real backend condition. The app never softens an
 * eligibility refusal into a generic error, and never suggests a session exists when it does not.
 */
export function describeLoginFailure(error: unknown): LoginFeedback {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      body: 'MonieNaija could not be reached. Check your connection and try again — you have not been signed in.',
      tone: 'warning',
    };
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return {
          title: 'Sign-in failed',
          body: 'That phone number, Customer ID or password is not correct. Check it and try again.',
          tone: 'error',
        };
      case 403:
        return {
          title: 'Account cannot sign in',
          body: 'This account is not permitted to sign in to the customer app right now. Contact support if you believe this is wrong.',
          tone: 'error',
        };
      case 409:
        return {
          title: 'Financial access not yet available',
          body: 'Your account exists and your credentials are correct, but it is not yet eligible for financial services. Complete verification in onboarding, or contact support.',
          tone: 'warning',
        };
      case 423:
        return {
          title: 'Account temporarily locked',
          body: 'Too many failed attempts. Wait before trying again; do not keep retrying or the lockout continues.',
          tone: 'warning',
        };
      case 429:
        return {
          title: 'Too many attempts',
          body: 'Please wait a moment before trying again.',
          tone: 'warning',
        };
      case 503:
        return {
          title: 'Service unavailable',
          body: 'The sign-in service is not available right now, so no session was created. Try again later.',
          tone: 'warning',
        };
      default:
        return {
          title: 'Sign-in failed',
          body:
            error.message || 'MonieNaija could not complete the sign-in. No session was created.',
          tone: 'error',
        };
    }
  }
  return {
    title: 'Sign-in failed',
    body: 'MonieNaija could not complete the sign-in. No session was created.',
    tone: 'error',
  };
}

export const LoginScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const [failure, setFailure] = useState<LoginFeedback | null>(null);

  const { login, isLoading, rotationRequired } = useAuthStore();

  const storeFailure = useMemo<LoginFeedback | null>(() => {
    if (rotationRequired) {
      return {
        title: 'Password change required',
        body: 'This is a temporary password. It must be changed before any session can be issued.',
        tone: 'warning',
      };
    }
    return null;
  }, [rotationRequired]);

  const handleLogin = async () => {
    if (!identifier.trim()) {
      setValidationError('Phone number or Customer ID is required');
      return;
    }
    if (!password) {
      setValidationError('Password is required');
      return;
    }

    setValidationError('');
    setFailure(null);

    try {
      await login(identifier, password);
    } catch (error) {
      setFailure(describeLoginFailure(error));
    }
  };

  const feedback = failure ?? storeFailure;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.eyebrow}>MonieNaija</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in with the phone number or Customer ID on your account and your password.
          </Text>
        </View>

        {(!!validationError || !!feedback) && (
          <View
            accessibilityRole="alert"
            style={[styles.banner, feedback?.tone === 'warning' && styles.bannerWarning]}
          >
            <Text style={styles.bannerTitle}>{feedback?.title ?? 'Check your details'}</Text>
            <Text style={styles.bannerBody}>{feedback?.body ?? validationError}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Phone Number or Customer ID"
            placeholder="e.g. 08012345678"
            textContentType="username"
            value={identifier}
            onChangeText={(text) => {
              setIdentifier(text);
              if (validationError) setValidationError('');
              if (failure) setFailure(null);
            }}
          />

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            label="Password"
            placeholder="••••••••"
            textContentType="password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (validationError) setValidationError('');
              if (failure) setFailure(null);
            }}
          />

          <Button loading={isLoading} label="Log In" style={styles.button} onPress={handleLogin} />

          {rotationRequired && (
            <Button
              label="Change my temporary password"
              variant="secondary"
              onPress={() => navigation.navigate('CredentialRotation')}
            />
          )}
        </View>

        <View style={styles.recoveryBlock}>
          <Text style={styles.helpTitle}>Forgotten your credentials?</Text>
          <Text style={styles.helpBody}>
            Recovery needs more than your phone number: MonieNaija sends a one-time code and also
            checks the verification evidence it already holds for you. If it cannot confirm enough,
            recovery stops and Support finishes it instead. Resetting a credential never grants
            financial access.
          </Text>
          <Button
            label="Forgot your login passcode?"
            variant="outline"
            onPress={() => navigation.navigate('CredentialRecovery', { purpose: 'LOGIN_PASSCODE' })}
          />
          <Button
            label="Forgot your transaction PIN?"
            variant="outline"
            onPress={() =>
              navigation.navigate('CredentialRecovery', { purpose: 'TRANSACTION_PIN' })
            }
          />
        </View>

        <View style={styles.helpBlock}>
          <Text style={styles.helpTitle}>New to MonieNaija?</Text>
          <Text style={styles.helpBody}>
            Start or resume onboarding with your phone number. Onboarding stays separate from
            financial access: a completed registration alone does not enable balances, transfers or
            cash operations.
          </Text>
          <Button
            label="Start or resume onboarding"
            variant="outline"
            onPress={() => navigation.navigate('Registration')}
          />
        </View>

        <Text style={styles.footnote}>
          Sessions expire. If you are signed out unexpectedly, sign in again — MonieNaija never
          restores a session that the backend has rejected.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface.cream,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    justifyContent: 'center',
  },
  header: {
    marginBottom: theme.spacing.xl,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.colors.surface.goldInk,
    marginBottom: theme.spacing.xxs,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    lineHeight: 22,
  },
  banner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 10,
    marginBottom: theme.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.feedback.error,
    gap: theme.spacing.xxs,
  },
  bannerWarning: {
    backgroundColor: theme.colors.feedback.warningLight,
    borderLeftColor: theme.colors.feedback.warning,
  },
  bannerTitle: {
    color: theme.colors.neutral.charcoal,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
  },
  bannerBody: {
    color: theme.colors.neutral.charcoal,
    fontSize: theme.typography.sizes.xs,
    lineHeight: 18,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: theme.spacing.md,
  },
  recoveryBlock: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    borderRadius: 14,
    backgroundColor: theme.colors.surface.mist,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
  },
  helpBlock: {
    marginTop: theme.spacing.xxl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface.hairline,
    gap: theme.spacing.sm,
  },
  helpTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  helpBody: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
    marginBottom: theme.spacing.sm,
  },
  footnote: {
    marginTop: theme.spacing.xl,
    fontSize: 10,
    color: theme.colors.neutral.gray,
    lineHeight: 16,
  },
});
