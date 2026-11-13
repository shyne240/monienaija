#!/usr/bin/env node
/**
 * ARENA 3 protected checker authority — executable PostgreSQL role provisioning.
 *
 * Creates a migration/administration login, an ordinary runtime login and a protected authority
 * login, then applies the grants that make the authority boundary real. Run it with a
 * superuser/owner connection (or the database owner) and a database that has already had the
 * migration chain applied.
 *
 * Usage:
 *   node scripts/provision-database-roles.js --phase=cluster
 *   node scripts/provision-database-roles.js --phase=before-migrations
 *   node scripts/provision-database-roles.js --phase=after-migrations
 *   node scripts/provision-database-roles.js --phase=all      # cluster + before + after
 *
 * Required environment (no secrets are committed):
 *   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD      — administrative connection
 *   RUNTIME_DB_USER RUNTIME_DB_PASSWORD
 *   AUTHORITY_DB_USER AUTHORITY_DB_PASSWORD
 *   MIGRATOR_DB_USER MIGRATOR_DB_PASSWORD
 * Optional:
 *   PROVISION_DATABASE=true   create DB_NAME owned by MIGRATOR_DB_USER if it does not exist
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SQL_DIR = path.join(__dirname, 'sql');
const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function identity(name) {
  const value = required(name);
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${name} must match ${IDENTIFIER} (lower-case PostgreSQL identifier)`);
  }
  return value;
}

function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function config() {
  const runtimeRole = identity('RUNTIME_DB_USER');
  const authorityRole = identity('AUTHORITY_DB_USER');
  const migratorRole = identity('MIGRATOR_DB_USER');
  if (
    runtimeRole === authorityRole ||
    runtimeRole === migratorRole ||
    authorityRole === migratorRole
  ) {
    throw new Error('runtime, authority and migration roles must be three distinct logins');
  }
  return {
    runtimeRole,
    runtimePassword: required('RUNTIME_DB_PASSWORD'),
    authorityRole,
    authorityPassword: required('AUTHORITY_DB_PASSWORD'),
    migratorRole,
    migratorPassword: required('MIGRATOR_DB_PASSWORD'),
    database: required('DB_NAME'),
  };
}

function render(file, values) {
  let sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
  const replacements = {
    '{{RUNTIME_ROLE}}': values.runtimeRole,
    '{{RUNTIME_PASSWORD}}': literal(values.runtimePassword),
    '{{AUTHORITY_ROLE}}': values.authorityRole,
    '{{AUTHORITY_PASSWORD}}': literal(values.authorityPassword),
    '{{MIGRATOR_ROLE}}': values.migratorRole,
    '{{MIGRATOR_PASSWORD}}': literal(values.migratorPassword),
    '{{DATABASE_NAME}}': values.database,
  };
  for (const [token, replacement] of Object.entries(replacements)) {
    sql = sql.split(token).join(replacement);
  }
  if (sql.includes('{{')) throw new Error(`${file} has an unresolved placeholder`);
  return sql;
}

function client(database) {
  return new Client({
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : required('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    database,
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function run(database, sql) {
  const connection = client(database);
  await connection.connect();
  try {
    await connection.query(sql);
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function ensureDatabase(values) {
  if (process.env.PROVISION_DATABASE !== 'true') return;
  const admin = client('postgres');
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
      values.database,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(
        `CREATE DATABASE ${values.database} OWNER ${values.migratorRole} TEMPLATE template0`,
      );
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function main() {
  const phaseArg = (process.argv.find((arg) => arg.startsWith('--phase=')) || '--phase=all').split(
    '=',
  )[1];
  const phase = phaseArg || 'all';
  if (!['cluster', 'before-migrations', 'after-migrations', 'all'].includes(phase)) {
    throw new Error(`unknown --phase=${phase}`);
  }
  const values = config();
  if (phase === 'cluster' || phase === 'all') {
    await ensureDatabase(values);
    await run(
      process.env.DB_ADMIN_NAME || 'postgres',
      render('provision-database-roles-cluster.sql', values),
    );
  }
  if (phase === 'before-migrations' || phase === 'all') {
    await run(values.database, render('provision-database-roles-before-migrations.sql', values));
  }
  if (phase === 'after-migrations' || phase === 'all') {
    await run(values.database, render('provision-database-roles-after-migrations.sql', values));
  }
  process.stdout.write(
    `provisioned ${phase}: runtime=${values.runtimeRole} authority=${values.authorityRole} migrator=${values.migratorRole}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`provisioning failed: ${error.message}\n`);
  process.exitCode = 1;
});
