import { useAuthStore } from '../src/store/auth-store';
import { ApiClient, ApiError } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
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

describe('Auth Store (Zustand) tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      customerId: null,
      error: null,
    });
  });

  test('should have initial state correctly configured', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.customerId).toBeNull();
  });

  test('should handle login successfully and write to SecureStorage', async () => {
    const mockSession = {
      accessToken: 'test-token',
      sessionId: 'session-123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: 'customer-api',
    };

    (ApiClient.post as jest.Mock).mockResolvedValue({
      authenticated: true,
      session: mockSession,
    });

    await useAuthStore.getState().login('cust-id-999', 'secure-pin-123');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.customerId).toBe('cust-id-999');
    expect(state.session?.accessToken).toBe('test-token');

    expect(SecureStorage.set).toHaveBeenCalledWith('auth_session_token', 'test-token');
    expect(SecureStorage.set).toHaveBeenCalledWith('auth_customer_id', 'cust-id-999');
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

  test('should handle logout correctly', async () => {
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

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.customerId).toBeNull();

    expect(SecureStorage.remove).toHaveBeenCalledWith('auth_session_token');
    expect(SecureStorage.remove).toHaveBeenCalledWith('auth_customer_id');
  });
});

describe('Auth Store real-authentication guarantees', () => {
  const failingStatuses = [401, 403, 404, 405, 500, 503];

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      customerId: null,
      error: null,
    });
  });

  test.each(failingStatuses)(
    'never fabricates a session when the backend answers %s',
    async (status) => {
      (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('backend failure', status));

      await expect(
        useAuthStore.getState().login('cust-id-999', 'secure-pin-123'),
      ).rejects.toBeInstanceOf(ApiError);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.session).toBeNull();
      expect(state.customerId).toBeNull();
      expect(SecureStorage.set).not.toHaveBeenCalled();
    },
  );

  test('never fabricates a session on a network failure', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await expect(
      useAuthStore.getState().login('cust-id-999', 'secure-pin-123'),
    ).rejects.toBeInstanceOf(Error);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(SecureStorage.set).not.toHaveBeenCalled();
  });

  test('never fabricates a session when the backend refuses the credentials', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ authenticated: false });

    await expect(
      useAuthStore.getState().login('cust-id-999', 'wrong-pin'),
    ).rejects.toThrow('Invalid credentials');

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(SecureStorage.set).not.toHaveBeenCalled();
  });

  test('never stores the submitted credential material', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      authenticated: true,
      customerId: 'cust-id-999',
      session: {
        accessToken: 'issued-token',
        sessionId: 'session-1',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        audience: 'customer-api',
      },
    });

    await useAuthStore.getState().login('cust-id-999', 'secure-pin-123');

    for (const [key, value] of (SecureStorage.set as jest.Mock).mock.calls as Array<
      [string, string]
    >) {
      expect(key).not.toMatch(/password|pin/i);
      expect(String(value)).not.toContain('secure-pin-123');
    }
  });

  test('revokes the backend session on logout', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      session: {
        accessToken: 'saved-token',
        sessionId: 'session-777',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        customerId: 'cust-id-888',
        audience: 'customer-api',
      },
      customerId: 'cust-id-888',
    });

    await useAuthStore.getState().logout();

    expect(ApiClient.delete).toHaveBeenCalledWith('/customers/cust-id-888/sessions/current');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
