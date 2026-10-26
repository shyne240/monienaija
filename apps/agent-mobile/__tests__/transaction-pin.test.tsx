import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TransactionPinManageScreen } from '../src/screens/authenticated/pin/TransactionPinManageScreen';
import { SetTransactionPinScreen } from '../src/screens/authenticated/pin/SetTransactionPinScreen';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import {
  describeApiError,
  describeTransactionPinError,
  type AgentTransactionPinStatus,
  type AgentSetPinResult,
} from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  getAgentTransactionPinStatus: jest.fn(),
  setAgentTransactionPin: jest.fn(),
  changeAgentTransactionPin: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
  describeTransactionPinError: jest.requireActual('../src/services/agent-api').describeTransactionPinError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  getAgentTransactionPinStatus: jest.Mock;
  setAgentTransactionPin: jest.Mock;
  changeAgentTransactionPin: jest.Mock;
};

const mockNavigate = jest.fn();
const mockReset = jest.fn();
let mockRoute: any = { key: 'k', name: 'route', params: {} };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, reset: mockReset }),
  useRoute: () => mockRoute,
}));

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

const activePinStatus: AgentTransactionPinStatus = {
  status: 'ACTIVE',
  exists: true,
  accountLocked: false,
  pinVersion: 2,
  lastChangedAt: '2026-09-15T10:00:00.000Z',
  failedCount: 0,
};

const notSetPinStatus: AgentTransactionPinStatus = {
  status: 'NOT_SET',
  exists: false,
  accountLocked: false,
};

const lockedPinStatus: AgentTransactionPinStatus = {
  status: 'LOCKED',
  exists: true,
  accountLocked: true,
  pinVersion: 1,
  lastChangedAt: '2026-09-01T10:00:00.000Z',
  failedCount: 5,
  lockedAt: '2026-10-01T12:00:00.000Z',
  lockReason: 'Maximum failed PIN attempts reached',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Agent Transaction PIN Management — Status Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ agentId: 'agent-pin-uuid-1', isAuthenticated: true });
  });

  test('renders ACTIVE status, version, and Change PIN action', async () => {
    mockApi.getAgentTransactionPinStatus.mockResolvedValue(activePinStatus);
    const { getByTestId, getByText } = wrap(<TransactionPinManageScreen />);

    await waitFor(() => expect(getByTestId('pin-status-card')).toBeTruthy());
    expect(getByTestId('pin-status-badge').props.children).toBe('ACTIVE');
    expect(getByTestId('pin-version').props.children).toBe(2);
    expect(getByTestId('pin-action-rotate')).toBeTruthy();

    fireEvent.press(getByTestId('pin-action-rotate'));
    expect(mockNavigate).toHaveBeenCalledWith('SetTransactionPin', { mode: 'ROTATE' });
  });

  test('renders NOT_SET status and Set PIN action', async () => {
    mockApi.getAgentTransactionPinStatus.mockResolvedValue(notSetPinStatus);
    const { getByTestId, getByText } = wrap(<TransactionPinManageScreen />);

    await waitFor(() => expect(getByTestId('pin-status-card')).toBeTruthy());
    expect(getByTestId('pin-status-badge').props.children).toBe('NOT_SET');
    expect(getByText(/No Transaction PIN is currently configured/)).toBeTruthy();
    expect(getByTestId('pin-action-create')).toBeTruthy();

    fireEvent.press(getByTestId('pin-action-create'));
    expect(mockNavigate).toHaveBeenCalledWith('SetTransactionPin', { mode: 'CREATE' });
  });

  // V1-AGENT-05: the LOCKED state used to offer a "Reset Transaction PIN" button that routed
  // to the CREATE form, which — combined with the backend's former unconditional overwrite —
  // let a locked Agent silently replace the PIN with no proof of the old one (a lockout
  // bypass). There is no secure, independent channel to re-verify identity in V1, so the
  // locked state now offers ONLY a Contact Support path, never an in-app PIN bypass.
  test('renders LOCKED status, locked details, and Contact Support action (no in-app reset bypass)', async () => {
    mockApi.getAgentTransactionPinStatus.mockResolvedValue(lockedPinStatus);
    const { getByTestId, getByText, queryByTestId } = wrap(<TransactionPinManageScreen />);

    await waitFor(() => expect(getByTestId('pin-status-card')).toBeTruthy());
    expect(getByTestId('pin-status-badge').props.children).toBe('LOCKED');
    expect(getByTestId('pin-locked-card')).toBeTruthy();
    expect(getByText('Maximum failed PIN attempts reached')).toBeTruthy();

    // CRITICAL: no "reset" action exists for a locked PIN — it must not be possible to
    // bypass lockout by navigating to the CREATE form.
    expect(queryByTestId('pin-action-reset')).toBeNull();
    expect(queryByTestId('pin-action-create')).toBeNull();
    expect(queryByTestId('pin-action-rotate')).toBeNull();

    expect(getByTestId('pin-action-support')).toBeTruthy();
    fireEvent.press(getByTestId('pin-action-support'));
    expect(mockNavigate).toHaveBeenCalledWith('CreateSupportTicket', { prefillCategory: 'PIN' });
  });

  test('error state and retry handling', async () => {
    mockApi.getAgentTransactionPinStatus.mockRejectedValue(apiError('Server error', 500));
    const { getByTestId, getByText } = wrap(<TransactionPinManageScreen />);

    await waitFor(() => expect(getByTestId('pin-status-error')).toBeTruthy());
    expect(getByText('The service is temporarily unavailable. Please retry.')).toBeTruthy();

    mockApi.getAgentTransactionPinStatus.mockResolvedValue(activePinStatus);
    fireEvent.press(getByTestId('pin-status-retry'));
    await waitFor(() => expect(getByTestId('pin-status-badge')).toBeTruthy());
  });
});

