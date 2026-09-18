/**
 * Build-time configuration resolution for the Admin Web console.
 *
 * Kept as a pure function so the production-safety rules are unit-testable without running Vite:
 *
 * - the API base URL has no default. A build without `ADMIN_WEB_API_BASE_URL` produces an empty
 *   value, and the API client then refuses to send requests instead of silently calling localhost.
 * - the development mock fallback requires BOTH a development build (`mode === 'development'`) and
 *   an explicit opt-in (`ADMIN_WEB_DEV_AUTH_MOCK=true`). A production build can never enable it,
 *   whatever the environment sets.
 */
export interface AdminBuildConfig {
  apiBaseUrl: string;
  devAuthMock: boolean;
}

export function resolveAdminBuildConfig(
  mode: string,
  env: Record<string, string | undefined>,
): AdminBuildConfig {
  const apiBaseUrl = (env.ADMIN_WEB_API_BASE_URL ?? '').trim();
  const devAuthMock = mode === 'development' && env.ADMIN_WEB_DEV_AUTH_MOCK === 'true';
  return { apiBaseUrl, devAuthMock };
}
