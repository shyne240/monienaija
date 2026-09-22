import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { CreatePinScreen } from '../src/screens/authenticated/CreatePinScreen';
import { ChangePinScreen } from '../src/screens/authenticated/ChangePinScreen';
import { ResetPinScreen } from '../src/screens/authenticated/ResetPinScreen';
import { classifyPinError } from '../src/services/transaction-pin';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
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

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({
    customerId: 'cust-uuid-777',
  }),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
}));

describe('Transaction PIN management service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('create posts the PIN to the authenticated endpoint with the mobile actor', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ configured: true, maxAttempts: 5 });

    const { getAllByPlaceholderText, getByText } = render(<CreatePinScreen />);

    await waitFor(() => {
      expect(getByText('Create Transaction PIN')).toBeTruthy();
    });

    fireEvent.changeText(getAllByPlaceholderText('••••')[0], '5173');
    fireEvent.changeText(getAllByPlaceholderText('••••')[1], '5173');
    fireEvent.press(getByText('Create PIN'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/cust-uuid-777/transaction-pin',
        {
          actor: 'customer-mobile',
          pin: '5173',
        },
      );
      expect(getByText('Transaction PIN Created')).toBeTruthy();
      // Never persisted anywhere else
      expect(ApiClient.post).toHaveBeenCalledTimes(1);
    });
  });

  test('change surfaces an incorrect-current-PIN rejection', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('Invalid transaction PIN', 401));

    const { getAllByPlaceholderText, getByText } = render(<ChangePinScreen />);

    await waitFor(() => {
      expect(getByText('Change Transaction PIN')).toBeTruthy();
    });

    fireEvent.changeText(getAllByPlaceholderText('••••')[0], '9999');
    fireEvent.changeText(getAllByPlaceholderText('••••')[1], '4321');
    fireEvent.changeText(getAllByPlaceholderText('••••')[2], '4321');
    fireEvent.press(getByText('Change PIN'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/cust-uuid-777/transaction-pin/change',
        {
          actor: 'customer-mobile',
          currentPin: '9999',
          newPin: '4321',
        },
      );
      // Wrong current PIN classifies to the incorrect-PIN message
      expect(getByText(/Incorrect transaction PIN/)).toBeTruthy();
    });
  });

  test('reset requires the account password and clears the form after submission', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ configured: true });

    const { getAllByPlaceholderText, getByPlaceholderText, getByText, queryByDisplayValue } =
      render(<ResetPinScreen />);

    await waitFor(() => {
      expect(getByText('Reset Transaction PIN')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Your login password'), 'hunter2$Long');
    fireEvent.changeText(getAllByPlaceholderText('••••')[0], '1122');
    fireEvent.changeText(getAllByPlaceholderText('••••')[1], '1122');
    fireEvent.press(getByText('Reset PIN'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/cust-uuid-777/transaction-pin/reset',
        {
          actor: 'customer-mobile',
          password: 'hunter2$Long',
          newPin: '1122',
        },
      );
      expect(getByText('Transaction PIN Reset')).toBeTruthy();
      // The plaintext password and PIN are wiped after the submission.
      expect(queryByDisplayValue('hunter2$Long')).toBeNull();
      expect(queryByDisplayValue('1122')).toBeNull();
    });
  });

  test('create blocks mismatched confirmation PINs before any network call', async () => {
    const { getAllByPlaceholderText, getByText } = render(<CreatePinScreen />);

    await waitFor(() => {
      expect(getByText('Create Transaction PIN')).toBeTruthy();
    });

    fireEvent.changeText(getAllByPlaceholderText('••••')[0], '5173');
    fireEvent.changeText(getAllByPlaceholderText('••••')[1], '5174');
    fireEvent.press(getByText('Create PIN'));

    await waitFor(() => {
      expect(getByText('The confirmation PIN does not match.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('classifyPinError maps the server error taxonomy', () => {
    expect(classifyPinError(new ApiError('No transaction PIN configured for customer abc', 404)).kind)
      .toBe('NOT_CONFIGURED');
    expect(classifyPinError(new ApiError('Transaction PIN is locked', 403)).kind).toBe('LOCKED');
    expect(classifyPinError(new ApiError('Invalid transaction PIN', 401)).kind).toBe('INCORRECT');
    expect(classifyPinError(new ApiError('PIN recovery attempt failed', 401)).kind)
      .toBe('RECOVERY_FAILED');
    expect(classifyPinError(new ApiError('pin must be 4-6 digits', 400)).kind).toBe('MALFORMED');
    expect(classifyPinError(new ApiError('A transaction PIN already exists', 409)).kind)
      .toBe('DUPLICATE');
    expect(classifyPinError(new ApiError('Something else broke', 500)).kind).toBe('UNKNOWN');
  });
});
