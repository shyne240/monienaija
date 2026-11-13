import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CredentialRecoveryScreen } from '../src/screens/unauthenticated/CredentialRecoveryScreen';
import { CredentialRotationScreen } from '../src/screens/unauthenticated/CredentialRotationScreen';
import {
  CredentialRecoveryApi,
  describeRecoveryFailure,
} from '../src/services/credential-recovery';
import { ApiError, NetworkError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  NetworkError: class extends Error {},
}));

jest.mock('../src/services/credential-recovery', () => {
  const actual = jest.requireActual('../src/services/credential-recovery');
  return {
    ...actual,
    CredentialRecoveryApi: {
      policy: jest.fn(),
      requestChallenge: jest.fn(),
      verifyChallenge: jest.fn(),
      complete: jest.fn(),
    },
  };
});

const mockNavigate = jest.fn();
let mockParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockParams }),
}));

const mockRotate = jest.fn();
let mockStoreState: Record<string, unknown> = {};

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => mockStoreState,
}));

const POLICY = {
  policyVersion: 'v1',
  enabled: true,
  purposes: ['LOGIN_PASSCODE', 'TRANSACTION_PIN'],
  authority: {
    requiresVerifiedPhoneOtp: true,
    requiresTrustedIdentityEvidence: true,
    requiresActiveCustomer: true,
    phoneNumberAloneIsSufficient: false,
  },
  otp: { expiresInSeconds: 600, maxVerifyAttempts: 5, resendAfterSeconds: 60 },
  recoveryToken: { expiresInSeconds: 600 },
  fallback: { status: 'SUPPORT_REQUIRED', contact: 'SUPPORT_TICKET' },
};

const api = CredentialRecoveryApi as unknown as {
  policy: jest.Mock;
  requestChallenge: jest.Mock;
  verifyChallenge: jest.Mock;
  complete: jest.Mock;
};

describe('describeRecoveryFailure', () => {
  test('fails closed onto Support when the backend demands authoritative evidence', () => {
    const feedback = describeRecoveryFailure(new ApiError('support required', 409), 'OTP');
    expect(feedback.supportRequired).toBe(true);
    expect(feedback.body).toContain('nothing was changed');
    expect(feedback.body).toContain('a phone number on its own is never enough');
  });

  test('treats unavailable policy as fail-closed, never as success', () => {
    expect(describeRecoveryFailure(new ApiError('unavailable', 503), 'PHONE')).toMatchObject({
      title: 'Recovery is unavailable',
      supportRequired: true,
    });
    expect(describeRecoveryFailure(new NetworkError('offline'), 'PHONE').supportRequired).toBe(
      false,
    );
  });

  test('never reports an OTP rejection as a session or credential change', () => {
    const feedback = describeRecoveryFailure(new ApiError('invalid', 401), 'OTP');
    expect(feedback.title).toBe('That code did not match');
    expect(feedback.supportRequired).toBe(false);
  });
});

