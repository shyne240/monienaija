import { ApiClient, ApiError, NetworkError } from '../src/services/api-client';
import {
  agentCashIn,
  agentCashToCash,
  agentCashToCashClaim,
  createAgentSupportTicket,
  createAgentSupportTicketMessage,
  describeApiError,
  describeCashToCashError,
  describeCashToCashClaimError,
  describeSupportError,
  describeTransactionPinError,
  getAgentOutlets,
  getAgentReceivingNumber,
  getAgentSupportTicket,
  getAgentSupportTicketMessages,
  getAgentSupportTickets,
  getAgentTerminals,
  getAgentTransactionPinStatus,
  setAgentTransactionPin,
  verifyAgentTransactionPin,
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

  describe('POST /agents/cash-to-cash/claim binding (Cash→Cash Claim Assist)', () => {
    test('sends exact contract body with credentials and preserveSessionOn401', async () => {
      const claimRes = {
        status: 'COMPLETED',
        transferId: 'c2c-transfer-uuid',
        journalId: 'journal-uuid',
        beneficiaryPhone: '8012345678',
        principalMinor: '450000',
        currency: 'NGN',
        amountMinor: '450000',
        claimantCustomerId: 'cust-claimant-uuid',
        idempotencyKey: 'c2c-claim-key-1',
        requestHash: 'hash-claim-1',
        replayed: false,
        reference: 'CASH_TO_CASH_CLAIM-c2c-claim-key-1',
        claimedAt: '2026-10-02T12:00:00.000Z',
      };
      mockClient.post.mockResolvedValue(claimRes);

      const out = await agentCashToCashClaim({
        transferId: 'c2c-transfer-uuid',
        beneficiaryPhone: '8012345678',
        transferCode: '87654321',
        customerId: 'cust-claimant-uuid',
        mfaChallengeId: 'mfa-challenge-uuid',
        otp: '123456',
        idempotencyKey: 'c2c-claim-key-1',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/cash-to-cash/claim',
        {
          transferId: 'c2c-transfer-uuid',
          beneficiaryPhone: '8012345678',
          transferCode: '87654321',
          customerId: 'cust-claimant-uuid',
          mfaChallengeId: 'mfa-challenge-uuid',
          otp: '123456',
          idempotencyKey: 'c2c-claim-key-1',
        },
        { idempotencyKey: 'c2c-claim-key-1', preserveSessionOn401: true },
      );
      expect(out.status).toBe('COMPLETED');
      expect(out.principalMinor).toBe('450000');
    });

    test('describeCashToCashClaimError maps all server responses correctly', () => {
      expect(describeCashToCashClaimError(new ApiError('Transfer code invalid', 401))).toBe(
        'Transfer code is invalid. Check the code and try again.',
      );
      expect(describeCashToCashClaimError(new ApiError('Transfer code locked', 403))).toBe(
        'Transfer code is locked due to too many failed attempts.',
      );
      expect(describeCashToCashClaimError(new ApiError('Claimant identity not verified', 403))).toBe(
        'Beneficiary identity is not verified. KYC approval or identity document is required.',
      );
      expect(describeCashToCashClaimError(new ApiError('Transfer has expired', 409))).toBe(
        'This Cash→Cash transfer has expired and cannot be claimed.',
      );
      expect(describeCashToCashClaimError(new ApiError('Transfer already claimed', 409))).toBe(
        'This Cash→Cash transfer has already been claimed.',
      );
      expect(describeCashToCashClaimError(new ApiError('OTP invalid: MISMATCH', 400))).toBe(
        'Customer verification code (OTP) is invalid. Check the code and try again.',
      );
      expect(describeCashToCashClaimError(new ApiError('OTP expired', 400))).toBe(
        'Customer verification code has expired. Request a new code.',
      );
      expect(describeCashToCashClaimError(new ApiError('Beneficiary phone does not match', 400))).toBe(
        'Beneficiary phone number does not match this transfer.',
      );
      expect(describeCashToCashClaimError(new ApiError('Transfer not found', 404))).toBe(
        'Cash→Cash transfer not found. Check the transfer ID and beneficiary phone.',
      );
      expect(describeCashToCashClaimError(new ApiError('Generic 400 error', 400))).toBe(
        'Generic 400 error',
      );
    });
  });

  describe('Agent Transaction PIN Management API bindings (V1-AGENT-MOBILE-10)', () => {
    test('getAgentTransactionPinStatus: calls GET /agents/me/transaction-pin', async () => {
      const statusFixture = {
        status: 'ACTIVE',
        exists: true,
        accountLocked: false,
        pinVersion: 1,
        lastChangedAt: '2026-09-01T00:00:00.000Z',
      };
      mockClient.get.mockResolvedValue(statusFixture);

      const out = await getAgentTransactionPinStatus();

      expect(mockClient.get).toHaveBeenCalledWith('api/v1/agents/me/transaction-pin');
      expect(out.status).toBe('ACTIVE');
      expect(out.exists).toBe(true);
    });

    test('setAgentTransactionPin: calls POST /agents/me/transaction-pin with preserveSessionOn401', async () => {
      const setResult = {
        agentId: 'a-1',
        pinVersion: 1,
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
      mockClient.post.mockResolvedValue(setResult);

      const out = await setAgentTransactionPin('1234', '1234');

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/me/transaction-pin',
        { pin: '1234', pinConfirmation: '1234' },
        { preserveSessionOn401: true },
      );
      expect(out.pinVersion).toBe(1);
    });

    test('verifyAgentTransactionPin: calls POST /agents/me/transaction-pin/verify with preserveSessionOn401', async () => {
      const verifyResult = { verified: true };
      mockClient.post.mockResolvedValue(verifyResult);

      const out = await verifyAgentTransactionPin('1234');

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/me/transaction-pin/verify',
        { pin: '1234' },
        { preserveSessionOn401: true },
      );
      expect(out.verified).toBe(true);
    });

    test('describeTransactionPinError: maps errors to safe user-friendly messages', () => {
      expect(describeTransactionPinError(new ApiError('Invalid PIN format', 401))).toBe(
        'Invalid PIN format. PIN must be 4 to 12 numeric digits.',
      );
      expect(describeTransactionPinError(new ApiError('Unauthorized', 401))).toBe(
        'Incorrect transaction PIN. Check the PIN and try again.',
      );
      expect(describeTransactionPinError(new ApiError('PIN is locked', 403))).toBe(
        'Transaction PIN is locked due to too many failed attempts.',
      );
      expect(describeTransactionPinError(new ApiError('Forbidden', 403))).toBe(
        'You are not permitted to manage transaction PIN on this account.',
      );
      expect(describeTransactionPinError(new ApiError('Custom 400 error', 400))).toBe(
        'Custom 400 error',
      );
      expect(describeTransactionPinError(new ApiError('Internal Error', 500))).toBe(
        'The service is temporarily unavailable. Please retry.',
      );
      expect(describeTransactionPinError(new NetworkError('failed'))).toBe(
        'No network connection. Check your connection and retry.',
      );
      expect(describeTransactionPinError(new Error('Local error message'))).toBe(
        'Local error message',
      );
    });
  });

  describe('Agent Support Ticket API bindings (V1-AGENT-MOBILE-11)', () => {
    test('getAgentSupportTickets: calls GET /agents/me/support/tickets with pagination', async () => {
      const listRes = {
        items: [{ id: 'sup-1', reference: 'SUP-1', subject: 'Help', status: 'OPEN' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
      };
      mockClient.get.mockResolvedValue(listRes);

      const out = await getAgentSupportTickets(1, 20);

      expect(mockClient.get).toHaveBeenCalledWith('api/v1/agents/me/support/tickets?page=1&limit=20');
      expect(out.items).toHaveLength(1);
    });

    test('getAgentSupportTicket: calls GET /agents/me/support/tickets/:id', async () => {
      const ticketRes = { id: 'sup-1', reference: 'SUP-1', subject: 'Help', status: 'OPEN' };
      mockClient.get.mockResolvedValue(ticketRes);

      const out = await getAgentSupportTicket('sup-1');

      expect(mockClient.get).toHaveBeenCalledWith('api/v1/agents/me/support/tickets/sup-1');
      expect(out.id).toBe('sup-1');
    });

    test('createAgentSupportTicket: calls POST /agents/me/support/tickets with idempotency header', async () => {
      const createdRes = { id: 'sup-new', reference: 'SUP-new', subject: 'Help', status: 'OPEN' };
      mockClient.post.mockResolvedValue(createdRes);

      const out = await createAgentSupportTicket({
        subject: 'Help Needed',
        category: 'TERMINAL',
        description: 'POS malfunctioning',
        priority: 'HIGH',
        idempotencyKey: 'idemp-sup-1',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/me/support/tickets',
        {
          subject: 'Help Needed',
          category: 'TERMINAL',
          description: 'POS malfunctioning',
          priority: 'HIGH',
        },
        { idempotencyKey: 'idemp-sup-1' },
      );
      expect(out.id).toBe('sup-new');
    });

    test('getAgentSupportTicketMessages: calls GET /agents/me/support/tickets/:id/messages', async () => {
      const messagesRes = [{ id: 'm-1', ticketId: 'sup-1', body: 'Msg' }];
      mockClient.get.mockResolvedValue(messagesRes);

      const out = await getAgentSupportTicketMessages('sup-1');

      expect(mockClient.get).toHaveBeenCalledWith('api/v1/agents/me/support/tickets/sup-1/messages');
      expect(out).toHaveLength(1);
    });

    test('createAgentSupportTicketMessage: calls POST /agents/me/support/tickets/:id/messages', async () => {
      const msgRes = { id: 'm-new', ticketId: 'sup-1', body: 'Reply' };
      mockClient.post.mockResolvedValue(msgRes);

      const out = await createAgentSupportTicketMessage('sup-1', 'Reply body');

      expect(mockClient.post).toHaveBeenCalledWith(
        'api/v1/agents/me/support/tickets/sup-1/messages',
        { body: 'Reply body' },
      );
      expect(out.id).toBe('m-new');
    });

    test('describeSupportError: maps errors to safe user-friendly messages', () => {
      expect(describeSupportError(new ApiError('Unauthorized', 401))).toBe(
        'Your session has expired. Please log in again.',
      );
      expect(describeSupportError(new ApiError('Forbidden', 403))).toBe(
        'You are not permitted to perform this support action.',
      );
      expect(describeSupportError(new ApiError('Not Found', 404))).toBe(
        'The requested support ticket was not found.',
      );
      expect(describeSupportError(new ApiError('Conflict', 409))).toBe(
        'This support request cannot be processed in its current state.',
      );
      expect(describeSupportError(new ApiError('subject must be 3 to 200 characters', 400))).toBe(
        'subject must be 3 to 200 characters',
      );
      expect(describeSupportError(new ApiError('Internal Error', 500))).toBe(
        'The service is temporarily unavailable. Please retry.',
      );
      expect(describeSupportError(new NetworkError('failed'))).toBe(
        'No network connection. Check your connection and retry.',
      );
      expect(describeSupportError(new Error('Local error message'))).toBe(
        'Local error message',
      );
    });
  });
});
