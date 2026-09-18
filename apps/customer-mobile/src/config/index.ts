/**
 * MoneyNaija Mobile Application Configuration
 */

/**
 * API base URL.
 *
 * Production builds must set `EXPO_PUBLIC_API_BASE_URL` (for example in `eas.json` or the build
 * environment). When it is not set, only a non-production (development/test) bundle falls back to
 * the Android emulator loopback so `expo start` keeps working; a production bundle gets an empty
 * base URL and the API client refuses to issue requests (`NetworkError`) instead of silently
 * sending credentials or money movements to an unintended host.
 */
const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';

/** Local development only - never applied to a production bundle. */
const LOCAL_DEVELOPMENT_BASE_URL = 'http://10.0.2.2:3000';

const isProductionBuild = process.env.NODE_ENV === 'production';

export const API_BASE_URL = configuredBaseUrl;

export const DEFAULT_BASE_URL =
  configuredBaseUrl || (isProductionBuild ? '' : LOCAL_DEVELOPMENT_BASE_URL);
