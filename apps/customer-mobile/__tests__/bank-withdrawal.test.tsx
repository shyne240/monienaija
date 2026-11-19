import React, { act } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { BankWithdrawalScreen } from '../src/screens/authenticated/BankWithdrawalScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.setTimeout(30000);

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  }
  return {
    ApiClient: { get: jest.fn(), post: jest.fn() },
    ApiError: MockApiError,
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const NGN_WALLET = { id: 'wallet-1', currency: 'NGN', status: 'ACTIVE', balanceMinor: '250000' };

const BANK_BENEFICIARIES = [
  {
    id: 'b-verified',
    nickname: 'GTB savings',
    displayName: 'GTB savings',
    bankCode: '058',
    destinationName: 'Amaka Obi',
    receivingNumber: '0123456789',
    isVerified: true,
    isActive: true,
    status: 'ACTIVE',
    beneficiaryType: 'BANK_ACCOUNT',
  },
  {
    id: 'b-pending',
    nickname: 'Unverified',
    displayName: 'Unverified',
    bankCode: '035',
    destinationName: null,
    receivingNumber: '9876543210',
    isVerified: false,
    isActive: true,
    status: 'PENDING',
    beneficiaryType: 'BANK_ACCOUNT',
  },
  {
    id: 'b-internal',
    nickname: 'Sibling',
    displayName: 'Sibling',
    bankCode: null,
    destinationName: null,
    receivingNumber: '08031234567',
    isVerified: true,
    isActive: true,
    status: 'ACTIVE',
    beneficiaryType: 'INTERNAL_CUSTOMER',
  },
];

function mockGets({
  wallets = [NGN_WALLET],
  beneficiaries = BANK_BENEFICIARIES,
}: {
  wallets?: unknown;
  beneficiaries?: unknown[];
} = {}) {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/customers/me/wallets') return Promise.resolve(wallets);
    if (url === '/customers/me/beneficiaries?limit=100') {
      return Promise.resolve({ items: beneficiaries });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

async function renderScreen() {
  const utils = render(<BankWithdrawalScreen />);
  await act(async () => {});
  return utils;
}

describe('BankWithdrawalScreen — customer bank withdrawal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('offers only verified, active BANK_ACCOUNT beneficiaries', async () => {
    mockGets();
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('GTB savings')).toBeTruthy();
    // Pending-verification and wallet-recipient beneficiaries are not offered as destinations.
    expect(queryByText('Unverified')).toBeNull();
    expect(queryByText('Sibling')).toBeNull();
  });

  test('is honest when there is no verified bank account', async () => {
    mockGets({ beneficiaries: [BANK_BENEFICIARIES[1]] });
    const { getByText, queryByTestId } = await renderScreen();
    expect(getByText('No verified bank account yet')).toBeTruthy();
    expect(getByText(/cannot verify one itself/i)).toBeTruthy();
    expect(getByText('Contact support')).toBeTruthy();
    expect(queryByTestId('bank-submit')).toBeNull();
  });

  test('cannot authorise without a selected destination', async () => {
    mockGets();
    const { getByTestId } = await renderScreen();
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    const submit = getByTestId('bank-submit');
    // The control is disabled until a destination exists, so no commitment can be created.
    expect(submit.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(submit);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('shows insufficient funds client-side without submitting', async () => {
    mockGets();
    const { getByTestId, getAllByText, findByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '9999.99');
    expect(await findByText('Insufficient funds')).toBeTruthy();
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));
    await waitFor(() =>
      expect(getAllByText('Insufficient funds').length).toBeGreaterThanOrEqual(1),
    );
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('requires a 4 to 12 digit PIN before submitting', async () => {
    mockGets();
    const { getByTestId, getByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '12');
    fireEvent.press(getByTestId('bank-submit'));
    await waitFor(() =>
      expect(getByText('Enter your transaction PIN (4 to 12 digits).')).toBeTruthy(),
    );
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('authorises a withdrawal and offers tracking when a reference exists', async () => {
    mockGets();
    (ApiClient.post as jest.Mock).mockResolvedValue({
      commitmentId: 'commitment-1',
      withdrawalId: 'withdrawal-1',
      externalOperationId: 'op-external-1',
      state: 'RESERVED',
      replayed: false,
      operationReference: 'OPABC123',
    });
    const { getByTestId, getByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));

    await waitFor(() => expect(getByText('Withdrawal authorised')).toBeTruthy());
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = (ApiClient.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/customers/me/withdrawal-commitments');
    expect(body).toMatchObject({
      walletAccountId: 'wallet-1',
      beneficiaryId: 'b-verified',
      amountMinor: '50000',
      currency: 'NGN',
      pin: '1234',
    });
    expect(options).toMatchObject({
      idempotencyKey: expect.stringMatching(/^bank-withdrawal-/),
    });

    fireEvent.press(getByText('Track this transfer'));
    expect(mockNavigate).toHaveBeenCalledWith('TransferStatus', {
      operationReference: 'OPABC123',
    });
  });

  test('shows the replayed record as an earlier submission, not a new one', async () => {
    mockGets();
    (ApiClient.post as jest.Mock).mockResolvedValue({
      commitmentId: 'commitment-3',
      withdrawalId: 'withdrawal-3',
      externalOperationId: 'op-external-3',
      state: 'SETTLED',
      replayed: true,
      operationReference: 'OPABC999',
    });
    const { getByTestId, getByText, queryByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));

    await waitFor(() => expect(getByText('Withdrawal settled')).toBeTruthy());
    expect(getByText(/record of your earlier submission/i)).toBeTruthy();
    expect(queryByText('Withdrawal authorised')).toBeNull();
  });

  test('shows no tracking control when the server produced no dispatch reference', async () => {
    mockGets();
    (ApiClient.post as jest.Mock).mockResolvedValue({
      commitmentId: 'commitment-2',
      withdrawalId: 'withdrawal-2',
      externalOperationId: 'op-external-2',
      state: 'RESERVED',
      replayed: false,
      operationReference: null,
    });
    const { getByTestId, getByText, queryByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));

    await waitFor(() => expect(getByText('Withdrawal authorised')).toBeTruthy());
    expect(queryByText('Track this transfer')).toBeNull();
    expect(getByText(/no bank dispatch reference yet/i)).toBeTruthy();
  });

  test('does not claim success when the execution authority is unavailable', async () => {
    mockGets();
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Withdrawal execution authority is unavailable', 503),
    );
    const { getByTestId, getByText, queryByText } = await renderScreen();
    fireEvent.press(getByTestId('beneficiary-b-verified'));
    fireEvent.changeText(getByTestId('bank-amount'), '500');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));

    await waitFor(() =>
      expect(getByText(/Bank transfers are not available right now/)).toBeTruthy(),
    );
    expect(queryByText('Withdrawal authorised')).toBeNull();
    expect(queryByText('Track this transfer')).toBeNull();
  });
});
