import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { RootStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/auth-store';
import { ApiError, NetworkError } from '../../services/api-client';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'CredentialRotation'>;

export interface RotationFeedback {
  title: string;
  body: string;
  tone: 'error' | 'warning';
}

/**
 * Maps a real rotation refusal to honest copy. A temporary credential that cannot be rotated is
 * never reported as a session, and a financial-eligibility refusal is never reported as a
 * credential problem.
 */
export function describeRotationFailure(error: unknown): RotationFeedback {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      body: 'MonieNaija could not be reached, so your temporary password is unchanged and no session was created.',
      tone: 'warning',
    };
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return {
          title: 'Check the new password',
          body: 'The new password must differ from the temporary one and meet the length rule shown below.',
          tone: 'error',
        };
      case 401:
        return {
          title: 'Temporary password not accepted',
          body: 'That temporary password is not correct, so nothing was changed. Check the SMS or message from MonieNaija and try again.',
          tone: 'error',
        };
      case 403:
        return {
          title: 'Nothing to change',
          body: 'This account has no pending first-login password change. Sign in normally instead.',
          tone: 'warning',
        };
      case 409:
        return {
          title: 'Financial access not yet available',
          body: 'Your password was accepted, but the account is not yet eligible for financial services, so no session was issued. Finish verification in onboarding or contact support.',
          tone: 'warning',
        };
      case 423:
        return {
          title: 'Account temporarily locked',
          body: 'Too many failed attempts. Wait before trying again; retrying immediately extends the lockout.',
          tone: 'warning',
        };
      case 429:
        return {
          title: 'Too many attempts',
          body: 'Please wait a moment before trying again. No password was changed.',
          tone: 'warning',
        };
      case 503:
        return {
          title: 'Service unavailable',
          body: 'The credential service is not available right now, so your temporary password is unchanged and no session was created.',
          tone: 'warning',
        };
      default:
        return {
          title: 'Password not changed',
          body:
            error.message || 'MonieNaija could not change this password. No session was created.',
          tone: 'error',
        };
    }
  }
  return {
    title: 'Password not changed',
    body: 'MonieNaija could not change this password. No session was created.',
    tone: 'error',
  };
}

/**
 * ARENA 4 — first-login credential rotation (`POST /customers/credentials/rotate`).
 *
 * A workforce-issued temporary password authenticates but issues no session. Rotation is the only
 * way forward: the backend re-verifies the temporary password, replaces it, revokes the rotated
 * credential's sessions and then issues the customer's first real session. Neither password is
 * stored by this screen; both live only in component state and are cleared on submit.
 */
export const CredentialRotationScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { rotateTemporaryCredential, isLoading, rotationCustomerId } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationError, setValidationError] = useState('');
  const [feedback, setFeedback] = useState<RotationFeedback | null>(null);

  const handleSubmit = async () => {
    if (!currentPassword) {
      setValidationError('Enter the temporary password you signed in with');
      return;
    }
    if (newPassword.length < 8) {
      setValidationError('The new password must be at least 8 characters');
      return;
    }
    if (newPassword === currentPassword) {
      setValidationError('The new password must be different from the temporary password');
      return;
    }
    if (newPassword !== confirmation) {
      setValidationError('The two new passwords do not match');
      return;
    }

    setValidationError('');
    setFeedback(null);
    try {
      await rotateTemporaryCredential(currentPassword, newPassword);
    } catch (error) {
      setFeedback(describeRotationFailure(error));
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.eyebrow}>First sign-in</Text>
          <Text style={styles.title}>Choose your password</Text>
          <Text style={styles.subtitle}>
            MonieNaija gave you a temporary password. Replace it now — until you do, no session can
            exist and nothing on your account can be used.
          </Text>
        </View>

        {!rotationCustomerId && (
          <View style={[styles.banner, styles.bannerWarning]}>
            <Text style={styles.bannerTitle}>Start signing in again</Text>
            <Text style={styles.bannerBody}>
              This password change belongs to a specific sign-in attempt, and that attempt is no
              longer active. Return to sign in and enter your temporary password once more.
            </Text>
          </View>
        )}

        {!!validationError && (
          <View accessibilityRole="alert" style={styles.banner}>
            <Text style={styles.bannerTitle}>Check your details</Text>
            <Text style={styles.bannerBody}>{validationError}</Text>
          </View>
        )}

        {feedback && (
          <View
            accessibilityRole="alert"
            style={[styles.banner, feedback.tone === 'warning' && styles.bannerWarning]}
          >
            <Text style={styles.bannerTitle}>{feedback.title}</Text>
            <Text style={styles.bannerBody}>{feedback.body}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Temporary password"
            placeholder="From your MonieNaija message"
            secureTextEntry
            value={currentPassword}
            onChangeText={(text) => {
              setCurrentPassword(text);
              if (validationError) setValidationError('');
            }}
          />
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            helperText="At least 8 characters. Never reuse your transaction PIN."
            label="New password"
            placeholder="At least 8 characters"
            secureTextEntry
            value={newPassword}
            onChangeText={(text) => {
              setNewPassword(text);
              if (validationError) setValidationError('');
            }}
          />
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Confirm new password"
            placeholder="Repeat the new password"
            secureTextEntry
            value={confirmation}
            onChangeText={(text) => {
              setConfirmation(text);
              if (validationError) setValidationError('');
            }}
          />
          <Button
            disabled={!rotationCustomerId}
            loading={isLoading}
            label="Change password and sign in"
            style={styles.button}
            onPress={handleSubmit}
          />
          <Button
            label="Back to sign in"
            variant="text"
            onPress={() => navigation.navigate('Login')}
          />
          <Text style={styles.footnote}>
            Your transaction PIN is separate and is never set or changed from this screen.
          </Text>
        </View>
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
    marginBottom: theme.spacing.lg,
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
  form: {
    gap: theme.spacing.md,
  },
  banner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 10,
    marginBottom: theme.spacing.md,
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
  button: {
    marginTop: theme.spacing.xs,
  },
  footnote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 18,
  },
});
