import { SecureStorage } from './secure-storage';
import { DEFAULT_BASE_URL } from '../config';

export interface ApiClientOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * Step-up PIN or password verification endpoints return 401 when the submitted
   * PIN/password is wrong while the customer's bearer session remains valid.
   * Those rejections must not wipe the active session token.
   */
  preserveSessionOn401?: boolean;
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

let currentBaseUrl = DEFAULT_BASE_URL;
const sessionExpiredListeners = new Set<() => void>();

export const setBaseUrl = (url: string) => {
  currentBaseUrl = url.replace(/\/+$/, '');
};

export const getBaseUrl = () => currentBaseUrl;

export const onCustomerSessionExpired = (listener: () => void): (() => void) => {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
};

/**
 * Normalizes customer API URLs against NestJS `app.setGlobalPrefix('api/v1')`.
 * Supports both bare-origin `DEFAULT_BASE_URL` / `EXPO_PUBLIC_API_URL` values
 * (`http://10.0.2.2:3000`, `https://api.example.com`) and pre-prefixed
 * `EXPO_PUBLIC_API_BASE_URL` values (`https://api.example.com/api/v1`) without
 * double-prefixing `/api/v1`.
 */
export function resolveCustomerApiUrl(baseUrl: string, endpoint: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const baseHasV1Prefix = /\/api\/v1$/i.test(cleanBase);
  const endpointHasV1Prefix = /^api\/v1(?:\/|$)/i.test(cleanEndpoint);

  if (baseHasV1Prefix && endpointHasV1Prefix) {
    const stripped = cleanEndpoint.replace(/^api\/v1\/?/i, '');
    return stripped ? `${cleanBase}/${stripped}` : cleanBase;
  }
  if (baseHasV1Prefix || endpointHasV1Prefix) {
    return `${cleanBase}/${cleanEndpoint}`;
  }
  return `${cleanBase}/api/v1/${cleanEndpoint}`;
}

function isStepUpOrLogin401(endpoint: string, normalizedMessage: string): boolean {
  const cleanPath = endpoint
    .replace(/^\/+/, '')
    .replace(/^api\/v1\/+/i, '')
    .split('?')[0];
  if (cleanPath === 'customers/sessions' || cleanPath === 'customers/sessions/logout') {
    return true;
  }
  const lower = normalizedMessage.toLowerCase();
  return (
    /\bpin\b/.test(lower) ||
    lower.includes('current password is incorrect') ||
    lower.includes('invalid credentials')
  );
}

async function purgeExpiredCustomerSession(notifyListeners: boolean): Promise<void> {
  await SecureStorage.remove('auth_session_token');
  await SecureStorage.remove('auth_customer_id');
  await SecureStorage.remove('auth_session_data');
  // Deliberately preserve `pending_wallet_transfer_intent:<customerId>` so an
  // ambiguous transfer recovery intent survives re-authentication.
  if (notifyListeners) {
    sessionExpiredListeners.forEach((listener) => listener());
  }
}

export async function request<T>(endpoint: string, options: ApiClientOptions = {}): Promise<T> {
  if (!currentBaseUrl) {
    // No silent fallback: a build without EXPO_PUBLIC_API_BASE_URL must fail loudly instead of
    // sending credentials or money movements to an unintended host.
    throw new NetworkError(
      'API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.',
    );
  }
  const url = resolveCustomerApiUrl(currentBaseUrl, endpoint);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Dynamically load the customer auth session token
  const token = await SecureStorage.get('auth_session_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Inject explicit financial idempotency keys for write operations (POST, PATCH, PUT)
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

    // Parse response body if present
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

      const normalizedMessage = Array.isArray(message) ? message.join(', ') : String(message);

      // Purge stored bearer session only when an authenticated bearer session was rejected,
      // never when a step-up Transaction PIN or password check returns 401.
      if (
        status === 401 &&
        Boolean(token) &&
        !options.preserveSessionOn401 &&
        !isStepUpOrLogin401(endpoint, normalizedMessage)
      ) {
        await purgeExpiredCustomerSession(true);
      }

      throw new ApiError(
        normalizedMessage,
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
