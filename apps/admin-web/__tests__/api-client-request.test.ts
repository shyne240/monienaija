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
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sets Content-Type application/json only when a JSON body is supplied', async () => {
    await ApiClient.post('/internal/agents/applications/app-1/review');
    const bodylessInit = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(bodylessInit.headers['Content-Type']).toBeUndefined();

    await ApiClient.post('/agents/applications', { applicantReference: 'AGT-001' });
    const jsonInit = fetchSpy.mock.calls[1]?.[1] as { headers: Record<string, string>; body?: string };
    expect(jsonInit.headers['Content-Type']).toBe('application/json');
    expect(jsonInit.body).toBe(JSON.stringify({ applicantReference: 'AGT-001' }));
  });
});
