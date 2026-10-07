import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ApiClient, ApiError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Registration'>;

/**
 * V1-CUSTOMER-04 — Customer self-service registration.
 *
 * Calls the real, public, OTP-verified backend contract (unauthenticated,
 * no privileged principal required — see `src/authorization/route-policy-registry.ts`
 * `PUBLIC_ROUTES` and `CustomerRegistrationController`):
 *
 *   POST /customers/registration/otp         { phone }
 *   POST /customers/registration/otp/verify  { phone, code }
 *   POST /customers/registration             { phone, verificationToken, password, displayName?, idempotencyKey? }
 *
 * This screen previously called the workforce-only `POST /customers` endpoint,
 * which requires an internal SUPPORT/OPERATOR/SERVICE/PRIVILEGED principal and
 * never collected a password or verified phone ownership — see
 * docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md Section 9/10/12 for the forensic finding.
 *
 * The backend's registration-completion response does NOT include a session
 * (no accessToken) — see `CustomerRegistrationService.completeRegistration`.
 * A newly registered customer must log in afterward via `POST /customers/sessions`
 * (handled by the existing, correct `LoginScreen`/`auth-store`), exactly like any
 * other customer. This screen never fabricates a session and never auto-authenticates.
 *
 * The OTP code, password, and verification token are held only in local component
 * state, are never logged, and are cleared on success, failure, or unmount.
 */

type Step = 'PHONE' | 'OTP' | 'DETAILS' | 'SUCCESS';

interface RequestOtpResponse {
  status: 'OTP_REQUEST_ACCEPTED';
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

interface VerifyOtpResponse {
  status: 'PHONE_VERIFIED';
  verificationToken: string;
  expiresInSeconds: number;
}

interface CompleteRegistrationResponse {
  id: string;
  reference: string;
  status: string;
  phone: string;
  phoneVerifiedAt: string;
  wallet?: { id: string; currency: string; status: string };
}

const PASSWORD_MIN_LENGTH = 8;

export const RegistrationScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const [step, setStep] = useState<Step>('PHONE');

  // Phone step
  const [phone, setPhone] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // OTP step
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  // Details step
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Shared
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [registeredUser, setRegisteredUser] = useState<CompleteRegistrationResponse | null>(null);

  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      // Never retain OTP code, password, or verification token beyond this screen's life.
      setCode('');
      setPassword('');
      setConfirmPassword('');
      setVerificationToken('');
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

