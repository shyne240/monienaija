import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RegistrationScreen } from '../src/screens/unauthenticated/RegistrationScreen';
import { ApiClient } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { post: jest.fn() },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('../src/services/secure-storage', () => ({
  SecureStorage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(16).fill(7)),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
const post = ApiClient.post as jest.Mock;
const future = new Date(Date.now() + 600000).toISOString();
const onboardingKycStatus = {
  customer: { status: 'ACTIVE', kycLevel: 'LEVEL_1', kycStatus: 'PENDING' },
  policy: { configured: false, version: null },
  requirements: null,
  candidateAssessment: { status: 'NOT_CONFIGURED', level: null, reason: 'POLICY_UNAVAILABLE' },
  consentNotice: null,
  verificationEnabled: false,
  consents: [],
  history: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  (SecureStorage.get as jest.Mock).mockResolvedValue(null);
});

test('allows phone entry when simulation is unavailable', async () => {
  post.mockResolvedValue({ available: false });
  const v = render(<RegistrationScreen />);
  expect(await v.findByPlaceholderText('e.g. 08012345678')).toBeTruthy();
  fireEvent.press(v.getByText('Back to Sign In'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
});

test.each(['BVN', 'NIN'])(
  'walks through phone, profile and %s simulation without claiming activation',
  async (kind) => {
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/simulation-availability')) return { available: true };
      if (path.endsWith('/onboarding-route')) return { next: 'NEW' };
      if (path.endsWith('/start')) return { id: 'session-id', token: 'pending-token' };
      if (path.endsWith('/status')) return { status: 'PENDING', expiresAt: future };
      if (path.endsWith('/otp/verify')) return { authorization: 'verified-token' };
      if (path.endsWith('/consent')) return { id: 'consent-id' };
      if (path.endsWith('/synthetic-verification'))
        return { id: 'attempt-id', status: 'MATCH', simulated: true };
      return {};
    });
    const v = render(<RegistrationScreen />);
    fireEvent.changeText(await v.findByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(v.getByText('Send Verification Code'));
    await waitFor(() => expect(v.getByText('Step 2 of 4: Phone verification')).toBeTruthy());
    fireEvent.changeText(v.getByPlaceholderText('123456'), '123456');
    fireEvent.press(v.getByText('Verify Code'));
    await waitFor(() => expect(v.getByText('Step 3 of 4: Details')).toBeTruthy());
    fireEvent.changeText(v.getByTestId('first-name'), 'Synthetic');
    fireEvent.changeText(v.getByTestId('last-name'), 'Person');
    fireEvent.changeText(v.getByTestId('date-of-birth'), '2000-01-01');
    fireEvent.press(v.getByText('Continue'));
    await waitFor(() => expect(v.getByText('Step 4 of 4: Synthetic identity')).toBeTruthy());
    if (kind === 'NIN') fireEvent.press(v.getByText('Selected: BVN (tap to change)'));
    fireEvent.changeText(v.getByTestId('test-identifier'), '00000000000');
    fireEvent.press(v.getByText('Accept synthetic test consent'));
    fireEvent.press(v.getByText('Verify test identity'));
    fireEvent.press(await v.findByText('Create test draft'));
    expect(await v.findByText(/Synthetic DRAFT created/)).toBeTruthy();
    fireEvent.changeText(v.getByTestId('test-passcode'), '112233');
    fireEvent.changeText(v.getByTestId('test-passcode-confirm'), '112233');
    fireEvent.changeText(v.getByTestId('test-pin'), '334455');
    fireEvent.changeText(v.getByTestId('test-pin-confirm'), '334455');
    fireEvent.press(v.getByText('Save test credentials'));
    expect(await v.findByText(/Test credentials saved/)).toBeTruthy();
    const stored = JSON.stringify((SecureStorage.set as jest.Mock).mock.calls);
    expect(stored).not.toContain('112233');
    expect(stored).not.toContain('334455');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/synthetic-complete'),
      { sessionId: 'session-id', attemptId: 'attempt-id' },
      { registrationBearer: 'verified-token' },
    );
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/synthetic-verification'),
      expect.objectContaining({ kind, identifier: '00000000000' }),
      { registrationBearer: 'verified-token' },
    );
  },
);

test('resumes a verified profile without retaining an identifier or OTP', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: true };
    if (path.endsWith('/onboarding-route')) return { next: 'NEW' };
    if (path.endsWith('/synthetic-profile/status'))
      return { firstName: 'Synthetic', lastName: 'Person', dateOfBirth: '2000-01-01', email: null };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText('Step 4 of 4: Synthetic identity')).toBeTruthy();
  expect(v.getByTestId('test-identifier').props.value).toBe('');
});

