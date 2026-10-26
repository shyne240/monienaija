import { create } from 'zustand';

import { AGENT_SESSION_KEYS, purgeAgentSessionFromStorage } from '../services/api-client';
import { SecureStorage } from '../services/secure-storage';
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
      // V1-MOBILE-REAL-WORLD-VALIDATION-01: logout deliberately does NOT clear this Agent's
      // pending-operation record. A record only ever exists here because the last attempt
      // ended AMBIGUOUSLY (every definitive outcome — success or a 4xx rejection — already
      // clears it immediately; see pending-operation.ts call sites). Discarding it on logout
      // previously meant: ambiguous Cash-In/Cash-Out/Cash-to-Cash-send failure -> Agent logs
      // out (e.g. to retry the app) -> logs back in as the SAME Agent -> re-submits the SAME
      // operation -> a brand-new Idempotency-Key is minted because the old one was wiped ->
      // if the original ambiguous request had actually already committed server-side, this
      // creates a SECOND, duplicate financial effect (these three flows have no independent
      // business-level duplicate guard — the persisted Idempotency-Key is the only thing
      // preventing this). The storage key is already scoped by `agentId`
      // (`pending_agent_operation:<agentId>:<type>`, see storageKeyFor() in
      // pending-operation.ts), so a DIFFERENT Agent signing into this device can never read or
      // collide with this record regardless of whether logout clears it — clearing on logout
      // was removing real retry-safety for no actual isolation benefit. The 24-hour staleness
      // window (MAX_PENDING_AGE_MS) still bounds how long an unresolved record can ever be
      // resumed, logout or not. See docs/V1/V1-MOBILE-REAL-WORLD-VALIDATION-01.md Part 16.
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
