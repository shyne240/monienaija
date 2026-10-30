/**
 * Admin Web runtime configuration.
 *
 * INTEGRATION (integration/main-backend-frontend-20261030): this is the Admin Web lead's reviewed
 * resolution (docs/design-discovery-20261029/m1/acceptance/integration-prep.md §1 row 1, branch
 * arena/d4ef0b81-monienaija @ 4dd4e3ec), reconstructed verbatim here: main's build-injected model
 * is adopted, and the development-only fallback keeps this branch's working local dev/test
 * behaviour.
 *
 * `__ADMIN_API_BASE_URL__` and `__ADMIN_DEV_AUTH_MOCK__` are replaced at build time by the values
 * resolved in `vite.config.ts` (see `resolveAdminBuildConfig` in `./build-config`). Production
 * values are therefore always injected by `define`, so a shipped bundle never evaluates a fallback:
 *
 * - `''` (fail-closed) remains the production default for an unset API base URL, and the API client
 *   refuses to send requests rather than silently calling an unintended host.
 * - `DEV_AUTH_MOCK` stays `false` for every production build regardless of the environment.
 *
 * The only code that still evaluates a fallback is guarded by `process.env.NODE_ENV !== 'production'`,
 * i.e. jest / ts-node / local dev, where no Vite `define` exists. Residual risk noted by the Admin
 * Web lead: a hypothetical non-Vite bundler that both skips `define` AND leaves `NODE_ENV` unset
 * would take the `/api/v1` branch. Vite is the only bundler in this repository, so that path does
 * not exist today.
 */
declare const __ADMIN_API_BASE_URL__: string | undefined;
declare const __ADMIN_DEV_AUTH_MOCK__: boolean | undefined;

const isProductionBuild =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

/** Absolute API base URL including the `/api/v1` prefix; empty when the build did not configure one. */
export const API_BASE_URL: string =
  typeof __ADMIN_API_BASE_URL__ === 'string'
    ? __ADMIN_API_BASE_URL__.trim()
    : isProductionBuild
      ? ''
      : (typeof process !== 'undefined' && process.env?.ADMIN_WEB_API_BASE_URL?.trim()) || '/api/v1';

/** Development-only mock fallback. Always false in a production build. */
export const DEV_AUTH_MOCK: boolean =
  typeof __ADMIN_DEV_AUTH_MOCK__ === 'boolean' ? __ADMIN_DEV_AUTH_MOCK__ : !isProductionBuild;

export const DEFAULT_INTERNAL_AUDIENCE = 'workforce-admin';