describe('Agent Transaction PIN — Create Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { key: 'k', name: 'SetTransactionPin', params: { mode: 'CREATE' } };
    useAuthStore.setState({ agentId: 'agent-pin-uuid-1', isAuthenticated: true });
  });

  test('valid PIN and matching confirmation creates PIN and displays success', async () => {
    const setResult: AgentSetPinResult = {
      agentId: 'agent-pin-uuid-1',
      pinVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    mockApi.setAgentTransactionPin.mockResolvedValue(setResult);

    const { getByTestId, getByText, queryByTestId } = wrap(<SetTransactionPinScreen />);

    // In CREATE mode, no current PIN input is rendered
    expect(queryByTestId('pin-input-current')).toBeNull();

    fireEvent.changeText(getByTestId('pin-input-new'), '1234');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '1234');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() => expect(mockApi.setAgentTransactionPin).toHaveBeenCalledWith('1234', '1234'));
    await waitFor(() => expect(getByTestId('pin-success-card')).toBeTruthy());
    expect(getByText('Transaction PIN Set')).toBeTruthy();

    fireEvent.press(getByTestId('pin-success-done'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionPinManage');
  });

  test('client validation: missing new PIN', () => {
    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.press(getByTestId('pin-submit-button'));
    expect(getByText('Enter your new Transaction PIN.')).toBeTruthy();
    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();
  });

  test('client validation: invalid PIN format (non-digits or length < 4 or > 12)', () => {
    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-new'), '12a');
    fireEvent.press(getByTestId('pin-submit-button'));
    expect(getByText('New PIN must be 4 to 12 numeric digits.')).toBeTruthy();

    fireEvent.changeText(getByTestId('pin-input-new'), '12');
    fireEvent.press(getByTestId('pin-submit-button'));
    expect(getByText('New PIN must be 4 to 12 numeric digits.')).toBeTruthy();

    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();
  });

  test('client validation: confirmation mismatch', () => {
    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-new'), '1234');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '9999');
    fireEvent.press(getByTestId('pin-submit-button'));

    expect(getByText('PIN confirmation does not match.')).toBeTruthy();
    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();
  });

  test('server error handling: 401 format error', async () => {
    mockApi.setAgentTransactionPin.mockRejectedValue(apiError('Invalid PIN format', 401));
    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-new'), '1234');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '1234');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() =>
      expect(getByText('Invalid PIN format. PIN must be 4 to 12 numeric digits.')).toBeTruthy(),
    );
    // Inputs wiped on error
    expect(getByTestId('pin-input-new').props.value).toBe('');
    expect(getByTestId('pin-input-confirm').props.value).toBe('');
  });
});

