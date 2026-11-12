const EmbeddedPostgres = require('embedded-postgres').default;
const pg = new EmbeddedPostgres({
  databaseDir: './data/pgdata',
  port: 5432,
  user: 'monienaija',
  password: 'monienaija-pw',
  persistent: true,
  createPostgresUser: false,
  onLog: (m) => console.log('[pg]', m),
  onError: (m) => console.error('[pg]', m),
});
(async () => {
  await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('monienaija'); } catch (e) { console.log('db exists:', e.message); }
  console.log('PG_READY on 5432');
})();
