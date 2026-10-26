import { ApiClient, ApiError } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

describe('Admin API client multipart and private-content requests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test('posts FormData without setting Content-Type and includes auth/idempotency headers', async () => {
    localStorage.setItem('admin_workforce_token', 'workforce-test-token');
    const form = new window.FormData();
    form.append('category', 'UTILITY');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 'document-1' }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await expect(
      ApiClient.postForm('/customers/customer-1/proof-of-address', form, {
        idempotencyKey: 'stable-request-key',
      }),
    ).resolves.toEqual({ id: 'document-1' });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/customers/customer-1/proof-of-address');
    expect(request.method).toBe('POST');
    expect(request.body).toBe(form);
    expect(request.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer workforce-test-token',
      'idempotency-key': 'stable-request-key',
    });
    expect((request.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  test('fetches protected content as a Blob with the workforce bearer token', async () => {
    localStorage.setItem('admin_workforce_token', 'workforce-test-token');
    const blob = new Blob(['encrypted-document-after-server-decryption'], {
      type: 'application/pdf',
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await expect(
      ApiClient.getBlob('/customers/customer-1/proof-of-address/document-1/content'),
    ).resolves.toBe(blob);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/customers/customer-1/proof-of-address/document-1/content');
    expect(request.headers).toEqual({
      Accept: 'application/pdf, image/jpeg, image/png',
      Authorization: 'Bearer workforce-test-token',
    });
  });

  test('converts protected-content errors to ApiError and clears expired local sessions', async () => {
    localStorage.setItem('admin_workforce_token', 'expired-token');
    localStorage.setItem('admin_workforce_principal', '{"principalId":"operator-1"}');
    localStorage.setItem('admin_workforce_session_id', 'expired-session');
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Session expired', code: 'UNAUTHORIZED' }),
    } as unknown as Response);

    await expect(ApiClient.getBlob('/private-document')).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem('admin_workforce_token')).toBeNull();
    expect(localStorage.getItem('admin_workforce_principal')).toBeNull();
    expect(localStorage.getItem('admin_workforce_session_id')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().error).toBe(
      'Your workforce session has expired. Please sign in again.',
    );
  });

  test('401 without an active stored session does not overwrite unauthenticated login error state', async () => {
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      token: null,
      sessionId: null,
      principal: null,
      error: null,
    });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Invalid local administrator credentials', code: 'UNAUTHORIZED' }),
    } as unknown as Response);

    await expect(
      ApiClient.post('/internal/a2/workforce/local-admin-sessions', {
        email: 'admin@monienaija.local',
        password: 'wrong',
      }),
    ).rejects.toThrow('Invalid local administrator credentials');
    expect(useAuthStore.getState().error).toBeNull();
  });
});
