import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  TransactionHistoryScreen,
  transactionDetailLink,
} from '../src/screens/authenticated/TransactionHistoryScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import {
  canonicalAdminView,
  canAccessAdminView,
} from '../src/screens/authenticated/navigation-access';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
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
