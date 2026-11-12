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
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  const input = await v.findByTestId('onboarding-passcode');
  fireEvent.changeText(input, '112233');
  fireEvent.press(v.getByText('Sign in to onboarding'));
  expect(
    await v.findByText('Signed in to onboarding only. Financial services remain unavailable.'),
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
      await v.findByText('Signed in to onboarding only. Financial services remain unavailable.'),
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
  expect(await v.findByText(/Verification or registration is pending/)).toBeTruthy();
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
