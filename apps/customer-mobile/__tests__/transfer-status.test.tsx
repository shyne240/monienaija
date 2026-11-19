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
    state: 'CONFIRMING',
    amountMinor: '250000',
    currency: 'NGN',
    bankCode: '035',
    accountNumberLast4: '6789',
    createdAt: new Date().toISOString(),
    submittedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * Transfer status and recovery.
 *
 * The state that justifies this screen's existence is CONFIRMING: money may have moved and we do not
 * yet know. Every assertion below is about not making that situation worse — specifically, never
 * inviting a retry and never claiming an outcome the provider has not given.
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
    // Only the last four digits the server serves are shown.
    expect(getByText(new RegExp('6789'))).toBeTruthy();
    expect(queryByText('0123456789')).toBeNull();
  });

  test('shows a completed transfer with the destination it was bound to', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse({ state: 'SUCCESSFUL' }));
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Transfer completed')).toBeTruthy());
    expect(getByText(/035 · •••• 6789/)).toBeTruthy();
  });

  test('explains a rejection without implying funds moved', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse({ state: 'REJECTED' }));
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Transfer failed')).toBeTruthy());
    expect(getByText(/did not complete this transfer/i)).toBeTruthy();
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
    (ApiClient.get as jest.Mock).mockResolvedValue(statusResponse({ state: 'PROCESSING' }));
    const { getByText } = render(<TransferStatusScreen {...screenProps()} />);
    await waitFor(() => expect(getByText('Check again')).toBeTruthy());
    fireEvent.press(getByText('Check again'));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledTimes(2));
    expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/banking/transfers/op-ref-1');
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});
