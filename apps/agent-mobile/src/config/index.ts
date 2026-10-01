/**
 * MoneyNaija Agent Mobile — application configuration.
 *
 * AUTH MODEL — FAIL CLOSED (spec V1-AGENT-MOBILE-APPLICATION-SPEC-01 §4/§10):
 * There is deliberately NO development authentication mock in this application
 * (the customer app's historical DEV_AUTH_MOCK exception is NOT copied). The
 * Agent authentication surface (@see src/agent-authentication) is complete and
 * UAT-accepted; if the backend is unreachable or a session fails, the app
 * presents the error and stays unauthenticated. Never introduce a bypass.
 */

// Default API Base URL targeting the sandbox backend (Android emulator loopback).
export const DEFAULT_BASE_URL = 'http://10.0.2.2:3000';
