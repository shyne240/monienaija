import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { RootStackParamList } from '../../navigation/types';
import {
  CredentialRecoveryApi,
  RecoveryFeedback,
  RecoveryPolicyView,
  RecoveryPurpose,
  RecoveryStep,
  describeRecoveryFailure,
  isPlausibleRecoveryPhone,
  isValidNewSecret,
} from '../../services/credential-recovery';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'CredentialRecovery'>;
type RouteType = RouteProp<RootStackParamList, 'CredentialRecovery'>;

const PURPOSE_COPY: Record<RecoveryPurpose, { title: string; secretLabel: string; done: string }> =
  {
    LOGIN_PASSCODE: {
      title: 'Reset your login passcode',
      secretLabel: 'New six-digit login passcode',
      done: 'Your login passcode was replaced. Sign in with the new passcode.',
    },
    TRANSACTION_PIN: {
      title: 'Reset your transaction PIN',
      secretLabel: 'New six-digit transaction PIN',
      done: 'Your transaction PIN was replaced. Sign in again — recovery closed every open session, so the app will ask you to log in.',
    },
  };

/**
 * ARENA 4 (C-9) — self-service credential recovery UI against the accepted backend contract.
 *
 * Deliberate constraints:
 *  - The screen is reachable without a session (recovery exists precisely for a customer who
 *    cannot sign in) and never issues or restores one itself.
 *  - Phone possession is not authority: the OTP only unlocks the request, and completion needs the
 *    server-side trusted-evidence gate. When the policy is off, the evidence is unavailable, or the
 *    backend answers SUPPORT_REQUIRED, the form is replaced by the support pathway.
 *  - The OTP, recovery token, passcode and PIN live only in component state: never persisted,
 *    never logged, never placed in navigation params, and cleared when the request closes.
 */
