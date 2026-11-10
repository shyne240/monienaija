'use strict';

// Read-only local check. Never prints environment values or PostgreSQL error messages.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const dotenv = require('dotenv');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function loadEffectiveEnv(root = ROOT, shellEnv = process.env) {
  const file = path.join(root, '.env');
  const fileEnv = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  // Nest/dotenv let already exported environment variables take precedence over .env.
  return { ...fileEnv, ...shellEnv };
}

function validate(env) {
  const issues = [];
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) issues.push(`${key} is required`);
  }
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test'].includes(mode)) issues.push('NODE_ENV must be development or test');
  if (env.DB_HOST && !LOOPBACK.has(env.DB_HOST.trim().toLowerCase())) {
    issues.push('DB_HOST must be an explicit local loopback address; remote hosts and socket paths are refused');
  }
  const port = env.DB_PORT || '5432';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) issues.push('DB_PORT must be a valid port');
  for (const key of ['DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED']) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key])) issues.push(`${key} must be true or false`);
  }
  if (env.LOCAL_DB_CONFIRMED_ISOLATED !== 'yes') issues.push('LOCAL_DB_CONFIRMED_ISOLATED=yes must attest that this local server is not a production proxy and has synthetic-only data');
  for (const key of ['NOTIFICATION_WORKER_ENABLED', 'CASH_TO_CASH_EXPIRY_WORKER_ENABLED', 'A6_PARTNER_ENABLED']) {
    if (env[key] !== undefined && env[key] !== 'false') issues.push(`${key} must be false`);
  }
  if ((env.NOTIFICATION_SMS_PROVIDER || 'console') !== 'console') issues.push('NOTIFICATION_SMS_PROVIDER must be console for local safety');
  if ((env.NOTIFICATION_EMAIL_PROVIDER || 'none') !== 'none') issues.push('NOTIFICATION_EMAIL_PROVIDER must be none for local safety');
  if ((env.A6_PARTNER_ENVIRONMENT || 'sandbox') !== 'sandbox') issues.push('A6_PARTNER_ENVIRONMENT must be sandbox');
  if (env.POA_UPLOADS_ENABLED && env.POA_UPLOADS_ENABLED !== 'false') issues.push('POA_UPLOADS_ENABLED must be false in the safe local launcher');
  if ((env.A5_PILOT_EMERGENCY_STOP || 'false') !== 'true') issues.push('A5_PILOT_EMERGENCY_STOP=true is required for the safe local launcher (not a universal financial kill switch)');
  const apiPort = env.PORT || '3000';
  if (!/^\d+$/.test(apiPort) || Number(apiPort) < 1 || Number(apiPort) > 65535) issues.push('PORT must be a valid port');
  if (issues.length) throw new Error(issues.join('\n'));
  // Check the same application schema without displaying values or schema error messages.
  require('ts-node/register/transpile-only');
  const { environmentSchema } = require('../src/config/environment.ts');
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'configuration'))];
    throw new Error(`Application configuration is invalid for: ${keys.join(', ')}. Check values privately.`);
  }
  return {
    host: env.DB_HOST.trim().toLowerCase() === 'localhost' ? '127.0.0.1' : env.DB_HOST.trim(),
    port: Number(port), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    connectionTimeoutMillis: 3000, statement_timeout: 3000,
    options: '-c default_transaction_read_only=on', application_name: 'monienaija-local-preflight',
  };
}

async function checkDatabase(config, ClientClass = Client) {
  const client = new ClientClass(config);
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch {
    throw new Error('Database connection or read-only SELECT failed. Check Docker service and existing connection settings privately; no settings were changed.');
  } finally {
    await client.end().catch(() => {});
  }
}

function checkBackend(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/v1/health', timeout: 3000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else reject(new Error('Local backend health endpoint did not return HTTP 200.'));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => reject(new Error('Local backend health endpoint is unavailable.')));
  });
}

async function run(env, { backend = false, ClientClass = Client } = {}) {
  const config = validate(env); // Refuse before any network contact.
  await checkDatabase(config, ClientClass);
  if (backend) await checkBackend(Number(env.PORT || '3000'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--backend') || args.length > 1) {
    console.error('Usage: npm run local:preflight -- [--backend]');
    process.exitCode = 1;
  } else {
    Promise.resolve().then(() => run(loadEffectiveEnv(), { backend: args.includes('--backend') }))
      .then(() => console.log('Local preflight passed: configuration and read-only PostgreSQL connection' + (args.includes('--backend') ? ', backend liveness' : '') + '.'))
      .catch((error) => { console.error(`Local preflight refused/failed:\n${error.message}`); process.exitCode = 1; });
  }
}
module.exports = { loadEffectiveEnv, validate, checkDatabase, checkBackend, run };
