#!/usr/bin/env node
'use strict';

// Explicit, disposable-local-database fixture only. Never use these credentials elsewhere.
const { createHash, randomBytes, randomUUID, pbkdf2Sync, timingSafeEqual } = require('node:crypto');
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
const OPERATIONAL = new Set([
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
]);
const emailFor = (role) => `${role.toLowerCase().replace(/_/g, '-')}@monienaija.local`;
const passwordFor = (role) => `MonieNaija_${role}_123!`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const principalFor = (email, config) =>
  `${config.oidcIssuer || 'https://identity.issuer.invalid'}:local-admin-credential:${sha256(email).slice(0, 32)}`;

function hashPassword(password) {
  const salt = randomBytes(16),
    iterations = 10000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function passwordMatches(password, encoded) {
  const parts = encoded.split('$');
  if (parts.length !== 5 || parts[0] !== 'PBKDF2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1000000) return false;
  const salt = Buffer.from(parts[3], 'base64url'),
    hash = Buffer.from(parts[4], 'base64url');
  if (!salt.length || hash.length !== 32) return false;
  return timingSafeEqual(pbkdf2Sync(password, salt, iterations, hash.length, 'sha256'), hash);
}
function assertSafe(ds, config) {
  if (!['development', 'test'].includes(process.env.NODE_ENV))
    throw new Error('Refusing outside NODE_ENV=development or test');
  if (process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database')
    throw new Error(
      'Set LOCAL_DEV_SEED_CONFIRM=disposable-local-database only after confirming this is a disposable local database',
    );
  if (!['127.0.0.1', 'localhost', '::1'].includes(ds.options.host))
    throw new Error('Refusing a non-loopback database host');
  if (
    process.env.NOTIFICATION_WORKER_ENABLED !== 'false' ||
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false'
  )
    throw new Error(
      'Both notification and cash-to-cash expiry workers must be explicitly disabled',
    );
  if (!config.enabled || !config.oidcIssuer)
    throw new Error('Workforce authentication and issuer must be configured');
}

/** Inserts only missing fixture rows; never changes existing credentials, assignments, role definitions or grants. */
async function seedLocalRoles(ds, config, audit) {
  assertSafe(ds, config);
  return ds.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext('monienaija-local-dev-11-roles'))");
    const definitions = await manager.query(
      'SELECT role_key, is_active FROM authorization_roles WHERE role_key = ANY($1)',
      [ROLES],
    );
    for (const role of ROLES) {
      if (!definitions.some((d) => d.role_key === role && d.is_active))
        throw new Error(`Catalogue role ${role} is missing or disabled; no roles changed`);
    }
    const fixtures = ROLES.map((role) => ({
      role,
      email: emailFor(role),
      password: passwordFor(role),
    }));
    // The original single-account seed created this separate identity, not an alias. Preserve it
    // when present; do not create an extra account on fresh installs.
    const legacy = await manager.query('SELECT email FROM local_admin_credentials WHERE email=$1', [
      'admin@monienaija.local',
    ]);
    if (legacy.length)
      fixtures.push({
        role: 'SUPER_ADMIN',
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
        legacy: true,
      });
    const results = [];
    for (const fixture of fixtures) {
      const { role, email, password } = fixture;
      const principal = principalFor(email, config);
      if (principal.length > 160)
        throw new Error('Workforce issuer is too long for local principal IDs');
      const credentials = await manager.query(
        'SELECT id, password_hash FROM local_admin_credentials WHERE email=$1 FOR UPDATE',
        [email],
      );
      const existing = credentials[0];
      const knownPassword = !existing || passwordMatches(password, existing.password_hash);
      const assignments = await manager.query(
        'SELECT id, role_key, status, effective_from, effective_to FROM a2_finance_role_assignments WHERE principal_id=$1 FOR UPDATE',
        [principal],
      );
      const active = assignments.filter(
        (a) =>
          a.status === 'ACTIVE' && a.effective_from <= new Date() && a.effective_to > new Date(),
      );
      if (
        active.some((a) => a.role_key !== role) ||
        active.filter((a) => a.role_key === role).length > 1
      ) {
        throw new Error(
          `${email} has conflicting active roles; unchanged. Inspect the disposable database before proceeding.`,
        );
      }
      if (!active.length && assignments.length)
        throw new Error(
          `${email} has an expired, future or revoked assignment; unchanged. Review it manually.`,
        );
      if (!active.length && existing && !knownPassword)
        throw new Error(
          `${email} has an unrecognized existing password and no current assignment; unchanged. Do not overwrite this account.`,
        );
      let credentialCreated = false,
        assignmentCreated = false;
      if (!existing) {
        const id = randomUUID();
        await manager.query(
          'INSERT INTO local_admin_credentials (id,email,password_hash,hash_algorithm) VALUES ($1,$2,$3,$4)',
          [id, email, hashPassword(password), 'PBKDF2'],
        );
        await audit.record(manager, {
          entityType: 'LOCAL_ADMIN_CREDENTIAL',
          entityId: id,
          action: 'LOCAL_ADMIN_CREDENTIAL_SEEDED',
          actor: 'local-dev-seed-11-roles',
          newValues: { email },
        });
        credentialCreated = true;
      }
      if (!active.length) {
        const id = randomUUID();
        const {
          financeRoleAssignmentReference,
        } = require('../dist/authorization/finance-role-administration.service');
        const ref = financeRoleAssignmentReference(principal, role, config.environment);
        const legacy = config.roles.find((r) => r.roleKey === role && r.enabled);
        const functionRows = legacy
          ? []
          : await manager.query(
              'SELECT rf.function_code FROM authorization_role_functions rf JOIN authorization_roles r ON r.id=rf.role_id WHERE r.role_key=$1 AND r.is_active AND rf.is_active',
              [role],
            );
        const scopes = legacy ? legacy.scopes : functionRows.map((r) => r.function_code);
        const scope = OPERATIONAL.has(role) ? 'ADMINISTRATOR_SCOPE' : 'SUPER_ADMIN_SCOPE';
        await manager.query(
          `INSERT INTO a2_finance_role_assignments
          (id,assignment_reference,assignment_version,principal_id,role_key,scopes,status,interim,initiated_scope,effective_from,effective_to,assigned_by,assigned_at,approval_ids,audit_references,record_version)
          VALUES ($1,$2,1,$3,$4,$5::jsonb,'ACTIVE',true,$6,now(),now() + interval '100 years','local-dev-seed-11-roles',now(),'[]'::jsonb,'[]'::jsonb,1)`,
          [id, ref, principal, role, JSON.stringify(scopes), scope],
        );
        const event = await audit.record(manager, {
          entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
          entityId: id,
          action: 'LOCAL_DEV_ROLE_ASSIGNED',
          actor: 'local-dev-seed-11-roles',
          newValues: { principalId: principal, roleKey: role, assignmentReference: ref },
        });
        await manager.query(
          'UPDATE a2_finance_role_assignments SET audit_references=$1::jsonb WHERE id=$2',
          [JSON.stringify([event.id]), id],
        );
        assignmentCreated = true;
      }
      results.push({
        email,
        role,
        credentialCreated,
        assignmentCreated,
        password: knownPassword ? 'default or newly created' : 'existing password preserved',
        legacy: !!fixture.legacy,
      });
    }
    return results;
  });
}

async function main() {
  if (process.argv.length > 2)
    throw new Error(
      'This seed accepts no arguments; the old --verify option is no longer supported',
    );
  require('dotenv').config();
  // Check before Nest bootstrap as well: no app or workers start on a refused invocation.
  assertSafe(
    { options: { host: process.env.DB_HOST } },
    {
      enabled: process.env.A2_WORKFORCE_ENABLED === 'true',
      oidcIssuer: process.env.A2_WORKFORCE_OIDC_ISSUER,
    },
  );
  const { NestFactory } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const { AuditService } = require('../dist/operations/audit.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const results = await seedLocalRoles(
      app.get(DataSource),
      app.get('A2_WORKFORCE_CONFIG'),
      app.get(AuditService),
    );
    console.log(
      JSON.stringify({ status: 'Disposable local development only', accounts: results }, null, 2),
    );
  } finally {
    await app.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error('LOCAL ROLE SEED FAILED:', error.message);
    process.exitCode = 1;
  });
module.exports = { ROLES, emailFor, passwordFor, principalFor, seedLocalRoles, assertSafe };
