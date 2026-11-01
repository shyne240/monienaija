const {Client}=require('/home/user/m25e/node_modules/pg');
const {randomUUID}=require('node:crypto');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:5432,user:'monienaija',password:'monienaija-pw',database:'monienaija_e2e'});
  await c.connect();
  // a real customer so the recipient resolver has something to resolve
  const cust=await c.query("SELECT id FROM customers LIMIT 1");
  let customerId=cust.rows[0]?.id;
  console.log('existing customer:', customerId);
  const rows=[
    {et:'customer.funding.approved', at:'CUSTOMER_FUNDING_REQUEST', payload:{customerId: customerId||randomUUID(), reference:'M25E-REF-0001', amountClause:' of NGN 1,000.00'}, key:'customer.funding.approved:'+randomUUID()},
    {et:'customer.funding.requested', at:'CUSTOMER_FUNDING_REQUEST', payload:{customerId: customerId||randomUUID(), reference:'M25E-REF-0002', amountClause:''}, key:'customer.funding.requested:'+randomUUID()},
  ];
  for(const r of rows){
    await c.query(`INSERT INTO outbox_events
      (id,event_type,aggregate_type,aggregate_id,payload,status,attempts,available_at,created_at,event_key,schema_version,classification,retention_class,occurred_at,correlation_id,causation_id)
      VALUES ($1,$2,$3,$4,$5,'PENDING',0,NOW(),NOW(),$6,1,'NOTIFICATION','STANDARD',NOW(),$7,NULL)`,
      [randomUUID(), r.et, r.at, randomUUID(), JSON.stringify(r.payload), r.key, 'm25e-fixture']);
    console.log('inserted:', r.et);
  }
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
