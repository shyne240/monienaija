import { SecureStorage } from './secure-storage';
import { DEFAULT_BASE_URL } from '../config';

/**
 * Agent Mobile API client (spec V1-AGENT-MOBILE-01 §4).
 *
 * - Bearer token loaded from secure storage per request (agent session audience).
 * - 401 → the stored agent session is purged and the app must return to login.
 * - `idempotency-key` header support for financial writes (later phases).
 * - No secrets/tokens are ever logged.
 */

export interface ApiClientOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    public override readonly message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly validationErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export const AGENT_SESSION_KEYS = {
  token: 'agent_session_token',
  agentId: 'agent_id',
  sessionData: 'agent_session_data',
} as const;

export async function purgeAgentSessionFromStorage(): Promise<void> {
  await SecureStorage.remove(AGENT_SESSION_KEYS.token);
  await SecureStorage.remove(AGENT_SESSION_KEYS.agentId);
  await SecureStorage.remove(AGENT_SESSION_KEYS.sessionData);
}

let currentBaseUrl = DEFAULT_BASE_URL;

export const setBaseUrl = (url: string) => {
  currentBaseUrl = url.replace(/\/$/, '');
};

export const getBaseUrl = () => currentBaseUrl;

export async function request<T>(endpoint: string, options: ApiClientOptions = {}): Promise<T> {
  const url = `${currentBaseUrl}/${endpoint.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const token = await SecureStorage.get(AGENT_SESSION_KEYS.token);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.idempotencyKey && ['POST', 'PATCH', 'PUT'].includes(options.method || '')) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const config: RequestInit = {
    method: options.method || 'GET',
    headers,
    signal: options.signal,
  };

  if (options.body !== undefined) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);

    let data: any = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      if (text) {
        data = { message: text };
      }
    }

    if (!response.ok) {
      const status = response.status;
      const message = data?.message || `Request failed with status ${status}`;
      const code = data?.code || data?.error || 'UNKNOWN_ERROR';
      const validationErrors = data?.validationErrors || data?.errors || undefined;

      if (status === 401) {
        // Expired or revoked agent session — fail closed back to login.
        await purgeAgentSessionFromStorage();
      }

      throw new ApiError(
        Array.isArray(message) ? message.join(', ') : String(message),
        status,
        code,
        validationErrors,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new NetworkError(error instanceof Error ? error.message : 'Network request failed');
  }
}

export const ApiClient = {
  get: <T>(endpoint: string, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'POST', body }),

  patch: <T>(endpoint: string, body?: unknown, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'PATCH', body }),

  delete: <T>(endpoint: string, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};
