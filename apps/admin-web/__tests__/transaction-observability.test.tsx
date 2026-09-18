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
        roles: ['FINANCE_CONTROLLER'], // Checker-eligible
        scopes: ['privileged:approve'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });

  test('should load specific deposit details and execute sandbox completion successfully', async () => {
    const mockDeposit = {
      id: 'dep-uuid-777',
      status: 'PENDING',
      currency: 'NGN',
      amountMinor: '125000', // 1,250.00 Naira
      createdAt: new Date().toISOString(),
      walletId: 'wallet-uuid-123',
      reference: 'dep-ref-123',
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(mockDeposit) // search load
      .mockResolvedValueOnce({ ...mockDeposit, status: 'COMPLETED' }); // reload after complete

    (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'SUCCESS' });

    const { getByText, getByPlaceholderText, findByText, getAllByText } = render(<App />);

    // Click navigation tab
    fireEvent.click(getByText('💸 Transaction & Fee Ops'));

    // Select DEPOSIT type
    const selectEl = getByText('P2P TRANSFER').parentElement as HTMLSelectElement;
    fireEvent.change(selectEl, { target: { value: 'DEPOSIT' } });

    // Search Deposit
    fireEvent.change(getByPlaceholderText('e.g. 5e6f7g8h-...'), { target: { value: 'dep-uuid-777' } });
    fireEvent.click(getByText('Track'));

    expect(ApiClient.get).toHaveBeenNthCalledWith(1, '/deposits/dep-uuid-777');
    expect(await findByText('DEPOSIT Detail View')).toBeTruthy();
    expect(await findByText('dep-ref-123')).toBeTruthy();
    expect(await findByText('PENDING')).toBeTruthy();

    // Trigger Sandbox complete
    expect(await findByText('Trigger Sandbox Completion')).toBeTruthy();
    fireEvent.click(getByText('Trigger Sandbox Completion'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/deposits/dep-uuid-777/complete');
      expect(getByText('Sandbox simulated transaction completed successfully!')).toBeTruthy();
      expect(getAllByText('COMPLETED').length).toBeGreaterThan(0);
    });
  });

  test('should run fee simulator calculations and display gross output', async () => {
    const mockFeeResult = {
      feeMinor: '1500', // 15 Naira
      vatMinor: '112',  // 1.12 Naira
      totalMinor: '101612', // 1,016.12 Naira
    };

    (ApiClient.post as jest.Mock).mockResolvedValue(mockFeeResult);

    const { getByText, getByPlaceholderText, findByText } = render(<App />);

    fireEvent.click(getByText('💸 Transaction & Fee Ops'));

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
