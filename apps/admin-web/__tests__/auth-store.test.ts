import { useAuthStore } from '../src/store/auth-store';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
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

describe('Admin Web Auth Store (Zustand) Tests', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = {};
    
    // Stub localStorage
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, value: string) => { mockStorage[key] = value; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { mockStorage = {}; },
      },
      writable: true,
    });

    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      token: null,
      sessionId: null,
      principal: null,
      error: null,
    });
  });

  test('should have initial state correctly configured', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
  });

  test('should authenticate with email/password against the real backend endpoint and cache the session', async () => {
    const mockSessionResponse = {
      accessToken: 'local-admin-bearer-123',
      tokenType: 'Bearer',
      sessionId: 'local-admin-session-123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      principal: {
        type: 'PRIVILEGED',
        principalId: 'https://local-dev-identity.monienaija.invalid:mock-sandbox-subject',
        sessionId: 'local-admin-session-123',
        audience: 'workforce-admin',
        roles: ['FINANCE_ADMIN', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'],
        scopes: ['privileged:execute', 'finance:prepare', 'privileged:approve', 'finance:audit'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    };

    (ApiClient.post as jest.Mock).mockResolvedValue(mockSessionResponse);

    await useAuthStore.getState().loginWithPassword('admin@monienaija.local', 'MonieNaijaAdmin123!');

    expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/local-admin-sessions', {
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('local-admin-bearer-123');
    expect(state.principal?.roles).toContain('FINANCE_ADMIN');
    expect(localStorage.getItem('admin_workforce_token')).toBe('local-admin-bearer-123');
  });

  test('should surface a clear error and never fabricate a session when credentials are rejected', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Invalid local administrator credentials', 401),
    );

    await expect(
      useAuthStore.getState().loginWithPassword('admin@monienaija.local', 'wrong-password'),
    ).rejects.toThrow('Invalid local administrator credentials');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.error).toBe('Invalid local administrator credentials');
    expect(localStorage.getItem('admin_workforce_token')).toBeNull();
  });

  test('should never fabricate a client-side session when the real OIDC endpoint is unreachable', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('Failed to fetch', 0));

    await expect(useAuthStore.getState().login('some-oidc-token')).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.principal).toBeNull();
  });

  test('should exchange OIDC assertion successfully and cache to localStorage', async () => {
    const mockSessionResponse = {
      accessToken: 'workforce-bearer-777',
      tokenType: 'Bearer',
      sessionId: 'sess-uuid-777',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:subject-999',
        sessionId: 'sess-uuid-777',
        roles: ['FINANCE_PREPARER'],
        scopes: ['finance:prepare'],
      },
    };

    (ApiClient.post as jest.Mock).mockResolvedValue(mockSessionResponse);

    await useAuthStore.getState().login('compact-oidc-assertion-jws');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('workforce-bearer-777');
    expect(state.principal?.roles).toContain('FINANCE_PREPARER');

    expect(localStorage.getItem('admin_workforce_token')).toBe('workforce-bearer-777');
    expect(localStorage.getItem('admin_workforce_session_id')).toBe('sess-uuid-777');
  });

  test('should consume bootstrap JWS token successfully', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'CONSUMED' });

    await useAuthStore.getState().bootstrap('compact-bootstrap-statement-jws');

    expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/bootstrap', {
      statement: 'compact-bootstrap-statement-jws',
    });
  });

  test('should handle logout cleanly and clear localStorage caches', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: 'bearer-token',
      sessionId: 'sess-id',
      principal: {
        type: 'PRIVILEGED',
        principalId: 'iss:sub',
        sessionId: 'sess-id',
        audience: 'admin',
        roles: ['FINANCE_ADMIN'],
        scopes: [],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    localStorage.setItem('admin_workforce_token', 'bearer-token');

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(localStorage.getItem('admin_workforce_token')).toBeNull();
  });
});