test('resumes matched attempt and retries draft completion without another identity request', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
          matchedAttemptId: 'attempt-id',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: true };
    if (path.endsWith('/onboarding-route')) return { next: 'NEW' };
    if (path.endsWith('/synthetic-profile/status'))
      return { firstName: 'Synthetic', lastName: 'Person', dateOfBirth: '2000-01-01', email: null };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  fireEvent.press(await v.findByText('Create test draft'));
  expect(await v.findByText(/Synthetic DRAFT created/)).toBeTruthy();
  expect(post.mock.calls.some(([p]: [string]) => p.endsWith('/synthetic-verification'))).toBe(
    false,
  );
});

test('recovers completed test credential setup after an interrupted response', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
          matchedAttemptId: 'attempt-id',
          draftCreated: true,
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: true };
    if (path.endsWith('/onboarding-route')) return { next: 'NEW' };
    if (path.endsWith('/synthetic-profile/status'))
      return { firstName: 'Synthetic', lastName: 'Person', dateOfBirth: '2000-01-01', email: null };
    if (path.endsWith('/synthetic-credentials/status'))
      return { status: 'SET_UP', simulated: true };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText(/Test credentials saved/)).toBeTruthy();
  expect(post.mock.calls.some(([p]: [string]) => p.endsWith('/synthetic-credentials'))).toBe(false);
});

test('signs into an isolated onboarding session and signs out without storing a passcode', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: true };
    if (path.endsWith('/onboarding-route')) return { next: 'LOGIN' };
    if (path.endsWith('/onboarding-login'))
      return { accessToken: 'onboarding-token', audience: 'customer-onboarding' };
    if (path.endsWith('/customer-kyc/status')) return onboardingKycStatus;
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  const input = await v.findByTestId('onboarding-passcode');
  fireEvent.changeText(input, '112233');
  fireEvent.press(v.getByText('Sign in to onboarding'));
  expect(
    await v.findByText(
      'You are signed in to onboarding only. Financial services remain unavailable because onboarding eligibility is separate from financial eligibility.',
    ),
  ).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    expect.stringContaining('/onboarding-login'),
    { sessionId: 'session-id', passcode: '112233' },
    { registrationBearer: 'verified-token' },
  );
  expect(JSON.stringify((SecureStorage.set as jest.Mock).mock.calls)).not.toContain('112233');
  expect(SecureStorage.set).toHaveBeenCalledWith(
    'synthetic_onboarding_token_v1',
    'onboarding-token',
  );
  fireEvent.press(v.getByText('Sign out of onboarding'));
  expect(await v.findByPlaceholderText('e.g. 08012345678')).toBeTruthy();
});

test.each(['BVN', 'NIN'])(
  'claims an existing %s account after OTP without retaining secrets',
  async (kind) => {
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/simulation-availability')) return { available: false };
      if (path.endsWith('/start')) return { id: 'session-id', token: 'pending-token' };
      if (path.endsWith('/customer-kyc/status')) return onboardingKycStatus;
      if (path.endsWith('/status')) return { status: 'PENDING', expiresAt: future };
      if (path.endsWith('/otp/verify')) return { authorization: 'verified-token' };
      if (path.endsWith('/onboarding-route')) return { next: 'CLAIM' };
      if (path.endsWith('/claim-match')) return { status: 'MATCH' };
      if (path.endsWith('/claim-credentials')) return { status: 'SET_UP' };
      if (path.endsWith('/onboarding-login'))
        return { accessToken: 'onboarding-token', audience: 'customer-onboarding' };
      return {};
    });
    const v = render(<RegistrationScreen />);
    fireEvent.changeText(await v.findByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(v.getByText('Send Verification Code'));
    fireEvent.changeText(await v.findByPlaceholderText('123456'), '123456');
    fireEvent.press(v.getByText('Verify Code'));
    expect(
      await v.findByText('Existing account found. Enter a previously verified identifier.'),
    ).toBeTruthy();
    if (kind === 'NIN') fireEvent.press(v.getByText('Selected: BVN (tap to change)'));
    fireEvent.changeText(v.getByTestId('claim-identifier'), '12345678901');
    fireEvent.press(v.getByText('Match verified identifier'));
    expect(
      await v.findByText(
        'Account matched. Choose a six-digit passcode and a separate transaction PIN.',
      ),
    ).toBeTruthy();
    fireEvent.changeText(v.getByTestId('test-passcode'), '112233');
    fireEvent.changeText(v.getByTestId('test-passcode-confirm'), '112233');
    fireEvent.changeText(v.getByTestId('test-pin'), '334455');
    fireEvent.changeText(v.getByTestId('test-pin-confirm'), '334455');
    fireEvent.press(v.getByText('Save credentials'));
    fireEvent.press(await v.findByText('Continue to onboarding sign in'));
    fireEvent.changeText(await v.findByTestId('onboarding-passcode'), '112233');
    fireEvent.press(v.getByText('Sign in to onboarding'));
    expect(
      await v.findByText(
        'You are signed in to onboarding only. Financial services remain unavailable because onboarding eligibility is separate from financial eligibility.',
      ),
    ).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/claim-match'),
      { sessionId: 'session-id', kind, identifier: '12345678901' },
      { registrationBearer: 'verified-token' },
    );
    const saved = JSON.stringify((SecureStorage.set as jest.Mock).mock.calls);
    expect(saved).not.toContain('12345678901');
    expect(saved).not.toContain('112233');
    expect(saved).not.toContain('334455');
  },
);

