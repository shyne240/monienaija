import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02: the Dashboard screen (the default view every test
// below lands on first) now makes one real `ApiClient.get` call on mount to load the caller's own
// dashboard — always the first recorded call. Prefixed onto the sequential
// `.mockResolvedValueOnce(...)` chain below so it still lines up with this screen's own call order.
const DASHBOARD_FETCH_STUB = { templateKey: 'DEFAULT_FALLBACK', displayName: 'Default Dashboard', description: '', isFallback: true, widgets: [] };

describe('Admin Web Portal W4 Transaction Observability & Fee Simulator Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'controller-bearer',
      sessionId: 'controller-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:back-office-controller',
        sessionId: 'controller-sess',
        audience: 'workforce-admin',
        roles: ['SUPER_ADMIN'],
        scopes: ['transaction.view','reporting.transaction_summary.view','fee_rule.view'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });

  test('loads deposit details as read-only and never submits a sandbox settlement command', async () => {
    const mockDeposit = {
      id: 'dep-uuid-777',
      status: 'PENDING',
      currency: 'NGN',
      amountMinor: '125000',
      createdAt: new Date().toISOString(),
      walletId: 'wallet-uuid-123',
      reference: 'dep-ref-123',
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB)
      .mockResolvedValueOnce(mockDeposit);

    const { getByText, getByPlaceholderText, findByText, queryByText } = render(<App />);

    fireEvent.click(getByText('💸 Transaction & Fee Ops — Transfers (W2W)'));
    const selectEl = getByText('P2P TRANSFER').parentElement as HTMLSelectElement;
    fireEvent.change(selectEl, { target: { value: 'DEPOSIT' } });
    fireEvent.change(getByPlaceholderText('e.g. 5e6f7g8h-...'), { target: { value: 'dep-uuid-777' } });
    fireEvent.click(getByText('Track'));

    expect(ApiClient.get).toHaveBeenNthCalledWith(2, '/deposits/dep-uuid-777');
    expect(await findByText('DEPOSIT Detail View')).toBeTruthy();
    expect(await findByText('dep-ref-123')).toBeTruthy();
    expect(await findByText('PENDING')).toBeTruthy();
    expect(
      await findByText('This view is read-only. A pending record cannot be completed here and is not evidence of external settlement.'),
    ).toBeTruthy();
    expect(queryByText('Trigger Sandbox Completion')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should run fee simulator calculations and display gross output', async () => {
    const mockFeeResult = {
      feeMinor: '1500', // 15 Naira
      vatMinor: '112',  // 1.12 Naira
      totalMinor: '101612', // 1,016.12 Naira
    };

    (ApiClient.post as jest.Mock).mockResolvedValue(mockFeeResult);

    const { getByText, getByPlaceholderText, findByText } = render(<App />);

    fireEvent.click(getByText('💸 Transaction & Fee Ops — Transfers (W2W)'));

    expect(getByText('Pricing Fee Simulator Tool')).toBeTruthy();

    // Submit calculations
    fireEvent.click(getByText('Run Simulation'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/fees/calculate', {
        amountMinor: '100000', // 1000 Naira
        currency: 'NGN',
        paymentType: 'VIRTUAL_ACCOUNT',
        flatFeeMinor: '5000', // 50 Naira
        percentageBps: '100',
        vatBps: '750',
      });
      expect(getByText('₦15.00')).toBeTruthy();
      expect(getByText('₦1.12')).toBeTruthy();
      expect(getByText('₦1,016.12')).toBeTruthy();
    });
  });
});
