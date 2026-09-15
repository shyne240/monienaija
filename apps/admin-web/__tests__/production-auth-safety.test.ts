import { resolveAdminBuildConfig } from '../src/config/build-config';
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

// Production-like configuration: no mock fallback is available to any code path under test.
jest.mock('../src/config', () => ({
  API_BASE_URL: 'https://admin-api.example.com/api/v1',
  DEV_AUTH_MOCK: false,
  DEFAULT_INTERNAL_AUDIENCE: 'workforce-admin',
}));

describe('Admin Web build configuration', () => {
  it('never enables the dev mock in a production build', () => {
    const production = resolveAdminBuildConfig('production', {
      ADMIN_WEB_DEV_AUTH_MOCK: 'true',
      ADMIN_WEB_API_BASE_URL: 'https://admin-api.example.com/api/v1',
    });

    expect(production.devAuthMock).toBe(false);
  });

  it('requires an explicit opt-in for the dev mock in a development build', () => {
    expect(resolveAdminBuildConfig('development', {}).devAuthMock).toBe(false);
    expect(
      resolveAdminBuildConfig('development', { ADMIN_WEB_DEV_AUTH_MOCK: 'true' }).devAuthMock,
    ).toBe(true);
  });

  it('never invents an API base URL', () => {
    expect(resolveAdminBuildConfig('production', {}).apiBaseUrl).toBe('');
    expect(
      resolveAdminBuildConfig('production', { ADMIN_WEB_API_BASE_URL: '  ' }).apiBaseUrl,
    ).toBe('');
  });
});

describe('Admin Web authentication failure handling', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    storage = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
        clear: () => {
          storage = {};
        },
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

  it.each([401, 403, 404, 405, 500, 503])(
    'does not fabricate a privileged principal when the backend answers %s',
    async (status) => {
      (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('backend failure', status));

      await expect(useAuthStore.getState().login('signed-oidc-assertion')).rejects.toBeInstanceOf(
        ApiError,
      );

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.principal).toBeNull();
      expect(state.token).toBeNull();
      expect(storage).toEqual({});
    },
  );

  it('does not fabricate a privileged principal on a network failure', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await expect(useAuthStore.getState().login('signed-oidc-assertion')).rejects.toThrow(
      'Network request failed',
    );
    expect(useAuthStore.getState().principal).toBeNull();
    expect(storage).toEqual({});
  });

  it('still accepts a real workforce session as the only production path', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      accessToken: 'real-workforce-token',
      tokenType: 'Bearer',
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      principal: {
        type: 'OPERATOR',
        principalId: 'https://issuer.example.com:operator-1',
        sessionId: 'session-1',
        audience: 'workforce-admin',
        roles: ['FINANCE_AUDITOR'],
        scopes: [],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });

    await useAuthStore.getState().login('signed-oidc-assertion');

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().principal?.principalId).toBe(
      'https://issuer.example.com:operator-1',
    );
    expect(storage['admin_workforce_token']).toBe('real-workforce-token');
  });
});