describe('CredentialRecoveryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { purpose: 'LOGIN_PASSCODE' };
  });

  test('shows the support pathway when the approved recovery policy is disabled', async () => {
    api.policy.mockResolvedValue({ ...POLICY, enabled: false });
    const { getByText, queryByPlaceholderText } = render(<CredentialRecoveryScreen />);

    await waitFor(() => expect(getByText('Self-service reset is not available')).toBeTruthy());
    expect(queryByPlaceholderText('e.g. 08012345678')).toBeNull();
    expect(getByText('Back to sign in')).toBeTruthy();
    expect(api.requestChallenge).not.toHaveBeenCalled();
  });

  test('fails closed when the policy cannot be read at all', async () => {
    api.policy.mockRejectedValue(new ApiError('down', 503));
    const { getByText, queryByText } = render(<CredentialRecoveryScreen />);

    await waitFor(() => expect(getByText('Recovery is unavailable right now')).toBeTruthy());
    expect(getByText('Try again')).toBeTruthy();
    expect(queryByText('Send recovery code')).toBeNull();
  });

  test('walks phone → OTP → new passcode and only reports success after the backend completes', async () => {
    api.policy.mockResolvedValue(POLICY);
    api.requestChallenge.mockResolvedValue({
      status: 'ACCEPTED',
      purpose: 'LOGIN_PASSCODE',
      challengeId: '11111111-1111-4111-8111-111111111111',
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    });
    api.verifyChallenge.mockResolvedValue({
      status: 'VERIFIED',
      purpose: 'LOGIN_PASSCODE',
      recoveryToken: 'A'.repeat(43),
      expiresInSeconds: 600,
      deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
    });
    api.complete.mockResolvedValue({
      status: 'COMPLETED',
      purpose: 'LOGIN_PASSCODE',
      sessionsRevoked: 2,
      deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
    });

    const { getByText, getByPlaceholderText, queryByText } = render(<CredentialRecoveryScreen />);

    await waitFor(() => expect(getByText('Send recovery code')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send recovery code'));

    await waitFor(() => expect(getByText('Verify code')).toBeTruthy());
    expect(api.requestChallenge).toHaveBeenCalledWith('08012345678', 'LOGIN_PASSCODE');
    // The accepted response says nothing about whether an account exists.
    expect(queryByText(/account found/i)).toBeNull();

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify code'));

    await waitFor(() => expect(getByText('Replace credential')).toBeTruthy());
    expect(api.verifyChallenge).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '482913',
    );

    fireEvent.changeText(getByPlaceholderText('Enter six digits'), '246810');
    fireEvent.changeText(getByPlaceholderText('Repeat six digits'), '246810');
    fireEvent.press(getByText('Replace credential'));

    await waitFor(() => expect(getByText('Credential replaced')).toBeTruthy());
    expect(api.complete).toHaveBeenCalledWith('A'.repeat(43), '246810', '246810');
  });

  test('stops at SUPPORT_REQUIRED from the backend instead of retrying the form', async () => {
    api.policy.mockResolvedValue(POLICY);
    api.requestChallenge.mockResolvedValue({
      status: 'ACCEPTED',
      purpose: 'LOGIN_PASSCODE',
      challengeId: '11111111-1111-4111-8111-111111111111',
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    });
    api.verifyChallenge.mockRejectedValue(new ApiError('support required', 409));

    const { getByText, getByPlaceholderText } = render(<CredentialRecoveryScreen />);
    await waitFor(() => expect(getByText('Send recovery code')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send recovery code'));
    await waitFor(() => expect(getByText('Verify code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '000000');
    fireEvent.press(getByText('Verify code'));

    await waitFor(() => expect(getByText('Support is required to finish this')).toBeTruthy());
    expect(api.complete).not.toHaveBeenCalled();
  });

  test('validates locally before spending an OTP attempt', async () => {
    api.policy.mockResolvedValue(POLICY);
    const { getByText, getByPlaceholderText } = render(<CredentialRecoveryScreen />);
    await waitFor(() => expect(getByText('Send recovery code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '123');
    fireEvent.press(getByText('Send recovery code'));

    await waitFor(() => expect(getByText('Check your details')).toBeTruthy());
    expect(api.requestChallenge).not.toHaveBeenCalled();
  });
});

describe('CredentialRotationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState = {
      rotateTemporaryCredential: mockRotate,
      isLoading: false,
      rotationCustomerId: 'e2b6c1f0-0000-4000-8000-000000000001',
    };
  });

  test('requires an 8-character new password that differs from the temporary one', async () => {
    const { getByText, getByPlaceholderText } = render(<CredentialRotationScreen />);

    fireEvent.changeText(getByPlaceholderText('From your MonieNaija message'), 'Temp#12345');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'short');
    fireEvent.press(getByText('Change password and sign in'));

    await waitFor(() => expect(getByText('Check your details')).toBeTruthy());
    expect(mockRotate).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'Temp#12345');
    fireEvent.press(getByText('Change password and sign in'));
    await waitFor(() =>
      expect(
        getByText('The new password must be different from the temporary password'),
      ).toBeTruthy(),
    );
    expect(mockRotate).not.toHaveBeenCalled();
  });

  test('submits the real rotation contract and surfaces an eligibility refusal honestly', async () => {
    mockRotate.mockRejectedValueOnce(new ApiError('not eligible', 409));
    const { getByText, getByPlaceholderText } = render(<CredentialRotationScreen />);

    fireEvent.changeText(getByPlaceholderText('From your MonieNaija message'), 'Temp#12345');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'NewPass#2026');
    fireEvent.changeText(getByPlaceholderText('Repeat the new password'), 'NewPass#2026');
    fireEvent.press(getByText('Change password and sign in'));

    await waitFor(() => expect(getByText('Financial access not yet available')).toBeTruthy());
    expect(mockRotate).toHaveBeenCalledWith('Temp#12345', 'NewPass#2026');
  });

  test('refuses to rotate without a pending rotation attempt', async () => {
    mockStoreState = {
      rotateTemporaryCredential: mockRotate,
      isLoading: false,
      rotationCustomerId: null,
    };
    const { getByText, getByPlaceholderText } = render(<CredentialRotationScreen />);

    await waitFor(() => expect(getByText('Start signing in again')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('From your MonieNaija message'), 'Temp#12345');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'NewPass#2026');
    fireEvent.changeText(getByPlaceholderText('Repeat the new password'), 'NewPass#2026');
    fireEvent.press(getByText('Change password and sign in'));
    expect(mockRotate).not.toHaveBeenCalled();
  });
});
