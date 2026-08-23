import { SecureStorage } from './secure-storage';

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

const DEFAULT_BASE_URL = 'http://10.0.2.2:3000'; // Default Android Emulator host pointing to localhost
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

      // Handle specific HTTP status codes
      if (status === 401) {
        // Expired or revoked session
        await SecureStorage.remove('auth_session_token');
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
