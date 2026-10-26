import { useAuthStore } from '../src/store/auth-store';
import { AGENT_SESSION_KEYS } from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import * as agentApi from '../src/services/agent-api';
import {
  savePendingAgentOperation,
  loadPendingAgentOperation,
  clearAllPendingAgentOperations,
  type PendingAgentOperation,
} from '../src/services/pending-operation';

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

  test('logout does NOT clear an ambiguous pending agent operation (V1-MOBILE-REAL-WORLD-VALIDATION-01)', async () => {
    // V1-MOBILE-REAL-WORLD-VALIDATION-01 PART 16: logout previously called
    // clearAllPendingAgentOperations(agentId) unconditionally, which discarded a pending
    // Cash-In/Cash-Out/Cash-to-Cash-send record even when it existed BECAUSE the last attempt
    // was AMBIGUOUS (every definitive outcome already clears it immediately — see the confirm
    // screens' save-before-send / clear-on-definitive-outcome pattern). That opened a
    // duplicate-financial-effect path: ambiguous failure -> Agent logs out -> logs back in as
    // the SAME Agent -> retries the SAME operation -> a brand-new Idempotency-Key is minted
    // because the old one was wiped -> if the original ambiguous request had actually already
    // committed server-side (these three flows have no independent business-level duplicate
    // guard), a SECOND financial effect occurs. The record's storage key is already scoped by
    // agentId AND operationType (storageKeyFor in pending-operation.ts), so a different Agent
    // logging into this device could never read or collide with it regardless of whether
    // logout clears it — clearing it provided no real isolation benefit while actively
    // destroying the retry-safety net. Logout must still clear all session/credential storage;
    // it must NOT clear this Agent's pending operation record.
    const session = sessionFixture();
    await SecureStorage.set(AGENT_SESSION_KEYS.token, session.accessToken);
    useAuthStore.setState({ isAuthenticated: true, session, agentId: session.agentId });
    mockedApi.agentLogout.mockResolvedValue({ revoked: true });

    const pending: PendingAgentOperation = {
      agentId: session.agentId,
      operationType: 'CASH_IN',
      idempotencyKey: 'ambiguous-op-key-1',
      counterpartyId: 'customer-uuid-1',
      amountMinor: '500000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    };
    await savePendingAgentOperation(pending);

    await useAuthStore.getState().logout();

    // Session/credential storage IS cleared by logout...
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
    // ...but the ambiguous pending operation survives logout, unchanged, so the SAME Agent
    // logging back in can still safely resume/match it instead of minting a fresh key.
    const survived = await loadPendingAgentOperation(session.agentId, 'CASH_IN');
    expect(survived).toEqual(pending);

    // A DIFFERENT Agent logging into this device still cannot see it — pure function of the
    // agentId-scoped storage key, independent of the logout change above.
    const otherAgentView = await loadPendingAgentOperation('a-totally-different-agent-id', 'CASH_IN');
    expect(otherAgentView).toBeNull();

    await clearAllPendingAgentOperations(session.agentId);
  });
});
