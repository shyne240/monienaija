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