test('unverified evidence is shown as pending', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-route')) return { next: 'CLAIM' };
    if (path.endsWith('/claim-match')) return { status: 'PENDING' };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  fireEvent.changeText(await v.findByTestId('claim-identifier'), '12345678901');
  fireEvent.press(v.getByText('Match verified identifier'));
  expect(await v.findByText(/Your registration is not yet activated/)).toBeTruthy();
  // ARENA 4: the outstanding requirements are enumerated instead of one vague sentence.
  expect(v.getByText(/Onboarding requirements/)).toBeTruthy();
  expect(v.getByText(/KYC assessment approved/)).toBeTruthy();
});

test('shows a mismatch without retaining the identifier', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-route')) return { next: 'CLAIM' };
    if (path.endsWith('/claim-match')) return { status: 'MISMATCH' };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  fireEvent.changeText(await v.findByTestId('claim-identifier'), '12345678901');
  fireEvent.press(v.getByText('Match verified identifier'));
  expect(await v.findByText('The identifier did not match. Check it and try again.')).toBeTruthy();
  expect(v.getByTestId('claim-identifier').props.value).toBe('');
});

test('resumes a previously matched claim from the server', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-route')) return { next: 'RESUME_CLAIM' };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(
    await v.findByText(
      'Account matched. Choose a six-digit passcode and a separate transaction PIN.',
    ),
  ).toBeTruthy();
  expect(post.mock.calls.some(([path]: [string]) => path.endsWith('/claim-match'))).toBe(false);
});

test('accepts an eligible financial-scoped session without storing the passcode', async () => {
  useAuthStore.setState({ isAuthenticated: false, session: null, customerId: null });
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_registration_session_v1'
      ? JSON.stringify({
          id: 'session-id',
          token: 'verified-token',
          expiresAt: future,
          phase: 'VERIFIED',
        })
      : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-route')) return { next: 'LOGIN' };
    if (path.endsWith('/onboarding-login'))
      return {
        accessToken: 'financial-token',
        audience: 'customer-api',
        customerId: 'customer-id',
        sessionId: 'financial-session',
        expiresAt: future,
      };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  fireEvent.changeText(await v.findByTestId('onboarding-passcode'), '112233');
  fireEvent.press(v.getByText('Sign in to onboarding'));
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  expect(useAuthStore.getState().session?.audience).toBe('customer-api');
  expect(SecureStorage.set).toHaveBeenCalledWith('auth_session_token', 'financial-token');
  expect(SecureStorage.remove).toHaveBeenCalledWith('synthetic_onboarding_token_v1');
  expect(JSON.stringify((SecureStorage.set as jest.Mock).mock.calls)).not.toContain('112233');
  useAuthStore.setState({ isAuthenticated: false, session: null, customerId: null });
});

it('retires a restricted onboarding token and prompts full sign-in once the customer becomes financially eligible', async () => {
  const future = new Date(Date.now() + 600_000).toISOString();
  (SecureStorage.get as jest.Mock).mockImplementation(async (key: string) =>
    key === 'synthetic_onboarding_token_v1' ? 'prior-onboarding-token' : null,
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-session')) {
      return {
        customerId: 'customer-id',
        sessionId: 'onboarding-session-id',
        audience: 'customer-onboarding',
        expiresAt: future,
        status: 'ACTIVE',
        financialEligible: true,
      };
    }
    if (path.endsWith('/onboarding-logout')) return { status: 'REVOKED' };
    return {};
  });

  const v = render(<RegistrationScreen />);
  expect(
    await v.findByText(
      'Your account is now verified for full access. Verify your phone and passcode to sign in.',
    ),
  ).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    expect.stringContaining('/onboarding-logout'),
    {},
    { registrationBearer: 'prior-onboarding-token' },
  );
  expect(SecureStorage.remove).toHaveBeenCalledWith('synthetic_onboarding_token_v1');
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-ONBOARDING-END-TO-END-01 — authoritative onboarding-state rendering
// ─────────────────────────────────────────────────────────────────────────────

