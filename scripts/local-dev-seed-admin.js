/**
 * DEVELOPMENT ONLY — V1-ADMIN-LOCAL-LOGIN-01 deterministic local administrator seed.
 *
 * Why this exists: the real production Admin Web login requires a conforming external OIDC
 * identity provider plus MFA (see src/authorization/workforce-oidc.service.ts and
 * docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md for the real, audited bootstrap
 * ceremony). Standing up a real OIDC provider just to click around Admin Web locally is
 * disproportionate. This script creates exactly one deterministic local administrator
 * credential (email + password, PBKDF2-hashed, stored in `local_admin_credentials`) that the
 * Admin Web login screen authenticates against via
 * `POST /internal/a2/workforce/local-admin-sessions`.
 *
 * This is NOT a parallel authentication system: a successful password check against this
 * credential exchanges into the existing, already-reviewed A2 workforce sandbox bypass
 * (`A2WorkforceOidcService` + `A2WorkforceSessionService`), producing the exact same kind of
 * session every other workforce login produces — with every enabled A2 Finance role
 * (FINANCE_ADMIN/FINANCE_PREPARER/FINANCE_CONTROLLER/FINANCE_AUDITOR) and their associated
 * scopes.
 *
 * `LocalAdminAuthenticationService` (and this script) refuse to run unless
 * NODE_ENV=development or NODE_ENV=test. NEVER run this against a production database.
 *
 * Usage:
 *   node scripts/local-dev-seed-admin.js [email] [password]
 *
 * Defaults (if omitted): admin@monienaija.local / MonieNaijaAdmin123!
 *
 * Safe to run repeatedly: a second run for the same email reports `"created": false` and
 * makes no changes (see LocalAdminAuthenticationService.seedDefaultAdmin).
 */
const { NestFactory } = require('@nestjs/core');

const DEFAULT_EMAIL = 'admin@monienaija.local';
const DEFAULT_PASSWORD = 'MonieNaijaAdmin123!';

async function main() {
  const email = process.argv[2] || DEFAULT_EMAIL;
  const password = process.argv[3] || DEFAULT_PASSWORD;

  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const { LocalAdminAuthenticationService } = require('../dist/local-admin-authentication/local-admin-authentication.service');
    const service = app.get(LocalAdminAuthenticationService);

    const result = await service.seedDefaultAdmin({ email, password });

    console.log(
      JSON.stringify(
        {
          status: 'DEVELOPMENT ONLY — local database only, never run against production',
          email: result.email,
          created: result.created,
          note: result.created
            ? 'Local administrator credential created.'
            : 'Local administrator credential already exists — no change made (idempotent).',
          loginUrl: 'http://localhost:5173',
          backendLoginEndpoint: 'POST http://localhost:3000/api/v1/internal/a2/workforce/local-admin-sessions',
        },
        null,
        2,
      ),
    );
    // Deliberately never logs the password — see src/common/sensitive-data-redaction.ts and
    // the security requirements in docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md.
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('LOCAL ADMIN SEED FAILED:', e.message || e);
  process.exit(1);
});
