import { API_BASE_URL } from '../config';

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

export async function request<T>(endpoint: string, options: ApiClientOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}/${endpoint.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const token = localStorage.getItem('admin_workforce_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
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
        localStorage.removeItem('admin_workforce_token');
        localStorage.removeItem('admin_workforce_principal');
        localStorage.removeItem('admin_workforce_session_id');
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

  delete: <T>(endpoint: string, options?: Omit<ApiClientOptions, 'method'>) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};
