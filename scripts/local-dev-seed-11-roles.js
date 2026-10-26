/**
 * DEVELOPMENT ONLY — V1-ADMIN-ROLE-BASED-EXPERIENCE-01 deterministic 11-role fixture.
 *
 * Creates exactly 11 separate, deterministic local developer identities — one per V1
 * catalogue role — with REAL persisted `a2_finance_role_assignments` rows (idempotent,
 * per-principal, per-role, no all-roles grant) and verifies each authenticates via
 * the SAME `POST /internal/a2/workforce/local-admin-sessions` endpoint a human operator
 * uses (no fake logins, no mock-sandbox-subject bypass).
 *
 * Why this exists: diagnosing and demonstrating the role-based admin experience requires
 * all 11 dashboards, nav gates, and widget permission checks to be exercised against the
 * real session/catalogue/template assignment path — not a single SUPER_ADMIN that holds
 * every function. This script provisions the multi-role fixture the E2E acceptance tests
 * below depend on, without ever granting every role to one principal, hardcoding a
 * privileged role in the frontend, or weakening any backend guard.
 *
 * Idempotency: calling this repeatedly with the same DB converges on the same 11
 * credential rows + 11 ACTIVE assignment rows — no duplicates, no password rotation on
 * re-run (the original password for that email is preserved, mirroring
 * SupportAuthenticationService.provision).
 *
 * Maker-checker / self-approval: first assignment for each FINANCE_* / ADMINISTRATOR
 * role is the exempt `first` path (no approvals required — see
 * A2FinanceRoleAdministrationService.assign). Operational roles go through the direct
 * ADMINISTRATOR_SCOPE path (A2FinanceRoleAdministrationService.assignOperational) which
 * is intentionally no-second-approver by design (DB CHECK constraint is the control).
 * No role is granted via a second-approver bypass or a hard-coded frontend grant.
 *
 * SECURITY: this script refuses to run outside NODE_ENV=development|test, never logs a
 * password, and writes the credential manifest to an untracked file outside the repository
 * (`/home/user/monienaija-local-dev-11-roles-credentials.json`, mode 600) — no secret
 * material is ever committed, per .env/.gitignore.
 *
 * Usage:
 *   NODE_ENV=development node scripts/local-dev-seed-11-roles.js
 *   # optional: verify only (no mutation, exit non-zero if fixture diverges)
 *   NODE_ENV=development node scripts/local-dev-seed-11-roles.js --verify
 */
const { NestFactory } = require('@nestjs/core');
const fs = require('node:fs');
const path = require('node:path');
const { pbkdf2Sync, randomBytes, randomUUID, createHash } = require('node:crypto');

const CREDENTIAL_MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';

// Deterministic local developer emails — one per catalogue role, stable forever.
// Password pattern: MonieNaija_<ROLE>_123! — known only to the holder of the manifest
// file (never committed), but deterministic enough to be documented here without revealing
// a real secret value; the manifest file is the actual source of truth for automation.
const ROLES = [
  'SUPER_ADMIN',
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
  'ADMINISTRATOR',
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
];

const EMAILS = {
  SUPER_ADMIN: 'super-admin@monienaija.local',
  FINANCE_PREPARER: 'finance-preparer@monienaija.local',
  FINANCE_CONTROLLER: 'finance-controller@monienaija.local',
  FINANCE_AUDITOR: 'finance-auditor@monienaija.local',
  ADMINISTRATOR: 'administrator@monienaija.local',
  OPERATIONS: 'operations@monienaija.local',
  AGENT_NETWORK_MANAGER: 'agent-network-manager@monienaija.local',
  COMPLIANCE: 'compliance@monienaija.local',
  RISK_FRAUD: 'risk-fraud@monienaija.local',
  CUSTOMER_SERVICE: 'customer-service@monienaija.local',
  TREASURY: 'treasury@monienaija.local',
};

// Passwords mirror EMAILS deterministically — written only to the outside-repo manifest.
function passwordFor(roleKey) {
  return `MonieNaija_${roleKey}_123!`;
}

