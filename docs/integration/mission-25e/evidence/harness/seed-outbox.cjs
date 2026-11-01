// M25E TEST FIXTURE — inserts raw outbox FACTS only (no notification decisions).
// The product consumer decides MATERIALIZED / QUARANTINED / UNSUPPORTED for them.
const {Client}=require('/home/user/m25e/node_modules/pg');
const {randomUUID}=require('node:crypto');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:5432,user:'monienaija',password:'monienaija-pw',database:'monienaija_e2e'});
  await c.connect();
  const rows=[
    // H-04: deposit/withdrawal are domain facts with no approved notification mapping
    {et:'deposit.completed', at:'DEPOSIT', payload:{depositId:randomUUID(), journalId:randomUUID()}, key:'deposit.completed:'+randomUUID()},
    {et:'withdrawal.failed', at:'WITHDRAWAL', payload:{withdrawalId:randomUUID(), failureCode:'INSUFFICIENT_FUNDS'}, key:'withdrawal.failed:'+randomUUID()},
    // H-03: legacy support fact with NO explicit isInternal marker -> visibility unknown
    {et:'support.ticket.message_added', at:'SUPPORT_TICKET', payload:{ticketId:randomUUID(), messageId:randomUUID(), authorType:'CUSTOMER', authorId:randomUUID()}, key:'support.ticket.message_added:'+randomUUID()},
  ];
  for(const r of rows){
    await c.query(`INSERT INTO outbox_events
      (id,event_type,aggregate_type,aggregate_id,payload,status,attempts,available_at,created_at,event_key,schema_version,classification,retention_class,occurred_at,correlation_id,causation_id)
      VALUES ($1,$2,$3,$4,$5,'PENDING',0,NOW(),NOW(),$6,1,'NOTIFICATION','STANDARD',NOW(),$7,NULL)`,
      [randomUUID(), r.et, r.at, randomUUID(), JSON.stringify(r.payload), r.key, 'm25e-fixture']);
    console.log('inserted fact:', r.et);
  }
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
