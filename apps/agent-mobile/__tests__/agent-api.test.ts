import { ApiClient, ApiError, NetworkError } from '../src/services/api-client';
import {
  agentCashIn,
  agentCashToCash,
  describeApiError,
  describeCashToCashError,
  getAgentReceivingNumber,
  getAgentOutlets,
  getAgentTerminals,
  requestAgentMfaChallenge,
  resolveAgentRecipient,
  setPendingTransferCode,
  consumePendingTransferCode,
  clearPendingTransferCode,
} from '../src/services/agent-api';

jest.mock('../src/services/api-client', () => {
  const actual = jest.requireActual('../src/services/api-client');
  return {
    ...actual,
    ApiClient: {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

const { ApiClient: mockClient } = jest.requireMock('../src/services/api-client') as {
  ApiClient: { get: jest.Mock; post: jest.Mock };
};

describe('Agent operating-context API bindings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('receiving-number: NONE response normalizes to null (no invented assignment)', async () => {
    mockClient.get.mockResolvedValue({ agentId: 'a', receivingNumber: null, status: 'NONE' });
    expect(await getAgentReceivingNumber()).toBeNull();
    expect(mockClient.get).toHaveBeenCalledWith('api/v1/agents/me/receiving-number');
  });

  test('receiving-number: assigned view returned verbatim', async () => {
    const view = { id: 'r', agentId: 'a', receivingNumber: '2348000001', status: 'ACTIVE' };
    mockClient.get.mockResolvedValue(view);
    expect(await getAgentReceivingNumber()).toEqual(view);
  });

  test('outlets/terminals: arrays pass through unchanged (no invented fields)', async () => {
    mockClient.get.mockResolvedValueOnce([{ id: 'o1' }]).mockResolvedValueOnce([{ id: 't1' }]);
    expect(await getAgentOutlets()).toEqual([{ id: 'o1' }]);
    expect(await getAgentTerminals()).toEqual([{ id: 't1' }]);
    expect(mockClient.get).toHaveBeenNthCalledWith(1, 'api/v1/agents/me/outlets');
    expect(mockClient.get).toHaveBeenNthCalledWith(2, 'api/v1/agents/me/terminals');
  });

  describe('POST /agents/me/mfa-challenges binding', () => {
    test('sends customerId+purpose and returns the typed server response', async () => {
      const issued = {
        challengeId: 'c-1', customerId: 'cust-1', purpose: 'WALLET_TO_CASH',
        deliveryChannel: 'SMS', destinationMasked: '******7801', delivered: true,
        issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:30.000Z', ttlSeconds: 90,
      };
      mockClient.post.mockResolvedValue(issued);

      const result = await requestAgentMfaChallenge('cust-1', 'WALLET_TO_CASH');

      expect(mockClient.post).toHaveBeenCalledWith('api/v1/agents/me/mfa-challenges', {
        customerId: 'cust-1',
        purpose: 'WALLET_TO_CASH',
      });
      expect(result.challengeId).toBe('c-1');
      expect(result.destinationMasked).toBe('******7801');
    });

    test('ttlSeconds is omitted unless the caller explicitly supplies it', async () => {
      mockClient.post.mockResolvedValue({});
      await requestAgentMfaChallenge('cust-2', 'CASH_TO_CASH_CLAIM');
      const body = mockClient.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect('ttlSeconds' in body).toBe(false);

      await requestAgentMfaChallenge('cust-2', 'CASH_TO_CASH_CLAIM', 45);
      const body2 = mockClient.post.mock.calls[1]?.[1] as Record<string, unknown>;
      expect(body2.ttlSeconds).toBe(45);
    });
  });

  describe('GET /recipients/resolve binding (Cash→Wallet recipient identity)', () => {
    test('resolves identity and STRIPS the internal ownerId before returning', async () => {
      mockClient.get.mockResolvedValue({
        ownerType: 'CUSTOMER', ownerId: 'internal-customer-id', receivingNumber: '8000000001',
        display: 'Ada N.', status: 'ACTIVE',
      });

      const view = await resolveAgentRecipient(' 8000000001 ');

      // Binding trims before transport:
      expect(mockClient.get).toHaveBeenCalledWith(
        'api/v1/recipients/resolve?identifier=8000000001',
      );
      expect(view).toEqual({
        ownerType: 'CUSTOMER', receivingNumber: '8000000001', display: 'Ada N.', status: 'ACTIVE',
      });
      expect('ownerId' in view).toBe(false); // internal ids never leak into the app
    });
  });

  describe('POST /agents/cash-in binding', () => {
    test('sends the exact contract body with body+header idempotency and PIN-session preservation', async () => {
      const result = {
        status: 'COMPLETED', journalId: 'j-1', agentId: 'a-1', recipientCustomerId: 'c-1',
        recipientReceivingNumber: '8000000001', amountMinor: '250000', currency: 'NGN',
        idempotencyKey: 'c2w-x', requestHash: 'h', replayed: false,
        reference: 'CASH_IN-c2w-x', createdAt: '2026-01-01T00:00:00.000Z',
      };
      mockClient.post.mockResolvedValue(result);

      const out = await agentCashIn({
        recipientIdentifier: '8000000001', amountMinor: '250000', currency: 'NGN',
        idempotencyKey: 'c2w-x', pin: '1234',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/cash-in',
        {
          recipientIdentifier: '8000000001', amountMinor: '250000', currency: 'NGN',
          idempotencyKey: 'c2w-x', pin: '1234',
        },
        { idempotencyKey: 'c2w-x', preserveSessionOn401: true },
      );
      expect(out.status).toBe('COMPLETED');
      expect(out.reference).toBe('CASH_IN-c2w-x');
    });
  });

  describe('POST /agents/cash-to-cash binding (Cash→Cash Initiation)', () => {
    test('sends exact contract body with agentPin and preserveSessionOn401', async () => {
      const result = {
        status: 'COMPLETED',
        transferId: 'c2c-transfer-uuid',
        journalId: 'journal-uuid',
        agentId: 'agent-uuid',
        beneficiaryPhone: '8012345678',
        principalMinor: '500000',
        feeMinor: '0',
        vatMinor: '0',
        totalMinor: '500000',
        currency: 'NGN',
        amountMinor: '500000',
        idempotencyKey: 'c2c-key-1',
        requestHash: 'hash-1',
        replayed: false,
        reference: 'CASH_TO_CASH-c2c-key-1',
        createdAt: '2026-06-01T12:00:00.000Z',
        transferCode: '98765432',
      };
      mockClient.post.mockResolvedValue(result);

      const out = await agentCashToCash({
        beneficiaryPhone: '8012345678',
        amountMinor: '500000',
        currency: 'NGN',
        idempotencyKey: 'c2c-key-1',
        agentPin: '4321',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/cash-to-cash',
        {
          beneficiaryPhone: '8012345678',
          amountMinor: '500000',
          currency: 'NGN',
          idempotencyKey: 'c2c-key-1',
          agentPin: '4321',
        },
        { idempotencyKey: 'c2c-key-1', preserveSessionOn401: true },
      );
      expect(out.status).toBe('COMPLETED');
      expect(out.transferCode).toBe('98765432');
    });
  });

  describe('Display-Once transferCode ephemeral handover', () => {
    test('single-use consumption and clearance', () => {
      setPendingTransferCode('CODE-999');
      expect(consumePendingTransferCode()).toBe('CODE-999');
      // Second read returns null (consumed):
      expect(consumePendingTransferCode()).toBeNull();

      // Clear function works:
      setPendingTransferCode('CODE-888');
      clearPendingTransferCode();
      expect(consumePendingTransferCode()).toBeNull();
    });
  });

  describe('describeApiError & describeCashToCashError mapping', () => {
    test('401 → session expired message in general describeApiError', () => {
      expect(describeApiError(new ApiError('Unauthorized', 401))).toBe(
        'Your session has expired. Please log in again.',
      );
    });
    test('401 with PIN error → PIN-specific error in describeCashToCashError', () => {
      expect(describeCashToCashError(new ApiError('Transaction PIN invalid', 401))).toBe(
        'Incorrect transaction PIN. Try again.',
      );
      expect(describeCashToCashError(new ApiError('Transaction PIN is locked', 401))).toBe(
        'Your transaction PIN is locked. Contact support.',
      );
    });
    test('403 → account-availability message', () => {
      expect(describeCashToCashError(new ApiError('Forbidden', 403))).toBe(
        'You are not permitted to perform Cash→Cash for this account.',
      );
    });
    test('500 → generic temporary-unavailable message (raw body hidden)', () => {
      expect(describeApiError(new ApiError('SQL stack trace secrets', 500))).toBe(
        'The service is temporarily unavailable. Please retry.',
      );
    });
    test('network failure → connection message', () => {
      expect(describeApiError(new NetworkError('fetch failed'))).toBe(
        'No network connection. Check your connection and retry.',
      );
    });
    test('4xx preserving backend message (safe, agent-facing)', () => {
      expect(describeApiError(new ApiError('No receiving number', 404))).toBe('No receiving number');
    });
  });
});
