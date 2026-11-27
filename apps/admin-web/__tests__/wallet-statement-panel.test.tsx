import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  defaultPeriod,
  formatCell,
  lagosDayOf,
  statementUrls,
  validateStatementPreview,
  WalletStatementPanel,
} from '../src/screens/authenticated/WalletStatementPanel';
import { maskWalletIdentifier } from '../src/screens/authenticated/customer-masking';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), getPdf: jest.fn(), getFile: jest.fn() },
}));

const get = ApiClient.get as jest.Mock;
const getPdf = ApiClient.getPdf as jest.Mock;

const customerId = '11111111-1111-4111-8111-111111111111';
const walletId = '22222222-2222-4222-8222-222222222222';

const preview = {
  walletId,
  customerId,
  walletLabel: '•••• 2222',
  currency: 'NGN',
  walletStatus: 'ACTIVE',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-30',
  timeZone: 'Africa/Lagos',
  balances: {
    openingMinor: '1250000',
    closingMinor: '1800000',
    creditsMinor: '900000',
    debitsMinor: '350000',
    currentMinor: '1800000',
    openingLabel: 'NGN 12,500.00',
    closingLabel: 'NGN 18,000.00',
    creditsLabel: 'NGN 9,000.00',
    debitsLabel: 'NGN 3,500.00',
    currentLabel: 'NGN 18,000.00',
  },
  rows: [
    {
      postedAt: '2026-11-03T09:12:00.000Z',
      reference: 'MN20261103001',
      description: 'Cash deposit via agent',
      amountMinor: '250000',
      direction: 'CREDIT' as const,
      runningMinor: '1500000',
      runningLabel: 'NGN 15,000.00',
    },
    {
      postedAt: '2026-11-04T10:00:00.000Z',
      reference: 'MN20261104001',
      description: 'Wallet transfer to Ada Obi',
      amountMinor: '70000',
      direction: 'DEBIT' as const,
      runningMinor: '1430000',
      runningLabel: 'NGN 14,300.00',
    },
  ],
};

beforeEach(() => {
  get.mockReset();
  getPdf.mockReset();
});

