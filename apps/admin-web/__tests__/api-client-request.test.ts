jest.mock('../src/config', () => ({
  API_BASE_URL: 'https://admin-api.example.com/api/v1',
  DEV_AUTH_MOCK: false,
  DEFAULT_INTERNAL_AUDIENCE: 'workforce-admin',
}));

import { ApiClient } from '../src/services/api-client';

describe('Admin Web API client requests', () => {
  const storage: Record<string, string> = { admin_workforce_token: 'workforce-token-123' };
  const fetchSpy = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok' }),
    });
    Object.defineProperty(global, 'fetch', { value: fetchSpy, writable: true });
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
      writable: true,
    });
  });

  it('calls the configured absolute URL with the workforce bearer token', async () => {
    await ApiClient.get('/internal/version');

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://admin-api.example.com/api/v1/internal/version',
    );
    const init = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['Authorization']).toBe('Bearer workforce-token-123');
  });
});
