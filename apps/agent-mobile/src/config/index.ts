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
export const DEFAULT_BASE_URL =
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL) ||
  'http://10.0.2.2:3000';
