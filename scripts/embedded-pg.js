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
