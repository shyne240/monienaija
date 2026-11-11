import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RegistrationScreen } from '../src/screens/unauthenticated/RegistrationScreen';
import { ApiClient } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

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

test('fails closed when simulation is not available', async () => {
  post.mockResolvedValue({ available: false });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText('Registration is temporarily unavailable.')).toBeTruthy();
  expect(v.queryByPlaceholderText('e.g. 08012345678')).toBeNull();
  fireEvent.press(v.getByText('Back to Sign In'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
});

test.each(['BVN', 'NIN'])(
  'walks through phone, profile and %s simulation without claiming activation',
  async (kind) => {
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/simulation-availability')) return { available: true };
      if (path.endsWith('/start')) return { id: 'session-id', token: 'pending-token' };
      if (path.endsWith('/status')) return { status: 'PENDING', expiresAt: future };
      if (path.endsWith('/otp/verify')) return { authorization: 'verified-token' };
      if (path.endsWith('/consent')) return { id: 'consent-id' };
      if (path.endsWith('/synthetic-verification')) return { status: 'MATCH', simulated: true };
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
    expect(
      await v.findByText(/no Tier 1 approval, account or wallet has been created/),
    ).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/synthetic-verification'),
      expect.objectContaining({ kind, identifier: '00000000000' }),
      { registrationBearer: 'verified-token' },
    );
  },
);

test('resumes a verified profile without retaining an identifier or OTP', async () => {
  (SecureStorage.get as jest.Mock).mockResolvedValue(
    JSON.stringify({
      id: 'session-id',
      token: 'verified-token',
      expiresAt: future,
      phase: 'VERIFIED',
    }),
  );
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/simulation-availability')) return { available: true };
    if (path.endsWith('/synthetic-profile/status'))
      return { firstName: 'Synthetic', lastName: 'Person', dateOfBirth: '2000-01-01', email: null };
    return { status: 'VERIFIED', expiresAt: future };
  });
  const v = render(<RegistrationScreen />);
  expect(await v.findByText('Step 4 of 4: Synthetic identity')).toBeTruthy();
  expect(v.getByTestId('test-identifier').props.value).toBe('');
});