  const generateNewIdempotencyKey = () => {
    // Mirrors the established convention used for financial-transfer idempotency keys
    // (see SendMoneyScreen). Registration completion is not money-moving, but reuses
    // the same network-retry-safety pattern already proven in this app.
    setIdempotencyKey(`reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  };

  const startResendCooldown = (seconds: number) => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    setResendCooldown(seconds);
    cooldownTimer.current = setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const handleRequestOtp = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setError('Phone number is required');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const result = await ApiClient.post<RequestOtpResponse>('/customers/registration/otp', {
        phone: trimmedPhone,
      });
      setStep('OTP');
      startResendCooldown(result.resendAfterSeconds);
    } catch (err: unknown) {
      setError(describeRegistrationError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isLoading) return;
    setError('');
    setIsLoading(true);
    try {
      const result = await ApiClient.post<RequestOtpResponse>('/customers/registration/otp', {
        phone: phone.trim(),
      });
      startResendCooldown(result.resendAfterSeconds);
    } catch (err: unknown) {
      setError(describeRegistrationError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError('Enter the 6-digit code sent to your phone');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const result = await ApiClient.post<VerifyOtpResponse>('/customers/registration/otp/verify', {
        phone: phone.trim(),
        code: trimmedCode,
      });
      setVerificationToken(result.verificationToken);
      setCode('');
      generateNewIdempotencyKey();
      setStep('DETAILS');
    } catch (err: unknown) {
      // Never surface or log the submitted code on failure.
      setCode('');
      setError(describeRegistrationError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteRegistration = async () => {
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const result = await ApiClient.post<CompleteRegistrationResponse>(
        '/customers/registration',
        {
          phone: phone.trim(),
          verificationToken,
          password,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          idempotencyKey,
        },
        { idempotencyKey },
      );
      // Password and verification token are no longer needed once registration
      // has been accepted by the backend; clear them immediately.
      setPassword('');
      setConfirmPassword('');
      setVerificationToken('');
      setRegisteredUser(result);
      setStep('SUCCESS');
    } catch (err: unknown) {
      setPassword('');
      setConfirmPassword('');
      setError(describeRegistrationError(err));
      // A rejected completion attempt is not safely retryable under the same
      // Idempotency-Key semantics as a fresh attempt (e.g. validation failure
      // the user then corrects), so issue a new key for the next try.
      generateNewIdempotencyKey();
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'SUCCESS' && registeredUser) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>🎉</Text>
          <Text style={styles.successTitle}>Account Created Successfully!</Text>
          <Text style={styles.successDescription}>
            Your MonieNaija account has been created and your phone number verified.
            {registeredUser.wallet
              ? ' Your NGN wallet is ready.'
              : ' Log in to finish setting up your account.'}
          </Text>

          <View style={styles.detailsCard}>
            <Text style={styles.detailLabel}>CUSTOMER REFERENCE</Text>
            <Text style={styles.detailValue}>{registeredUser.reference}</Text>

            <Text style={[styles.detailLabel, { marginTop: theme.spacing.md }]}>PHONE</Text>
            <Text style={styles.detailValue}>{registeredUser.phone}</Text>

            {registeredUser.wallet && (
              <>
                <Text style={[styles.detailLabel, { marginTop: theme.spacing.md }]}>WALLET STATUS</Text>
                <Text style={styles.detailValue}>
                  {registeredUser.wallet.currency} wallet — {registeredUser.wallet.status}
                </Text>
              </>
            )}
          </View>

          <Text style={styles.copyWarning}>
            Use your phone number and the password you just created to log in.
          </Text>
        </View>

        <Button
          label="Proceed to Log In"
          style={styles.button}
          onPress={() => navigation.navigate('Login')}
        />
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
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Get started with a secure individual mobile money wallet</Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {step === 'PHONE' && (
          <View style={styles.form}>
            <Input
              keyboardType="phone-pad"
              label="Phone Number"
              placeholder="e.g. 08012345678"
              value={phone}
              onChangeText={(text) => {
                setPhone(text);
                if (error) setError('');
              }}
            />

            <Button
              loading={isLoading}
              label="Send Verification Code"
              style={styles.button}
              onPress={handleRequestOtp}
            />
          </View>
        )}

        {step === 'OTP' && (
          <View style={styles.form}>
            <Text style={styles.stepDescription}>
              Enter the 6-digit code sent to {phone.trim()}
            </Text>

            <Input
              keyboardType="number-pad"
              maxLength={6}
              label="Verification Code"
              placeholder="123456"
              value={code}
              onChangeText={(text) => {
                setCode(text);
                if (error) setError('');
              }}
            />

            <Button
              loading={isLoading}
              label="Verify Code"
              style={styles.button}
              onPress={handleVerifyOtp}
            />

            <Button
              variant="text"
              disabled={resendCooldown > 0 || isLoading}
              label={resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              style={styles.linkButton}
              onPress={handleResendOtp}
            />
          </View>
        )}

        {step === 'DETAILS' && (
          <View style={styles.form}>
            <Text style={styles.stepDescription}>Phone verified. Finish creating your account.</Text>

            <Input
              label="Full Name (optional)"
              placeholder="e.g. Babajide Alao"
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                if (error) setError('');
              }}
            />

            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              label="Password"
              placeholder="At least 8 characters"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
            />

            <Input
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              label="Confirm Password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (error) setError('');
              }}
            />

            <Button
              loading={isLoading}
              label="Finish Sign Up"
              style={styles.button}
              onPress={handleCompleteRegistration}
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/**
 * Maps backend error responses to user-facing copy without inventing new backend
 * semantics. Falls back to the server's own (already-generic, enumeration-safe)
 * message for anything not explicitly handled here.
 */
function describeRegistrationError(err: unknown): string {
  if (err instanceof ApiError) {
    const message = (err.message || '').toLowerCase();
    if (err.status === 409) {
      return 'An account already exists for this phone number. Try logging in instead.';
    }
    if (message.includes('otp verification failed')) {
      return 'That code is incorrect or has expired. Check the code or request a new one.';
    }
    if (message.includes('registration verification is invalid or expired')) {
      return 'Your phone verification has expired. Please start again and request a new code.';
    }
    return err.message || 'Registration failed. Please try again.';
  }
  return err instanceof Error ? err.message : 'Registration failed. Please try again.';
}

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
    marginBottom: theme.spacing.xxl,
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
  stepDescription: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    marginBottom: theme.spacing.lg,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: theme.spacing.md,
  },
  linkButton: {
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
  detailsCard: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing.lg,
    borderRadius: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    marginBottom: theme.spacing.md,
  },
  detailLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    fontWeight: theme.typography.weights.semibold,
  },
  detailValue: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.charcoal,
    fontWeight: theme.typography.weights.bold,
    marginTop: theme.spacing.xs,
  },
  copyWarning: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.warning,
    textAlign: 'center',
    fontWeight: theme.typography.weights.semibold,
  },
});
