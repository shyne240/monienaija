import { create } from 'zustand';
import { ApiClient } from '../services/api-client';

export interface WorkforcePrincipal {
  type: 'PRIVILEGED' | 'OPERATOR';
  principalId: string;
  sessionId: string;
  audience: string;
  roles: string[];
  scopes: string[];
  customerAccess: string;
  assuranceLevel: string;
}

export interface WorkforceSession {
  accessToken: string;
  tokenType: string;
  sessionId: string;
  expiresAt: string;
  principal: WorkforcePrincipal;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  sessionId: string | null;
  principal: WorkforcePrincipal | null;
  error: string | null;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  login: (idToken: string) => Promise<void>;
  bootstrap: (statement: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => void;
  clearError: () => void;
}

function persistSession(set: (partial: Partial<AuthState>) => void, sessionData: WorkforceSession) {
  localStorage.setItem('admin_workforce_token', sessionData.accessToken);
  localStorage.setItem('admin_workforce_session_id', sessionData.sessionId);
  localStorage.setItem('admin_workforce_principal', JSON.stringify(sessionData.principal));

  set({
    isAuthenticated: true,
    isLoading: false,
    token: sessionData.accessToken,
    sessionId: sessionData.sessionId,
    principal: sessionData.principal,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  token: null,
  sessionId: null,
  principal: null,
  error: null,

  // V1-ADMIN-LOCAL-LOGIN-01: the normal Admin Web login path. Authenticates against the
  // real backend's `POST /internal/a2/workforce/local-admin-sessions` endpoint — a LOCAL
  // DEVELOPMENT ONLY route that the backend itself refuses to serve outside
  // NODE_ENV=development/test (see LocalAdminAuthenticationService). This establishes the
  // same real A2 workforce session every other workforce login path produces; there is no
  // client-side session fabrication anywhere in this store.
  loginWithPassword: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const sessionData = await ApiClient.post<WorkforceSession>(
        '/internal/a2/workforce/local-admin-sessions',
        { email: email.trim(), password },
      );
      persistSession(set, sessionData);
    } catch (err: any) {
      set({
        isLoading: false,
        error: err?.message || 'Sign-in failed',
        isAuthenticated: false,
        token: null,
        sessionId: null,
        principal: null,
      });
      throw err;
    }
  },

  // Real OIDC assertion exchange — the production workforce login path. Kept for the
  // engineering-only "Advanced" OIDC panel (see LoginScreen) and for automated contract
  // tests; never presented as the normal operator login. No client-side mock/fallback
  // session is ever fabricated here — a failed exchange is a failed exchange.
  login: async (idToken: string) => {
    set({ isLoading: true, error: null });
    try {
      const sessionData = await ApiClient.post<WorkforceSession>('/internal/a2/workforce/sessions', {
        idToken: idToken.trim(),
      });
      persistSession(set, sessionData);
    } catch (err: any) {
      set({
        isLoading: false,
        error: err?.message || 'Workforce authentication failed',
        isAuthenticated: false,
        token: null,
        sessionId: null,
        principal: null,
      });
      throw err;
    }
  },

  bootstrap: async (statement: string) => {
    set({ isLoading: true, error: null });
    try {
      // Consume bootstrap JWS token: POST /internal/a2/workforce/bootstrap
      await ApiClient.post('/internal/a2/workforce/bootstrap', {
        statement: statement.trim(),
      });
      set({ isLoading: false });
    } catch (err: any) {
      set({ isLoading: false, error: err?.message || 'Bootstrap Statement Consumption Failed' });
      throw err;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      const { sessionId, token } = get();
      if (sessionId && token) {
        try {
          await ApiClient.delete(`/internal/a2/workforce/sessions/${sessionId}`, {
            body: { reason: 'Workforce user initiated logout' },
          });
        } catch {
          // Swallow deletion failure during cleanup
        }
      }
    } finally {
      localStorage.removeItem('admin_workforce_token');
      localStorage.removeItem('admin_workforce_session_id');
      localStorage.removeItem('admin_workforce_principal');

      set({
        isAuthenticated: false,
        isLoading: false,
        token: null,
        sessionId: null,
        principal: null,
        error: null,
      });
    }
  },

  restoreSession: () => {
    try {
      const token = localStorage.getItem('admin_workforce_token');
      const sessionId = localStorage.getItem('admin_workforce_session_id');
      const principalStr = localStorage.getItem('admin_workforce_principal');

      if (token && sessionId && principalStr) {
        const principal = JSON.parse(principalStr) as WorkforcePrincipal;
        set({
          isAuthenticated: true,
          isLoading: false,
          token,
          sessionId,
          principal,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
