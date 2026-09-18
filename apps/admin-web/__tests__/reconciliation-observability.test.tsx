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

describe('Admin Web Portal W5 Reconciliation & Breaks Desk Tests', () => {
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

  test('should trigger PG reconciliation report and render active checks and breaks cleanly', async () => {
    const mockReport = {
      status: 'WARNING',
      generatedAt: new Date().toISOString(),
      checks: [
        {
          name: 'wallet_balances_ledger_derived',
          status: 'PASS',
          message: 'Every wallet has a calculable ledger-derived balance',
          details: { violations: 0 },
        },
        {
          name: 'failed_transfer_attempts',
          status: 'WARNING',
          message: 'failed_transfer_attempts reported 1 violation(s).',
          details: { violations: 1 },
        },
      ],
      binding: {
        summary: {
          bindingsChecked: 10,
          activeBindingsChecked: 8,
          customerWalletsChecked: 12,
          financialWalletsChecked: 12,
          discrepancies: 1,
          errors: 0,
          warnings: 1,
        },
        discrepancies: [
          {
            key: 'unbound-wallet-1',
            type: 'UNBOUND_FINANCIAL_WALLET',
            severity: 'WARNING',
            owner: 'WALLET',
            recoveryState: 'MANUAL_REVIEW_REQUIRED',
            bindingId: 'bind-id-1',
            customerId: 'cust-id-1',
            message: 'Financial wallet has no customer binding',
          },
        ],
      },
    };

    (ApiClient.get as jest.Mock).mockResolvedValue(mockReport);

    const { getByText, findByText, getAllByText } = render(<App />);

    // Click navigation tab
    fireEvent.click(getByText('⚖️ Reconciliation & Breaks'));

    expect(getByText('Independent Reconciliation & Breaks Desk')).toBeTruthy();

    // Trigger run
    fireEvent.click(getByText('Execute In-House Reconciliation Match'));

    expect(ApiClient.get).toHaveBeenCalledWith('/internal/reconciliation/report');

    expect(await findByText('Run Result Summary')).toBeTruthy();
    expect(await findByText('Every wallet has a calculable ledger-derived balance')).toBeTruthy();
    expect(await findByText('Financial wallet has no customer binding')).toBeTruthy();
    expect(getAllByText('WARNING').length).toBeGreaterThan(0);
  });

  test('should load Trial Balance and display balanced dimensions', async () => {
    const mockTrialBalance = {
      generatedAt: new Date().toISOString(),
      balanced: true,
      dimensions: [
        {
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          totalDebitsMinor: '500000', // 5,000 Naira
          totalCreditsMinor: '500000',
          balanced: true,
        },
      ],
      rows: [
        {
          accountId: 'acc-uuid-1',
          accountCode: '1001',
          accountName: 'Central Settlement Asset',
          accountType: 'ASSET',
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          entryCount: 12,
          totalDebitsMinor: '500000',
          totalCreditsMinor: '0',
          balanceMinor: '500000',
        },
      ],
    };

    (ApiClient.get as jest.Mock).mockResolvedValue(mockTrialBalance);

    const { getByText, findByText, getAllByText } = render(<App />);

    // Click navigation tab
    fireEvent.click(getByText('⚖️ Reconciliation & Breaks'));

    // Switch to Trial Balance Tab
    fireEvent.click(getByText('⚖️ General Trial Balance'));

    expect(ApiClient.get).toHaveBeenCalledWith('/internal/reconciliation/trial-balance');

    expect(await findByText('BALANCED FACT')).toBeTruthy();
    expect(await findByText('NGN / CUSTOMER_FUNDS')).toBeTruthy();
    expect(await findByText('Central Settlement Asset')).toBeTruthy();
    expect(await findByText('1001')).toBeTruthy();
    expect(getAllByText('BALANCED').length).toBeGreaterThan(0);
  });
});
