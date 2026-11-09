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
const {Agent} = require('../../../../src/agent/agent.entity');
const {AgentClassService} = require('../../../../src/agent/agent-class.service');
const {WalletService} = require('../../../../src/wallet/wallet.service');
const {createIntegrationDataSourceFromScratch, destroyIntegrationDataSource} = require('../../../../test/support/pg-harness');
const {seedLocalRoles,emailFor,passwordFor} = require('../../../../scripts/local-dev-seed-11-roles');
if (process.env.NODE_ENV !== 'test' || process.env.NOTIFICATION_WORKER_ENABLED !== 'false' || process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false' || process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database' || !process.env.NODE_OPTIONS?.includes('mission-25c-network-guard.cjs')) throw Error('Test mode, disabled workers, confirmation and outbound Node guard required');
const output='docs/admin-m2/evidence/design-real';
const views=['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'];
const roles=['SUPER_ADMIN','FINANCE_CONTROLLER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','AGENT_NETWORK_MANAGER','OPERATIONS','ADMINISTRATOR','FINANCE_AUDITOR','FINANCE_PREPARER','TREASURY'];
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
(async()=>{
 let ds,app,proxy,vite,browser;
 const manifest={source:'Windows-equivalent Vite dev server from current source, real Nest AppModule and disposable migrated PostgreSQL',baseCommit:process.env.CAPTURE_COMMIT || null,auth:'real local development login for seeded test roles',backend:'Only GET and local-login POST allowed; no fixtures, real providers or workers',screens:[],warnings:[]};
 try {
  fs.mkdirSync(output,{recursive:true});
  ds=await createIntegrationDataSourceFromScratch('m2design');
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app=mod.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false})); await app.init(); await app.getHttpAdapter().getInstance().ready();
  await seedLocalRoles(ds,mod.get('A2_WORKFORCE_CONFIG'),mod.get(AuditService));
  const agentClass=await mod.get(AgentClassService).create({reference:`design-class-${randomUUID()}`,code:`M2-${randomUUID().slice(0,8)}`,name:'Design fixture class',actor:'test',applicableServices:['CASH_IN','AGENT_FUNDING','AGENT_DEFUNDING']});
  const agent=await ds.getRepository(Agent).save({id:randomUUID(),reference:'M2-DESIGN-AGENT',status:'ACTIVE',agentClassId:agentClass.id});
  await mod.get(WalletService).createWallet({customerId:agent.id,currency:'NGN',idempotencyKey:`design-wallet-${randomUUID()}`});
  const customerId=randomUUID();
  await ds.query("INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')",[customerId,'m2-design-customer']);
  await ds.query('INSERT INTO customer_profiles (customer_id,display_name,is_active) VALUES ($1,$2,true)',[customerId,'M2 Design Review Customer']);
  const ticketId=randomUUID();
  await ds.query("INSERT INTO support_tickets (id,reference,customer_id,created_by_type,created_by_id,subject,category,description,status,priority) VALUES ($1,$2,$3,'CUSTOMER','fixture','M2 design review issue','OTHER','Disposable local fixture','OPEN','MEDIUM')",[ticketId,'M2-DESIGN-SUPPORT',customerId]);
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
  for(const width of [1440,375]) {
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
     const h=(await page.locator('[data-testid="main-content"] h1, [data-testid="main-content"] h2').allTextContents()).slice(0,6);
     const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
     const file=`${key}-${width}.png`;await page.screenshot({path:`${output}/${file}`,fullPage:true});
     manifest.screens.push({key,role,width,file,headings:h,geometry:size});done.add(key); console.log('CAPTURE',width,role,key,JSON.stringify(h));
     const extra=async(name)=>{const file=`${name}-${width}.png`;await page.waitForTimeout(400);await page.waitForLoadState('networkidle');await page.waitForTimeout(200);await page.screenshot({path:`${output}/${file}`,fullPage:true});manifest.screens.push({key:name,role,width,file,interaction:true});};
     if(key==='ledgerExplorer') {
      assert.equal(await page.getByText('Ledger account list returned an invalid response.').count(),0,'real account-list response must render');
      assert.ok(await page.getByText(/Balance unavailable/).count(),'real account list must not invent balances');
     }
     if(key==='customers') {
      const create=page.getByRole('button',{name:'New Customer'});
      if(await create.count()){await create.click();await extra('customer-registration');await page.getByRole('button',{name:'Close registration'}).click();}
      const open=page.getByRole('button',{name:'Open Customer 360° for M2 Design Review Customer'});
      if(await open.count()) {
       await open.click();await page.getByRole('tablist',{name:'Customer 360 sections'}).waitFor();await extra('customer-overview');
       await page.getByRole('tab',{name:'Personal information & contact'}).click();await extra('customer-personal');
       await page.getByRole('tab',{name:'Proof of Address & physical verification'}).click();await extra('customer-proof');
      } else manifest.warnings.push({width,missingInteraction:'customer fixture not visible'});
     }
     if(key==='agents') {
      const row=page.getByRole('row').filter({hasText:'M2-DESIGN-AGENT'});
      if(await row.count()){await row.getByRole('button',{name:'View'}).click();await extra('agent-detail');const load=page.getByRole('button',{name:'Load Agent transactions'});if(await load.count()){await load.click();await extra('agent-transactions');}}
      else manifest.warnings.push({width,missingInteraction:'agent fixture not visible'});
     }
     if(key==='support') {
      const row=page.getByRole('row').filter({hasText:'M2-DESIGN-SUPPORT'});
      if(await row.count()){await row.getByRole('button',{name:'View'}).click();await extra('support-detail');}
      else manifest.warnings.push({width,missingInteraction:'ticket fixture not visible'});
     }
     if(key==='notifications') {
      const tabs=await page.getByRole('tablist',{name:'Notification management sections'}).getByRole('tab').all();
      for(const tab of tabs){const id=await tab.getAttribute('id');await tab.click();await extra('notification-'+id.replace('notification-tab-',''));}
     }

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
