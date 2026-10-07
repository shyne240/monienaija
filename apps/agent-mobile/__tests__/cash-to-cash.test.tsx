import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  CashToCashRecipientScreen,
  canonicalizePhoneNumber,
} from '../src/screens/authenticated/cash-to-cash/CashToCashRecipientScreen';
import { CashToCashAmountScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashAmountScreen';
import { CashToCashConfirmScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashConfirmScreen';
import { CashToCashSuccessScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashSuccessScreen';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import { formatNairaFromMinor, newIdempotencyKey, parseNairaInputToMinor } from '../src/utils/format';
import {
  setPendingTransferCode,
  consumePendingTransferCode,
  clearPendingTransferCode,
  type ResolvedRecipientView,
  type AgentCashToCashResult,
} from '../src/services/agent-api';
import {
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  savePendingAgentOperation,
} from '../src/services/pending-operation';

jest.mock('../src/services/agent-api', () => ({
  resolveAgentRecipient: jest.fn(),
  agentCashToCash: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
  describeCashToCashError: jest.requireActual('../src/services/agent-api').describeCashToCashError,
  setPendingTransferCode: jest.requireActual('../src/services/agent-api').setPendingTransferCode,
  isAmbiguousOperationOutcome: jest.requireActual('../src/services/agent-api').isAmbiguousOperationOutcome,
  consumePendingTransferCode: jest.requireActual('../src/services/agent-api').consumePendingTransferCode,
  clearPendingTransferCode: jest.requireActual('../src/services/agent-api').clearPendingTransferCode,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveAgentRecipient: jest.Mock;
  agentCashToCash: jest.Mock;
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

const cashToCashResult: AgentCashToCashResult = {
  status: 'COMPLETED',
  transferId: 'internal-transfer-uuid-9',
  journalId: 'internal-journal-uuid-9',
  agentId: 'internal-agent-uuid-1',
  beneficiaryPhone: '8012345678',
  principalMinor: '500000',
  feeMinor: '0',
  vatMinor: '0',
  totalMinor: '500000',
  currency: 'NGN',
  amountMinor: '500000',
  idempotencyKey: 'c2c-key-abc',
  requestHash: 'internal-hash-c2c',
  replayed: false,
  reference: 'CASH_TO_CASH-c2c-key-abc',
  createdAt: '2026-06-01T12:30:00.000Z',
  transferCode: 'TRANSFER_CODE_778899',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Cash→Cash — Phone Canonicalization Helper', () => {
  test('canonicalizes various Nigerian phone formats to 10-digit', () => {
    expect(canonicalizePhoneNumber('08012345678')).toBe('8012345678');
    expect(canonicalizePhoneNumber('+2348012345678')).toBe('8012345678');
    expect(canonicalizePhoneNumber('2348012345678')).toBe('8012345678');
    expect(canonicalizePhoneNumber('8012345678')).toBe('8012345678');
    expect(canonicalizePhoneNumber(' 070 1234 5678 ')).toBe('7012345678');
    expect(canonicalizePhoneNumber('090-1234-5678')).toBe('9012345678');
  });

  test('rejects invalid or non-Nigerian phone numbers', () => {
    expect(canonicalizePhoneNumber('')).toBeNull();
    expect(canonicalizePhoneNumber('123')).toBeNull();
    expect(canonicalizePhoneNumber('05012345678')).toBeNull();
    expect(canonicalizePhoneNumber('abcdefghij')).toBeNull();
  });
});

describe('Cash→Cash — Step 1: Beneficiary Phone Screen (C2C-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('valid Nigerian phone can proceed directly to amount step without resolver', () => {
    const { getByTestId } = wrap(<CashToCashRecipientScreen />);
    fireEvent.changeText(getByTestId('beneficiary-phone-input'), '08012345678');
    fireEvent.press(getByTestId('beneficiary-continue'));
    expect(mockNavigate).toHaveBeenCalledWith('CashToCashAmount', {
      beneficiaryPhone: '8012345678',
    });
  });

  test('invalid phone format is blocked client-side with safe error', () => {
    const { getByTestId, getByText } = wrap(<CashToCashRecipientScreen />);
    fireEvent.changeText(getByTestId('beneficiary-phone-input'), '12345');
    fireEvent.press(getByTestId('beneficiary-continue'));
    expect(getByText(/Enter a valid 10-digit Nigerian phone number/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('optional verification: 404 from resolver confirms unregistered beneficiary (expected for C2C)', async () => {
    mockApi.resolveAgentRecipient.mockRejectedValue(apiError('Recipient not found', 404));
    const { getByTestId, getByText } = wrap(<CashToCashRecipientScreen />);
    fireEvent.changeText(getByTestId('beneficiary-phone-input'), '08012345678');
    fireEvent.press(getByTestId('beneficiary-verify-button'));

    await waitFor(() => expect(getByTestId('beneficiary-unregistered-card')).toBeTruthy());
    expect(getByText(/This phone is unregistered/)).toBeTruthy();

    fireEvent.press(getByTestId('beneficiary-continue'));
    expect(mockNavigate).toHaveBeenCalledWith('CashToCashAmount', {
      beneficiaryPhone: '8012345678',
    });
  });

  test('optional verification: AGENT recipient is blocked (backend rule)', async () => {
    const agentRecipient: ResolvedRecipientView = {
      ownerType: 'AGENT',
      receivingNumber: '8012345678',
      display: 'Test Agent Outlet',
      status: 'ACTIVE',
    };
    mockApi.resolveAgentRecipient.mockResolvedValue(agentRecipient);
    const { getByTestId, getByText, queryByTestId } = wrap(<CashToCashRecipientScreen />);
    fireEvent.changeText(getByTestId('beneficiary-phone-input'), '08012345678');
    fireEvent.press(getByTestId('beneficiary-verify-button'));

    await waitFor(() => expect(getByTestId('beneficiary-agent-ineligible')).toBeTruthy());
    expect(getByText(/Agent accounts cannot receive Cash→Cash/)).toBeTruthy();
    expect(queryByTestId('beneficiary-continue')).toBeNull();
  });
});

describe('Cash→Cash — Step 2: Amount Entry Screen (C2C-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k',
      name: 'CashToCashAmount',
      params: { beneficiaryPhone: '8012345678' },
    };
  });

  test('blocks zero, negative, malformed, and >2dp amounts client-side', () => {
    const { getByTestId, getByText } = wrap(<CashToCashAmountScreen />);

    fireEvent.changeText(getByTestId('c2c-amount-input'), '0');
    fireEvent.press(getByTestId('c2c-amount-continue'));
    expect(getByText(/greater than zero/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('c2c-amount-input'), '-500');
    fireEvent.press(getByTestId('c2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('c2c-amount-input'), '100.999');
    fireEvent.press(getByTestId('c2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('c2c-amount-input'), 'abc');
    fireEvent.press(getByTestId('c2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('valid amount navigates to confirm with ONE unique idempotency key', async () => {
    const { getByTestId, getByText } = wrap(<CashToCashAmountScreen />);
    fireEvent.changeText(getByTestId('c2c-amount-input'), '5000');
    expect(getByText(/You will send ₦5,000.00 NGN/)).toBeTruthy();

    fireEvent.press(getByTestId('c2c-amount-continue'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    const [screen, params] = mockNavigate.mock.calls[0] as any[];
    expect(screen).toBe('CashToCashConfirm');
    expect(params.beneficiaryPhone).toBe('8012345678');
    expect(params.amountMinor).toBe('500000');
    expect(params.idempotencyKey).toMatch(/^c2c-/);
  });
});

describe('Cash→Cash — Step 3: Confirmation & Authorize (C2C-4 / C2C-7 / SEC-1 / SEC-2)', () => {
  const params = {
    beneficiaryPhone: '8012345678',
    amountMinor: '500000',
    idempotencyKey: 'c2c-key-abc',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingTransferCode();
    mockRoute = { key: 'k', name: 'CashToCashConfirm', params };
  });

  test('summary displays only authoritative input data without client-side fee math', () => {
    const { getByText, getByTestId } = wrap(<CashToCashConfirmScreen />);
    expect(getByTestId('c2c-confirm-summary-card')).toBeTruthy();
    expect(getByText('8012345678')).toBeTruthy();
    expect(getByText('₦5,000.00 NGN')).toBeTruthy();
  });

  test('request construction: sends agentPin and contract body with preserveSessionOn401', async () => {
    mockApi.agentCashToCash.mockResolvedValue(cashToCashResult);
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(mockApi.agentCashToCash).toHaveBeenCalledWith({
        beneficiaryPhone: '8012345678',
        amountMinor: '500000',
        currency: 'NGN',
        idempotencyKey: 'c2c-key-abc',
        agentPin: '4321',
      }),
    );
  });

  test('duplicate-submission protection: button disabled while in-flight', async () => {
    let resolveIt: (v: any) => void = () => {};
    mockApi.agentCashToCash.mockImplementation(() => new Promise((res) => { resolveIt = res; }));

    const { getByTestId } = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() => expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('c2c-confirm-submit')); // loading disabled
    expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(1);

    await act(async () => resolveIt(cashToCashResult));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
  });

  test('CRITICAL SECURITY: transferCode is NEVER placed in navigation params', async () => {
    mockApi.agentCashToCash.mockResolvedValue(cashToCashResult);
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    const resetCall = mockReset.mock.calls[0]?.[0] as any;
    const successRoute = resetCall.routes[0];
    expect(successRoute.name).toBe('CashToCashSuccess');

    // Strict assertions: transferCode is NOT anywhere in route params
    expect(successRoute.params).not.toHaveProperty('transferCode');
    expect(successRoute.params.result).not.toHaveProperty('transferCode');
    expect(JSON.stringify(successRoute.params)).not.toContain('TRANSFER_CODE_778899');
    expect(JSON.stringify(successRoute.params)).not.toContain('transferCode');
  });

  test('PIN failure (401) surfaces PIN-specific error without logging agent out', async () => {
    mockApi.agentCashToCash.mockRejectedValue(apiError('Transaction PIN invalid: PIN_INVALID', 401));
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '9999');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-confirm-error').props.children).toBe('Incorrect transaction PIN. Try again.'),
    );
    // PIN cleared from state on error:
    expect(getByTestId('c2c-pin-input').props.value).toBe('');
  });

  test('PIN locked (401) surfaces locked error', async () => {
    mockApi.agentCashToCash.mockRejectedValue(apiError('Transaction PIN is locked', 401));
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '9999');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-confirm-error').props.children).toBe(
        'Your transaction PIN is locked. Contact support.',
      ),
    );
  });

  test('insufficient balance (409) surfaces server error message', async () => {
    mockApi.agentCashToCash.mockRejectedValue(apiError('Insufficient available balance', 409));
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-confirm-error').props.children).toContain('Insufficient available balance'),
    );
  });

  test('authorization failure (403) surfaces account permission message', async () => {
    mockApi.agentCashToCash.mockRejectedValue(apiError('Agent not permitted: AGENT_SUSPENDED', 403));
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-confirm-error').props.children).toBe(
        'You are not permitted to perform Cash→Cash for this account.',
      ),
    );
  });

  test('sanitized 500 server error hides internal SQL / stack traces', async () => {
    mockApi.agentCashToCash.mockRejectedValue(apiError('Internal DB error at line 42', 500));
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-confirm-error').props.children).toBe(
        'The service is temporarily unavailable. Please retry.',
      ),
    );
  });

  test('success invalidates financial position and transaction history queries', async () => {
    useAuthStore.setState({ agentId: 'agent-uuid-1' });
    mockApi.agentCashToCash.mockResolvedValue(cashToCashResult);
    const { client, getByTestId } = wrap(<CashToCashConfirmScreen />);
    const spy = jest.spyOn(client, 'invalidateQueries');

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-financial-position', 'agent-uuid-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-transactions', 'agent-uuid-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-history', 'agent-uuid-1'] });
  });

  test('PIN is never persisted and never logged', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.agentCashToCash.mockResolvedValue(cashToCashResult);
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('4321');
      }
    }
    for (const call of setSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('4321');
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('Cash→Cash — Step 4: Display-Once Success & Receipt (C2C-5 / C2C-6 / C2C-8 / SEC-1..7)', () => {
  const { transferCode: _stripped, ...safeResult } = cashToCashResult;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k',
      name: 'CashToCashSuccess',
      params: { result: safeResult, amountMinor: '500000' },
    };
  });

  test('displays prominent one-time transferCode from single-use handover', () => {
    setPendingTransferCode('TRANSFER_CODE_778899');
    const { getByTestId, getByText } = wrap(<CashToCashSuccessScreen />);

    expect(getByTestId('c2c-transfer-code-card')).toBeTruthy();
    expect(getByTestId('c2c-transfer-code').props.children).toBe('TRANSFER_CODE_778899');
    expect(getByText(/DISPLAY-ONCE CODE/)).toBeTruthy();

    // Handover was consumed:
    expect(consumePendingTransferCode()).toBeNull();
  });

  test('shared receipt is rendered but NEVER contains transferCode', () => {
    setPendingTransferCode('TRANSFER_CODE_778899');
    const { getByTestId, getByText, queryByText } = wrap(<CashToCashSuccessScreen />);

    expect(getByTestId('c2c-receipt')).toBeTruthy();
    expect(getByText('Cash→Cash Receipt')).toBeTruthy();
    expect(getByText('COMPLETED')).toBeTruthy();
    expect(getByText('8012345678')).toBeTruthy();
    expect(getByText('CASH_TO_CASH-c2c-key-abc')).toBeTruthy();

    // Internal IDs are never rendered:
    expect(queryByText(/internal-transfer-uuid-9/)).toBeNull();
    expect(queryByText(/internal-journal-uuid-9/)).toBeNull();
    expect(queryByText(/internal-hash-c2c/)).toBeNull();
  });

  test('share receipt payload NEVER contains transferCode', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: 'sharedAction' } as never);
    setPendingTransferCode('TRANSFER_CODE_778899');
    const { getByTestId } = wrap(<CashToCashSuccessScreen />);

    fireEvent.press(getByTestId('receipt-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    const message = (shareSpy.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain('Cash→Cash Receipt');
    expect(message).toContain('Status: COMPLETED');
    expect(message).not.toContain('TRANSFER_CODE_778899');
    expect(message).not.toContain('transferCode');

    shareSpy.mockRestore();
  });

  test('replayed response renders honest REPLAYED status and does not fabricate a transfer code', () => {
    const replayedResult = { ...safeResult, status: 'REPLAYED' as const, replayed: true };
    mockRoute = {
      key: 'k',
      name: 'CashToCashSuccess',
      params: { result: replayedResult, amountMinor: '500000' },
    };
    clearPendingTransferCode();

    const { getByTestId, getByText, queryByTestId } = wrap(<CashToCashSuccessScreen />);

    expect(getByText('Already recorded')).toBeTruthy();
    expect(getByTestId('c2c-replay-card')).toBeTruthy();
    expect(getByText(/Transfer code was issued during initial creation/)).toBeTruthy();
    expect(queryByTestId('c2c-transfer-code')).toBeNull();
  });

  test('unmount clears any residual transfer code state', () => {
    setPendingTransferCode('CODE-UNMOUNT-TEST');
    const { unmount } = wrap(<CashToCashSuccessScreen />);
    unmount();
    expect(consumePendingTransferCode()).toBeNull();
  });

  test('navigation buttons reset cleanly to History, New, and Home', () => {
    const { getByTestId } = wrap(<CashToCashSuccessScreen />);

    fireEvent.press(getByTestId('c2c-success-history'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Transactions' }],
    });

    fireEvent.press(getByTestId('c2c-success-new'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'CashToCash' }],
    });

    fireEvent.press(getByTestId('c2c-success-done'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  });
});

