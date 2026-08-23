import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

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
