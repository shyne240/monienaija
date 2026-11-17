/**
 * MonieNaija Agent Mobile — application configuration.
 *
 * AUTH MODEL — FAIL CLOSED (spec V1-AGENT-MOBILE-APPLICATION-SPEC-01 §4/§10):
 * There is deliberately NO development authentication mock in this application
 * (the customer app's historical DEV_AUTH_MOCK exception is NOT copied). The
 * Agent authentication surface (@see src/agent-authentication) is complete and
 * UAT-accepted; if the backend is unreachable or a session fails, the app
 * presents the error and stays unauthenticated. Never introduce a bypass.
 */

// V1-RELEASE-01: this previously had no environment switching at all — the API base URL
// was permanently hardcoded to the Android-emulator-only loopback address below, so every
// build (including any production/EAS build) would ship pointed at a developer's local
// machine over plain HTTP. `EXPO_PUBLIC_*` variables are inlined by Expo/Metro at build
// time (natively supported, no extra config, SDK 49+), so setting
// EXPO_PUBLIC_API_URL=https://api.monienaija.ng in the EAS build profile now controls the
// shipped API endpoint. The literal below remains the local-development fallback only.
/** Local development only. Never applied to a production bundle. */
export const LOCAL_DEVELOPMENT_BASE_URL = 'http://10.0.2.2:3000';

/**
 * Resolves the API base URL from explicit inputs.
 *
 * A pure function rather than a module-level constant, for two reasons that matter here:
 *
 *  1. `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` at transform time, so a test cannot
 *     vary it at runtime. Passing the values in makes the decision observable and testable without
 *     defeating the inlining that production builds rely on.
 *  2. The production rule is the one that has to be right, and it is easier to review as four lines
 *     of ordinary logic than as an expression inside a `const` at module scope.
 *
 * The rule: an explicit endpoint always wins (trailing slash stripped so paths are not doubled); with
 * no endpoint, a production build resolves to `''` so the API client refuses to issue a request at
 * all, and only a non-production build falls back to the emulator loopback address.
 */
export function resolveApiBaseUrl(
  configured: string | undefined,
  nodeEnv: string | undefined,
): string {
  const explicit = (configured ?? '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  return nodeEnv === 'production' ? '' : LOCAL_DEVELOPMENT_BASE_URL;
}

const configuredBaseUrl = resolveApiBaseUrl(
  typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_URL : undefined,
  typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
);

/**
 * Empty in a production build with no configured endpoint.
 *
 * This is the difference between "the emulator fallback is harmless" and "a release build silently
 * talks to a developer's laptop over plain HTTP". The loopback literal is a convenience for a local
 * `expo start`; in a production bundle it is a defect, and the API client fails closed on an empty
 * base URL rather than falling back to it. Mirrors `apps/customer-mobile/src/config/index.ts`, which
 * already had this posture — the two apps now behave the same way instead of one of them relying on
 * a build profile being correct.
 */
export const API_BASE_URL = configuredBaseUrl;

export const DEFAULT_BASE_URL = configuredBaseUrl;