const onboardingState = (
  stage: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  stage,
  nextAction: 'authoritative next action',
  session: { status: 'VERIFIED', expiresAt: future },
  customer: {
    referenceMasked: 'mn-••••5678',
    status: 'DRAFT',
    kycLevel: 'LEVEL_1',
    kycStatus: 'APPROVED',
  },
  claim: null,
  credentials: { passcodeSet: false, pinSet: false },
  requirements: [
    { code: 'phone_verified', label: 'Phone verified', state: 'MET' },
    { code: 'kyc_assessment', label: 'KYC assessment approved', state: 'OUTSTANDING' },
  ],
  outstanding: ['kyc_assessment'],
  wallet: null,
  evaluatedAt: future,
  ...overrides,
});

const verifiedSessionStorage = async (key: string) =>
  key === 'synthetic_registration_session_v1'
    ? JSON.stringify({
        id: 'session-id',
        token: 'verified-token',
        expiresAt: future,
        phase: 'VERIFIED',
      })
    : null;

test('renders the authoritative pending-review state with the shared requirement list', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-state')) return onboardingState('PENDING_REVIEW');
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText(/your identity is still under review/i)).toBeTruthy();
  // The requirement labels are the backend's, not a locally invented checklist.
  expect(v.getByText(/Phone verified/)).toBeTruthy();
  expect(v.getByText(/KYC assessment approved/)).toBeTruthy();
  expect(v.getByText(/Reference mn-••••5678/)).toBeTruthy();
});

test('renders the authoritative rejected state without offering a second registration', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-state')) return onboardingState('REJECTED');
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText(/could not be approved/i)).toBeTruthy();
  expect(v.getByText(/Do not create a second registration/i)).toBeTruthy();
  // Rejection is terminal here: there is no "continue" affordance to click.
  expect(v.queryByText('Continue')).toBeNull();
});

test('routes an activated customer to financial sign-in, never back into onboarding', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-state'))
      return onboardingState('ACTIVATED', {
        customer: {
          referenceMasked: 'mn-••••5678',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
          kycStatus: 'APPROVED',
        },
        outstanding: [],
        wallet: { provisioned: true, currency: 'NGN' },
      });
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText(/Your account is activated/i)).toBeTruthy();
  fireEvent.press(v.getByText('Go to sign in'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
});

test('never fabricates a state when the projection is unavailable', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    // An older/partial backend: the state read answers something the client cannot trust.
    if (path.endsWith('/onboarding-state')) return { unexpected: true };
    if (path.endsWith('/onboarding-route')) return { next: 'LOGIN' };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  // The weaker route read still governs (LOGIN), and the customer is told the status could not be
  // loaded rather than being shown a state the server never reported.
  expect(await v.findByText('Enter your passcode')).toBeTruthy();
  expect(
    v.getByText(/could not load your registration status. Nothing was approved or rejected/i),
  ).toBeTruthy();
});

