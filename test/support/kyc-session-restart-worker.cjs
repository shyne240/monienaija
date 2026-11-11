'use strict';
// Synthetic-only child process: credential comes from stdin, never arguments or logs.
const { DataSource } = require('typeorm');
const { KycRegistrationSessionService } = require('../../src/kyc-verification/kyc-registration-session.service');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  let db;
  try {
    const value = JSON.parse(input);
    if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(value.socket) || !/^kyc_api_test_[0-9a-f]{32}$/.test(value.schema)) throw new Error('Unsafe test target');
    db = new DataSource({ type:'postgres', host:value.socket, port:55461, username:'kyc_synthetic',database:'postgres',logging:false,extra:{ options:`-c search_path=${value.schema}` }});
    await db.initialize();
    const directory = await db.query('SHOW data_directory');
    const listen = await db.query('SHOW listen_addresses');
    if (!/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(directory[0].data_directory) || listen[0].listen_addresses !== '') throw new Error('Unsafe test cluster');
    const service = new KycRegistrationSessionService(db, { name:'synthetic', send:()=>Promise.reject(new Error('disabled')) }, {consume:()=>Promise.reject(new Error('disabled'))});
    const result = await service.status(value.id,value.token);
    process.stdout.write(result.status);
  } catch { process.stderr.write('Synthetic worker failed'); process.exitCode=1; }
  finally { if(db?.isInitialized) await db.destroy(); }
});