// V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01 — the process-kill recovery fix. Mirrors the
// Cash→Wallet / Wallet→Cash coverage for the Cash→Cash SEND leg (CLAIM is out of scope — it is
// independently guarded by cash_to_cash_transfers' own state machine, see
// src/services/pending-operation.ts's module doc).
describe('Cash→Cash Send — Idempotency-Key durability across a simulated process kill', () => {
  const agentId = 'agent-persist-c2c';
  const beneficiaryPhone = '8012345678';

  beforeEach(async () => {
    jest.clearAllMocks();
    clearPendingTransferCode();
    useAuthStore.setState({ agentId });
    await clearPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND');
  });

  test('1. an ambiguous outcome (NetworkError) durably persists the pending operation, not just in-memory', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '500000', idempotencyKey: 'c2c-persist-k1' },
    };
    const networkErr = new Error('fetch failed');
    (networkErr as any).name = 'NetworkError';
    mockApi.agentCashToCash.mockRejectedValueOnce(networkErr);

    const { getByTestId } = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(1));

    const persisted = await loadPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND');
    expect(persisted).not.toBeNull();
    expect(persisted?.idempotencyKey).toBe('c2c-persist-k1');
    expect(persisted?.counterpartyId).toBe(beneficiaryPhone);
    expect(persisted?.amountMinor).toBe('500000');
  });

  test('2. a fresh Confirm instance after a simulated restart reuses the persisted key, not the freshly-minted route-param one', async () => {
    // Precondition: left behind by an earlier ambiguous attempt (per test 1 above).
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_TO_CASH_SEND',
      idempotencyKey: 'c2c-restart-original',
      counterpartyId: beneficiaryPhone,
      amountMinor: '500000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    // "Reopen the app": a fresh Confirm instance with a BRAND NEW route-param key, exactly
    // what CashToCashAmountScreen would mint since its in-memory useRef cannot have survived
    // the process kill.
    mockApi.agentCashToCash.mockResolvedValueOnce(cashToCashResult);
    mockRoute = {
      key: 'k2',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '500000', idempotencyKey: 'c2c-restart-FRESH-K2' },
    };
    const second = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(second.getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(second.getByTestId('c2c-confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(1));

    expect(mockApi.agentCashToCash.mock.calls[0][0].idempotencyKey).toBe('c2c-restart-original');
  });

  test('3. success clears the persisted operation', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '500000', idempotencyKey: 'c2c-success-clear' },
    };
    mockApi.agentCashToCash.mockResolvedValueOnce(cashToCashResult);
    const { getByTestId } = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(getByTestId('c2c-confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    await waitFor(async () =>
      expect(await loadPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND')).toBeNull(),
    );
  });

  test('4. a definitive rejection (4xx) clears the persisted operation — a later attempt gets a clean new key', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '500000', idempotencyKey: 'c2c-definitive-reject' },
    };
    mockApi.agentCashToCash.mockRejectedValueOnce(apiError('Transaction PIN invalid: PIN_INVALID', 401));
    const first = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(first.getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(first.getByTestId('c2c-confirm-submit'));
    await waitFor(() =>
      expect(first.getByTestId('c2c-confirm-error').props.children).toBe('Incorrect transaction PIN. Try again.'),
    );
    await waitFor(async () =>
      expect(await loadPendingAgentOperation(agentId, 'CASH_TO_CASH_SEND')).toBeNull(),
    );
    first.unmount();

    mockApi.agentCashToCash.mockResolvedValueOnce(cashToCashResult);
    mockRoute = {
      key: 'k2',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '500000', idempotencyKey: 'c2c-clean-retry-key' },
    };
    const second = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(second.getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(second.getByTestId('c2c-confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(2));
    expect(mockApi.agentCashToCash.mock.calls[1][0].idempotencyKey).toBe('c2c-clean-retry-key');
  });

  test('5. a persisted operation for a DIFFERENT amount is never reused — no fuzzy attribution', async () => {
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_TO_CASH_SEND',
      idempotencyKey: 'c2c-amount-a',
      counterpartyId: beneficiaryPhone,
      amountMinor: '500000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    mockApi.agentCashToCash.mockResolvedValueOnce({ ...cashToCashResult, amountMinor: '900000' });
    mockRoute = {
      key: 'k2',
      name: 'CashToCashConfirm',
      params: { beneficiaryPhone, amountMinor: '900000', idempotencyKey: 'c2c-amount-b-own-key' },
    };
    const second = wrap(<CashToCashConfirmScreen />);
    fireEvent.changeText(second.getByTestId('c2c-pin-input'), '4321');
    fireEvent.press(second.getByTestId('c2c-confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashToCash).toHaveBeenCalledTimes(1));
    expect(mockApi.agentCashToCash.mock.calls[0][0].idempotencyKey).toBe('c2c-amount-b-own-key');
  });
});