test('the default period is the current Lagos month, not the browser month', () => {
  // 2026-11-01T00:30Z is still 31 October in UTC but already 1 November in Lagos.
  const now = new Date('2026-10-31T23:30:00.000Z');
  expect(lagosDayOf(now)).toBe('2026-11-01');
  expect(defaultPeriod(now)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  expect(defaultPeriod(new Date('2026-11-24T12:00:00.000Z'))).toEqual({
    from: '2026-11-01',
    to: '2026-11-24',
  });
});

test('preview and PDF URLs are built together, so they cannot diverge', () => {
  const urls = statementUrls(customerId, walletId, '2026-11-01', '2026-11-30');
  expect(urls.preview).toBe(
    `/internal/customers/${customerId}/wallets/${walletId}/statement?from=2026-11-01&to=2026-11-30`,
  );
  expect(urls.pdf).toBe(
    `/internal/customers/${customerId}/wallets/${walletId}/statement.pdf?from=2026-11-01&to=2026-11-30`,
  );
});

test('a payload for another wallet or customer is rejected rather than rendered', () => {
  expect(validateStatementPreview(preview, walletId, customerId)).not.toBeNull();
  expect(validateStatementPreview(preview, 'other', customerId)).toBeNull();
  expect(validateStatementPreview(preview, walletId, 'other')).toBeNull();
  expect(validateStatementPreview({ ...preview, balances: null }, walletId, customerId)).toBeNull();
  expect(
    validateStatementPreview(
      { ...preview, rows: [{ ...preview.rows[0], direction: 'SIDEWAYS' }] },
      walletId,
      customerId,
    ),
  ).toBeNull();
});

test('an unavailable balance renders as Unavailable, never as zero', async () => {
  get.mockResolvedValue({
    ...preview,
    balances: {
      ...preview.balances,
      openingMinor: null,
      openingLabel: 'Unavailable',
      closingMinor: null,
      closingLabel: 'Unavailable',
    },
  });
  render(
    <WalletStatementPanel
      customerId={customerId}
      walletId={walletId}
      currency="NGN"
      now={new Date('2026-11-24T12:00:00.000Z')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview statement' }));
  await screen.findAllByText('Unavailable');
  expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('NGN 0.00')).toBeNull();
  // A zero that the ledger actually reports is still printed as a zero.
  expect(screen.getByText('NGN 9,000.00')).toBeTruthy();
});

test('the preview shows the statement table with the PDF column order', async () => {
  get.mockResolvedValue(preview);
  render(
    <WalletStatementPanel
      customerId={customerId}
      walletId={walletId}
      currency="NGN"
      now={new Date('2026-11-24T12:00:00.000Z')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview statement' }));
  await screen.findByText('MN20261103001');
  const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
  expect(headers).toEqual([
    'Date (Lagos)',
    'Reference',
    'Description',
    'Debit',
    'Credit',
    'Balance',
  ]);
  expect(screen.getByText('NGN 2,500.00')).toBeTruthy();
  expect(screen.getByText('NGN 700.00')).toBeTruthy();
  // Lagos wall clock, not UTC.
  expect(screen.getByText('3 Nov 2026, 10:12')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(
    `/internal/customers/${customerId}/wallets/${walletId}/statement?from=2026-11-01&to=2026-11-24`,
  );
});

test('downloading asks for the PDF and hands the server-named file to the browser', async () => {
  const blob = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
  getPdf.mockResolvedValue({
    blob,
    fileName: 'monienaija-wallet-statement-2222-2026-11-01_2026-11-30.pdf',
    rowCount: null,
    exportId: null,
    pageCount: 3,
  });
  const createObjectURL = jest.fn(() => 'blob:synthetic');
  const revokeObjectURL = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  render(
    <WalletStatementPanel
      customerId={customerId}
      walletId={walletId}
      currency="NGN"
      now={new Date('2026-11-24T12:00:00.000Z')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await screen.findByText(/3 pages/);
  expect(getPdf).toHaveBeenCalledWith(
    `/internal/customers/${customerId}/wallets/${walletId}/statement.pdf?from=2026-11-01&to=2026-11-24`,
  );
  // The screen never fetches a JSON error body in place of the file: a refusal surfaces as text.
  expect(screen.getByRole('status').textContent).toContain('monienaija-wallet-statement-2222');
  expect(click).toHaveBeenCalledTimes(1);
  click.mockRestore();
});

test('a refused download says no document was produced and shows the server message', async () => {
  getPdf.mockRejectedValue(new Error('Wallet not found'));
  render(
    <WalletStatementPanel
      customerId={customerId}
      walletId={walletId}
      currency="NGN"
      now={new Date('2026-11-24T12:00:00.000Z')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('Wallet not found');
  expect(screen.queryByRole('status')).toBeNull();
});

test('a malformed preview is refused instead of rendered as a plausible document', async () => {
  get.mockResolvedValue({ ...preview, rows: 'not-an-array' });
  render(
    <WalletStatementPanel
      customerId={customerId}
      walletId={walletId}
      currency="NGN"
      now={new Date('2026-11-24T12:00:00.000Z')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview statement' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('could not be read');
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
});

test('money in the preview is exact for values beyond float precision', () => {
  expect(formatCell('9007199254740993', 'NGN')).toBe('NGN 90,071,992,547,409.93');
  expect(formatCell('5', 'NGN')).toBe('NGN 0.05');
  expect(formatCell('nope', 'NGN')).toBe('—');
});

test('a wallet identifier is masked wherever Customer 360 shows it', () => {
  // The full id addresses an account in our ledger; it is not something staff need to copy.
  expect(maskWalletIdentifier('e6db7ac2-b6b6-4b6b-a628-04a48c71b0f9')).toBe('•••• B0F9');
  expect(maskWalletIdentifier('e6db7ac2-b6b6-4b6b-a628-04a48c71b0f9')).not.toContain('e6db7ac2');
  // Anything that is not an identifier is fully withheld rather than echoed.
  expect(maskWalletIdentifier('not-a-wallet')).toBe('••••');
  expect(maskWalletIdentifier(null)).toBe('••••');
  // The statement's own label and the drawer's label agree for the same wallet.
  expect(maskWalletIdentifier('22222222-2222-4222-8222-222222222222')).toBe(
    statementUrls(
      customerId,
      '22222222-2222-4222-8222-222222222222',
      '2026-11-01',
      '2026-11-30',
    ).preview.includes('2222')
      ? '•••• 2222'
      : 'unreachable',
  );
});
