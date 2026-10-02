import { ApiClient, ApiError, NetworkError } from '../src/services/api-client';
import {
  describeApiError,
  getAgentReceivingNumber,
  getAgentOutlets,
  getAgentTerminals,
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

  describe('describeApiError — user-facing mapping (raw server errors hidden)', () => {
    test('401 → session expired message', () => {
      expect(describeApiError(new ApiError('Unauthorized', 401))).toBe(
        'Your session has expired. Please log in again.',
      );
    });
    test('403 → account-availability message', () => {
      expect(describeApiError(new ApiError('Forbidden', 403))).toBe(
        'This information is not available for your account.',
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
