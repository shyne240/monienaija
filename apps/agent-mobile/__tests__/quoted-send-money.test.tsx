import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QuotedSendMoneyScreen } from '../src/screens/authenticated/QuotedSendMoneyScreen';
import { ApiClient } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

jest.setTimeout(30000);

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
let mockOwnerId = 'owner-test';
jest.mock('../src/store/auth-store', () => ({
  useAuthStore: (select: (state: any) => unknown) => select({ agentId: mockOwnerId }),
}));
const recipient = {
  ownerType: 'AGENT',
  ownerId: 'recipient',
  walletId: 'dest',
  receivingNumber: '8000000001',
  display: 'Ada',
  status: 'ACTIVE',
};
const quote = {
  quoteId: 'quote-1',
  sourceWalletId: 'source',
  destinationWalletId: 'dest',
  recipientType: 'AGENT',
  recipientId: 'recipient',
  amountMinor: '10050',
  feeMinor: '100',
  vatMinor: '8',
  totalDebitMinor: '10158',
  currency: 'NGN',
  expiresAt: '2099-01-01T00:00:00.000Z',
  status: 'ACTIVE',
};
const receipt = {
  id: 'transfer-1',
  status: 'COMPLETED',
  paymentReference: 'MN123',
  completedAt: '2026-01-01T00:00:00Z',
};
const base = 'api/v1/agents/me';
const key = 'p2p.confirm.owner-test';

beforeEach(async () => {
  jest.clearAllMocks();
  mockOwnerId = 'owner-test';
  await SecureStorage.removeDurable(key);
  await SecureStorage.removeDurable('p2p.confirm.other-owner');
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('transfer-recipient')) return recipient;
    if (path.includes('transfer-quotes/'))
      return { ...quote, status: 'USED', sessionMatches: false, receipt };
    throw new Error('unexpected');
  });
  (ApiClient.post as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith('/confirm') ? receipt : quote,
  );
});

async function prepare(screen: ReturnType<typeof render>) {
  await waitFor(() => expect(screen.getByTestId('recipient-number')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('recipient-number'), '08000000001');
  fireEvent.press(screen.getByText('Verify recipient'));
  await waitFor(() => expect(screen.getByTestId('recipient-name')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-amount'), '100.50');
  fireEvent.press(screen.getByText('Review fees'));
  await waitFor(() => expect(screen.getByTestId('quote-summary')).toBeTruthy());
}

test('resolves phone, displays server fees, confirms with PIN and shows receipt', async () => {
  const screen = render(<QuotedSendMoneyScreen />);
  await prepare(screen);
  expect(screen.getByText('Fee: ₦1.00')).toBeTruthy();
  expect(screen.getByText('VAT: ₦0.08')).toBeTruthy();
  expect(screen.getByText('Total debit: ₦101.58')).toBeTruthy();
  expect(ApiClient.post).toHaveBeenCalledWith(
    `${base}/transfer-quotes`,
    expect.objectContaining({ destinationWalletId: 'dest', amountMinor: '10050', currency: 'NGN' }),
    expect.anything(),
  );
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Confirm transfer'));
  await waitFor(() => expect(screen.getByTestId('transfer-receipt')).toBeTruthy());
  expect(ApiClient.post).toHaveBeenCalledWith(
    `${base}/transfer-quotes/quote-1/confirm`,
    { pin: '1234' },
    { idempotencyKey: 'confirm:quote-1', preserveSessionOn401: true },
  );
  expect(await SecureStorage.getDurable(key)).toBeNull();
});

test('ambiguous response persists quote and key but not PIN, then recovers after remount', async () => {
  (ApiClient.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/confirm')) throw new Error('lost response');
    return quote;
  });
  const first = render(<QuotedSendMoneyScreen />);
  await prepare(first);
  fireEvent.changeText(first.getByTestId('send-pin'), '1234');
  fireEvent.press(first.getByText('Confirm transfer'));
  await waitFor(() => expect(first.getByTestId('pending-notice')).toBeTruthy());
  const saved = await SecureStorage.getDurable(key);
  expect(saved).toContain('confirm:quote-1');
  expect(saved).not.toContain('1234');
  first.unmount();
  const second = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(second.getByTestId('pending-notice')).toBeTruthy());
  expect(second.queryByTestId('recipient-number')).toBeNull();
  fireEvent.press(second.getByText('Check transfer status'));
  await waitFor(() => expect(second.getByTestId('transfer-receipt')).toBeTruthy());
  expect(await SecureStorage.getDurable(key)).toBeNull();
});

test('unavailable durable storage blocks sending', async () => {
  jest.spyOn(SecureStorage, 'getDurable').mockRejectedValueOnce(new Error('no storage'));
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByText(/Recovery storage is unavailable/)).toBeTruthy());
  expect(screen.queryByText('Verify recipient')).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('a pending confirmation retries only with its original quote and key', async () => {
  (ApiClient.post as jest.Mock)
    .mockImplementationOnce(async () => quote)
    .mockRejectedValueOnce(new Error('lost'));
  const screen = render(<QuotedSendMoneyScreen />);
  await prepare(screen);
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Confirm transfer'));
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  (ApiClient.post as jest.Mock).mockResolvedValueOnce(receipt);
  fireEvent.changeText(screen.getByTestId('send-pin'), '4321');
  fireEvent.press(screen.getByText('Retry same confirmation'));
  await waitFor(() => expect(screen.getByTestId('transfer-receipt')).toBeTruthy());
  expect(ApiClient.post).toHaveBeenLastCalledWith(
    `${base}/transfer-quotes/quote-1/confirm`,
    { pin: '4321' },
    { idempotencyKey: 'confirm:quote-1', preserveSessionOn401: true },
  );
});

test('new session can read status but cannot retry an active old-session quote', async () => {
  (ApiClient.post as jest.Mock)
    .mockImplementationOnce(async () => quote)
    .mockRejectedValueOnce(new Error('lost'));
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('transfer-quotes/'))
      return { ...quote, status: 'ACTIVE', sessionMatches: false, receipt: null };

    if (path.includes('transfer-recipient')) return recipient;
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await prepare(screen);
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Confirm transfer'));
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() => expect(screen.getByText(/belongs to an earlier session/)).toBeTruthy());
  const calls = (ApiClient.post as jest.Mock).mock.calls.length;
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Retry same confirmation'));
  expect(ApiClient.post).toHaveBeenCalledTimes(calls);
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
});

