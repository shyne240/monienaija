// V1-RELEASE-01: these two constants previously shipped as unconditional, hardcoded
// values with no environment switching at all:
//   export const API_BASE_URL = 'http://localhost:3000/api/v1';
//   export const DEV_AUTH_MOCK = true;
// That meant ANY production build of admin-web would (a) always call localhost, never a
// real deployed backend, and (b) always expose a client-side "sandbox" login bypass that
// fabricates a fully privileged FINANCE_ADMIN session (scopes: privileged:execute,
// privileged:approve, finance:audit) whenever the real workforce OIDC/session endpoint
// returned 401/404/405/500 — which is exactly what happens by default, since
// A2_WORKFORCE_ENABLED=false is the backend's safe-by-default posture. The fabricated
// session cannot move money or read real data (the backend's RuntimeAccessGuard validates
// sessions server-side and rejects the fabricated token), but it is still a dangerous
// production default: it is dead code a deployer must remember to manually delete, it
// renders a convincing "authenticated" admin UI with no real backend session behind it,
// and it ships test-only/mock behaviour unconditionally inside the production bundle.
//
// Fix: both values now derive from Vite's build-time environment instead of a literal.
// `process.env.NODE_ENV` is statically replaced by Vite at build time (and by ts-jest/CRA
// conventions at test time), so a `vite build` (NODE_ENV=production) always compiles
// DEV_AUTH_MOCK to `false` with no deployer action required. The API base URL is sourced
// from `ADMIN_WEB_API_BASE_URL`, injected via `define` in vite.config.ts from the
// deployer's real build-time environment, falling back to localhost only outside
// production so local development is unaffected.
// Production default is a same-origin relative path (`/api/v1`), which works when the
// backend is reverse-proxied under the same origin as this static app (the common gateway
// pattern). Cross-origin deployments must set ADMIN_WEB_API_BASE_URL at build time.
//
// V1-ADMIN-LOCAL-LOGIN-01: the local-development default used to be the absolute
// `http://localhost:3000/api/v1`, a different origin from this app's own
// `http://localhost:5173`. The backend never calls `app.enableCors()` (by design — see the
// production comment above), so every request from the browser was a blocked cross-origin
// request that failed before a real HTTP response ever arrived, surfacing only as
// "Failed to fetch" on the login screen. Local development now defaults to the same
// same-origin-relative `/api/v1` path production uses, and `vite.config.ts` proxies it to
// the real backend (`http://localhost:3000` by default) from the dev server itself — the
// browser only ever talks to its own origin, exactly like the production reverse-proxy
// model. No backend CORS configuration was added or is needed.
export const API_BASE_URL: string =
  (typeof process !== 'undefined' && process.env.ADMIN_WEB_API_BASE_URL) || '/api/v1';

export const DEV_AUTH_MOCK: boolean = process.env.NODE_ENV !== 'production';

export const DEFAULT_INTERNAL_AUDIENCE = 'workforce-admin';
