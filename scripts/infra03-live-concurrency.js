require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'ES2023' } });
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const fs=require('fs');
const seedResult=require('../infra03-seed-result.json');
const DB_NAME=seedResult.database;
const trustKey=Buffer.from(seedResult.trustKeyB64,'base64url');
async function buildApp(port){
  const {AppModule}=require('../src/app.module');
  const {KycTierEvidenceReader}=require('../src/kyc-verification/kyc-tier-evidence.reader');
  const {createTestEvidenceReader}=require('../test/support/kyc-test-evidence-reader');
  const kycEvidence=createTestEvidenceReader({mode:'ELIGIBLE',key:trustKey});
  const ds=new DataSource({type:'postgres',host:'127.0.0.1',port:5432,username:'monienaija',password:'monienaija-pw',database:DB_NAME,synchronize:false,migrationsRun:false,entities:[__dirname+'/../src/**/*.entity.ts'],migrations:[__dirname+'/../src/migrations/*.ts'],logging:false});
  await ds.initialize();
  const m=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).overrideProvider(KycTierEvidenceReader).useValue(kycEvidence.reader).compile();
  const app=m.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); await app.init(); await app.getHttpAdapter().getInstance().ready(); await app.listen(port,'0.0.0.0'); return {app,ds};
}
async function p(base,path,body,token,idem){
  const h={'content-type':'application/json'}; if(token) h.authorization=`Bearer ${token}`; if(idem) h['idempotency-key']=idem;
  const r=await fetch(base+path,{method:'POST',headers:h,body:JSON.stringify(body)}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}; return {status:r.status,body:j};
}
async function g(base,path,token){
  const h={}; if(token) h.authorization=`Bearer ${token}`; const r=await fetch(base+path,{headers:h}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}; return {status:r.status,body:j};
}
(async()=>{
  const A='http://127.0.0.1:3001/api/v1',B='http://127.0.0.1:3002/api/v1';
  const a=await buildApp(3001), b=await buildApp(3002);
  const out={database:DB_NAME, steps:[]};
  const push=(k,v)=>{out.steps.push({k,v}); console.log(k,JSON.stringify(v).slice(0,300));};
  try{
    let r=await p(A,'/customers/sessions',{customerId:seedResult.A.customerId,password:seedResult.A.password}); push('loginA',{status:r.status,hasToken:!!r.body.accessToken});
    const tokenA=r.body.accessToken;
    let rB=await p(B,'/customers/sessions',{customerId:seedResult.B.customerId,password:seedResult.B.password}); push('loginB',{status:rB.status});
    const tokenB=rB.body.accessToken;
    let meB=await g(B,'/customers/me',tokenA); push('crossInstanceAuth',{status:meB.status, pass:meB.status===200&&meB.body.id===seedResult.A.customerId});
    let bad=await g(B,'/customers/me','invalid-token-xyz'); push('unauthorizedRejected',{status:bad.status, pass:bad.status===401});
    let pinA=await p(A,'/customers/me/transaction-pin',{pin:'1234'},tokenA); push('setPinA',pinA.status);
    let pinB=await p(B,'/customers/me/transaction-pin',{pin:'4321'},tokenB); push('setPinB',pinB.status);
    // verify PIN via other instance
    let vPin=await p(B,'/customers/me/transaction-pin/verify',{pin:'1234'},tokenA); push('crossInstancePinVerify',{status:vPin.status, pass:vPin.status===200});
    const walletA=seedResult.A.walletId, walletB=seedResult.B.walletId;
    let bal0=await g(A,`/customers/me/wallets/${walletA}/balance`,tokenA); push('balanceBefore',{bal:bal0.body.balanceMinor});
    const suffix=Date.now();
    const amt='6000000';
    let [ra,rb]=await Promise.allSettled([p(A,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:amt,currency:'NGN',reference:`race-a-${suffix}`,pin:'1234'},tokenA,`race-a-${suffix}`), p(B,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:amt,currency:'NGN',reference:`race-b-${suffix}`,pin:'1234'},tokenA,`race-b-${suffix}`)]);
    const sA=ra.status==='fulfilled'?ra.value.status:-1, sB=rb.status==='fulfilled'?rb.value.status:-1;
    push('overdraftRace',{sA,sB,successes:[sA,sB].filter(s=>s===201).length, pass:[sA,sB].filter(s=>s===201).length===1});
    let sharedIdem=`shared-idem-${suffix}`, sharedRef=`shared-ref-${suffix}`;
    let [ia,ib]=await Promise.allSettled([p(A,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:'100000',currency:'NGN',reference:sharedRef,pin:'1234'},tokenA,sharedIdem), p(B,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:'100000',currency:'NGN',reference:sharedRef,pin:'1234'},tokenA,sharedIdem)]);
    const vA=ia.status==='fulfilled'?ia.value:{status:-1}, vB=ib.status==='fulfilled'?ib.value:{status:-1};
    const idA=vA.body?.id, idB=vB.body?.id;
    push('idempotencyRace',{statusA:vA.status,statusB:vB.status,sameId: idA&&idB&&idA===idB, idA, idB});
    const cnt=await a.ds.query('SELECT count(*)::int as c FROM ledger_journals WHERE reference=$1',[sharedRef]);
    push('idempotencyLedger',{count:cnt[0].c, pass:cnt[0].c===1});
    const conflictIdem=`conflict-idem-${suffix}`;
    let c1=await p(A,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:'50000',currency:'NGN',reference:`conflict-a-${suffix}`,pin:'1234'},tokenA,conflictIdem);
    let c2=await p(B,'/customers/me/transfers',{sourceWalletId:walletA,destinationWalletId:walletB,amountMinor:'99999',currency:'NGN',reference:`conflict-b-${suffix}`,pin:'1234'},tokenA,conflictIdem);
    push('conflictingPayload',{first:c1.status, second:c2.status, pass:c2.status===409});
    let finalBal=await g(A,`/customers/me/wallets/${walletA}/balance`,tokenA); push('finalBalance',{api:finalBal.body.balanceMinor});
    let sqlBal=await a.ds.query(`SELECT SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor::bigint ELSE -l.amount_minor::bigint END)::text as bal FROM ledger_lines l WHERE l.ledger_account_id=(SELECT ledger_account_id FROM wallet_accounts WHERE id=$1)`,[walletA]);
    push('sqlBalance',{bal:sqlBal[0].bal, pass: BigInt(sqlBal[0].bal)>=0n});
    // invariants
    const journalsA=await a.ds.query('SELECT count(*)::int as c FROM ledger_journals WHERE reference IN ($1,$2)',[`race-a-${suffix}`,`race-b-${suffix}`]);
    push('overdraftJournals',{count:journalsA[0].c, pass:journalsA[0].c===1});
    // ledger conservation: sum debits==credits per journal (ledger_lines.journal_id)
    const cons=await a.ds.query(`SELECT j.id, SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor::bigint ELSE 0 END)::text as deb, SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor::bigint ELSE 0 END)::text as cred FROM ledger_journals j JOIN ledger_lines l ON l.journal_id=j.id GROUP BY j.id HAVING SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor::bigint ELSE 0 END) != SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor::bigint ELSE 0 END) LIMIT 1`);
    push('conservation',{unbalancedJournals: cons.length, pass: cons.length===0});

    out.verdict = out.steps.every(s=> s.v.pass!==false) ? 'PASS' : 'FAIL';
    console.log('=== FINAL LIVE CONCURRENCY VERDICT', out.verdict,'===');
    fs.mkdirSync('docs/integration/evidence/infra03-live', {recursive:true});
    fs.writeFileSync('docs/integration/evidence/infra03-live/infra03-live-result.json', JSON.stringify(out,null,2));
    fs.writeFileSync('docs/integration/evidence/infra03-live/infra03-live.log', out.steps.map(s=>`${s.k}: ${JSON.stringify(s.v)}`).join('\n'));
  }catch(e){ console.error(e.stack); out.error=e.message; fs.mkdirSync('docs/integration/evidence/infra03-live',{recursive:true}); fs.writeFileSync('docs/integration/evidence/infra03-live/infra03-live-result.json',JSON.stringify(out,null,2));}
  await a.app.close(); await b.app.close(); await a.ds.destroy().catch(()=>{}); await b.ds.destroy().catch(()=>{}); process.exit(0);
})();
