import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { TransferStatusScreen } from '../src/screens/authenticated/TransferStatusScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
}));

const navigation = { navigate: jest.fn() };
/**
 * Minimal props. Typed as an object so `{...screenProps()}` spreads legally; the screen only reads
 * `route.params.operationReference` and `navigation.navigate`.
 */
type ScreenProps = React.ComponentProps<typeof TransferStatusScreen>;
const screenProps = (operationReference = 'op-ref-1'): ScreenProps =>
  ({ route: { params: { operationReference } }, navigation }) as unknown as ScreenProps;

function statusResponse(overrides: Record<string, unknown> = {}) {
  return {
    operationReference: 'op-ref-1',
    state: 'UNKNOWN',
    amountMinor: '250000',
    currency: 'NGN',
    destinationAccountNumber: '0123456789',
    destinationBankName: 'Wema Bank',
    providerReference: null,
    failureCode: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Transfer status and recovery.
 *
 * The state that justifies this screen's existence is UNKNOWN: money may have moved and we do not yet
 * know. Every assertion below is about not making that situation worse — specifically, never inviting a
 * retry and never claiming an outcome the provider has not given.
 */
describe('TransferStatusScreen — recovery without repeating a payment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tells the customer not to resend an unconfirmed transfer', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse());
    const { getByText, queryByText } = render(<TransferStatusScreen {...screenProps()} />);

    await waitFor(() => expect(getByText('Do not send this again')).toBeTruthy());
    expect(getByText(/could pay the recipient twice/)).toBeTruthy();
    // No control that would resubmit the transfer.
    expect(queryByText(/Try again/i)).toBeNull();
    expect(queryByText(/Send again/i)).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('does not claim success while the outcome is unknown', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse());
    const { getByText, queryByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Still confirming')).toBeTruthy());
    expect(queryByText('Transfer completed')).toBeNull();
    // No bank reference is invented before the provider supplies one.
    expect(queryByText('Bank reference')).toBeNull();
  });

  test('shows a completed transfer with the provider reference it actually returned', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(
      statusResponse({ state: 'SUCCESSFUL', providerReference: 'MFY-778899' }),
    );
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Transfer completed')).toBeTruthy());
    expect(getByText('MFY-778899')).toBeTruthy();
    expect(getByText(/Wema Bank · 0123456789/)).toBeTruthy();
  });

  test('explains a failure without implying funds moved', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(
      statusResponse({ state: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS' }),
    );
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Transfer failed')).toBeTruthy());
    expect(getByText(/not enough funds/)).toBeTruthy();
  });

  test('an unreadable status is not reported as a failure', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(new Error('network down'));
    const { getByText, queryByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText(/could not check this transfer/i)).toBeTruthy());
    // The distinction that matters: a failed read says nothing about the transfer itself.
    expect(getByText(/does not mean it failed/i)).toBeTruthy();
    expect(queryByText('Transfer failed')).toBeNull();
  });

  test('re-checks on request without resubmitting', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse({ state: 'PENDING' }));
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Check again')).toBeTruthy());
    fireEvent.press(getByText('Check again'));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledTimes(2));
    expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/banking/transfers/op-ref-1');
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});
