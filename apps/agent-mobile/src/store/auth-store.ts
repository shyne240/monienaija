import { create } from 'zustand';

import { AGENT_SESSION_KEYS, purgeAgentSessionFromStorage } from '../services/api-client';
import { SecureStorage } from '../services/secure-storage';
import { clearAllPendingAgentOperations } from '../services/pending-operation';
import {
  agentLogin,
  agentLogout,
  agentRotateCredentials,
  isRotationRequired,
  type AgentSession,
} from '../services/agent-api';

/**
 * Agent Mobile authentication store (spec V1-AGENT-MOBILE-01 §5/§6/§7).
 *
 * Fail-closed agent session model:
 *  - login: POST /agents/sessions. If the backend answers {rotationRequired:true},
 *    NO session is established; the pending-rotation state routes the UI to the
 *    mandatory credential-rotation screen.
 *  - rotation: POST /agents/credentials/rotate returns the first real session —
 *    that establishes the authenticated experience.
 *  - restore: session metadata persisted via expo-secure-store, expiry-checked.
 *  - passwords/PINs/OTPs are NEVER persisted; only {accessToken, sessionId,
 *    expiresAt, agentId} are stored (no credential material).
 */

interface PendingRotation {
  agentId: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: AgentSession | null;
  agentId: string | null;
  pendingRotation: PendingRotation | null;
  error: string | null;
  login: (agentId: string, password: string) => Promise<void>;
  rotateCredentials: (currentPassword: string, newPassword: string) => Promise<void>;
  cancelRotation: () => void;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

async function persistSession(session: AgentSession): Promise<void> {
  await SecureStorage.set(AGENT_SESSION_KEYS.token, session.accessToken);
  await SecureStorage.set(AGENT_SESSION_KEYS.agentId, session.agentId);
  await SecureStorage.set(AGENT_SESSION_KEYS.sessionData, JSON.stringify(session));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  session: null,
  agentId: null,
  pendingRotation: null,
  error: null,

  login: async (agentId: string, password: string) => {
    set({ isLoading: true, error: null, pendingRotation: null });
    try {
      const normalizedAgentId = agentId.trim();
      const result = await agentLogin(normalizedAgentId, password);

      if (isRotationRequired(result)) {
        // Mandatory first-login rotation — no session exists yet by design.
        set({ isLoading: false, pendingRotation: { agentId: result.agentId } });
        return;
      }

      await persistSession(result);
      set({
        isAuthenticated: true,
        isLoading: false,
        session: result,
        agentId: result.agentId,
        pendingRotation: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      set({
        isLoading: false,
        error: message,
        isAuthenticated: false,
        session: null,
        agentId: null,
      });
      throw err;
    }
  },

  rotateCredentials: async (currentPassword: string, newPassword: string) => {
    const pending = get().pendingRotation;
    if (!pending) {
      throw new Error('No credential rotation is pending');
    }
    set({ isLoading: true, error: null });
    try {
      const session = await agentRotateCredentials(pending.agentId, currentPassword, newPassword);
      await persistSession(session);
      set({
        isAuthenticated: true,
        isLoading: false,
        session,
        agentId: session.agentId,
        pendingRotation: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Credential rotation failed';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  cancelRotation: () => set({ pendingRotation: null }),

  logout: async () => {
    set({ isLoading: true });
    const loggedOutAgentId = get().agentId;
    try {
      const session = get().session;
      if (session) {
        try {
          await agentLogout();
        } catch {
          // Best-effort remote revocation; local purge always proceeds.
        }
      }
    } finally {
      await purgeAgentSessionFromStorage();
      // V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-01: a pending operation must never cross an
      // Agent identity boundary — if this device is reused by a different Agent, no stale
      // Idempotency-Key from the previous Agent's session may ever be read or reused.
      if (loggedOutAgentId) {
        await clearAllPendingAgentOperations(loggedOutAgentId);
      }
      set({
        isAuthenticated: false,
        isLoading: false,
        session: null,
        agentId: null,
        pendingRotation: null,
        error: null,
      });
    }
  },

  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const token = await SecureStorage.get(AGENT_SESSION_KEYS.token);
      const sessionDataStr = await SecureStorage.get(AGENT_SESSION_KEYS.sessionData);

      if (token && sessionDataStr) {
        const session = JSON.parse(sessionDataStr) as AgentSession;
        const expiresAt = new Date(session.expiresAt);
        if (expiresAt.getTime() > Date.now()) {
          set({
            isAuthenticated: true,
            session,
            agentId: session.agentId,
          });
        } else {
          await purgeAgentSessionFromStorage();
        }
      }
    } catch {
      // Corrupt/unreadable stored session — fail closed (treated as logged out).
    } finally {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
