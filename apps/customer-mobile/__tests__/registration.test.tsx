import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { RegistrationScreen } from '../src/screens/unauthenticated/RegistrationScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

const mockPost = ApiClient.post as jest.Mock;

/**
 * V1-CUSTOMER-04 — this suite replaces the previous version, which asserted that
 * `ApiClient.post` was called with the WRONG, workforce-only endpoint (`/customers`).
 * That earlier suite passed while the feature itself was non-functional against the
 * real backend's authorization rules — see docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md
 * Section 9/10 finding #1-2. This suite asserts against the real public contract:
 *
 *   POST /customers/registration/otp
 *   POST /customers/registration/otp/verify
 *   POST /customers/registration
 */
describe('Registration Screen — real OTP-verified backend contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('renders the initial phone-entry step', () => {
    const { getByText, getByPlaceholderText } = render(<RegistrationScreen />);
    expect(getByText('Create Account')).toBeTruthy();
    expect(getByPlaceholderText('e.g. 08012345678')).toBeTruthy();
    expect(getByText('Send Verification Code')).toBeTruthy();
  });

  test('shows a validation error when phone is empty', async () => {
    const { getByText } = render(<RegistrationScreen />);
    fireEvent.press(getByText('Send Verification Code'));
    expect(getByText('Phone number is required')).toBeTruthy();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('requesting an OTP calls the correct endpoint and advances to the OTP step', async () => {
    mockPost.mockResolvedValueOnce({
      status: 'OTP_REQUEST_ACCEPTED',
      resendAfterSeconds: 30,
      expiresInSeconds: 300,
    });

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp', {
        phone: '08012345678',
      });
      expect(getByText('Verification Code')).toBeTruthy();
      expect(getByText(/Enter the 6-digit code sent to/)).toBeTruthy();
    });
  });

  test('verifying an OTP calls the correct endpoint and advances to the details step', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 'OTP_REQUEST_ACCEPTED',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
      .mockResolvedValueOnce({
        status: 'PHONE_VERIFIED',
        verificationToken: 'token-abc-123-456-789-0123456789',
        expiresInSeconds: 600,
      });

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify Code'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp/verify', {
        phone: '08012345678',
        code: '482913',
      });
      expect(getByText('Create Account')).toBeTruthy();
      expect(getByText('Phone verified. Finish creating your account.')).toBeTruthy();
    });
  });

  test('an incorrect OTP produces an appropriate, generic error and does not advance', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 'OTP_REQUEST_ACCEPTED',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
      .mockRejectedValueOnce(new ApiError('OTP verification failed', 400));

    const { getByPlaceholderText, getByText, queryByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '000000');
    fireEvent.press(getByText('Verify Code'));

    await waitFor(() => {
      expect(getByText(/incorrect or has expired/)).toBeTruthy();
    });
    // Must remain on the OTP step — registration completion must never be called.
    expect(queryByText('Password')).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test('completing registration collects a password and calls the correct endpoint with the verification token', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 'OTP_REQUEST_ACCEPTED',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
      .mockResolvedValueOnce({
        status: 'PHONE_VERIFIED',
        verificationToken: 'token-abc-123-456-789-0123456789',
        expiresInSeconds: 600,
      })
      .mockResolvedValueOnce({
        id: 'cust-uuid-1111-2222',
        reference: 'mn-8012345678',
        status: 'ACTIVE',
        phone: '+234*****5678',
        phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
        wallet: { id: 'wallet-uuid-1', currency: 'NGN', status: 'ACTIVE' },
      });

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify Code'));
    await waitFor(() => expect(getByText('Phone verified. Finish creating your account.')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. Babajide Alao'), 'Babajide Alao');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'SuperSecret1');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'SuperSecret1');
    fireEvent.press(getByText('Finish Sign Up'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenNthCalledWith(
        3,
        '/customers/registration',
        expect.objectContaining({
          phone: '08012345678',
          verificationToken: 'token-abc-123-456-789-0123456789',
          password: 'SuperSecret1',
          displayName: 'Babajide Alao',
          idempotencyKey: expect.any(String),
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
      expect(getByText('Account Created Successfully!')).toBeTruthy();
      expect(getByText('mn-8012345678')).toBeTruthy();
    });

    // The workforce-only, internal-route endpoint must NEVER be called by this flow.
    expect(mockPost).not.toHaveBeenCalledWith('/customers', expect.anything());

    fireEvent.press(getByText('Proceed to Log In'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  test('rejects mismatched passwords client-side without calling the backend', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 'OTP_REQUEST_ACCEPTED',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
      .mockResolvedValueOnce({
        status: 'PHONE_VERIFIED',
        verificationToken: 'token-abc-123-456-789-0123456789',
        expiresInSeconds: 600,
      });

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify Code'));
    await waitFor(() => expect(getByText('Phone verified. Finish creating your account.')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'SuperSecret1');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'DifferentPassword1');
    fireEvent.press(getByText('Finish Sign Up'));

    await waitFor(() => {
      expect(getByText('Passwords do not match')).toBeTruthy();
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test('handles a duplicate-phone 409 conflict from registration completion', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 'OTP_REQUEST_ACCEPTED',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
      .mockResolvedValueOnce({
        status: 'PHONE_VERIFIED',
        verificationToken: 'token-abc-123-456-789-0123456789',
        expiresInSeconds: 600,
      })
      .mockRejectedValueOnce(new ApiError('Registration could not be completed', 409));

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify Code'));
    await waitFor(() => expect(getByText('Phone verified. Finish creating your account.')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'SuperSecret1');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'SuperSecret1');
    fireEvent.press(getByText('Finish Sign Up'));

    await waitFor(() => {
      expect(getByText(/account already exists for this phone number/)).toBeTruthy();
    });
  });

  test('loading state disables duplicate submission while a request is in flight', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const { getByPlaceholderText, getByText, queryByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));

    // The button enters its loading state (disabled, spinner replaces the label) the
    // instant the request is submitted — the pressable label is no longer present, so
    // a user cannot fire a second submission while the first is in flight.
    expect(queryByText('Send Verification Code')).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);

    resolveRequest({ status: 'OTP_REQUEST_ACCEPTED', resendAfterSeconds: 30, expiresInSeconds: 300 });
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());
  });

  test('never logs sensitive values (password, OTP code, verification token) to the console', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockPost
      .mockResolvedValueOnce({ status: 'OTP_REQUEST_ACCEPTED', resendAfterSeconds: 30, expiresInSeconds: 300 })
      .mockResolvedValueOnce({
        status: 'PHONE_VERIFIED',
        verificationToken: 'super-secret-verification-token-0123456789',
        expiresInSeconds: 600,
      })
      .mockResolvedValueOnce({
        id: 'cust-uuid-1111-2222',
        reference: 'mn-8012345678',
        status: 'ACTIVE',
        phone: '+234*****5678',
        phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
      });

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);
    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.press(getByText('Send Verification Code'));
    await waitFor(() => expect(getByText('Verification Code')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    fireEvent.press(getByText('Verify Code'));
    await waitFor(() => expect(getByText('Phone verified. Finish creating your account.')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'SuperSecret1');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'SuperSecret1');
    fireEvent.press(getByText('Finish Sign Up'));
    await waitFor(() => expect(getByText('Account Created Successfully!')).toBeTruthy());

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((value) => String(value))
      .join(' ');

    expect(allLoggedText).not.toContain('SuperSecret1');
    expect(allLoggedText).not.toContain('482913');
    expect(allLoggedText).not.toContain('super-secret-verification-token-0123456789');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
