/**
 * Admin Web runtime configuration.
 *
 * `__ADMIN_API_BASE_URL__` and `__ADMIN_DEV_AUTH_MOCK__` are replaced at build/dev time by the
 * values resolved in `vite.config.ts` (see `resolveAdminBuildConfig` in `./build-config`):
 *
 * - Local Vite dev server (`vite`, `command === 'serve'`, `mode === 'development'`): defaults
 *   `__ADMIN_API_BASE_URL__` to `/api/v1` when `ADMIN_WEB_API_BASE_URL` is unset so same-origin
 *   requests flow through Vite's local dev proxy without manual env exports, while still
 *   respecting an explicit `ADMIN_WEB_API_BASE_URL` override when provided.
 * - Shipped Vite bundle (`vite build`, `command === 'build'`): never invents a fallback URL and
 *   rejects loopback hosts; an unset `ADMIN_WEB_API_BASE_URL` injects `''` (fail-closed) so
 *   `ApiClient` refuses to send requests rather than calling an unintended host, and Rollup
 *   dead-code-eliminates the non-bundled fallback branch completely.
 * - `DEV_AUTH_MOCK` stays `false` for every production build regardless of environment.
 */
declare const __ADMIN_API_BASE_URL__: string | undefined;
declare const __ADMIN_DEV_AUTH_MOCK__: boolean | undefined;

const isProductionRuntime =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

function resolveNonBundledApiBaseUrl(): string {
  const raw =
    typeof process !== 'undefined' ? (process.env?.ADMIN_WEB_API_BASE_URL ?? '').trim() : '';
  const normalized = !raw || raw === '/' ? '' : raw.replace(/\/+$/, '');

  if (isProductionRuntime) {
    if (!normalized) {
      return '';
    }
    if (
      /^\/\/|(?:^https?:\/\/)(?:localhost|[^/]*\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i.test(
        normalized,
      ) ||
      /^(?:localhost|[^/:]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|::1)(?::|\/|$)/i.test(
        normalized,
      )
    ) {
      return '';
    }
    return normalized;
  }

  return normalized || '/api/v1';
}

/** API base URL including the `/api/v1` prefix; empty when a production build did not configure one. */
export const API_BASE_URL: string =
  typeof __ADMIN_API_BASE_URL__ === 'string'
    ? __ADMIN_API_BASE_URL__.trim().replace(/\/+$/, '')
    : resolveNonBundledApiBaseUrl();

/** Development-only mock fallback. Always false in a production build. */
export const DEV_AUTH_MOCK: boolean =
  typeof __ADMIN_DEV_AUTH_MOCK__ === 'boolean' ? __ADMIN_DEV_AUTH_MOCK__ : !isProductionRuntime;

export const DEFAULT_INTERNAL_AUDIENCE = 'workforce-admin';
