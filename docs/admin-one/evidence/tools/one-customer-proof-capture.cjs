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
if (process.env.POA_UPLOADS_ENABLED !== 'true' || process.env.NODE_ENV !== 'test' || process.env.NOTIFICATION_WORKER_ENABLED !== 'false' || process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false' || process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database' || !process.env.NODE_OPTIONS?.includes('mission-25c-network-guard.cjs')) throw Error('Test mode, disabled workers, confirmation and outbound Node guard required');
const output='docs/admin-one/evidence/customer-proof-batch';
const views=['customers'];
const roles=['SUPER_ADMIN'];
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
(async()=>{
 let ds,app,proxy,vite,browser;
 const manifest={source:'Vite dev server from current source, real Nest AppModule and disposable migrated PostgreSQL',baseCommit:process.env.CAPTURE_COMMIT || null,auth:'real local development login for seeded test roles',backend:'Real API, seeded synthetic local workforce and one synthetic customer, ledger-backed wallet and two metadata-only evidence records in disposable PostgreSQL; browser proxy permits only GET and local-login POST; no real providers or workers',screens:[],globalCustomerSearch:[],warnings:[]};
 try {
  fs.mkdirSync(output,{recursive:true});
  ds=await createIntegrationDataSourceFromScratch('m2design');
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app=mod.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false})); await app.init(); await app.getHttpAdapter().getInstance().ready();
  await seedLocalRoles(ds,mod.get('A2_WORKFORCE_CONFIG'),mod.get(AuditService));
  const customerId=randomUUID();
  await ds.query("INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')",[customerId,'one-local-review-customer']);
  await ds.query('INSERT INTO customer_profiles (customer_id,display_name,is_active) VALUES ($1,$2,true)',[customerId,'Local Review Customer']);
  const walletId=randomUUID(),accountId=randomUUID();
  await ds.query("INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency) VALUES ($1,'LOCAL-C360-WALLET','Synthetic wallet','LIABILITY','CREDIT','NGN')",[accountId]);
  await ds.query("INSERT INTO wallet_accounts (id,customer_id,currency,ledger_account_id) VALUES ($1,$2,'NGN',$3)",[walletId,customerId,accountId]);
  const addressId=randomUUID(),evidence1=randomUUID(),evidence2=randomUUID();
  await ds.query("INSERT INTO customer_addresses (id,customer_id,type,line_one,city,state,country,is_primary) VALUES ($1,$2,'RESIDENTIAL','Synthetic address','Abuja','FCT','NG',true)",[addressId,customerId]);
  await ds.query("INSERT INTO customer_proof_of_address_submissions (id,submission_group_id,customer_id,residential_address_id,category,document_type,created_by_principal_id,created_by_role_key,document_status,scanner_result) VALUES ($1,$1,$3,$4,'UTILITY','UTILITY_BILL','fixture','OPERATIONS','QUARANTINED','UNAVAILABLE'),($2,$2,$3,$4,'BANK','BANK_STATEMENT','fixture','OPERATIONS','QUARANTINED','ERROR')",[evidence1,evidence2,customerId,addressId]);
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
     const nav=page.getByTestId((mobile?'mobile-':'')+'nav-'+key);
     if(!await nav.count()) {if(mobile) await page.keyboard.press('Escape');continue;}
     await nav.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(200);
     await page.getByRole('button',{name:'Open Customer 360° for Local Review Customer'}).waitFor({timeout:20000});
     await page.getByRole('button',{name:'Open Customer 360° for Local Review Customer'}).click();
     await page.getByRole('button',{name:'View NGN wallet details'}).waitFor({timeout:20000});
     const capture=async(name)=>{const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.equal(size.client,size.scroll,`Overflow ${name} ${width}`);await page.waitForTimeout(150);await page.screenshot({path:`${output}/${name}-${width}.png`});manifest.screens.push({key:name,role,width,file:`${name}-${width}.png`,geometry:size});};
     await page.evaluate(()=>window.scrollTo(0,0));await capture('overview');
     const wallet=page.getByRole('button',{name:'View NGN wallet details'});await wallet.click();const drawer=page.getByRole('dialog',{name:'Wallet details'});await drawer.waitFor();await capture('wallet');await page.keyboard.press('Escape');assert.equal(await drawer.count(),0);assert.equal(await wallet.evaluate(e=>document.activeElement===e),true);
     await page.getByRole('tab',{name:'Personal information & contact'}).click();await page.getByRole('navigation',{name:'Personal information sections'}).waitFor({timeout:20000});await page.evaluate(()=>window.scrollTo(0,0));await capture('personal');
     await page.getByRole('link',{name:'Addresses',exact:true}).click();await capture('addresses');
     await page.getByRole('tab',{name:'Proof of Address & physical verification'}).click();await page.getByRole('navigation',{name:'Address verification sections'}).waitFor({timeout:20000});await page.evaluate(()=>window.scrollTo(0,0));await capture('proof');
     await page.getByRole('link',{name:'Evidence upload'}).waitFor({timeout:20000});
     await page.getByRole('link',{name:'Evidence upload'}).click(); await capture('upload');
     await page.getByRole('link',{name:'Submission history'}).click();
     await page.getByRole('group',{name:'Loaded evidence state'}).waitFor();
     await page.getByRole('button',{name:'Available',exact:true}).click();
     await page.getByText('No loaded records match this state.',{exact:false}).waitFor();await capture('filtered-empty');
     await page.getByRole('button',{name:'Quarantined',exact:true}).click();
     await page.getByText('2 of 2 loaded records shown').waitFor();await capture('evidence');
     await page.getByRole('button',{name:'View history'}).first().click();
     await page.getByRole('region',{name:'History for revision 1'}).first().waitFor();await capture('history');
     await page.getByRole('link',{name:'Physical verification',exact:true}).click();await capture('physical');
     done.add(key);console.log('CAPTURE',width,role,key);

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
