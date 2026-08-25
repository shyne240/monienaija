const EmbeddedPostgres = require('embedded-postgres').default;
const path = require('path');
const fs = require('fs');

async function main() {
  const dataDir = path.join(__dirname, '../../.embedded-pg-data');
  
  // Clean up previous data
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'monienaija',
    password: 'monienaija-pw',
    port: 5432,
    persistent: true,
  });

  console.log('Initializing embedded PostgreSQL...');
  await pg.initialise();
  
  console.log('Starting embedded PostgreSQL...');
  await pg.start();
  
  console.log('PostgreSQL is running on port 5432');
  console.log('PID:', process.pid);
  
  // Keep running
  process.on('SIGINT', async () => {
    console.log('Stopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Stopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start PostgreSQL:', error);
  process.exit(1);
});