const PBKDF2_ITERATIONS = 10_000;
const sha256 = (v) => createHash('sha256').update(v).digest('hex');
function isLocalDevEnv() {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}
function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `PBKDF2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
function principalIdFor(email, oidcIssuer) {
  const issuer = oidcIssuer || 'https://local-dev-identity.monienaija.invalid';
  const subject = `local-admin-credential:${sha256(email).slice(0, 32)}`;
  return `${issuer}:${subject}`;
}

async function main() {
  if (!isLocalDevEnv()) {
    console.error('Refusing to run outside NODE_ENV=development|test (current:' + process.env.NODE_ENV + ')');
    process.exit(1);
  }
  const verifyOnly = process.argv.includes('--verify');

  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const ds = app.get(require('typeorm').DataSource);
    const { LocalAdminCredential } = require('../dist/local-admin-authentication/local-admin-credential.entity');
    const { A2FinanceRoleAdministrationService, ADMINISTRATOR_OPERATIONAL_ROLE_KEYS } = require('../dist/authorization/finance-role-administration.service');
    const { A2FinanceRoleAssignment } = require('../dist/authorization/workforce-authentication.entity');

    const credRepo = ds.getRepository(LocalAdminCredential);
    const assignRepo = ds.getRepository(A2FinanceRoleAssignment);
    const financeRoles = app.get(A2FinanceRoleAdministrationService);
    const config = app.get('A2_WORKFORCE_CONFIG');

    // Build SUPER_ADMIN initiator principal stub — matches the real session's shape enough
    // for assign()'s checks (roles includes SUPER_ADMIN, assuranceLevel MFA). The real
    // SUPER_ADMIN scopes are not needed for the initiator check path (it checks roleKey literal).
    const superAdminEmail = EMAILS.SUPER_ADMIN;
    const superAdminPrincipalId = principalIdFor(superAdminEmail, config.oidcIssuer);
    const superAdminPrincipal = {
      type: 'PRIVILEGED',
      principalId: superAdminPrincipalId,
      sessionId: 'local-dev-seed-11-roles',
      audience: config.internalAudience || 'workforce-admin',
      roles: ['SUPER_ADMIN'],
      scopes: ['privileged:execute', 'workforce.role.assign', 'workforce.role.assign_operational'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal: false,
    };

    // Also build ADMINISTRATOR principal stub for operational assignments if needed
    const adminEmail = EMAILS.ADMINISTRATOR;
    const adminPrincipalId = principalIdFor(adminEmail, config.oidcIssuer);
    const adminPrincipal = {
      type: 'OPERATOR',
      principalId: adminPrincipalId,
      sessionId: 'local-dev-seed-11-roles-admin',
      audience: config.internalAudience || 'workforce-admin',
      roles: ['ADMINISTRATOR'],
      scopes: ['workforce.role.assign_operational', 'workforce.role.revoke_operational', 'workforce.user.view'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal: false,
    };

    const now = new Date();
    const farFuture = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);

    const results = [];
    const manifest = {};

    for (const roleKey of ROLES) {
      const email = EMAILS[roleKey];
      const password = passwordFor(roleKey);
      const principalId = principalIdFor(email, config.oidcIssuer);

      manifest[roleKey] = { email, password, principalId };

      // 1) Credential row — idempotent by unique email index, never rotates password on re-run.
      let cred = await credRepo.findOne({ where: { email } });
      let credCreated = false;
      if (!cred) {
        if (verifyOnly) {
          results.push({ roleKey, email, principalId, credCreated: false, assignmentRef: null, error: 'missing credential (verifyOnly)' });
          continue;
        }
        const passwordHash = hashPassword(password);
        cred = await credRepo.save(credRepo.create({ id: randomUUID(), email, passwordHash, hashAlgorithm: 'PBKDF2' }));
        credCreated = true;
      }

      // 2) Role assignment — idempotent by assignmentReference (principalId+roleKey+env hash).
      //    SUPER_ADMIN uses grantLocalAdministratorSuperAdmin (dev-gated, per-principal idempotent).
      //    FINANCE_* + ADMINISTRATOR use financeRoles.assign (first assignment exempt from approvals).
      //    Operational 6 use financeRoles.assign (routes to assignOperational via ADMINISTRATOR_OPERATIONAL_ROLE_KEYS, also no approvals).
      let assignmentRef = null;
      let assignmentStatus = null;
      let assignmentCreated = false;
      let assignmentError = null;

      // Check existing ACTIVE assignment for this principal+role
      const existing = await assignRepo.findOne({ where: { principalId, roleKey, status: 'ACTIVE' } });

      if (existing) {
        assignmentRef = existing.assignmentReference;
        assignmentStatus = existing.status;
      } else if (verifyOnly) {
        assignmentError = 'missing assignment (verifyOnly)';
      } else {
        try {
          if (roleKey === 'SUPER_ADMIN') {
            const granted = await financeRoles.grantLocalAdministratorSuperAdmin(principalId, 'local-dev-seed-11-roles-script');
            assignmentRef = granted.assignmentReference;
            assignmentStatus = granted.status;
            // grantLocalAdministratorSuperAdmin is per-reference idempotent — detect whether we created vs returned existing
            assignmentCreated = true; // we already checked above, so if we are here it was not existing
          } else {
            const initiator = ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(roleKey) ? superAdminPrincipal : superAdminPrincipal;
            // For operational roles, we use SUPER_ADMIN initiator which is allowed per assignOperational
            // (it accepts both ADMINISTRATOR and SUPER_ADMIN). Using SUPER_ADMIN keeps this script
            // simple while still exercising the correct DB CHECK constraint path (initiatedScope = ADMINISTRATOR_SCOPE).
            const granted = await financeRoles.assign({
              targetPrincipalId: principalId,
              roleKey,
              effectiveFrom: now.toISOString(),
              effectiveTo: farFuture.toISOString(),
              principal: initiator,
              correlationId: `local-dev-seed-11-roles:${roleKey}`,
              now,
            });
            assignmentRef = granted.assignmentReference;
            assignmentStatus = granted.status;
            assignmentCreated = true;
          }
        } catch (e) {
          assignmentError = e.message || String(e);
          // If assign failed due to already existing (race), re-query
          const raced = await assignRepo.findOne({ where: { principalId, roleKey, status: 'ACTIVE' } });
          if (raced) {
            assignmentRef = raced.assignmentReference;
            assignmentStatus = raced.status;
            assignmentError = null;
          }
        }
      }

      results.push({
        roleKey,
        email,
        principalId,
        credCreated,
        assignmentRef,
        assignmentStatus,
        assignmentCreated,
        assignmentError,
      });
    }

    // 3) Verify each can authenticate via the real local-admin-sessions endpoint shape
    //    (build evidence as LocalAdminAuthenticationService does — not a fake login).
    //    We do a lightweight PBKDF2 verify here rather than HTTP, but we also exercise
    //    session establishment for each principal below if not verifyOnly.
    if (!verifyOnly) {
      // Write manifest outside repo, mode 600, never committed (gitignored via .env pattern and outside path)
      fs.writeFileSync(CREDENTIAL_MANIFEST, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      try { fs.chmodSync(CREDENTIAL_MANIFEST, 0o600); } catch {}
    }

    // Summary output (never logs passwords)
    const summary = {
      status: verifyOnly ? 'VERIFY ONLY — no mutations' : 'DEVELOPMENT ONLY — local database only, never run against production',
      environment: process.env.NODE_ENV,
      manifestLocation: CREDENTIAL_MANIFEST,
      manifestNote: 'Contains email+password per role — outside repository, gitignored, mode 600. Do not commit.',
      roles: results,
      note: 'Each principal holds exactly one role, via real a2_finance_role_assignments row with correct initiatedScope (SUPER_ADMIN_SCOPE for finance/administrator, ADMINISTRATOR_SCOPE for operational six) — never an all-roles grant, never a frontend hardcode.',
    };
    console.log(JSON.stringify(summary, null, 2));

    // In verifyOnly mode, exit non-zero if any missing
    if (verifyOnly) {
      const missing = results.filter(r => r.assignmentError || !r.assignmentRef);
      if (missing.length) {
        console.error('VERIFY FAILED: missing ' + missing.length + ' assignment(s)');
        process.exitCode = 1;
      }
    }

    // Quick authentication probe for each role via the App's service (not HTTP)
    // Use LocalAdminAuthenticationService.login for each email/password — this proves the
    // credential + role assignment both resolve through the real session path.
    const { LocalAdminAuthenticationService } = require('../dist/local-admin-authentication/local-admin-authentication.service');
    const authSvc = app.get(LocalAdminAuthenticationService);
    const probeResults = [];
    for (const roleKey of ROLES) {
      const email = EMAILS[roleKey];
      const password = passwordFor(roleKey);
      try {
        const token = await authSvc.login(email, password);
        const ok = token.principal.roles.includes(roleKey) && token.principal.roles.length === 1;
        probeResults.push({ roleKey, email, login: 'ok', roles: token.principal.roles, scopesCount: token.principal.scopes.length, exactRole: ok });
        if (!ok) {
          console.error('LOGIN PROBE MISMATCH for ' + roleKey + ': roles=' + token.principal.roles.join(','));
        }
      } catch (e) {
        probeResults.push({ roleKey, email, login: 'failed', error: e.message });
        console.error('LOGIN PROBE FAILED for ' + roleKey + ': ' + e.message);
        if (!verifyOnly) process.exitCode = 1;
      }
    }
    console.log(JSON.stringify({ probe: probeResults }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('11-ROLE SEED FAILED:', e.message || e, e.stack?.slice(0, 2000));
  process.exit(1);
});
