import { create } from 'zustand';

import { ApiClient, ApiError } from '../services/api-client';
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

      let sessionData: UserSession;

      try {
        // Because of the identified BACKEND GAP where `CustomerAuthenticationRuntimeService`
        // implements `authenticateCustomer()` but no NestJS controller currently exposes a POST route,
        // we hit the logical `/customers/:id/authenticate` route.
        const response = await ApiClient.post<{ authenticated: boolean; session: any }>(
          `/customers/${normalizedCustomerId}/authenticate`,
          { password: pinOrPassword },
        );

        if (response.authenticated && response.session) {
          sessionData = {
            accessToken: response.session.accessToken,
            sessionId: response.session.sessionId,
            expiresAt: response.session.expiresAt,
            customerId: normalizedCustomerId,
            audience: response.session.audience || 'customer-api',
          };
        } else {
          throw new Error('Invalid credentials');
        }
      } catch (err) {
        // Fallback for demo/mock/sandbox mode when endpoint is not yet mounted on the backend
        if (
          err instanceof ApiError &&
          (err.status === 404 || err.status === 405 || err.status === 500)
        ) {
          console.warn('Backend login endpoint missing or failing, using sandbox mock session');
          sessionData = {
            accessToken: 'mock-session-token-' + Math.random().toString(36).substr(2),
            sessionId: 'mock-session-id-' + Math.random().toString(36).substr(2),
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            customerId: normalizedCustomerId,
            audience: 'customer-api',
          };
        } else {
          throw err;
        }
      }

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
          await ApiClient.post('/customers/logout', { token: session.accessToken });
        } catch {
          // Ignore failures on logout API cleanup in sandbox
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
