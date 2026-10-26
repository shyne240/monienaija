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
  rotationRequired: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

/**
 * V1-CUSTOMER-02 — login is wired to the real, hardened backend session
 * contract (`POST /customers/sessions`, see `CustomerAppController.login`
 * and `docs/V1/A23-CUSTOMER-APP-CONTRACT.md`). There is no mock/sandbox
 * authentication fallback: an authentication failure is always a real
 * failure, never a locally-fabricated session. This app never mints its
 * own bearer tokens.
 */
export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  session: null,
  customerId: null,
  error: null,
  rotationRequired: false,

  login: async (identifier: string, password: string) => {
    set({ isLoading: true, error: null, rotationRequired: false });
    try {
      const trimmedIdentifier = identifier.trim();

      const response = await ApiClient.post<{
        rotationRequired?: boolean;
        customerId?: string;
        accessToken?: string;
        tokenType?: string;
        expiresAt?: string;
        sessionId?: string;
      }>('/customers/sessions', { identifier: trimmedIdentifier, password });

      if (response.rotationRequired) {
        // Workforce-issued temporary credential: no session is issued yet.
        // The customer must rotate the credential before a real session can
        // exist (see `POST /customers/credentials/rotate`). This app does not
        // yet implement a rotation screen; surface the true backend state
        // rather than fabricating a session.
        set({
          isLoading: false,
          rotationRequired: true,
          error: 'Your temporary password must be changed before you can sign in. Credential rotation is not yet supported in this app version.',
        });
        return;
      }

      if (!response.accessToken || !response.customerId) {
        throw new Error('Authentication response was missing required session data');
      }

      const sessionData: UserSession = {
        accessToken: response.accessToken,
        sessionId: response.sessionId ?? '',
        expiresAt: response.expiresAt ?? new Date(Date.now() + 3600 * 1000).toISOString(),
        customerId: response.customerId,
        audience: 'customer-api',
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
          // Bearer token is attached automatically by ApiClient from SecureStorage;
          // never send the raw access token in a request body.
          await ApiClient.post('/customers/sessions/logout');
        } catch {
          // Best-effort server-side revocation; local session is cleared regardless.
        }
      }
    } finally {
      await SecureStorage.remove('auth_session_token');
      await SecureStorage.remove('auth_customer_id');
      await SecureStorage.remove('auth_session_data');
      // V1-MOBILE-REAL-WORLD-VALIDATION-01: logout deliberately does NOT clear this customer's
      // pending Wallet-to-Wallet transfer intent. A pending intent only ever exists because the
      // last attempt ended AMBIGUOUSLY (every definitive outcome — success or a 4xx rejection —
      // already clears it immediately in SendMoneyScreen). Discarding it on logout previously
      // meant: ambiguous transfer failure -> customer logs out -> logs back in as the SAME
      // customer -> re-submits the SAME transfer -> a brand-new Idempotency-Key is minted
      // because the old one was wiped -> if the original ambiguous request had actually already
      // committed server-side, this creates a SECOND, duplicate debit/credit. The storage key
      // is already scoped by `customerId` (`pending_wallet_transfer_intent:<customerId>`, see
      // storageKeyFor() in pending-transfer.ts), so a DIFFERENT customer signing into this
      // device can never read or collide with this record regardless of whether logout clears
      // it — clearing on logout was removing real retry-safety for no actual isolation benefit.
      // The 24-hour staleness window (MAX_PENDING_AGE_MS) still bounds how long an unresolved
      // intent can ever be resumed, logout or not. See
      // docs/V1/V1-MOBILE-REAL-WORLD-VALIDATION-01.md Part 16.
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
