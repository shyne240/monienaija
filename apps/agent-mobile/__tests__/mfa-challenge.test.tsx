import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MfaChallengeCard } from '../src/components/MfaChallengeCard';
import { SecureStorage } from '../src/services/secure-storage';
import {
  formatChallengeCountdown,
  isChallengeExpired,
  remainingChallengeSeconds,
} from '../src/services/mfa-challenge';
import type { AgentMfaChallenge } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  requestAgentMfaChallenge: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  requestAgentMfaChallenge: jest.Mock;
};

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

const challengeFixture = (overrides: Partial<AgentMfaChallenge> = {}): AgentMfaChallenge => ({
  challengeId: 'challenge-uuid-1',
  customerId: 'customer-uuid-1',
  purpose: 'WALLET_TO_CASH',
  deliveryChannel: 'SMS',
  destinationMasked: '******7801',
  delivered: true,
  issuedAt: new Date(Date.now()).toISOString(),
  expiresAt: new Date(Date.now() + 90_000).toISOString(),
  ttlSeconds: 90,
  ...overrides,
});

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('MfaChallengeCard (customer-factor MFA, issue-only backend surface)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1+2. challenge request: initial idle state, then loading state while requesting', async () => {
    let resolveIt: (v: AgentMfaChallenge) => void = () => {};
    mockApi.requestAgentMfaChallenge.mockImplementation(
      () => new Promise((res) => { resolveIt = res; }),
    );

    const { getByTestId } = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />);

    expect(getByTestId('mfa-request-button')).toBeTruthy(); // idle
    fireEvent.press(getByTestId('mfa-request-button'));

    await waitFor(() => expect(getByTestId('mfa-requesting')).toBeTruthy()); // loading shown

    await act(async () => resolveIt(challengeFixture()));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());
  });

  test('3. challenge request failure: sanitized message + retry path', async () => {
    mockApi.requestAgentMfaChallenge.mockRejectedValue(apiError('Customer not found', 404));
    const { getByTestId, getByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByText('Customer not found')).toBeTruthy());
    expect(getByTestId('mfa-retry-button')).toBeTruthy();
  });

  test('4. masked destination is rendered exactly as supplied by the server', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture({ destinationMasked: '******9999' }));
    const { getByTestId, getByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-destination-masked')).toBeTruthy());
    expect(getByText('******9999')).toBeTruthy();
  });

  test('5. server ttl/expiresAt drive the countdown (no hard-coded duration)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(
      challengeFixture({ issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 42_000).toISOString(), ttlSeconds: 42 }),
    );
    const { getByTestId, getByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-countdown')).toBeTruthy());
    expect(getByText(/Code expires in 0:4[12]/)).toBeTruthy();
    expect(formatChallengeCountdown(42)).toBe('0:42');
  });

  test('6+7. both backend-supported purposes are forwarded to the endpoint', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture());
    const w2c = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />);
    fireEvent.press(w2c.getByTestId('mfa-request-button'));
    await waitFor(() => expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledTimes(1));
    expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledWith('customer-uuid-1', 'WALLET_TO_CASH', undefined);

    const c2c = wrap(<MfaChallengeCard customerId="customer-uuid-9" purpose="CASH_TO_CASH_CLAIM" />);
    fireEvent.press(c2c.getByTestId('mfa-request-button'));
    await waitFor(() => expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledTimes(2));
    expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledWith('customer-uuid-9', 'CASH_TO_CASH_CLAIM', undefined);
  });

  test('8. duplicate request protection: only one in-flight POST while requesting', async () => {
    let resolveIt: (v: AgentMfaChallenge) => void = () => {};
    mockApi.requestAgentMfaChallenge.mockImplementation(
      () => new Promise((res) => { resolveIt = res; }),
    );
    const { getByTestId } = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-requesting-button')).toBeTruthy());
    fireEvent.press(getByTestId('mfa-requesting-button')); // disabled; ignored
    expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledTimes(1);
    await act(async () => resolveIt(challengeFixture()));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());
  });

  test('9. 401 failure uses established session-expiry message (purge stays in API client)', async () => {
    mockApi.requestAgentMfaChallenge.mockRejectedValue(apiError('Unauthorized', 401));
    const { getByTestId, getByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByText('Your session has expired. Please log in again.')).toBeTruthy());
  });

  test('10. 5xx/403 responses stay sanitized (no raw server errors shown)', async () => {
    mockApi.requestAgentMfaChallenge.mockRejectedValue(apiError('provider trace #xYz', 500));
    const result = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="CASH_TO_CASH_CLAIM" />);
    fireEvent.press(result.getByTestId('mfa-request-button'));
    await waitFor(() =>
      expect(result.getByText('The service is temporarily unavailable. Please retry.')).toBeTruthy(),
    );
    result.unmount();

    mockApi.requestAgentMfaChallenge.mockRejectedValue(apiError('Forbidden', 403));
    const result2 = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="CASH_TO_CASH_CLAIM" />);
    fireEvent.press(result2.getByTestId('mfa-request-button'));
    await waitFor(() =>
      expect(result2.getByText('This information is not available for your account.')).toBeTruthy(),
    );
  });

  test('11+12. OTP/challenge is never persisted to device storage and nothing is logged', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture());
    const { getByTestId } = wrap(<MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    expect(setSpy).not.toHaveBeenCalled();
    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toMatch(/otp|challenge-uuid|destination/i);
      }
    }
    logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore();
  });

  test('13. the customer phone is never resolved/exposed (only server-masked destination shown)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture());
    const { getByTestId, queryByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());
    expect(getByTestId('mfa-destination-masked').props.children).toBe('******7801');
    expect(queryByText(/080\d{8}/)).toBeNull(); // no raw Nigerian numbers anywhere
  });

  test('14. expiration: challenge past server expiresAt flips to the expired state', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(
      challengeFixture({ expiresAt: new Date(Date.now() + 1_500).toISOString(), ttlSeconds: 2 }),
    );
    const { getByTestId, findByTestId } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    expect(await findByTestId('mfa-ready-title')).toBeTruthy();
    expect(await findByTestId('mfa-expired', {}, { timeout: 4_000 })).toBeTruthy();
  }, 10_000);

  test('14b. expiration helpers honor server values only', () => {
    const challenge = challengeFixture({
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:01:30.000Z',
      ttlSeconds: 90,
    });
    const t0 = new Date('2026-01-01T00:00:30.000Z').getTime();
    expect(remainingChallengeSeconds(challenge, t0)).toBe(60);
    expect(isChallengeExpired(challenge, new Date('2026-01-01T00:01:29.000Z').getTime())).toBe(false);
    expect(isChallengeExpired(challenge, new Date('2026-01-01T00:01:30.000Z').getTime())).toBe(true);
  });

  test('15. resend requests a new challenge through the same backend endpoint', async () => {
    mockApi.requestAgentMfaChallenge
      .mockResolvedValueOnce(challengeFixture({ challengeId: 'challenge-uuid-1' }))
      .mockResolvedValueOnce(challengeFixture({ challengeId: 'challenge-uuid-2' }));

    const { getByTestId } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="CASH_TO_CASH_CLAIM" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-resend-button')).toBeTruthy());

    fireEvent.press(getByTestId('mfa-resend-button'));
    await waitFor(() => expect(mockApi.requestAgentMfaChallenge).toHaveBeenCalledTimes(2));
    expect(mockApi.requestAgentMfaChallenge).toHaveBeenNthCalledWith(2, 'customer-uuid-1', 'CASH_TO_CASH_CLAIM', undefined);
  });

  test('no verification UI exists: the app offers no OTP entry (issue-only backend contract)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture());
    const { getByTestId, queryByTestId, queryByText } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());
    expect(queryByTestId(/otp-input|code-input/i)).toBeNull();
    expect(queryByText(/enter the code/i)).toBeNull();
  });

  test('onChallengeReady hands the server-issued challengeId to the future flow', async () => {
    const onReady = jest.fn();
    mockApi.requestAgentMfaChallenge.mockResolvedValue(challengeFixture({ challengeId: 'server-issued-id-7' }));
    const { getByTestId } = wrap(
      <MfaChallengeCard customerId="customer-uuid-1" purpose="WALLET_TO_CASH" onChallengeReady={onReady} />,
    );
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: 'server-issued-id-7' }),
    ));
  });
});
