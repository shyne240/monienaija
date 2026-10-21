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
// dashboard — always the first recorded call. Prefixed onto every sequential
// `.mockResolvedValueOnce(...)` chain below so the rest of each chain still lines up with the
// ledger screen's own call order.
const DASHBOARD_FETCH_STUB = { templateKey: 'DEFAULT_FALLBACK', displayName: 'Default Dashboard', description: '', isFallback: true, widgets: [] };

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
        roles: ['SUPER_ADMIN'],
        scopes: ['ledger.view','transaction.view','reporting.transaction_summary.view'],
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
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB) // Dashboard my-dashboard fetch on mount
      .mockResolvedValueOnce([]) // accounts list
      .mockResolvedValueOnce(mockJournal); // journal audit

    const { getByText, getByPlaceholderText, findByText, findAllByText } = render(<App />);

    fireEvent.click(getByText('📖 Ledger & Reversals'));

    // Fill search
    fireEvent.change(getByPlaceholderText('e.g. ecd61345-...'), { target: { value: 'journal-uuid-999' } });
    fireEvent.click(getByText('Audit Journal'));

    expect(ApiClient.get).toHaveBeenNthCalledWith(3, '/ledger/journals/journal-uuid-999');

    expect(await findByText('Pilot Wallet Funding')).toBeTruthy();
    expect(await findByText('acc-uuid-debit')).toBeTruthy();
    expect(await findByText('acc-uuid-credit')).toBeTruthy();
    expect((await findAllByText('₦500.00')).length).toBeGreaterThan(0); // verify debit column
  });

  test('should execute controller reversal only with an approved maker-checker request id (P0-B)', async () => {
    const mockJournal = {
      id: 'journal-uuid-999',
      status: 'POSTED',
      currency: 'NGN',
      accountingUnit: 'LAGOS_BRANCH',
      description: 'Pilot Wallet Funding',
      lines: [],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB) // Dashboard my-dashboard fetch on mount
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

    // Trigger governed reversal execution
    expect(await findByText('Execute Approved Reversal')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('e.g. Correct posting duplicate entry'), { target: { value: 'Reversing Pilot Funding' } });
    fireEvent.change(getByPlaceholderText('e.g. 3f2c1a00-... (from the approved reversal request)'), {
      target: { value: '3f2c1a00-0000-0000-0000-000000000abc' },
    });
    fireEvent.click(getByText('Execute Approved Reversal'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/ledger/journals/journal-uuid-999/reversal',
        {
          idempotencyKey: expect.stringContaining('rev-journal-uuid-999-'),
          reason: 'Reversing Pilot Funding',
          approvalId: '3f2c1a00-0000-0000-0000-000000000abc',
        },
        expect.any(Object)
      );
      expect(getByText('Governed journal reversal executed from the approved request.')).toBeTruthy();
    });
  });

  test('should reject controller reversal when no approved maker-checker request id is supplied', async () => {
    const mockJournal = {
      id: 'journal-uuid-999',
      status: 'POSTED',
      currency: 'NGN',
      accountingUnit: 'LAGOS_BRANCH',
      description: 'Pilot Wallet Funding',
      lines: [],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockJournal);

    (ApiClient.post as jest.Mock).mockResolvedValue({});

    const { getByText, getByPlaceholderText, findByText } = render(<App />);

    fireEvent.click(getByText('📖 Ledger & Reversals'));
    fireEvent.change(getByPlaceholderText('e.g. ecd61345-...'), { target: { value: 'journal-uuid-999' } });
    fireEvent.click(getByText('Audit Journal'));

    expect(await findByText('Execute Approved Reversal')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('e.g. Correct posting duplicate entry'), { target: { value: 'No approval supplied' } });
    fireEvent.click(getByText('Execute Approved Reversal'));

    await waitFor(() => {
      expect(getByText('Approved maker-checker request ID (approvalId) is required.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should submit preparer reversal maker request to the domain endpoint (no mock fingerprint)', async () => {
    // Set active principal role to Preparer (Maker) — ledger.reverse / finance:prepare initiates; never executes
    useAuthStore.setState({
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:back-office-preparer',
        sessionId: 'preparer-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_PREPARER'],
        scopes: ['ledger.view','ledger.post','ledger.reverse','finance:prepare','transaction.view','reporting.transaction_summary.view'],
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
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB) // Dashboard my-dashboard fetch on mount
      .mockResolvedValueOnce([]) // accounts list
      .mockResolvedValueOnce(mockJournal); // journal audit

    (ApiClient.post as jest.Mock).mockResolvedValue({
      approvalId: 'req-uuid-1',
      status: 'REQUESTED',
      actionType: 'LEDGER_JOURNAL_REVERSAL',
      resourceType: 'LEDGER_JOURNAL',
      resourceId: 'journal-uuid-999',
      actionFingerprint: 'a'.repeat(64),
    });

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
      // P0-B: the maker leg posts the actual reversal request to the domain endpoint; the
      // backend derives the deterministic fingerprint (the client never sends one).
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/ledger/journals/journal-uuid-999/reversal-request',
        { reason: 'Preparer Reversal Request' },
      );
      expect(ApiClient.post).not.toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/request',
        expect.anything(),
      );
      expect(getByText('Reversal maker request created (request ID req-uuid-1). Awaiting independent FINANCE_CONTROLLER approval.')).toBeTruthy();
    });
  });
});