test('shows approved post-claim status and signs into customer-api when claiming an ACTIVE account', async () => {
  useAuthStore.setState({ isAuthenticated: false, session: null, customerId: null });
  let claimed = false;
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/start')) return { id: 'session-id', token: 'pending-token' };
    if (path.endsWith('/status')) return { status: 'PENDING', expiresAt: future };
    if (path.endsWith('/otp/verify')) return { authorization: 'verified-token' };
    if (path.endsWith('/onboarding-state')) {
      return onboardingState(claimed ? 'LOGIN' : 'CLAIM', {
        nextAction: claimed
          ? 'Your account is approved. Sign in with your passcode to activate your NGN wallet.'
          : 'This phone number already has an account. Verify a registered identity document to claim it.',
        customer: {
          referenceMasked: 'mn-••••5678',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
          kycStatus: 'APPROVED',
        },
        claim: claimed ? null : { available: true, matchedThisSession: false },
        credentials: { passcodeSet: claimed, pinSet: claimed },
        requirements: [
          { code: 'phone_verified', label: 'Phone verified', state: 'MET' },
          { code: 'identity_evidence', label: 'Identity evidence verified', state: 'MET' },
          { code: 'kyc_assessment', label: 'KYC assessment approved', state: 'MET' },
          { code: 'account_active', label: 'Account active', state: 'MET' },
          { code: 'wallet', label: 'Primary NGN wallet provisioned', state: 'OUTSTANDING' },
        ],
        outstanding: ['wallet'],
        wallet: { provisioned: false, currency: null },
      });
    }
    if (path.endsWith('/claim-match')) return { status: 'MATCH' };
    if (path.endsWith('/claim-credentials')) {
      claimed = true;
      return { status: 'SET_UP' };
    }
    if (path.endsWith('/onboarding-login')) {
      return {
        accessToken: 'financial-token',
        audience: 'customer-api',
        customerId: 'customer-id',
        sessionId: 'financial-session',
        expiresAt: future,
      };
    }
    return {};
  });
  const v = render(<RegistrationScreen />);
  fireEvent.changeText(await v.findByPlaceholderText('e.g. 08012345678'), '08012345678');
  fireEvent.press(v.getByText('Send Verification Code'));
  fireEvent.changeText(await v.findByPlaceholderText('123456'), '123456');
  fireEvent.press(v.getByText('Verify Code'));
  fireEvent.changeText(await v.findByTestId('claim-identifier'), '12345678901');
  fireEvent.press(v.getByText('Match verified identifier'));
  fireEvent.changeText(await v.findByTestId('test-passcode'), '112233');
  fireEvent.changeText(v.getByTestId('test-passcode-confirm'), '112233');
  fireEvent.changeText(v.getByTestId('test-pin'), '334455');
  fireEvent.changeText(v.getByTestId('test-pin-confirm'), '334455');
  fireEvent.press(v.getByText('Save credentials'));
  expect(
    await v.findByText(
      'Credentials saved. Your account is approved — sign in to set up your NGN wallet.',
    ),
  ).toBeTruthy();
  expect(v.queryByText(/financial services remain unavailable/i)).toBeNull();
  fireEvent.press(v.getByText('Continue to sign in'));
  fireEvent.changeText(await v.findByTestId('onboarding-passcode'), '112233');
  fireEvent.press(v.getByText('Sign in'));
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  expect(useAuthStore.getState().session?.audience).toBe('customer-api');
  useAuthStore.setState({ isAuthenticated: false, session: null, customerId: null });
});

test('routes an account with an admin temporary password to LoginScreen for rotation', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-state')) {
      return onboardingState('LOGIN', {
        nextAction:
          'Staff issued a temporary password for your account. Sign in to set your permanent password.',
        customer: {
          referenceMasked: 'mn-••••5678',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
          kycStatus: 'APPROVED',
        },
        credentials: { passcodeSet: true, pinSet: false, rotationRequired: true },
        outstanding: ['wallet'],
      });
    }
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText(/Staff issued a temporary password/i)).toBeTruthy();
  fireEvent.press(v.getByText('Sign in with temporary password'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
});

test('lets an activated mobile-claimed customer sign back in with phone OTP + 6-digit passcode', async () => {
  (SecureStorage.get as jest.Mock).mockImplementation(verifiedSessionStorage);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: false };
    if (path.endsWith('/onboarding-state')) {
      return onboardingState('ACTIVATED', {
        nextAction: 'Your account is active. Sign in with your phone number and passcode.',
        customer: {
          referenceMasked: 'mn-••••5678',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
          kycStatus: 'APPROVED',
        },
        credentials: { passcodeSet: true, pinSet: true, mobileOtpRequired: true },
        outstanding: [],
        wallet: { provisioned: true, currency: 'NGN' },
      });
    }
    if (path.endsWith('/onboarding-login')) {
      return {
        accessToken: 'active-customer-token',
        sessionId: 'session-id',
        customerId: '11111111-1111-4111-8111-111111111199',
        audience: 'customer-api',
        expiresAt: future,
      };
    }
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(
    await v.findByText('Your account is active. Sign in with your phone number and passcode.'),
  ).toBeTruthy();
  expect(v.queryByText('Go to sign in')).toBeNull();
  fireEvent.changeText(await v.findByTestId('onboarding-passcode'), '246810');
  fireEvent.press(v.getByText('Sign in'));
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  expect(useAuthStore.getState().session?.audience).toBe('customer-api');
  useAuthStore.setState({ isAuthenticated: false, session: null, customerId: null });
});

