/**
 * MonieNaija Mobile Application Configuration
 *
 * INTEGRATION (integration/main-backend-frontend-20261030): this file is the union of the two
 * sides' API-base-URL hardening. Both replaced the merge base's `DEV_AUTH_MOCK = true` toggle and
 * the permanently hardcoded Android-emulator loopback address, and both are preserved here:
 *
 *   - main (39a9e504) contributed the fail-closed production posture: `EXPO_PUBLIC_API_BASE_URL`,
 *     the exported `API_BASE_URL`, and an empty base URL for a production bundle so the API client
 *     refuses to issue requests (`NetworkError`) instead of silently sending credentials or money
 *     movements to an unintended host. `src/services/api-client.ts` (main's version, which Lineage A
 *     never modified) imports `DEFAULT_BASE_URL` and throws when it is empty, so the fail-closed
 *     behaviour below is what makes that guard effective.
 *   - Lineage A (V1-RELEASE-01) contributed build-time environment switching through
 *     `EXPO_PUBLIC_API_URL`, which its deployment documentation and EAS build profiles set.
 *
 * Both variable names are therefore accepted (`EXPO_PUBLIC_API_BASE_URL` first, then
 * `EXPO_PUBLIC_API_URL`) so neither side's documented build configuration silently stops applying.
 * `EXPO_PUBLIC_*` variables are inlined by Expo/Metro at build time (SDK 49+).
 */

/** Local development only - never applied to a production bundle. */
const LOCAL_DEVELOPMENT_BASE_URL = 'http://10.0.2.2:3000';

const configuredBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '') ||
  process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '') ||
  '';

const isProductionBuild = process.env.NODE_ENV === 'production';

/** Empty unless a build explicitly configured a host: production builds fail closed. */
export const API_BASE_URL = configuredBaseUrl;

export const DEFAULT_BASE_URL =
  configuredBaseUrl || (isProductionBuild ? '' : LOCAL_DEVELOPMENT_BASE_URL);
