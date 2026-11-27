import { API_BASE_URL } from '../config';

export interface ApiClientOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiRequestOptions {
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

function requestHeaders(contentType?: string, accept = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (contentType) headers['Content-Type'] = contentType;

  const token = localStorage.getItem('admin_workforce_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onWorkforceSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function clearExpiredSession(status: number): void {
  if (status !== 401) return;
  const hadSession = Boolean(
    localStorage.getItem('admin_workforce_token') ||
      localStorage.getItem('admin_workforce_session_id'),
  );
  localStorage.removeItem('admin_workforce_token');
  localStorage.removeItem('admin_workforce_principal');
  localStorage.removeItem('admin_workforce_session_id');
  if (hadSession) {
    sessionExpiredListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Listener errors must never mask API errors.
      }
    });
  }
}

async function readResponseData(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { message: text } : null;
}

function apiErrorFrom(response: Response, data: any): ApiError {
  const message = data?.message || `Request failed with status ${response.status}`;
  const code = data?.code || data?.error || 'UNKNOWN_ERROR';
  const validationErrors = data?.validationErrors || data?.errors || undefined;
  clearExpiredSession(response.status);
  return new ApiError(
    Array.isArray(message) ? message.join(', ') : String(message),
    response.status,
    code,
    validationErrors,
  );
}

function asNetworkError(error: unknown): NetworkError | ApiError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new NetworkError(error instanceof Error ? error.message : 'Network request failed');
}

/** Refuse every request type when the build has no API base URL configured. */
function assertApiBaseUrlConfigured(): void {
  if (!API_BASE_URL) {
    throw new NetworkError(
      'Admin API base URL is not configured. Set ADMIN_WEB_API_BASE_URL for this build.',
    );
  }
}

export async function request<T>(endpoint: string, options: ApiClientOptions = {}): Promise<T> {
  assertApiBaseUrlConfigured();

  const url = `${API_BASE_URL}/${endpoint.replace(/^\//, '')}`;
  const config: RequestInit = {
    method: options.method || 'GET',
    headers: requestHeaders(options.body !== undefined ? 'application/json' : undefined),
    signal: options.signal,
  };

  if (options.idempotencyKey) {
    (config.headers as Record<string, string>)['idempotency-key'] = options.idempotencyKey;
  }
  if (options.body !== undefined) config.body = JSON.stringify(options.body);

  try {
    const response = await fetch(url, config);
    const data = await readResponseData(response);
    if (!response.ok) throw apiErrorFrom(response, data);
    return data as T;
  } catch (error) {
    throw asNetworkError(error);
  }
}

async function requestForm<T>(
  endpoint: string,
  body: FormData,
  options: ApiRequestOptions = {},
): Promise<T> {
  assertApiBaseUrlConfigured();

  const url = `${API_BASE_URL}/${endpoint.replace(/^\//, '')}`;
  const headers = requestHeaders();
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: options.signal,
    });
    const data = await readResponseData(response);
    if (!response.ok) throw apiErrorFrom(response, data);
    return data as T;
  } catch (error) {
    throw asNetworkError(error);
  }
}

async function requestBlob(endpoint: string, options: ApiRequestOptions = {}): Promise<Blob> {
  assertApiBaseUrlConfigured();

  const url = `${API_BASE_URL}/${endpoint.replace(/^\//, '')}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders(undefined, 'application/pdf, image/jpeg, image/png'),
      signal: options.signal,
    });
    if (!response.ok) {
      const data = await readResponseData(response);
      throw apiErrorFrom(response, data);
    }
    return await response.blob();
  } catch (error) {
    throw asNetworkError(error);
  }
}

/**
 * A downloaded file plus the metadata the export UI reports back to the operator: the server's
 * own row count (from `X-Export-Rows`) and export id, so the UI states what the file contains
 * instead of guessing from the current page.
 */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
  /** Rows the server wrote into the file. Null when the server did not state a count. */
  rowCount: number | null;
  exportId: string | null;
  /** Pages in a generated PDF. Null for formats that do not have pages. */
  pageCount?: number | null;
}

function fileNameFrom(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to the ASCII form
    }
  }
  const ascii = /filename="?([^";]+)"?/i.exec(disposition);
  return ascii?.[1] || fallback;
}

/**
 * GET a file and return it with its server-stated metadata.
 *
 * A non-2xx response is read as JSON so the caller sees the real error (for example the export
 * size refusal) rather than an empty download.
 */
async function requestFile(
  endpoint: string,
  accept: string,
  fallbackName: string,
  options: ApiRequestOptions = {},
): Promise<DownloadedFile> {
  assertApiBaseUrlConfigured();

  const url = `${API_BASE_URL}/${endpoint.replace(/^\//, '')}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders(undefined, accept),
      signal: options.signal,
    });
    if (!response.ok) {
      const data = await readResponseData(response);
      throw apiErrorFrom(response, data);
    }
    const stated = Number(response.headers.get('x-export-rows'));
    const statedPages = Number(response.headers.get('x-statement-pages'));
    return {
      blob: await response.blob(),
      fileName: fileNameFrom(response, fallbackName),
      rowCount: Number.isInteger(stated) && stated >= 0 ? stated : null,
      exportId: response.headers.get('x-export-id'),
      pageCount: Number.isInteger(statedPages) && statedPages > 0 ? statedPages : null,
    };
  } catch (error) {
    throw asNetworkError(error);
  }
}

export const ApiClient = {
  get: <T>(endpoint: string, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiClientOptions, 'method' | 'body'>,
  ) => request<T>(endpoint, { ...options, method: 'POST', body }),

  postForm: <T>(endpoint: string, body: FormData, options?: ApiRequestOptions) =>
    requestForm<T>(endpoint, body, options),

  getBlob: (endpoint: string, options?: ApiRequestOptions) => requestBlob(endpoint, options),

  /** Download a CSV report, keeping the server's stated row count and export id. */
  getFile: (endpoint: string, options?: ApiRequestOptions) =>
    requestFile(endpoint, 'text/csv, application/json', 'transaction-history.csv', options),

  /** Download a generated PDF (a wallet statement), keeping the server's stated page count. */
  getPdf: (endpoint: string, options?: ApiRequestOptions) =>
    requestFile(endpoint, 'application/pdf, application/json', 'statement.pdf', options),

  patch: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiClientOptions, 'method' | 'body'>,
  ) => request<T>(endpoint, { ...options, method: 'PATCH', body }),

  put: <T>(endpoint: string, body?: unknown, options?: Omit<ApiClientOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'PUT', body }),

  delete: <T>(endpoint: string, options?: Omit<ApiClientOptions, 'method'>) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};
