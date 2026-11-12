// Actual Vite development UI -> actual Nest AppModule -> disposable migrated PostgreSQL.
// No API fixtures; every mutation is blocked except local test-account login.
// No preview: both ephemeral servers bind loopback and terminate on completion.
require('ts-node/register/transpile-only');
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');
const {Test} = require('@nestjs/testing');
const {ValidationPipe} = require('@nestjs/common');
const {FastifyAdapter} = require('@nestjs/platform-fastify');
const {DataSource} = require('typeorm');
const {chromium: playwright} = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const {AppModule} = require('../../../../src/app.module');
const {AuditService} = require('../../../../src/operations/audit.service');
const {createIntegrationDataSourceFromScratch, destroyIntegrationDataSource} = require('../../../../test/support/pg-harness');
const {seedLocalRoles,emailFor,passwordFor} = require('../../../../scripts/local-dev-seed-11-roles');
if (process.env.NODE_ENV !== 'test' || process.env.NOTIFICATION_WORKER_ENABLED !== 'false' || process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false' || process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database' || !process.env.NODE_OPTIONS?.includes('mission-25c-network-guard.cjs')) throw Error('Test mode, disabled workers, confirmation and outbound Node guard required');
const output='docs/admin-one/evidence/c2c-batch';
const views=['cashToCashOps'];
const roles=['SUPER_ADMIN'];
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
(async()=>{
 let ds,app,proxy,vite,browser;
 const manifest={source:'Vite dev server from current source, real Nest AppModule and disposable migrated PostgreSQL',baseCommit:process.env.CAPTURE_COMMIT || null,auth:'real local development login for seeded test roles',backend:'Real API, seeded synthetic local workforce and synthetic agent, transfer and journal in disposable storage in disposable PostgreSQL; browser proxy permits only GET and local-login POST; no real providers or workers',screens:[],warnings:[]};
 try {
  fs.mkdirSync(output,{recursive:true});
  ds=await createIntegrationDataSourceFromScratch('m2design');
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app=mod.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false})); await app.init(); await app.getHttpAdapter().getInstance().ready();
  await seedLocalRoles(ds,mod.get('A2_WORKFORCE_CONFIG'),mod.get(AuditService));
  const agentId=randomUUID(), journalId=randomUUID(), transferId=randomUUID();
  await ds.query("INSERT INTO agents (id,reference,status) VALUES ($1,'LOCAL-REVIEW-AGENT','ACTIVE')",[agentId]);
  const debitAccount=randomUUID(), creditAccount=randomUUID();
  await ds.transaction(async tx=>{
   await tx.query("INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency) VALUES ($1,'LOCAL-C2C-DEBIT','Synthetic debit','ASSET','DEBIT','NGN'),($2,'LOCAL-C2C-CREDIT','Synthetic credit','LIABILITY','CREDIT','NGN')",[debitAccount,creditAccount]);
   await tx.query("INSERT INTO ledger_journals (id,idempotency_key,request_hash,currency,total_minor,reference) VALUES ($1,'local-journal',$2,'NGN',10000,'LOCAL-REVIEW-JOURNAL')",[journalId,'a'.repeat(64)]);
   await tx.query("INSERT INTO ledger_lines (id,journal_id,ledger_account_id,line_number,direction,amount_minor,currency,accounting_unit) VALUES ($1,$2,$3,1,'DEBIT',10000,'NGN','CUSTOMER_FUNDS'),($4,$2,$5,2,'CREDIT',10000,'NGN','CUSTOMER_FUNDS')",[randomUUID(),journalId,debitAccount,randomUUID(),creditAccount]);
  });
  await ds.query("INSERT INTO cash_to_cash_transfers (id,agent_id,beneficiary_phone,principal_minor,fee_minor,vat_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,reference,idempotency_key,expires_at) VALUES ($1,$2,'8000000000',10000,0,0,10000,'NGN','UNCLAIMED','synthetic-unusable-hash','PBKDF2',$3,'LOCAL-REVIEW-C2C','local-capture',now()+interval '7 days')",[transferId,agentId,journalId]);
  proxy=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://localhost');
   if(req.method!=='GET' && !(req.method==='POST' && u.pathname==='/api/v1/internal/a2/workforce/local-admin-sessions')) {res.writeHead(403);return res.end('Blocked by design capture');}
   try {let body='';for await(const chunk of req) body+=chunk;
    const result=await app.getHttpAdapter().getInstance().inject({method:req.method,url:req.url,headers:{authorization:req.headers.authorization||'',...(body?{'content-type':'application/json'}:{})},...(body?{payload:body}:{})});
    if(result.statusCode>=500) manifest.warnings.push({path:u.pathname,status:result.statusCode});
    res.writeHead(result.statusCode,{'content-type':result.headers['content-type']||'application/json'});res.end(result.payload);
   } catch(e) {res.writeHead(500);res.end('Capture proxy failed');manifest.warnings.push({path:u.pathname,error:e.message});}
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const port=await freePort();
  vite=spawn(process.execPath,[path.resolve('apps/admin-web/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:path.resolve('apps/admin-web'),env:{...process.env,NODE_ENV:'development',ADMIN_WEB_DEV_PROXY_TARGET:`http://127.0.0.1:${proxy.address().port}`},stdio:['ignore','pipe','pipe']});
  let logs='';vite.stdout.on('data',b=>logs+=b);vite.stderr.on('data',b=>logs+=b);
  await new Promise((resolve,reject)=>{const deadline=Date.now()+30000;const check=()=>{if(vite.exitCode!==null)return reject(Error('Vite exited '+logs));const q=http.get(`http://127.0.0.1:${port}/`,r=>{r.resume();resolve()});q.on('error',()=>{if(Date.now()>deadline)reject(Error('Vite startup '+logs));else setTimeout(check,200);});};check();});
  const origin=`http://127.0.0.1:${port}`;
  browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(x=>x!=='--single-process'),headless:true});
  for(const width of [1440,768,375]) {
   const done=new Set();
   for(const role of roles) {
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const page=await context.newPage(); page.on('dialog',d=>d.dismiss());
    await page.goto(origin,{waitUntil:'networkidle'});
    if(role==='SUPER_ADMIN') {
     await page.screenshot({path:`${output}/login-${width}.png`,fullPage:true});
     manifest.screens.push({key:'login',role:'unauthenticated',width,file:`login-${width}.png`,heading:await page.locator('h1').allTextContents()});
    }
    await page.getByLabel('Email or username').fill(emailFor(role));
    await page.getByLabel('Password',{exact:true}).fill(passwordFor(role));
    await page.getByRole('button',{name:'Sign In',exact:true}).click();
    await page.getByTestId('main-content').waitFor({timeout:20000});await page.waitForLoadState('networkidle');
    for(const key of views) {
     if(done.has(key)) continue;
     const mobile=width<1024;
     if(mobile) await page.getByTestId('mobile-menu-toggle').click();
     const section=page.getByTestId((mobile?'mobile-':'')+'section-money');
     if(await section.getAttribute('aria-expanded')!=='true') await section.click();
     const nav=page.getByTestId((mobile?'mobile-':'')+'nav-'+key);
     if(!await nav.count()) {if(mobile) await page.keyboard.press('Escape');continue;}
     await nav.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(200);
     await page.getByRole('button',{name:'Inspect receipt'}).first().waitFor({timeout:20000});
     await page.getByRole('button',{name:'Unclaimed',exact:true}).click();
     assert.equal(await page.getByText('Applied: All transfers').count(),1);
     await page.getByRole('button',{name:'Search',exact:true}).click();
     await page.getByText('Applied: status: UNCLAIMED').waitFor();
     await page.getByRole('button',{name:'Inspect receipt'}).first().waitFor({timeout:20000});
     const h=(await page.locator('[data-testid="main-content"] h1, [data-testid="main-content"] h2').allTextContents()).slice(0,6);
     const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
     if(size.scroll!==size.client) console.log('OVERFLOW', JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,20).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,overflow:getComputedStyle(e).overflowX})))));
     assert.equal(size.scroll, size.client, `Unexpected page-level horizontal overflow on ${key} at ${width}px`);
     await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(200);
     const file=`${key}-${width}.png`;
     // Chromium's fullPage capture can omit off-screen contents of overflow regions.
     // For a complete narrow directory image, expand viewport height only; separate
     // 900px viewport captures below verify the real scrolled state.
     let captureHeight=900;
     if(mobile && key==='customers') {captureHeight=await page.evaluate(()=>document.documentElement.scrollHeight);await page.setViewportSize({width,height:captureHeight});await page.waitForTimeout(400);}
     await page.screenshot({path:`${output}/${file}`});
     if(captureHeight!==900) await page.setViewportSize({width,height:900});
     manifest.screens.push({key,role,width,file,headings:h,geometry:size,captureHeight});done.add(key); console.log('CAPTURE',width,role,key,JSON.stringify(h));
     await page.locator('[aria-label="Cash-to-cash transfers"]').evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(200);
     await page.screenshot({path:`${output}/results-${width}.png`});
     manifest.screens.push({key:'results',role,width,file:`results-${width}.png`,interaction:true});
     const trigger=page.getByRole('button',{name:'Inspect receipt'}).first();
     await trigger.click(); const dialog=page.getByRole('dialog',{name:'Cash-to-Cash receipt details'}); await dialog.waitFor();
     await page.screenshot({path:`${output}/receipt-${width}.png`});
     manifest.screens.push({key:'receipt',role,width,file:`receipt-${width}.png`,interaction:true});
     await dialog.getByRole('button',{name:'Inspect initiation journal'}).click();
     await dialog.getByTestId('c2c-inspected-journal').getByText('BALANCED').waitFor({timeout:20000});
     await dialog.getByTestId('c2c-inspected-journal').scrollIntoViewIfNeeded();
     await page.screenshot({path:`${output}/journal-${width}.png`});
     manifest.screens.push({key:'journal',role,width,file:`journal-${width}.png`,interaction:true});
     await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
     assert.equal(await trigger.evaluate(e=>document.activeElement===e),true);



    }
    await context.close(); if(done.size===views.length) break;
   }
   const missing=views.filter(x=>!done.has(x)); if(missing.length) manifest.warnings.push({width,missing});
  }
  fs.writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  console.log('TOTAL',manifest.screens.length,'WARNINGS',JSON.stringify(manifest.warnings));
  assert.deepEqual(manifest.warnings,[]);
 } finally {
  if(browser) await browser.close();if(vite){vite.kill('SIGTERM');}if(proxy)await new Promise(r=>proxy.close(r));if(app)await app.close();if(ds)await destroyIntegrationDataSource(ds);
 }
})().catch(e=>{console.error(e);process.exitCode=1});
