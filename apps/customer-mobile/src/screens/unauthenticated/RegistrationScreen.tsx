import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { RootStackParamList } from '../../navigation/types';
import { ApiClient, ApiError } from '../../services/api-client';
import { SecureStorage } from '../../services/secure-storage';
import { theme } from '../../theme';

type Step =
  | 'LOADING'
  | 'UNAVAILABLE'
  | 'PHONE'
  | 'OTP'
  | 'PROFILE'
  | 'IDENTITY'
  | 'RESULT'
  | 'CREDENTIALS'
  | 'ONBOARDING_PENDING'
  | 'ONBOARDING_LOGIN'
  | 'ONBOARDING_AUTHENTICATED';
type Kind = 'BVN' | 'NIN';
type Session = {
  id: string;
  token: string;
  expiresAt: string;
  phase: 'PENDING' | 'VERIFIED';
  consentId?: string;
  kind?: Kind;
  verificationId?: string;
  matchedAttemptId?: string;
  draftCreated?: boolean;
};
const STORAGE_KEY = 'synthetic_registration_session_v1';
const ONBOARDING_TOKEN_KEY = 'synthetic_onboarding_token_v1';
const base = '/customers/registration-sessions/';
async function uuid(): Promise<string> {
  const b = await Crypto.getRandomBytesAsync(16);
  b[6] = (b[6]! & 15) | 64;
  b[8] = (b[8]! & 63) | 128;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** This test-only simulation never claims to activate a real account or wallet. */
export const RegistrationScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Registration'>>();
  const [step, setStep] = useState<Step>('LOADING');
  const [session, setSession] = useState<Session | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<Kind>('BVN');
  const [identifier, setIdentifier] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [passcode, setPasscode] = useState('');
  const [passcodeConfirmation, setPasscodeConfirmation] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const post = <T,>(path: string, body: unknown, token: string | null = null) =>
    ApiClient.post<T>(`${base}${path}`, body, { registrationBearer: token });
  const save = async (value: Session) => {
    await SecureStorage.set(STORAGE_KEY, JSON.stringify(value));
    setSession(value);
  };
  const reset = async () => {
    await SecureStorage.remove(STORAGE_KEY);
    setSession(null);
    setCode('');
    setIdentifier('');
    setPasscode('');
    setPasscodeConfirmation('');
    setPin('');
    setPinConfirmation('');
    setAccepted(false);
    setError('');
    setStep('PHONE');
  };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    let availabilityConfirmed = false;
    (async () => {
      try {
        if (!__DEV__) {
          if (live) setStep('UNAVAILABLE');
          return;
        }
        const a = await post<{ available: boolean }>('simulation-availability', {});
        if (!a.available) {
          if (live) setStep('UNAVAILABLE');
          return;
        }
        availabilityConfirmed = true;
        const priorToken = await SecureStorage.get(ONBOARDING_TOKEN_KEY);
        if (priorToken) {
          try {
            await post('onboarding-session', {}, priorToken);
            if (live) {
              setOnboardingToken(priorToken);
              setStep('ONBOARDING_AUTHENTICATED');
            }
            return;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 401) throw e;
            await SecureStorage.remove(ONBOARDING_TOKEN_KEY);
          }
        }
        const stored = await SecureStorage.get(STORAGE_KEY);
        if (!stored) {
          if (live) setStep('PHONE');
          return;
        }
        const saved = JSON.parse(stored) as Session;
        if (
          !saved.id ||
          !saved.token ||
          !saved.expiresAt ||
          !Number.isFinite(new Date(saved.expiresAt).getTime()) ||
          new Date(saved.expiresAt).getTime() <= Date.now()
        )
          throw new Error('expired');
        const status = await post<{ status: 'PENDING' | 'VERIFIED'; expiresAt: string }>(
          'status',
          { sessionId: saved.id },
          saved.token,
        );
        if (status.status !== saved.phase) throw new Error('session changed');
        if (!live) return;
        setSession(saved);
        if (status.status === 'PENDING') {
          setStep('OTP');
          setError('If your code has expired, request a new one.');
          return;
        }
        const route = await post<{ next: 'NEW' | 'LOGIN' | 'PENDING' }>(
          'onboarding-route',
          { sessionId: saved.id },
          saved.token,
        );
        if (!live) return;
        if (route.next === 'LOGIN') {
          setStep('ONBOARDING_LOGIN');
          return;
        }
        if (route.next === 'PENDING' && !saved.draftCreated) {
          setStep('ONBOARDING_PENDING');
          return;
        }
        if (route.next !== 'NEW' && route.next !== 'PENDING') throw new Error('unknown route');
        const profile = await post<{
          firstName: string;
          lastName: string;
          dateOfBirth: string;
          email: string | null;
        } | null>('synthetic-profile/status', { sessionId: saved.id }, saved.token);
        if (!live) return;
        if (profile) {
          setFirstName(profile.firstName);
          setLastName(profile.lastName);
          setDob(profile.dateOfBirth);
          setEmail(profile.email ?? '');
        }
        if (saved.kind) setKind(saved.kind);
        if (saved.draftCreated) {
          const credentials = await post<{ status: 'SET_UP' | 'NOT_SET' }>(
            'synthetic-credentials/status',
            { sessionId: saved.id },
            saved.token,
          );
          if (!live) return;
          if (credentials.status === 'SET_UP') {
            setResult(
              'Test credentials saved. You can sign in to onboarding only; financial services remain unavailable.',
            );
            setStep('RESULT');
          } else setStep('CREDENTIALS');
        } else if (saved.matchedAttemptId) {
          setResult(
            'Synthetic identity matched. Complete your test draft or retry if interrupted.',
          );
          setStep('RESULT');
        } else setStep(profile ? 'IDENTITY' : 'PROFILE');
      } catch (e) {
        if (!availabilityConfirmed || (e instanceof ApiError && e.status !== 401)) {
          if (live) setStep('UNAVAILABLE');
          return;
        }
        if (
          !(e instanceof ApiError) &&
          e instanceof Error &&
          !['expired', 'session changed'].includes(e.message) &&
          !(e instanceof SyntaxError)
        ) {
          if (live) setStep('UNAVAILABLE');
          return;
        }
        await SecureStorage.remove(STORAGE_KEY);
        if (live) {
          setStep('PHONE');
          setError(
            'Your previous session could not be resumed. Start again and verify your phone.',
          );
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const withError = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429)
        setError('Too many requests. Please wait before trying again.');
      else if (e instanceof ApiError && e.status === 503)
        setError('Verification is unavailable. Please try again later.');
      else if (e instanceof ApiError && e.status === 401)
        setError('The code or session is invalid or expired. If needed, start again.');
      else setError('We could not complete this step. Check your details or try again later.');
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    withError(async () => {
      if (!phone.trim()) throw new Error('phone required');
      const s = await post<{ id: string; token: string }>('start', { phone: phone.trim() });
      const status = await post<{ expiresAt: string }>('status', { sessionId: s.id }, s.token);
      await save({ ...s, expiresAt: status.expiresAt, phase: 'PENDING' });
      setStep('OTP');
      setResendAt(Date.now() + 60_000);
      await post('otp', { sessionId: s.id, requestId: await uuid() }, s.token);
    });
  const resend = () =>
    withError(async () => {
      if (!session || now < resendAt) return;
      setResendAt(Date.now() + 60_000);
      await post('otp', { sessionId: session.id, requestId: await uuid() }, session.token);
    });
  const verifyPhone = () =>
    withError(async () => {
      if (!session || !/^\d{6}$/.test(code)) throw new Error('code');
      const r = await post<{ authorization: string }>(
        'otp/verify',
        { sessionId: session.id, code },
        session.token,
      );
      setCode('');
      await save({ ...session, token: r.authorization, phase: 'VERIFIED' });
      const route = await post<{ next: 'NEW' | 'LOGIN' | 'PENDING' }>(
        'onboarding-route',
        { sessionId: session.id },
        r.authorization,
      );
      setStep(
        route.next === 'NEW'
          ? 'PROFILE'
          : route.next === 'LOGIN'
            ? 'ONBOARDING_LOGIN'
            : 'ONBOARDING_PENDING',
      );
    });
  const saveProfile = () =>
    withError(async () => {
      if (!session) return;
      await post(
        'synthetic-profile',
        {
          sessionId: session.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dob.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
        },
        session.token,
      );
      setStep('IDENTITY');
    });
  const completeDraft = () =>
    withError(async () => {
      if (!session?.matchedAttemptId) return;
      await post(
        'synthetic-complete',
        { sessionId: session.id, attemptId: session.matchedAttemptId },
        session.token,
      );
      await save({ ...session, draftCreated: true });
      setStep('CREDENTIALS');
    });
  const setupCredentials = () =>
    withError(async () => {
      if (
        !session ||
        !/^\d{6}$/.test(passcode) ||
        passcode !== passcodeConfirmation ||
        !/^\d{6}$/.test(pin) ||
        pin !== pinConfirmation ||
        pin === passcode
      ) {
        throw new Error('invalid credentials');
      }
      try {
        await post(
          'synthetic-credentials',
          { sessionId: session.id, passcode, passcodeConfirmation, pin, pinConfirmation },
          session.token,
        );
        setResult(
          'Test credentials saved. You can sign in to onboarding only; financial services remain unavailable.',
        );
        setStep('RESULT');
      } finally {
        setPasscode('');
        setPasscodeConfirmation('');
        setPin('');
        setPinConfirmation('');
      }
    });
  const onboardingLogin = () =>
    withError(async () => {
      if (!session || !/^\d{6}$/.test(passcode)) throw new Error('passcode');
      try {
        const login = await post<{ accessToken: string; audience: string }>(
          'onboarding-login',
          { sessionId: session.id, passcode },
          session.token,
        );
        if (login.audience !== 'customer-onboarding') throw new Error('unexpected scope');
        await SecureStorage.set(ONBOARDING_TOKEN_KEY, login.accessToken);
        await SecureStorage.remove(STORAGE_KEY);
        setSession(null);
        setOnboardingToken(login.accessToken);
        setStep('ONBOARDING_AUTHENTICATED');
      } finally {
        setPasscode('');
      }
    });
  const onboardingLogout = () =>
    withError(async () => {
      if (!onboardingToken) return;
      await post('onboarding-logout', {}, onboardingToken);
      await SecureStorage.remove(ONBOARDING_TOKEN_KEY);
      setOnboardingToken(null);
      await reset();
    });
  const verifyIdentity = () =>
    withError(async () => {
      if (!session || !accepted || !/^0000000000[0-9]$/.test(identifier))
        throw new Error('fixture or consent');
      let next = session;
      if (next.kind && next.kind !== kind) throw new Error('kind cannot change');
      if (!next.consentId) {
        const c = await post<{ id: string }>(
          'consent',
          {
            sessionId: next.id,
            requestId: await uuid(),
            kind,
            accepted: true,
            noticeVersion: 'synthetic-test-v1',
            expiresAt: next.expiresAt,
          },
          next.token,
        );
        next = { ...next, consentId: c.id, kind, verificationId: await uuid() };
        await save(next);
      }
      const r = await post<{ id: string; status: string; simulated: true }>(
        'synthetic-verification',
        {
          sessionId: next.id,
          consentId: next.consentId,
          kind,
          requestId: next.verificationId,
          identifier,
        },
        next.token,
      );
      setIdentifier('');
      if (r.status === 'MATCH') {
        await save({ ...next, matchedAttemptId: r.id });
        setResult('Synthetic identity matched. Complete your test draft or retry if interrupted.');
      } else if (r.status === 'REVIEW')
        setResult(
          'The synthetic identity details did not match. Start a new session and check the fixture details.',
        );
      else
        setResult(
          'Verification is pending. Do not submit another request; please try the same request again later.',
        );
      setStep('RESULT');
    });
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Create Account</Text>
      {step === 'LOADING' && <Text>Checking registration availability…</Text>}
      {step === 'UNAVAILABLE' && (
        <>
          <Text style={styles.message}>Registration is temporarily unavailable.</Text>
          <Text style={styles.message}>
            Identity verification must be available before a new account can be activated. Please
            try again later.
          </Text>
        </>
      )}
      {step !== 'LOADING' && step !== 'UNAVAILABLE' && (
        <Text style={styles.message}>
          Development simulation only. Use test data; never enter a real BVN or NIN. No account or
          wallet will be activated.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {step === 'PHONE' && (
        <View>
          <Text>Step 1 of 4: Phone</Text>
          <Input
            label="Nigerian phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="e.g. 08012345678"
          />
          <Button label="Send Verification Code" loading={busy} onPress={start} />
        </View>
      )}
      {step === 'OTP' && (
        <View>
          <Text>Step 2 of 4: Phone verification</Text>
          <Text style={styles.message}>
            Enter the six-digit code. Codes expire after five minutes; the session expires after 15
            minutes.
          </Text>
          <Input
            label="Verification Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
          />
          <Button label="Verify Code" loading={busy} onPress={verifyPhone} />
          <Button
            label={cooldown ? `Resend in ${cooldown}s` : 'Resend Code'}
            disabled={cooldown > 0 || busy}
            variant="text"
            onPress={resend}
          />
          <Button label="Start again" variant="text" onPress={() => void reset()} />
        </View>
      )}
      {step === 'PROFILE' && (
        <View>
          <Text>Step 3 of 4: Details</Text>
          <Input
            testID="first-name"
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
          />
          <Input testID="last-name" label="Last name" value={lastName} onChangeText={setLastName} />
          <Input
            testID="date-of-birth"
            label="Date of birth"
            placeholder="YYYY-MM-DD"
            value={dob}
            onChangeText={setDob}
          />
          <Input
            testID="email"
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Button label="Continue" loading={busy} onPress={saveProfile} />
        </View>
      )}
      {step === 'IDENTITY' && (
        <View>
          <Text>Step 4 of 4: Synthetic identity</Text>
          <Text style={styles.message}>
            For a match use Synthetic Person, born 2000-01-01 and a test identifier from 00000000000
            to 00000000009. Each test identifier can be claimed only once per type.
          </Text>
          <Button
            label={`Selected: ${kind} (tap to change)`}
            variant="outline"
            disabled={!!session?.kind}
            onPress={() => setKind(kind === 'BVN' ? 'NIN' : 'BVN')}
          />
          <Input
            testID="test-identifier"
            label={`${kind} test identifier`}
            value={identifier}
            onChangeText={setIdentifier}
            keyboardType="number-pad"
            maxLength={11}
          />
          <Button
            label={accepted ? 'Consent accepted' : 'Accept synthetic test consent'}
            variant="outline"
            onPress={() => setAccepted(!accepted)}
          />
          <Text style={styles.message}>
            I consent to simulated identity verification for this test session. This is not a
            production consent notice.
          </Text>
          <Button label="Verify test identity" loading={busy} onPress={verifyIdentity} />
          <Button label="Start again" variant="text" onPress={() => void reset()} />
        </View>
      )}
      {step === 'CREDENTIALS' && (
        <View>
          <Text style={styles.message}>
            Synthetic DRAFT created. Choose separate six-digit test passcode and PIN. Financial
            services remain unavailable.
          </Text>
          <Input
            testID="test-passcode"
            label="Test login passcode"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={passcode}
            onChangeText={setPasscode}
          />
          <Input
            testID="test-passcode-confirm"
            label="Confirm test login passcode"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={passcodeConfirmation}
            onChangeText={setPasscodeConfirmation}
          />
          <Input
            testID="test-pin"
            label="Test transaction PIN"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={pin}
            onChangeText={setPin}
          />
          <Input
            testID="test-pin-confirm"
            label="Confirm test transaction PIN"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={pinConfirmation}
            onChangeText={setPinConfirmation}
          />
          <Button label="Save test credentials" loading={busy} onPress={setupCredentials} />
        </View>
      )}
      {step === 'ONBOARDING_PENDING' && (
        <View>
          <Text>
            Existing account or incomplete setup requires review. Claiming is not available in this
            simulation.
          </Text>
          <Button label="Start again" onPress={() => void reset()} />
        </View>
      )}
      {step === 'ONBOARDING_LOGIN' && (
        <View>
          <Text>Sign in to test onboarding</Text>
          <Input
            testID="onboarding-passcode"
            label="Test login passcode"
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={passcode}
            onChangeText={setPasscode}
          />
          <Button label="Sign in to onboarding" loading={busy} onPress={onboardingLogin} />
          <Button label="Start again" variant="text" onPress={() => void reset()} />
        </View>
      )}
      {step === 'ONBOARDING_AUTHENTICATED' && (
        <View>
          <Text>Signed in to test onboarding only. Financial services remain unavailable.</Text>
          <Button label="Sign out of onboarding" loading={busy} onPress={onboardingLogout} />
        </View>
      )}
      {step === 'RESULT' && (
        <View>
          <Text style={styles.message}>{result}</Text>
          {result.startsWith('Test credentials saved') && (
            <Button
              label="Continue to onboarding sign in"
              onPress={() => setStep('ONBOARDING_LOGIN')}
            />
          )}
          {result.startsWith('Synthetic identity matched') && (
            <Button label="Create test draft" loading={busy} onPress={completeDraft} />
          )}
          {!result.startsWith('Synthetic identity matched') &&
            !result.startsWith('Synthetic DRAFT created') &&
            !result.startsWith('Test credentials saved') && (
              <Button
                label="Return to verification"
                variant="outline"
                onPress={() => setStep('IDENTITY')}
              />
            )}
          <Button label="Start again" variant="text" onPress={() => void reset()} />
        </View>
      )}
      <Button label="Back to Sign In" variant="text" onPress={() => navigation.navigate('Login')} />
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.neutral.white,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.md,
  },
  message: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    marginVertical: theme.spacing.md,
  },
  error: { color: theme.colors.feedback.error, marginVertical: theme.spacing.md },
});
