import { create } from 'zustand';

import { ApiClient } from '../services/api-client';
import { SecureStorage } from '../services/secure-storage';

export interface UserSession {
  accessToken: string;
  sessionId: string;
  expiresAt: string;
  customerId: string;
  audience: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: UserSession | null;
  customerId: string | null;
  error: string | null;
  login: (customerId: string, pinOrPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  session: null,
  customerId: null,
  error: null,

  login: async (customerId: string, pinOrPassword: string) => {
    set({ isLoading: true, error: null });
    try {
      // Clean inputs
      const normalizedCustomerId = customerId.trim().toLowerCase();

      // Real backend credential exchange. There is no mock or fallback session: a 401/403/404/5xx
      // or network failure is surfaced to the caller so authentication can never silently succeed.
      const response = await ApiClient.post<{
        authenticated: boolean;
        customerId: string;
        session: {
          accessToken: string;
          sessionId: string;
          expiresAt: string;
          audience?: string;
        };
      }>(`/customers/${normalizedCustomerId}/authenticate`, { password: pinOrPassword });

      if (!response.authenticated || !response.session?.accessToken) {
        throw new Error('Invalid credentials');
      }

      const sessionData: UserSession = {
        accessToken: response.session.accessToken,
        sessionId: response.session.sessionId,
        expiresAt: response.session.expiresAt,
        customerId: response.customerId || normalizedCustomerId,
        audience: response.session.audience || 'customer-api',
      };

      await SecureStorage.set('auth_session_token', sessionData.accessToken);
      await SecureStorage.set('auth_customer_id', sessionData.customerId);
      await SecureStorage.set('auth_session_data', JSON.stringify(sessionData));

      set({
        isAuthenticated: true,
        isLoading: false,
        session: sessionData,
        customerId: sessionData.customerId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      set({
        isLoading: false,
        error: message,
        isAuthenticated: false,
        session: null,
        customerId: null,
      });
      throw err;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      const session = useAuthStore.getState().session;
      if (session) {
        try {
          // Real backend session revocation; local credentials are always cleared afterwards.
          await ApiClient.delete(`/customers/${session.customerId}/sessions/current`);
        } catch {
          // A failed revoke must not keep the operator signed in locally.
        }
      }
    } finally {
      await SecureStorage.remove('auth_session_token');
      await SecureStorage.remove('auth_customer_id');
      await SecureStorage.remove('auth_session_data');

      set({
        isAuthenticated: false,
        isLoading: false,
        session: null,
        customerId: null,
        error: null,
      });
    }
  },

  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const token = await SecureStorage.get('auth_session_token');
      const customerId = await SecureStorage.get('auth_customer_id');
      const sessionDataStr = await SecureStorage.get('auth_session_data');

      if (token && customerId && sessionDataStr) {
        const sessionData = JSON.parse(sessionDataStr) as UserSession;

        // Verify expiration
        const expiresAt = new Date(sessionData.expiresAt);
        if (expiresAt.getTime() > Date.now()) {
          set({
            isAuthenticated: true,
            session: sessionData,
            customerId: sessionData.customerId,
          });
        } else {
          // Token expired
          await SecureStorage.remove('auth_session_token');
          await SecureStorage.remove('auth_customer_id');
          await SecureStorage.remove('auth_session_data');
        }
      }
    } catch (err) {
      console.warn('Failed to restore session from storage:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
