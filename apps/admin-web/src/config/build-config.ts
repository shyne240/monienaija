/**
 * Build-time configuration resolution for the Admin Web console.
 *
 * Kept as pure functions so local-development fallback and production-safety rules are
 * unit-testable without booting Vite:
 *
 * - In local development (`vite` dev server: `command === 'serve'`, `mode === 'development'`,
 *   and `NODE_ENV !== 'production'`), an unset `ADMIN_WEB_API_BASE_URL` defaults to the
 *   same-origin relative path `/api/v1`, which Vite's dev-server proxy forwards to the local
 *   backend (`http://127.0.0.1:3000` by default, overridable via `ADMIN_WEB_DEV_PROXY_TARGET`).
 *   An explicit `ADMIN_WEB_API_BASE_URL` always takes precedence when set.
 * - In every static bundle build (`command === 'build'`) and every non-development mode
 *   (`production`, `staging`, or `NODE_ENV=production`), there is NO default API base URL:
 *   an unset `ADMIN_WEB_API_BASE_URL` resolves to `''` so `ApiClient` fails closed instead of
 *   calling an unintended host, and any loopback/localhost `ADMIN_WEB_API_BASE_URL` is rejected
 *   outright so a production bundle can never direct requests to `localhost`.
 * - The development mock flag requires a local development serve session AND an explicit opt-in
 *   (`ADMIN_WEB_DEV_AUTH_MOCK=true`). A production build can never enable it.
 */
export const LOCAL_DEV_DEFAULT_API_BASE_URL = '/api/v1';
export const LOCAL_DEV_DEFAULT_PROXY_TARGET = 'http://127.0.0.1:3000';

export interface AdminBuildConfig {
  apiBaseUrl: string;
  devAuthMock: boolean;
}

export interface AdminBuildConfigOptions {
  command?: 'build' | 'serve';
}

export interface AdminDevProxyEntry {
  target: string;
  changeOrigin: boolean;
}

export function normalizeApiBaseUrl(rawUrl: string | undefined): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

export function isLoopbackApiBaseUrl(apiBaseUrl: string): boolean {
  const normalized = normalizeApiBaseUrl(apiBaseUrl);
  if (!normalized) {
    return false;
  }
  // Single-leading-slash relative paths (e.g. `/api/v1` behind a reverse proxy) are same-origin,
  // not hardcoded loopback hosts. Protocol-relative `//localhost/...` is NOT path-relative.
  if (normalized.startsWith('/') && !normalized.startsWith('//')) {
    return false;
  }

  const candidate = normalized.startsWith('//') ? `http:${normalized}` : normalized;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      return isLoopbackHostname(hostname);
    }
  } catch {
    // Fall through to scheme-less loopback check below.
  }

  return /^(?:localhost|[^/:]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|::1)(?::|\/|$)/i.test(
    normalized,
  );
}

function isLoopbackHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '::' ||
    hostname === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isLocalDevelopmentSession(
  mode: string,
  env: Record<string, string | undefined>,
  options?: AdminBuildConfigOptions,
): boolean {
  const command = options?.command ?? 'serve';
  return command === 'serve' && mode === 'development' && env.NODE_ENV !== 'production';
}

export function resolveAdminBuildConfig(
  mode: string,
  env: Record<string, string | undefined>,
  options?: AdminBuildConfigOptions,
): AdminBuildConfig {
  const configured = normalizeApiBaseUrl(env.ADMIN_WEB_API_BASE_URL);
  const isDevelopmentMode = mode === 'development' && env.NODE_ENV !== 'production';
  const isLocalDevServe = isLocalDevelopmentSession(mode, env, options);

  if (configured && (!isDevelopmentMode || options?.command === 'build') && isLoopbackApiBaseUrl(configured)) {
    throw new Error(
      `Refusing to configure loopback ADMIN_WEB_API_BASE_URL ("${configured}") for non-local-dev Admin Web build (mode="${mode}", command="${options?.command ?? 'serve'}").`,
    );
  }

  const apiBaseUrl = configured || (isLocalDevServe ? LOCAL_DEV_DEFAULT_API_BASE_URL : '');
  const devAuthMock = isLocalDevServe && env.ADMIN_WEB_DEV_AUTH_MOCK === 'true';
  return { apiBaseUrl, devAuthMock };
}

export function resolveAdminDevServerProxy(
  mode: string,
  env: Record<string, string | undefined>,
  options?: AdminBuildConfigOptions,
): Record<string, AdminDevProxyEntry> | undefined {
  if (!isLocalDevelopmentSession(mode, env, options)) {
    return undefined;
  }

  const target = normalizeApiBaseUrl(env.ADMIN_WEB_DEV_PROXY_TARGET) || LOCAL_DEV_DEFAULT_PROXY_TARGET;
  return {
    '/api/v1': {
      target,
      changeOrigin: true,
    },
    '/api': {
      target,
      changeOrigin: true,
    },
  };
}
