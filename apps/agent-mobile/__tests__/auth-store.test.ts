import { useAuthStore } from '../src/store/auth-store';
import { AGENT_SESSION_KEYS } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import * as agentApi from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => {
  const actual = jest.requireActual('../src/services/agent-api');
  return {
    ...actual,
    agentLogin: jest.fn(),
    agentRotateCredentials: jest.fn(),
    agentLogout: jest.fn(),
    getAgentMe: jest.fn(),
  };
});

const mockedApi = agentApi as jest.Mocked<typeof agentApi>;

const sessionFixture = (overrides: Partial<agentApi.AgentSession> = {}): agentApi.AgentSession => ({
  accessToken: 'agent-session-token-1',
  tokenType: 'Bearer',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  agentId: '3f99fdc2-1111-4abc-9def-0aaabbbbcccc',
  sessionId: 'session-uuid-1',
  ...overrides,
});

describe('Agent auth store (fail-closed)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await SecureStorage.remove(AGENT_SESSION_KEYS.token);
    await SecureStorage.remove(AGENT_SESSION_KEYS.agentId);
    await SecureStorage.remove(AGENT_SESSION_KEYS.sessionData);
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      agentId: null,
      pendingRotation: null,
      error: null,
    });
  });

  test('login success persists the session and authenticates', async () => {
    const session = sessionFixture();
    mockedApi.agentLogin.mockResolvedValue(session);

    await useAuthStore.getState().login(session.agentId, 'password-123');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.session?.accessToken).toBe(session.accessToken);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBe(session.accessToken);
  });

  test('login failure fails closed: unauthenticated, no session, no mock fallback', async () => {
    mockedApi.agentLogin.mockRejectedValue({ name: 'ApiError', message: 'Invalid credentials', status: 401 });

    await expect(
      useAuthStore.getState().login(sessionFixture().agentId, 'wrong'),
    ).rejects.toBeTruthy();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(state.error).toBeTruthy();
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });

  test('login failure on network error also fails closed (no DEV_AUTH_MOCK exists)', async () => {
    mockedApi.agentLogin.mockRejectedValue(new Error('Network request failed'));

    await expect(useAuthStore.getState().login(sessionFixture().agentId, 'any')).rejects.toBeTruthy();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });

  test('rotationRequired response enters pending-rotation without establishing a session', async () => {
    mockedApi.agentLogin.mockResolvedValue({ rotationRequired: true, agentId: sessionFixture().agentId });

    await useAuthStore.getState().login(sessionFixture().agentId, 'temp-password');

    const state = useAuthStore.getState();
    expect(state.pendingRotation?.agentId).toBe(sessionFixture().agentId);
    expect(state.isAuthenticated).toBe(false);
    expect(state.session).toBeNull();
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });

  test('credential rotation success establishes the first real session and clears pending state', async () => {
    const session = sessionFixture();
    useAuthStore.setState({ pendingRotation: { agentId: session.agentId } });
    mockedApi.agentRotateCredentials.mockResolvedValue(session);

    await useAuthStore.getState().rotateCredentials('temp-password', 'new-password-1');

    expect(mockedApi.agentRotateCredentials).toHaveBeenCalledWith(
      session.agentId,
      'temp-password',
      'new-password-1',
    );
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.pendingRotation).toBeNull();
    expect(state.session?.accessToken).toBe(session.accessToken);
  });

  test('credential rotation failure keeps the user pending and surfaces the error', async () => {
    useAuthStore.setState({ pendingRotation: { agentId: sessionFixture().agentId } });
    mockedApi.agentRotateCredentials.mockRejectedValue({
      name: 'ApiError',
      message: 'Credential rotation is not pending',
      status: 403,
    });

    await expect(
      useAuthStore.getState().rotateCredentials('temp', 'new-password-1'),
    ).rejects.toBeTruthy();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.pendingRotation).not.toBeNull();
    expect(state.error).toBeTruthy();
  });

  test('restoreSession restores a persisted, unexpired session', async () => {
    const session = sessionFixture();
    await SecureStorage.set(AGENT_SESSION_KEYS.token, session.accessToken);
    await SecureStorage.set(AGENT_SESSION_KEYS.sessionData, JSON.stringify(session));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().agentId).toBe(session.agentId);
  });

  test('restoreSession purges an expired session', async () => {
    const expired = sessionFixture({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await SecureStorage.set(AGENT_SESSION_KEYS.token, expired.accessToken);
    await SecureStorage.set(AGENT_SESSION_KEYS.sessionData, JSON.stringify(expired));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });

  test('logout revokes remotely (best-effort) and always clears local state and storage', async () => {
    const session = sessionFixture();
    await SecureStorage.set(AGENT_SESSION_KEYS.token, session.accessToken);
    useAuthStore.setState({ isAuthenticated: true, session });
    mockedApi.agentLogout.mockRejectedValue(new Error('network down'));

    await useAuthStore.getState().logout();

    expect(mockedApi.agentLogout).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().session).toBeNull();
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });
});
