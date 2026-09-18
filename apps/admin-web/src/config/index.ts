/**
 * Admin Web runtime configuration.
 *
 * `__ADMIN_API_BASE_URL__` and `__ADMIN_DEV_AUTH_MOCK__` are replaced at build time by the values
 * resolved in `vite.config.ts` (see `resolveAdminBuildConfig`). Outside a Vite build - unit tests,
 * for example - both identifiers are absent, so the console defaults to NO API base URL and NO mock
 * authentication; requests then fail closed instead of reaching an unintended host.
 */
declare const __ADMIN_API_BASE_URL__: string | undefined;
declare const __ADMIN_DEV_AUTH_MOCK__: boolean | undefined;

/** Absolute API base URL including the `/api/v1` prefix; empty when the build did not configure one. */
export const API_BASE_URL =
  typeof __ADMIN_API_BASE_URL__ === 'string' ? __ADMIN_API_BASE_URL__.trim() : '';

/** Development-only mock fallback. Always false in a production build. */
export const DEV_AUTH_MOCK =
  typeof __ADMIN_DEV_AUTH_MOCK__ === 'boolean' ? __ADMIN_DEV_AUTH_MOCK__ : false;

export const DEFAULT_INTERNAL_AUDIENCE = 'workforce-admin';
