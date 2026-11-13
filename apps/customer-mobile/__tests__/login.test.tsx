import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { LoginScreen, describeLoginFailure } from '../src/screens/unauthenticated/LoginScreen';
import { ApiError, NetworkError } from '../src/services/api-client';

const mockLogin = jest.fn();
let mockStoreState: Record<string, unknown> = {};

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => mockStoreState,
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe('describeLoginFailure', () => {
  test('reports an eligibility refusal as a real account state, not a credential error', () => {
    const feedback = describeLoginFailure(new ApiError('Customer is not eligible', 409));
    expect(feedback.title).toBe('Financial access not yet available');
    expect(feedback.body).toContain('not yet eligible for financial services');
  });

  test('reports an unavailable policy service without implying a session exists', () => {
    const feedback = describeLoginFailure(new ApiError('policy unavailable', 503));
    expect(feedback.title).toBe('Service unavailable');
    expect(feedback.body).toContain('no session was created');
  });

  test('handles lockout, rate limiting and offline states distinctly', () => {
    expect(describeLoginFailure(new ApiError('locked', 423)).title).toBe(
      'Account temporarily locked',
    );
    expect(describeLoginFailure(new ApiError('slow down', 429)).title).toBe('Too many attempts');
    expect(describeLoginFailure(new NetworkError('offline')).title).toBe('No connection');
    expect(describeLoginFailure(new ApiError('bad', 401)).title).toBe('Sign-in failed');
  });
});

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState = { login: mockLogin, isLoading: false, rotationRequired: false };
  });

  test('validates locally before contacting the backend', async () => {
    const { getByText } = render(<LoginScreen />);

    fireEvent.press(getByText('Log In'));

    await waitFor(() => expect(getByText('Check your details')).toBeTruthy());
    expect(getByText('Phone number or Customer ID is required')).toBeTruthy();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('submits credentials and surfaces a real backend refusal', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError('Customer is not eligible', 409));
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08031234567');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'secret-password');
    fireEvent.press(getByText('Log In'));

    await waitFor(() => expect(getByText('Financial access not yet available')).toBeTruthy());
    expect(mockLogin).toHaveBeenCalledWith('08031234567', 'secret-password');
    expect(getByText(/not yet eligible for financial services/)).toBeTruthy();
  });

  test('explains a temporary password that must be rotated before a session exists', () => {
    mockStoreState = { login: mockLogin, isLoading: false, rotationRequired: true };
    const { getByText } = render(<LoginScreen />);

    expect(getByText('Password change required')).toBeTruthy();
    expect(getByText(/must be changed before any session can be issued/)).toBeTruthy();
    // ARENA 4: rotation is implemented, so the screen routes to the real contract instead of
    // telling the customer to contact Support.
    fireEvent.press(getByText('Change my temporary password'));
    expect(mockNavigate).toHaveBeenCalledWith('CredentialRotation');
  });

  test('offers the onboarding path and keeps onboarding separate from financial access', () => {
    const { getByText } = render(<LoginScreen />);

    expect(getByText('Start or resume onboarding')).toBeTruthy();
    expect(getByText(/does not enable balances, transfers or cash operations/)).toBeTruthy();
  });
});
