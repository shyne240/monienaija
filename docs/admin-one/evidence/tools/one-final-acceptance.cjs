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
const output='docs/admin-one/evidence/final-acceptance';
const views={home:['dashboard','dashboardSettings'],servicing:['customers','agents','agentClasses','support'],money:['transfers','cashIn','cashOut','cashToCashOps'],finance:['ledgerExplorer','reconciliation'],commercial:['feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments'],compliance:['kycQueue','complianceCases','fraudCases'],platform:['workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents']};
const roles=['SUPER_ADMIN','FINANCE_CONTROLLER','ADMINISTRATOR','OPERATIONS','CUSTOMER_SERVICE','COMPLIANCE','RISK_FRAUD','AGENT_NETWORK_MANAGER','FINANCE_AUDITOR','FINANCE_PREPARER','TREASURY'];
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
(async()=>{
 let ds,app,proxy,vite,browser;
 const manifest={source:'Real Vite UI and Nest AppModule with disposable migrated PostgreSQL',baseCommit:process.env.CAPTURE_COMMIT || null,safety:'GET and local-login POST only; workers and outbound requests disabled',screens:[],roles:[],unauthenticated:[],restricted:[],interactions:[],browserErrors:[],apiFailures:[],requestFailures:[],blockedExternalHosts:[],warnings:[]};
 try {
  fs.mkdirSync(output,{recursive:true});
  ds=await createIntegrationDataSourceFromScratch('m2design');
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app=mod.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false})); await app.init(); await app.getHttpAdapter().getInstance().ready();
  await seedLocalRoles(ds,mod.get('A2_WORKFORCE_CONFIG'),mod.get(AuditService));
  const customerId=randomUUID();
  await ds.query("INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')",[customerId,'one-audit-review-customer']);
  await ds.query('INSERT INTO customer_profiles (customer_id,display_name,is_active) VALUES ($1,$2,true)',[customerId,'Audit Review Customer']);
  for(const endpoint of ['/internal/notifications/changes','/internal/notifications/provider-config','/internal/metrics','/internal/a2/workforce/dashboard/assignments']) {
    const response=await app.getHttpAdapter().getInstance().inject({method:'GET',url:'/api/v1'+endpoint});
    manifest.unauthenticated.push({endpoint,status:response.statusCode});if(![401,403].includes(response.statusCode)) manifest.warnings.push({unauthenticated:endpoint,status:response.statusCode});
  }
  proxy=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://localhost');
   if(req.method!=='GET' && !(req.method==='POST' && u.pathname==='/api/v1/internal/a2/workforce/local-admin-sessions')) {res.writeHead(403);return res.end('Blocked by acceptance audit');}
   try {let body='';for await(const chunk of req) body+=chunk;
    const result=await app.getHttpAdapter().getInstance().inject({method:req.method,url:req.url,headers:{authorization:req.headers.authorization||'',...(body?{'content-type':'application/json'}:{})},...(body?{payload:body}:{})});
    res.writeHead(result.statusCode,{'content-type':result.headers['content-type']||'application/json'});res.end(result.payload);
   } catch(e) {res.writeHead(500);res.end('Capture proxy failed');}
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
    await context.route('**/*',r=>{if(r.request().url().startsWith(origin+'/'))return r.continue();let host;try{host=new URL(r.request().url()).host}catch{host='invalid'};manifest.blockedExternalHosts.push({role,width,host});return r.abort();});
    const page=await context.newPage(); let current='login';
    page.on('dialog',d=>d.dismiss());
    page.on('pageerror',error=>manifest.browserErrors.push({role,width,screen:current,type:'pageerror',message:error.message}));
    page.on('console',msg=>{if(msg.type()==='error')manifest.browserErrors.push({role,width,screen:current,type:'console',message:msg.text().slice(0,300)});});
    page.on('requestfailed',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))manifest.requestFailures.push({role,width,screen:current,path:url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id'),error:request.failure()?.errorText || 'failed'});});
    page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/') && response.status()>=400)manifest.apiFailures.push({role,width,screen:current,path:url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id'),status:response.status()});});
    await page.goto(origin,{waitUntil:'networkidle'});
    if(role==='SUPER_ADMIN') await page.screenshot({path:`${output}/login-${width}.png`});
    await page.getByLabel('Email or username').fill(emailFor(role));await page.getByLabel('Password',{exact:true}).fill(passwordFor(role));await page.getByRole('button',{name:'Sign In',exact:true}).click();
    await page.getByTestId('main-content').waitFor({timeout:20000});await page.waitForLoadState('networkidle');
    const visible=[];
    for(const [section,keys] of Object.entries(views)) {
     const mobile=width<1024;
     if(mobile) await page.getByTestId('mobile-menu-toggle').click();
     const sectionButton=page.getByTestId((mobile?'mobile-':'')+'section-'+section);
     if(await sectionButton.count() && await sectionButton.getAttribute('aria-expanded')!=='true') await sectionButton.click();
     for(const key of keys) {const nav=page.getByTestId((mobile?'mobile-':'')+'nav-'+key);if(await nav.count())visible.push(key);}
     if(mobile) await page.keyboard.press('Escape');
    }
    manifest.roles.push({role,width,visible});
    if(width===1440 && ['CUSTOMER_SERVICE','RISK_FRAUD'].includes(role)) {
      const token=await page.evaluate(()=>localStorage.getItem('admin_workforce_token'));
      for(const endpoint of ['/internal/notifications/provider-config','/internal/a2/workforce/dashboard/assignments']) {
        const response=await app.getHttpAdapter().getInstance().inject({method:'GET',url:'/api/v1'+endpoint,headers:{authorization:`Bearer ${token}`}});
        manifest.restricted.push({role,endpoint,status:response.statusCode});if(![401,403].includes(response.statusCode))manifest.warnings.push({role,restricted:endpoint,status:response.statusCode});
      }
    }
    for(const [section,keys] of Object.entries(views)) for(const key of keys) {
     if(done.has(key)||!visible.includes(key))continue;
     const mobile=width<1024;
     if(mobile) await page.getByTestId('mobile-menu-toggle').click();
     const sectionButton=page.getByTestId((mobile?'mobile-':'')+'section-'+section);if(await sectionButton.count() && await sectionButton.getAttribute('aria-expanded')!=='true') await sectionButton.click();
     current=key;await page.getByTestId((mobile?'mobile-':'')+'nav-'+key).click();await page.waitForLoadState('networkidle');await page.waitForTimeout(350);
     const data=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,headings:Array.from(document.querySelectorAll('[data-testid="main-content"] h1, [data-testid="main-content"] h2')).map(e=>e.textContent).slice(0,6),text:document.querySelector('[data-testid="main-content"]')?.innerText.slice(0,500)}));
     if(data.client!==data.scroll)manifest.warnings.push({role,width,screen:key,overflow:data});
     const file=`${key}-${width}.jpg`;await page.screenshot({path:`${output}/${file}`,type:'jpeg',quality:65});
     manifest.screens.push({key,role,width,file,...data});done.add(key);console.log('CHECK',width,role,key,data.client,data.scroll);
     if(key==='customers') {
       const trigger=page.getByRole('button',{name:'Preview Audit Review Customer'});await trigger.waitFor();await trigger.click();const dialog=page.getByRole('dialog',{name:'Customer preview'});await dialog.waitFor();await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await trigger.evaluate(e=>document.activeElement===e),true);
       const table=page.getByRole('region',{name:'Customer records table'});const dimensions=await table.evaluate(e=>({width:e.clientWidth,total:e.scrollWidth}));if(dimensions.total>dimensions.width){await table.evaluate(e=>{e.scrollLeft=e.scrollWidth});assert.ok(await table.evaluate(e=>e.scrollLeft)>0);}
       manifest.interactions.push({key,width,check:'customer preview Escape/focus and table scrolling',dimensions});
     }
     if(key==='support') {const group=page.getByRole('group',{name:'Ticket status filters'});const info=await group.evaluate(e=>({width:e.clientWidth,total:e.scrollWidth}));if(info.total>info.width){await page.getByText('Scroll horizontally to see all filters.').waitFor();await group.evaluate(e=>{e.scrollLeft=e.scrollWidth});assert.ok(await group.evaluate(e=>e.scrollLeft)>0);}await group.getByRole('button',{name:'Closed',exact:true}).click();assert.equal(await group.getByRole('button',{name:'Closed',exact:true}).getAttribute('aria-pressed'),'true');await page.waitForLoadState('networkidle');manifest.interactions.push({key,width,check:'status filter scrolling and selection',dimensions:info});}
     if(key==='dashboardSettings') {const input=page.getByLabel('Search loaded templates');await input.fill('no-synthetic-template-match');await page.getByText('No loaded templates match this search.').waitFor();await page.getByRole('button',{name:'Clear search'}).click();assert.equal(await input.inputValue(),'');manifest.interactions.push({key,width,check:'template filter empty and clear'});}
     if(key==='productCatalogue') {const input=page.getByLabel('Search Products on this page');await input.fill('no-synthetic-product-match');await page.getByText(/No.*match/i).first().waitFor();await input.fill('');const trigger=page.getByRole('button',{name:'View details'}).first();await trigger.click();const dialog=page.getByRole('dialog',{name:'Products record details'});await dialog.waitFor();await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(e=>document.activeElement===e),true);manifest.interactions.push({key,width,check:'local filter and product drawer Escape/focus'});}
     if(key==='notifications') {await page.getByRole('button',{name:/Explore event catalogue/}).click();const tab=page.getByRole('tab',{name:'2. Event Catalogue & Triggers'});assert.equal(await tab.getAttribute('aria-selected'),'true');assert.equal(await tab.evaluate(e=>document.activeElement===e),true);manifest.interactions.push({key,width,check:'event shortcut and tab focus'});}
     if(key==='systemHealth') {const input=page.getByLabel('Search loaded metrics');await input.fill('no-synthetic-metric-match');await page.getByText('No loaded metrics match this search.').waitFor();await page.getByRole('button',{name:'Clear search'}).click();assert.equal(await input.inputValue(),'');await page.getByTestId('system-health-load-outbox-receipts-btn').click();await page.getByTestId('system-health-outbox-receipts-panel').waitFor();manifest.interactions.push({key,width,check:'metric search/clear and independent receipts read'});}

    }
    await context.close();
    if(done.size===Object.values(views).flat().length)break;
   }
   const missing=Object.values(views).flat().filter(key=>!done.has(key));if(missing.length)manifest.warnings.push({width,missing});
  }
  fs.writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  console.log('TOTAL',manifest.screens.length,'WARNINGS',JSON.stringify(manifest.warnings),'BROWSER ERRORS',manifest.browserErrors.length,'API FAILURES',manifest.apiFailures.length,'REQUEST FAILURES',manifest.requestFailures.length,'EXTERNAL BLOCKS',manifest.blockedExternalHosts.length);
 } finally {if(browser)await browser.close();if(vite)vite.kill('SIGTERM');if(proxy)await new Promise(r=>proxy.close(r));if(app)await app.close();if(ds)await destroyIntegrationDataSource(ds);}
})().catch(e=>{console.error(e);process.exitCode=1});
