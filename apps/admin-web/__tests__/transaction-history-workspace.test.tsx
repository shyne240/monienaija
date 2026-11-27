import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  TransactionHistoryScreen,
  exportUrl,
  transactionDetailLink,
} from '../src/screens/authenticated/TransactionHistoryScreen';
import { ApiClient, ApiError } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import {
  canonicalAdminView,
  canAccessAdminView,
} from '../src/screens/authenticated/navigation-access';
jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), getFile: jest.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));
const get = ApiClient.get as jest.Mock;
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'SYN-C2C',
  type: 'CASH_TO_CASH',
  status: 'CLAIMED',
  createdAt: '2026-11-24T12:00:00Z',
  amountMinor: '500000',
  feeMinor: '100',
  currency: 'NGN',
};
beforeEach(() => {
  window.location.hash = '';
  get.mockReset();
  useAuthStore.setState({
    sessionId: 'synthetic',
    principal: {
      type: 'OPERATOR',
      principalId: 'synthetic',
      sessionId: 'synthetic',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes: ['transaction.view'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
});
test('legacy money movement routes converge under the same guard', () => {
  for (const alias of ['cashIn', 'cashOut', 'cashToCashOps', 'transactions'] as const) {
    expect(canonicalAdminView(alias)).toBe('transfers');
    expect(canAccessAdminView(alias, [], [])).toBe(false);
    expect(canAccessAdminView(alias, ['transaction.view'], [])).toBe(true);
  }
  expect(transactionDetailLink(row.type, row.id)).toBe(
    `#transaction-history/${row.type}/${row.id}`,
  );
});
test('combines filters server side and resets pagination', async () => {
  get.mockResolvedValue({ items: [row], nextCursor: 'cursor-2' });
  render(<TransactionHistoryScreen />);
  await screen.findByText('SYN-C2C');
  expect(screen.queryByRole('option', { name: 'Deposit' })).toBeNull();
  for (const name of [
    'Cash to Wallet',
    'Wallet to Cash',
    'Cash to Cash',
    'Wallet to Bank',
    'Bank to Wallet',
    'Customer Funding',
    'Agent Funding',
    'Agent Defunding',
  ])
    expect(screen.getByRole('option', { name })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'VERIFIED' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(expect.stringContaining('cursor=cursor-2')),
  );
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-24' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-24' } });
  fireEvent.change(screen.getByLabelText('Transaction type'), {
    target: { value: 'CASH_TO_CASH' },
  });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CLAIMED' } });
  fireEvent.change(screen.getByLabelText('Exact reference'), { target: { value: 'SYN-C2C' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(
      expect.stringContaining(
        'from=2026-11-24&to=2026-11-24&type=CASH_TO_CASH&status=CLAIMED&reference=SYN-C2C&limit=20&cursor=',
      ),
    ),
  );
});
test('empty and failure states are explicit', async () => {
  get
    .mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockRejectedValueOnce(new Error('Forbidden: institution permission'));
  render(<TransactionHistoryScreen />);
  await screen.findByText('No matching transactions');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Forbidden: institution permission')).toBeTruthy();
});
test('no permission means no requests', () => {
  useAuthStore.setState({ principal: null });
  render(<TransactionHistoryScreen />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});
test('late list responses from a previous principal cannot leak', async () => {
  let resolve!: (v: unknown) => void;
  get.mockReturnValue(new Promise((r) => (resolve = r)));
  const view = render(<TransactionHistoryScreen />);
  act(() => useAuthStore.setState({ principal: null }));
  view.rerender(<TransactionHistoryScreen />);
  resolve({ items: [row], nextCursor: null });
  await waitFor(() => expect(screen.queryByText('SYN-C2C')).toBeNull());
});

test.each([
  { fee: null, journals: [null], feeLabel: 'Not recorded', journalLabel: 'No journal recorded.' },
  {
    fee: '0',
    journals: null,
    feeLabel: '₦0.00',
    journalLabel: 'Ledger information requires ledger.view.',
  },
])(
  'distinguishes absent fee/journal evidence from zero or denied permission ($feeLabel)',
  async ({ fee, journals, feeLabel, journalLabel }) => {
    if (journals) {
      const principal = useAuthStore.getState().principal!;
      useAuthStore.setState({
        principal: { ...principal, scopes: ['transaction.view', 'ledger.view'] },
      });
    }
    window.location.hash = transactionDetailLink(row.type, row.id);
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/' + row.type + '/')
          ? { ...row, feeMinor: fee, vatMinor: null, journals }
          : { items: [{ ...row, feeMinor: fee }], nextCursor: null },
      ),
    );
    render(<TransactionHistoryScreen />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: row.reference });
    expect(within(dialog).getByText('Fee').nextElementSibling?.textContent).toBe(feeLabel);
    expect(within(dialog).getByText('VAT').nextElementSibling?.textContent).toBe('Not recorded');
    expect(within(dialog).getByText(journalLabel)).toBeTruthy();
  },
);

test.each([true, false])('journal action requires ledger.view (%s)', async (ledgerAccess) => {
  const journalId = '22222222-2222-4222-8222-222222222222';
  const onOpenJournal = jest.fn();
  const principal = useAuthStore.getState().principal!;
  useAuthStore.setState({
    principal: {
      ...principal,
      scopes: ledgerAccess ? ['transaction.view', 'ledger.view'] : ['transaction.view'],
    },
  });
  window.location.hash = transactionDetailLink(row.type, row.id);
  get.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/' + row.type + '/')
        ? { ...row, journals: [null, journalId] }
        : { items: [row], nextCursor: null },
    ),
  );
  const view = render(<TransactionHistoryScreen onOpenJournal={onOpenJournal} />);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('heading', { name: row.reference });
  if (ledgerAccess) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open journal' }));
    expect(onOpenJournal).toHaveBeenCalledWith(journalId);
    act(() => useAuthStore.setState({ principal: { ...principal, scopes: ['transaction.view'] } }));
    view.rerender(<TransactionHistoryScreen onOpenJournal={onOpenJournal} />);
    await screen.findByText('Ledger information requires ledger.view.');
  } else {
    expect(within(dialog).queryByRole('button', { name: 'Open journal' })).toBeNull();
    expect(within(dialog).queryByText(journalId)).toBeNull();
  }
});

