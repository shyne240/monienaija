import { ApiClient, ApiError, NetworkError, AGENT_SESSION_KEYS, setBaseUrl, getBaseUrl } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

describe('Agent Mobile API client', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
    setBaseUrl('http://10.0.2.2:3000');
  });

  const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  test('sends Authorization Bearer from secure storage on each request', async () => {
    await SecureStorage.set(AGENT_SESSION_KEYS.token, 'agent-token-abc');
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await ApiClient.get('api/v1/agents/me');

    const [, config] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((config.headers as Record<string, string>).Authorization).toBe('Bearer agent-token-abc');
    await SecureStorage.remove(AGENT_SESSION_KEYS.token);
  });

  test('omits Authorization when no session exists (public endpoints)', async () => {
    await SecureStorage.remove(AGENT_SESSION_KEYS.token);
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await ApiClient.post('api/v1/agents/sessions', { agentId: 'x', password: 'y' });

    const [, config] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('injects idempotency-key header on POST when provided', async () => {
    await SecureStorage.remove(AGENT_SESSION_KEYS.token);
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true }));

    await ApiClient.post('api/v1/agents/cash-in', { any: true }, { idempotencyKey: 'idem-123' });

    const [, config] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((config.headers as Record<string, string>)['idempotency-key']).toBe('idem-123');
  });

  test('401 purges the stored agent session (fail-closed back to login)', async () => {
    await SecureStorage.set(AGENT_SESSION_KEYS.token, 'stale-token');
    await SecureStorage.set(AGENT_SESSION_KEYS.sessionData, '{"x":1}');
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'expired' }));

    await expect(ApiClient.get('api/v1/agents/me')).rejects.toMatchObject({ status: 401 });

    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.sessionData)).toBeNull();
  });

  test('maps backend errors to ApiError with status/code and never throws tokens', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { message: 'Credential rotation is not pending', code: 'FORBIDDEN' }),
    );

    const promise = ApiClient.post('api/v1/agents/credentials/rotate', {});
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  test('network failures map to NetworkError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(ApiClient.get('api/v1/agents/me')).rejects.toBeInstanceOf(NetworkError);
  });

  test('base URL is configurable and trailing slashes are normalized', () => {
    setBaseUrl('http://192.168.1.50:3000/');
    expect(getBaseUrl()).toBe('http://192.168.1.50:3000');
  });
});