test('restored confirmation requires status before any PIN retry', async () => {
  await SecureStorage.setDurable(
    key,
    JSON.stringify({ ownerId: 'owner-test', quote, recipient, key: 'confirm:quote-1' }),
  );
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Retry same confirmation'));
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
});

test('storage write failure prevents posting confirmation', async () => {
  const screen = render(<QuotedSendMoneyScreen />);
  await prepare(screen);
  const failure = jest
    .spyOn(SecureStorage, 'setDurable')
    .mockRejectedValueOnce(new Error('write failed'));
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Confirm transfer'));
  await waitFor(() => expect(screen.getByTestId('send-error')).toBeTruthy());
  expect(
    (ApiClient.post as jest.Mock).mock.calls.filter(([path]: [string]) =>
      path.endsWith('/confirm'),
    ),
  ).toHaveLength(0);
  failure.mockRestore();
});

test('expired recovery only clears when durable removal succeeds', async () => {
  await SecureStorage.setDurable(
    key,
    JSON.stringify({ ownerId: 'owner-test', quote, recipient, key: 'confirm:quote-1' }),
  );
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('transfer-quotes/'))
      return { ...quote, status: 'EXPIRED', sessionMatches: false, receipt: null };
    if (path === '/customers/me/wallets')
      return [{ id: 'source', currency: 'NGN', status: 'ACTIVE' }];
    if (path === '/customers/me/beneficiaries') return { items: [] };
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  const failure = jest
    .spyOn(SecureStorage, 'removeDurable')
    .mockRejectedValueOnce(new Error('delete failed'));
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() => expect(screen.getByText(/Could not clear recovery storage/)).toBeTruthy());
  expect(screen.getByTestId('pending-notice')).toBeTruthy();
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
  failure.mockRestore();
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() =>
    expect(screen.getByText(/expired without a completed transfer/)).toBeTruthy(),
  );
  expect(await SecureStorage.getDurable(key)).toBeNull();
  expect(screen.queryByTestId('pending-notice')).toBeNull();
});

test('a receipt remains available and blocks another send if recovery deletion fails', async () => {
  const screen = render(<QuotedSendMoneyScreen />);
  await prepare(screen);
  const failure = jest
    .spyOn(SecureStorage, 'removeDurable')
    .mockRejectedValueOnce(new Error('delete failed'));
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Confirm transfer'));
  await waitFor(() => expect(screen.getByTestId('transfer-receipt')).toBeTruthy());
  expect(screen.getByText(/recovery storage could not be cleared/)).toBeTruthy();
  expect(screen.queryByText('Make another transfer')).toBeNull();
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
  failure.mockRestore();
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() => expect(screen.getByText('Make another transfer')).toBeTruthy());
  expect(await SecureStorage.getDurable(key)).toBeNull();
});