describe('Transaction history CSV export', () => {
  // jsdom has no object-URL implementation; record what the component asked the browser to save.
  const saved: Array<{ name: string; text: string }> = [];
  let created: Blob[] = [];
  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob);
        return 'blob:synthetic';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    // Capture the download handoff without letting jsdom navigate.
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ name: this.download, text: String(created[created.length - 1]?.size ?? '') });
      });
    click.mockClear();
  });
  beforeEach(() => {
    saved.length = 0;
    created = [];
  });

  test('exports every record matching the applied filters, across pages', async () => {
    get.mockResolvedValue({ items: [row], nextCursor: 'cursor-2' });
    render(<TransactionHistoryScreen />);
    await screen.findByText('SYN-C2C');
    // Apply a date range and filters, then page forward: the export must ignore the cursor.
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-24' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-25' } });
    fireEvent.change(screen.getByLabelText('Transaction type'), {
      target: { value: 'CASH_TO_CASH' },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CLAIMED' } });
    fireEvent.change(screen.getByLabelText('Exact reference'), { target: { value: 'SYN-C2C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(expect.stringContaining('type=CASH_TO_CASH')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('cursor=')));

    const file = {
      blob: new Blob(['transaction_reference,product\nSYN-C2C,CASH_TO_CASH'], { type: 'text/csv' }),
      fileName: 'transaction-history_2026-11-24_to_2026-11-25_cash_to_cash.csv',
      rowCount: 137,
      exportId: 'export-1',
    };
    (ApiClient as unknown as { getFile: jest.Mock }).getFile = jest.fn().mockResolvedValue(file);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await screen.findByText(/Exported 137 transactions/);
    const getFile = (ApiClient as unknown as { getFile: jest.Mock }).getFile;
    expect(getFile).toHaveBeenCalledTimes(1);
    const url = getFile.mock.calls[0][0] as string;
    expect(url).toBe(
      '/internal/admin/transaction-history/export.csv?from=2026-11-24&to=2026-11-25&type=CASH_TO_CASH&status=CLAIMED&reference=SYN-C2C',
    );
    // No paging controls: the server owns the walk, so a page cursor cannot truncate the file.
    expect(url).not.toContain('cursor=');
    expect(url).not.toContain('limit=');
    // The file an operator gets is named by the server and states it covers all pages.
    expect(saved).toEqual([{ name: file.fileName, text: expect.any(String) }]);
    expect(screen.getByText(/not just this page/)).toBeTruthy();
  });

  test('shows progress while the export runs', async () => {
    get.mockResolvedValue({ items: [row], nextCursor: null });
    let resolveFile!: (v: unknown) => void;
    (ApiClient as unknown as { getFile: jest.Mock }).getFile = jest
      .fn()
      .mockReturnValue(new Promise((r) => (resolveFile = r)));
    render(<TransactionHistoryScreen />);
    await screen.findByText('SYN-C2C');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeTruthy();
    expect(screen.getByText(/Preparing export/)).toBeTruthy();
    resolveFile({
      blob: new Blob(['x']),
      fileName: 'transaction-history_all-dates.csv',
      rowCount: 1,
      exportId: 'e',
    });
    await screen.findByText(/Exported 1 transaction to/);
    expect(screen.queryByRole('button', { name: 'Exporting…' })).toBeNull();
  });

  test('an oversized export explains how to narrow it and produces no file', async () => {
    get.mockResolvedValue({ items: [row], nextCursor: null });
    (ApiClient as unknown as { getFile: jest.Mock }).getFile = jest.fn().mockRejectedValue(
      new ApiError(
        'This export matches more than 50,000 transactions, which is above the supported export size. Narrow the date range or add a product, status or reference filter and export again. No file was produced.',
        413,
        'PAYLOAD_TOO_LARGE',
      ),
    );
    render(<TransactionHistoryScreen />);
    await screen.findByText('SYN-C2C');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Export CSV failed')).toBeTruthy();
    expect(within(alert).getByText(/above the supported export size/)).toBeTruthy();
    expect(within(alert).getAllByText(/No file was produced/).length).toBeGreaterThan(0);
    expect(saved).toEqual([]);
  });

  test('an unauthorized export surfaces the denial instead of downloading', async () => {
    get.mockResolvedValue({ items: [row], nextCursor: null });
    (ApiClient as unknown as { getFile: jest.Mock }).getFile = jest
      .fn()
      .mockRejectedValue(new ApiError('Authorization denied: FUNCTION_MISSING', 403));
    render(<TransactionHistoryScreen />);
    await screen.findByText('SYN-C2C');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Authorization denied/)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  test('export is unavailable without transaction.view', () => {
    useAuthStore.setState({ principal: null });
    render(<TransactionHistoryScreen />);
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  test('the export URL carries no filters when none are applied', () => {
    expect(exportUrl({ from: '', to: '', type: '', status: '', reference: '' })).toBe(
      '/internal/admin/transaction-history/export.csv',
    );
  });
});