export const CredentialRecoveryScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteType>();
  const purpose: RecoveryPurpose = route.params?.purpose ?? 'LOGIN_PASSCODE';
  const copy = PURPOSE_COPY[purpose];

  const [policy, setPolicy] = useState<RecoveryPolicyView | null>(null);
  const [policyError, setPolicyError] = useState<string>('');
  const [step, setStep] = useState<RecoveryStep>('PHONE');
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [feedback, setFeedback] = useState<RecoveryFeedback | null>(null);

  const loadPolicy = useCallback(async () => {
    setPolicyError('');
    try {
      const view = await CredentialRecoveryApi.policy();
      setPolicy(view);
    } catch (error) {
      setPolicy(null);
      setPolicyError(describeRecoveryFailure(error, 'PHONE').body);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const fail = (error: unknown, atStep: RecoveryStep) => {
    setFeedback(describeRecoveryFailure(error, atStep));
  };

  const handleRequestChallenge = async () => {
    if (!isPlausibleRecoveryPhone(phone)) {
      setValidationError('Enter the Nigerian phone number on your account, e.g. 08012345678');
      return;
    }
    setValidationError('');
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await CredentialRecoveryApi.requestChallenge(phone.trim(), purpose);
      // ACCEPTED is deliberately identical whether or not the number is recoverable: never state
      // that an account exists — only what happens next if it does.
      setChallengeId(response.challengeId);
      setCode('');
      setStep('OTP');
    } catch (error) {
      fail(error, 'PHONE');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setValidationError('Enter the six-digit code from the SMS');
      return;
    }
    setValidationError('');
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await CredentialRecoveryApi.verifyChallenge(challengeId, code);
      setRecoveryToken(response.recoveryToken);
      setCode('');
      setStep('SECRET');
    } catch (error) {
      setCode('');
      fail(error, 'OTP');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!isValidNewSecret(secret)) {
      setValidationError(`Enter exactly six digits for the ${copy.secretLabel.toLowerCase()}`);
      return;
    }
    if (secret !== confirmation) {
      setValidationError('The two entries do not match');
      return;
    }
    setValidationError('');
    setFeedback(null);
    setSubmitting(true);
    try {
      await CredentialRecoveryApi.complete(recoveryToken, secret, confirmation);
      setSecret('');
      setConfirmation('');
      setRecoveryToken('');
      setStep('DONE');
    } catch (error) {
      setSecret('');
      setConfirmation('');
      fail(error, 'SECRET');
    } finally {
      setSubmitting(false);
    }
  };

  const policyBlocked =
    policyError !== '' ||
    (policy !== null && (!policy.enabled || !policy.purposes.includes(purpose)));

  const renderPolicyState = () => (
    <View style={styles.form}>
      <View style={[styles.banner, styles.bannerWarning]}>
        <Text style={styles.bannerTitle}>
          {policyError
            ? 'Recovery is unavailable right now'
            : 'Self-service reset is not available'}
        </Text>
        <Text style={styles.bannerBody}>
          {policyError ||
            'MonieNaija is not currently approving in-app resets for this credential under its recovery policy. Nothing has been changed. Contact Support to have it reset for you — Support will confirm your identity through an approved process before anything is changed.'}
        </Text>
      </View>
      {policyError ? (
        <Button
          label="Try again"
          variant="outline"
          onPress={() => {
            void loadPolicy();
          }}
        />
      ) : null}
      <Button
        label="Back to sign in"
        style={styles.button}
        onPress={() => navigation.navigate('Login')}
      />
      <Text style={styles.footnote}>
        A phone number on its own is never enough to reset a passcode or transaction PIN, and no
        reset unlocks financial access that your account is not eligible for.
      </Text>
    </View>
  );

  const renderFeedback = () =>
    feedback ? (
      <View
        accessibilityRole="alert"
        style={[styles.banner, feedback.tone === 'warning' && styles.bannerWarning]}
      >
        <Text style={styles.bannerTitle}>{feedback.title}</Text>
        <Text style={styles.bannerBody}>{feedback.body}</Text>
      </View>
    ) : null;

  const renderBody = () => {
    if (step === 'DONE') {
      return (
        <View style={styles.form}>
          <View style={[styles.banner, styles.bannerSuccess]}>
            <Text style={styles.bannerTitle}>Credential replaced</Text>
            <Text style={styles.bannerBody}>{copy.done}</Text>
          </View>
          <Button
            label="Go to sign in"
            style={styles.button}
            onPress={() => navigation.navigate('Login')}
          />
        </View>
      );
    }

    if (policyBlocked) return renderPolicyState();

    if (step === 'PHONE') {
      return (
        <View style={styles.form}>
          <Text style={styles.helperText}>
            MonieNaija will send a six-digit code to the phone number on your account. The code
            alone does not reset anything: the server also checks the verification evidence it
            already holds for you.
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            label="Phone Number"
            placeholder="e.g. 08012345678"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              if (validationError) setValidationError('');
            }}
          />
          <Button
            loading={submitting}
            label="Send recovery code"
            style={styles.button}
            onPress={handleRequestChallenge}
          />
        </View>
      );
    }

    if (step === 'OTP') {
      return (
        <View style={styles.form}>
          <Text style={styles.helperText}>
            If that number belongs to a MonieNaija account, an SMS with a six-digit code is on its
            way. It expires shortly and can be used once.
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Six-digit code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChangeText={(text) => {
              setCode(text.replace(/\D/g, ''));
              if (validationError) setValidationError('');
            }}
          />
          <Button
            loading={submitting}
            label="Verify code"
            style={styles.button}
            onPress={handleVerify}
          />
          <Button
            label="Send a new code"
            variant="text"
            disabled={submitting}
            onPress={handleRequestChallenge}
          />
        </View>
      );
    }

    return (
      <View style={styles.form}>
        <Text style={styles.helperText}>
          Choose a new value only you know. MonieNaija never shows it back to you and never stores
          it in readable form.
        </Text>
        <Input
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          label={copy.secretLabel}
          maxLength={6}
          placeholder="Enter six digits"
          secureTextEntry
          value={secret}
          onChangeText={(text) => {
            setSecret(text.replace(/\D/g, ''));
            if (validationError) setValidationError('');
          }}
        />
        <Input
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          label="Confirm new value"
          maxLength={6}
          placeholder="Repeat six digits"
          secureTextEntry
          value={confirmation}
          onChangeText={(text) => {
            setConfirmation(text.replace(/\D/g, ''));
            if (validationError) setValidationError('');
          }}
        />
        <Button
          loading={submitting}
          label="Replace credential"
          style={styles.button}
          onPress={handleComplete}
        />
        <Text style={styles.footnote}>
          Completing this closes every open session for your account, including this device.
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Account recovery</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>
            Recovery is a separate, evidence-based process. It never grants financial access and
            never overrides a compliance hold or session restriction.
          </Text>
        </View>

        {!!validationError && (
          <View accessibilityRole="alert" style={styles.banner}>
            <Text style={styles.bannerTitle}>Check your details</Text>
            <Text style={styles.bannerBody}>{validationError}</Text>
          </View>
        )}

        {renderFeedback()}
        {renderBody()}
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
  helperText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
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
  bannerSuccess: {
    backgroundColor: theme.colors.feedback.successLight,
    borderLeftColor: theme.colors.feedback.success,
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