test('same-session status permits retry after a restored confirmation', async () => {
  await SecureStorage.setDurable(
    key,
    JSON.stringify({ ownerId: 'owner-test', quote, recipient, key: 'confirm:quote-1' }),
  );
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('transfer-quotes/'))
      return { ...quote, status: 'ACTIVE', sessionMatches: true, receipt: null };
    if (path === '/customers/me/wallets')
      return [{ id: 'source', currency: 'NGN', status: 'ACTIVE' }];
    if (path === '/customers/me/beneficiaries') return { items: [] };
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() => expect(screen.getByText(/Not completed yet/)).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Retry same confirmation'));
  await waitFor(() => expect(screen.getByTestId('transfer-receipt')).toBeTruthy());
  expect(ApiClient.post).toHaveBeenCalledWith(
    `${base}/transfer-quotes/quote-1/confirm`,
    { pin: '1234' },
    { idempotencyKey: 'confirm:quote-1', preserveSessionOn401: true },
  );
});

test('switching owners discards the previous owner’s recovery display and PIN', async () => {
  await SecureStorage.setDurable(
    key,
    JSON.stringify({ ownerId: 'owner-test', quote, recipient, key: 'confirm:quote-1' }),
  );
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  mockOwnerId = 'other-owner';
  screen.rerender(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('recipient-number')).toBeTruthy());
  expect(screen.queryByTestId('pending-notice')).toBeNull();
  expect(screen.queryByTestId('recipient-name')).toBeNull();
  expect(screen.queryByTestId('send-pin')).toBeNull();
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
});

test('an unavailable or revoked session cannot clear or retry restored recovery', async () => {
  await SecureStorage.setDurable(
    key,
    JSON.stringify({ ownerId: 'owner-test', quote, recipient, key: 'confirm:quote-1' }),
  );
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('transfer-quotes/')) throw new Error('session revoked');
    if (path === '/customers/me/wallets')
      return [{ id: 'source', currency: 'NGN', status: 'ACTIVE' }];
    if (path === '/customers/me/beneficiaries') return { items: [] };
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByTestId('pending-notice')).toBeTruthy());
  fireEvent.press(screen.getByText('Check transfer status'));
  await waitFor(() => expect(screen.getByText(/Status is unavailable/)).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-pin'), '1234');
  fireEvent.press(screen.getByText('Retry same confirmation'));
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(await SecureStorage.getDurable(key)).not.toBeNull();
});

test('agent saves recipients and rejects a changed saved identity before quoting', async () => {
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === `${base}/beneficiaries`)
      return {
        items: [
          {
            id: 'saved',
            nickname: 'Friend',
            receivingNumber: recipient.receivingNumber,
            isActive: true,
            recipientType: 'AGENT',
            recipientId: 'original',
          },
        ],
      };
    if (path.includes('transfer-recipient')) return recipient;
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByText('Saved: Friend')).toBeTruthy());
  fireEvent.press(screen.getByText('Saved: Friend'));
  fireEvent.press(screen.getByText('Verify recipient'));
  await waitFor(() => expect(screen.getByTestId('send-error')).toBeTruthy());
  expect(screen.queryByTestId('recipient-name')).toBeNull();
  expect(screen.queryByText('Review fees')).toBeNull();
  fireEvent.changeText(screen.getByTestId('recipient-number'), recipient.receivingNumber);
  fireEvent.press(screen.getByText('Verify recipient'));
  await waitFor(() => expect(screen.getByText('Save recipient')).toBeTruthy());
  (ApiClient.post as jest.Mock).mockResolvedValueOnce({
    id: 'new',
    nickname: 'Ada',
    receivingNumber: recipient.receivingNumber,
    isActive: true,
    recipientType: 'AGENT',
    recipientId: recipient.ownerId,
  });
  fireEvent.press(screen.getByText('Save recipient'));
  await waitFor(() =>
    expect(ApiClient.post).toHaveBeenCalledWith(`${base}/beneficiaries`, {
      beneficiaryIdentifier: recipient.receivingNumber,
      nickname: 'Ada',
    }),
  );
});

test('selected bound beneficiary is included in the authenticated quote request', async () => {
  (ApiClient.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === `${base}/beneficiaries`)
      return {
        items: [
          {
            id: 'saved',
            nickname: 'Friend',
            receivingNumber: recipient.receivingNumber,
            isActive: true,
            recipientType: recipient.ownerType,
            recipientId: recipient.ownerId,
          },
        ],
      };
    if (path.includes('transfer-recipient')) return recipient;
    throw new Error('unexpected');
  });
  const screen = render(<QuotedSendMoneyScreen />);
  await waitFor(() => expect(screen.getByText('Saved: Friend')).toBeTruthy());
  fireEvent.press(screen.getByText('Saved: Friend'));
  fireEvent.press(screen.getByText('Verify recipient'));
  await waitFor(() => expect(screen.getByTestId('recipient-name')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('send-amount'), '100.50');
  fireEvent.press(screen.getByText('Review fees'));
  await waitFor(() => expect(screen.getByTestId('quote-summary')).toBeTruthy());
  expect(ApiClient.post).toHaveBeenCalledWith(
    `${base}/transfer-quotes`,
    expect.objectContaining({ beneficiaryId: 'saved', destinationWalletId: 'dest' }),
    expect.anything(),
  );
});
