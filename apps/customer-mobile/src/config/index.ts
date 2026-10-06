/**
 * MoneyNaija Mobile Application Configuration
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
