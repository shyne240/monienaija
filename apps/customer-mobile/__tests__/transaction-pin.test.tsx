import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { TransactionPinScreen } from '../src/screens/authenticated/TransactionPinScreen';
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

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
  // Minimal stand-in: runs the focus callback once on mount (and its cleanup on unmount),
  // which is sufficient to exercise TransactionPinScreen's status-load-on-focus behavior
  // without a real NavigationContainer in this unit test environment.
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => {
      const cleanup = callback();
      return cleanup;
    }, []);
  },
}));

/**
 * V1-CUSTOMER-05 — Secure Customer Transaction PIN screen tests.
 *
 * Covers: first-time creation, known-PIN change, incorrect current PIN, new
 * PIN mismatch, locked state (no fake reset), API failure handling on the
 * status fetch, and duplicate-submit prevention while a request is in
 * flight.
 */
describe('TransactionPinScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('first-time creation: NOT_SET status shows the create form and a successful submit confirms creation', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'NOT_SET', exists: false, accountLocked: false });
    (ApiClient.post as jest.Mock).mockResolvedValue({ customerId: 'cust-1', pinVersion: 1, updatedAt: new Date().toISOString() });

    const { getByText, getByPlaceholderText, queryByText } = render(<TransactionPinScreen />);

    await waitFor(() => expect(getByText('Create Transaction PIN')).toBeTruthy());
    expect(queryByText('Current Transaction PIN')).toBeNull();

    fireEvent.changeText(getByPlaceholderText('Enter new PIN'), '1234');
    fireEvent.changeText(getByPlaceholderText('Confirm new PIN'), '1234');
    fireEvent.press(getByText('Create Transaction PIN'));

    await waitFor(() => expect(getByText('Transaction PIN created successfully.')).toBeTruthy());
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/me/transaction-pin', { pin: '1234' });
  });

  test('known-PIN change: ACTIVE status shows current/new/confirm fields and a successful change confirms it', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'ACTIVE', exists: true, accountLocked: false, pinVersion: 1 });
    (ApiClient.post as jest.Mock).mockResolvedValue({ customerId: 'cust-1', pinVersion: 2, updatedAt: new Date().toISOString() });

    const { getByText, getByPlaceholderText } = render(<TransactionPinScreen />);

    await waitFor(() => expect(getByText('Change Transaction PIN')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Enter current PIN'), '1234');
    fireEvent.changeText(getByPlaceholderText('Enter new PIN'), '5678');
    fireEvent.changeText(getByPlaceholderText('Confirm new PIN'), '5678');
    fireEvent.press(getByText('Change Transaction PIN'));

    await waitFor(() => expect(getByText('Transaction PIN changed successfully.')).toBeTruthy());
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/me/transaction-pin/change', {
      currentPin: '1234',
      newPin: '5678',
    });
  });

  test('incorrect current PIN: change request rejected with 401 shows an error and does not clear ACTIVE status', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'ACTIVE', exists: true, accountLocked: false, pinVersion: 1 });
    (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('Current PIN is incorrect', 401));

    const { getByText, getByPlaceholderText } = render(<TransactionPinScreen />);
    await waitFor(() => expect(getByText('Change Transaction PIN')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Enter current PIN'), '0000');
    fireEvent.changeText(getByPlaceholderText('Enter new PIN'), '5678');
    fireEvent.changeText(getByPlaceholderText('Confirm new PIN'), '5678');
    fireEvent.press(getByText('Change Transaction PIN'));

    await waitFor(() => expect(getByText('Current PIN is incorrect')).toBeTruthy());
    // Still on the change (ACTIVE) form, not silently switched away
    expect(getByText('Change Transaction PIN')).toBeTruthy();
  });

  test('new PIN mismatch: client-side validation blocks submission before any API call', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'ACTIVE', exists: true, accountLocked: false, pinVersion: 1 });

    const { getByText, getByPlaceholderText } = render(<TransactionPinScreen />);
    await waitFor(() => expect(getByText('Change Transaction PIN')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Enter current PIN'), '1234');
    fireEvent.changeText(getByPlaceholderText('Enter new PIN'), '5678');
    fireEvent.changeText(getByPlaceholderText('Confirm new PIN'), '9999');
    fireEvent.press(getByText('Change Transaction PIN'));

    await waitFor(() => expect(getByText('New PIN confirmation does not match.')).toBeTruthy());
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('locked state: shows an honest "contact support" message, no PIN inputs and no fake reset button', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'LOCKED', exists: true, accountLocked: true, pinVersion: 1 });

    const { getByText, queryByText, queryByPlaceholderText } = render(<TransactionPinScreen />);

    await waitFor(() => expect(getByText('Transaction PIN locked')).toBeTruthy());
    expect(queryByText(/does not offer an in-app PIN reset/i)).toBeTruthy();
    expect(queryByText(/Reset PIN/i)).toBeNull();
    expect(queryByPlaceholderText('Enter current PIN')).toBeNull();
    expect(queryByPlaceholderText('Enter new PIN')).toBeNull();

    fireEvent.press(getByText('Contact Support'));
    expect(mockNavigate).toHaveBeenCalledWith(
      'CreateSupportTicket',
      expect.objectContaining({ category: 'PIN' }),
    );
  });

  test('API failure handling: status fetch failure shows an error with a retry action instead of a blank/crashed screen', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(new ApiError('Network unreachable', 0));

    const { getByText } = render(<TransactionPinScreen />);

    await waitFor(() => expect(getByText('Network unreachable')).toBeTruthy());
    expect(getByText('Retry')).toBeTruthy();

    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'NOT_SET', exists: false, accountLocked: false });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByText('Create Transaction PIN')).toBeTruthy());
  });

  test('loading/duplicate-submit prevention: a second press while the first create request is in flight does not issue a second API call', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'NOT_SET', exists: false, accountLocked: false });
    let resolvePost: (value: unknown) => void = () => undefined;
    (ApiClient.post as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve; }),
    );

    const { getByText, getByPlaceholderText } = render(<TransactionPinScreen />);
    await waitFor(() => expect(getByText('Create Transaction PIN')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Enter new PIN'), '1234');
    fireEvent.changeText(getByPlaceholderText('Confirm new PIN'), '1234');

    // Capture the button element before it switches to its loading spinner (which replaces
    // its text), then reuse the same reference to simulate a rapid second tap.
    const submitButton = getByText('Create Transaction PIN');
    fireEvent.press(submitButton);
    // Button should now be in its loading state (disabled) before the request resolves.
    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
    fireEvent.press(submitButton);
    expect(ApiClient.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({ customerId: 'cust-1', pinVersion: 1, updatedAt: new Date().toISOString() });
    });
    await waitFor(() => expect(getByText('Transaction PIN created successfully.')).toBeTruthy());
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
  });
});
