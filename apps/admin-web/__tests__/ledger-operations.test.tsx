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

describe('Admin Web Portal W3 Ledger Operations & Reversals Tests', () => {
  const mockAccounts = [
    {
      id: 'acc-uuid-1',
      code: '1001',
      name: 'Central Settlement Asset',
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      currency: 'NGN',
      balanceMinor: '1250050', // 1,250.05 Naira
    },
  ];

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

  test('should load ledger accounts list and format balance correctly', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(mockAccounts);

    const { getByText, findByText } = render(<App />);

    // Click ledger navigation
    fireEvent.click(getByText('📖 Ledger & Reversals'));

    expect(ApiClient.get).toHaveBeenCalledWith('/ledger/accounts');
    expect(await findByText('Central Settlement Asset')).toBeTruthy();
    expect(await findByText('1001')).toBeTruthy();
    expect(await findByText('₦12,500.50')).toBeTruthy();
  });

  test('should search journal ID and display double-entry lines in debit/credit columns', async () => {
    const mockJournal = {
      id: 'journal-uuid-999',
      status: 'POSTED',
      currency: 'NGN',
      accountingUnit: 'LAGOS_BRANCH',
      description: 'Pilot Wallet Funding',
      lines: [
        {
          id: 'line-1',
          accountId: 'acc-uuid-debit',
          direction: 'DEBIT',
          amountMinor: '50000', // 500 Naira
        },
        {
          id: 'line-2',
          accountId: 'acc-uuid-credit',
          direction: 'CREDIT',
          amountMinor: '50000',
        },
      ],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([]) // accounts list
      .mockResolvedValueOnce(mockJournal); // journal audit

    const { getByText, getByPlaceholderText, findByText, findAllByText } = render(<App />);

    fireEvent.click(getByText('📖 Ledger & Reversals'));

    // Fill search
    fireEvent.change(getByPlaceholderText('e.g. ecd61345-...'), { target: { value: 'journal-uuid-999' } });
    fireEvent.click(getByText('Audit Journal'));

    expect(ApiClient.get).toHaveBeenNthCalledWith(2, '/ledger/journals/journal-uuid-999');

    expect(await findByText('Pilot Wallet Funding')).toBeTruthy();
    expect(await findByText('acc-uuid-debit')).toBeTruthy();
    expect(await findByText('acc-uuid-credit')).toBeTruthy();
    expect((await findAllByText('₦500.00')).length).toBeGreaterThan(0); // verify debit column
  });

  test('should submit controller direct journal reversal override on click', async () => {
    const mockJournal = {
      id: 'journal-uuid-999',
      status: 'POSTED',
      currency: 'NGN',
      accountingUnit: 'LAGOS_BRANCH',
      description: 'Pilot Wallet Funding',
      lines: [],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([]) // accounts list
      .mockResolvedValueOnce(mockJournal) // journal audit
      .mockResolvedValueOnce({ ...mockJournal, status: 'REVERSED' }) // reload journal
      .mockResolvedValueOnce([]); // reload accounts list

    (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'REVERSED' });

    const { getByText, getByPlaceholderText, findByText, container } = render(<App />);

    fireEvent.click(getByText('📖 Ledger & Reversals'));

    // Fill search
    fireEvent.change(getByPlaceholderText('e.g. ecd61345-...'), { target: { value: 'journal-uuid-999' } });
    fireEvent.click(getByText('Audit Journal'));

    // Trigger reversal
    expect(await findByText('Sign & Execute Reversal')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('e.g. Correct posting duplicate entry'), { target: { value: 'Reversing Pilot Funding' } });
    fireEvent.click(getByText('Sign & Execute Reversal'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/ledger/journals/journal-uuid-999/reversal',
        {
          idempotencyKey: expect.stringContaining('rev-journal-uuid-999-'),
          reason: 'Reversing Pilot Funding',
        },
        expect.any(Object)
      );
      expect(getByText('Journal reversal compensating entry executed successfully!')).toBeTruthy();
    });
  });

  test('should submit preparer approval maker request on click instead of direct execution', async () => {
    // Set active principal role to Preparer (Maker)
    useAuthStore.setState({
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:back-office-preparer',
        sessionId: 'preparer-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_PREPARER'],
        scopes: ['finance:prepare'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    const mockJournal = {
      id: 'journal-uuid-999',
      status: 'POSTED',
      currency: 'NGN',
      accountingUnit: 'LAGOS_BRANCH',
      description: 'Pilot Wallet Funding',
      lines: [],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([]) // accounts list
      .mockResolvedValueOnce(mockJournal); // journal audit

    (ApiClient.post as jest.Mock).mockResolvedValue({ approved: false, reason: 'REQUESTED' });

    const { getByText, getByPlaceholderText, findByText } = render(<App />);

    fireEvent.click(getByText('📖 Ledger & Reversals'));

    // Fill search
    fireEvent.change(getByPlaceholderText('e.g. ecd61345-...'), { target: { value: 'journal-uuid-999' } });
    fireEvent.click(getByText('Audit Journal'));

    // Trigger reversal maker request
    expect(await findByText('Request Reversal Approval')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('e.g. Correct posting duplicate entry'), { target: { value: 'Preparer Reversal Request' } });
    fireEvent.click(getByText('Request Reversal Approval'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/request',
        expect.objectContaining({
          action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
          reason: 'Preparer Reversal Request',
        })
      );
      expect(getByText('Privileged reversal maker request created. Requires checking signature.')).toBeTruthy();
    });
  });
});
