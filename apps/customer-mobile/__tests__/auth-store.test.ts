import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
    get: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../src/services/secure-storage', () => ({
  SecureStorage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL backend session contract:
 *   POST /customers/sessions         { identifier, password }
 *     -> { accessToken, tokenType, expiresAt, customerId, sessionId }
 *     -> or { rotationRequired: true, customerId } (no session issued)
 *   POST /customers/sessions/logout  (Bearer token only, no body)
 *
 * The previous version of this test asserted a fabricated
 * `{ authenticated, session }` response shape that the backend has never
 * returned. That made a real authentication bug look like a passing test.
 */
describe('Auth Store (Zustand) tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      customerId: null,
      error: null,
      rotationRequired: false,
    });
  });

  test('should have initial state correctly configured', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.customerId).toBeNull();
  });

  test('should handle login successfully and write to SecureStorage', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      customerId: 'cust-id-999',
      sessionId: 'session-123',
    });

    await useAuthStore.getState().login('08012345678', 'secure-pin-123');

    expect(ApiClient.post).toHaveBeenCalledWith('/customers/sessions', {
      identifier: '08012345678',
      password: 'secure-pin-123',
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.customerId).toBe('cust-id-999');
    expect(state.session?.accessToken).toBe('test-token');

    expect(SecureStorage.set).toHaveBeenCalledWith('auth_session_token', 'test-token');
    expect(SecureStorage.set).toHaveBeenCalledWith('auth_customer_id', 'cust-id-999');
  });

  test('should surface rotationRequired without fabricating a session', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      rotationRequired: true,
      customerId: 'cust-id-999',
    });

    await useAuthStore.getState().login('08012345678', 'temp-password');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.rotationRequired).toBe(true);
    expect(state.error).toBeTruthy();
  });

  test('should fail closed when the backend omits required session data', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({});

    await expect(useAuthStore.getState().login('08012345678', 'secure-pin-123')).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
  });

  test('should restore session from SecureStorage correctly', async () => {
    const mockSessionData = {
      accessToken: 'saved-token',
      sessionId: 'session-777',
      expiresAt: new Date(Date.now() + 100000).toISOString(),
      customerId: 'cust-id-888',
      audience: 'customer-api',
    };

    (SecureStorage.get as jest.Mock).mockImplementation((key) => {
      if (key === 'auth_session_token') return Promise.resolve('saved-token');
      if (key === 'auth_customer_id') return Promise.resolve('cust-id-888');
      if (key === 'auth_session_data') return Promise.resolve(JSON.stringify(mockSessionData));
      return Promise.resolve(null);
    });

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.customerId).toBe('cust-id-888');
    expect(state.session?.accessToken).toBe('saved-token');
  });

  test('should handle logout correctly without re-sending the token in the body', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      session: {
        accessToken: 'saved-token',
        sessionId: 'session-777',
        expiresAt: new Date().toISOString(),
        customerId: 'cust-id-888',
        audience: 'customer-api',
      },
      customerId: 'cust-id-888',
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ revoked: true });

    await useAuthStore.getState().logout();

    expect(ApiClient.post).toHaveBeenCalledWith('/customers/sessions/logout');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.customerId).toBeNull();

    expect(SecureStorage.remove).toHaveBeenCalledWith('auth_session_token');
    expect(SecureStorage.remove).toHaveBeenCalledWith('auth_customer_id');
  });
});