describe('Agent Transaction PIN — Rotate Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { key: 'k', name: 'SetTransactionPin', params: { mode: 'ROTATE' } };
    useAuthStore.setState({ agentId: 'agent-pin-uuid-1', isAuthenticated: true });
  });

  // V1-AGENT-05: rotation is now a SINGLE atomic server request (changeAgentTransactionPin),
  // not a client-orchestrated "verify then set" (which a bypassing client could defeat).
  test('correct current PIN + valid new PIN rotates PIN successfully (single atomic request)', async () => {
    const setResult: AgentSetPinResult = {
      agentId: 'agent-pin-uuid-1',
      pinVersion: 2,
      updatedAt: new Date().toISOString(),
    };
    mockApi.changeAgentTransactionPin.mockResolvedValue(setResult);

    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    expect(getByTestId('pin-input-current')).toBeTruthy();

    fireEvent.changeText(getByTestId('pin-input-current'), '1234');
    fireEvent.changeText(getByTestId('pin-input-new'), '5678');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '5678');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() => expect(mockApi.changeAgentTransactionPin).toHaveBeenCalledWith('1234', '5678'));
    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();
    await waitFor(() => expect(getByTestId('pin-success-card')).toBeTruthy());
    expect(getByText('Transaction PIN Updated')).toBeTruthy();
  });

  test('client validation: new PIN same as current PIN blocked', () => {
    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-current'), '1234');
    fireEvent.changeText(getByTestId('pin-input-new'), '1234');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '1234');
    fireEvent.press(getByTestId('pin-submit-button'));

    expect(getByText('New PIN must be different from current PIN.')).toBeTruthy();
    expect(mockApi.changeAgentTransactionPin).not.toHaveBeenCalled();
    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();
  });

  test('incorrect current PIN (server rejects change) shows error and wipes fields', async () => {
    mockApi.changeAgentTransactionPin.mockRejectedValue(apiError('Current PIN is incorrect', 401));

    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-current'), '0000');
    fireEvent.changeText(getByTestId('pin-input-new'), '5678');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '5678');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() =>
      expect(getByText('Incorrect transaction PIN. Check the PIN and try again.')).toBeTruthy(),
    );
    expect(mockApi.setAgentTransactionPin).not.toHaveBeenCalled();

    // Fields wiped on failure
    expect(getByTestId('pin-input-current').props.value).toBe('');
    expect(getByTestId('pin-input-new').props.value).toBe('');
    expect(getByTestId('pin-input-confirm').props.value).toBe('');
  });

  test('locked PIN on change attempt shows locked message (no bypass)', async () => {
    mockApi.changeAgentTransactionPin.mockRejectedValue(
      apiError('Transaction PIN is locked due to too many failed attempts. Contact support to proceed.', 403),
    );

    const { getByTestId, getByText } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-current'), '0000');
    fireEvent.changeText(getByTestId('pin-input-new'), '5678');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '5678');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() =>
      expect(
        getByText('Transaction PIN is locked due to too many failed attempts.'),
      ).toBeTruthy(),
    );
  });

  test('duplicate submit while pending does not fire a second change request', async () => {
    let resolveChange: (value: AgentSetPinResult) => void = () => {};
    mockApi.changeAgentTransactionPin.mockImplementation(
      () =>
        new Promise<AgentSetPinResult>((resolve) => {
          resolveChange = resolve;
        }),
    );

    const { getByTestId } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-current'), '1234');
    fireEvent.changeText(getByTestId('pin-input-new'), '5678');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '5678');

    const submitButton = getByTestId('pin-submit-button');
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);

    await waitFor(() => expect(mockApi.changeAgentTransactionPin).toHaveBeenCalledTimes(1));

    resolveChange({ agentId: 'agent-pin-uuid-1', pinVersion: 2, updatedAt: new Date().toISOString() });
    await waitFor(() => expect(getByTestId('pin-success-card')).toBeTruthy());
  });
});

describe('Agent Transaction PIN — Critical Security Invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { key: 'k', name: 'SetTransactionPin', params: { mode: 'ROTATE' } };
    useAuthStore.setState({ agentId: 'agent-pin-uuid-1', isAuthenticated: true });
  });

  test('CRITICAL: PINs are never persisted to SecureStorage or logged', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.changeAgentTransactionPin.mockResolvedValue({
      agentId: 'agent-pin-uuid-1',
      pinVersion: 2,
      updatedAt: new Date().toISOString(),
    });

    const { getByTestId } = wrap(<SetTransactionPinScreen />);

    fireEvent.changeText(getByTestId('pin-input-current'), '4321');
    fireEvent.changeText(getByTestId('pin-input-new'), '8765');
    fireEvent.changeText(getByTestId('pin-input-confirm'), '8765');
    fireEvent.press(getByTestId('pin-submit-button'));

    await waitFor(() => expect(getByTestId('pin-success-card')).toBeTruthy());

    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('4321');
        expect(String(call.join(' '))).not.toContain('8765');
      }
    }
    for (const call of setSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('4321');
      expect(String(call.join(' '))).not.toContain('8765');
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
