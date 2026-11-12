// This legacy helper initializes and may remove its data directory. Never point it at
// an existing local database or run it as part of ordinary development startup.
const fs = require('node:fs');
const path = require('node:path');
if (process.env.EMBEDDED_PG_CONFIRM_DISPOSABLE !== 'yes') {
  console.error('Embedded PostgreSQL is destructive test tooling; set EMBEDDED_PG_CONFIRM_DISPOSABLE=yes only for a fresh disposable checkout.');
  process.exit(1);
}
if (fs.existsSync(path.resolve('./data/embedded-pg'))) {
  console.error('Refusing to initialize over an existing embedded PostgreSQL data directory.');
  process.exit(1);
}

const EmbeddedPostgres = require('embedded-postgres').default;

const pg = new EmbeddedPostgres({
  databaseDir: './data/embedded-pg',
  port: 5432,
  user: 'monienaija',
  password: 'monienaija-pw',
  persistent: false,
  createPostgresUser: false,
  onLog: (msg) => console.log('[pg]', msg),
  onError: (msg) => console.error('[pg]', msg),
});

async function main() {
  console.log('Initialising embedded postgres...');
  await pg.initialise();
  console.log('Starting embedded postgres...');
  await pg.start();
  console.log('Creating database monienaija...');
  try {
    await pg.createDatabase('monienaija');
  } catch (e) {
    console.log('Database creation error (maybe exists):', e.message);
  }
  console.log('Embedded postgres ready at 5432 as monienaija/monienaija-pw');
  process.on('SIGTERM', async () => {
    console.log('Stopping postgres...');
    try { await pg.stop(); } catch {}
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    console.log('Stopping postgres...');
    try { await pg.stop(); } catch {}
    process.exit(0);
  });
}

main().catch(async (e) => {
  console.error('Failed to start embedded postgres', e);
  try { await pg.stop(); } catch {}
  process.exit(1);
});
