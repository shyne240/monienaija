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
const output='docs/admin-one/evidence/notification-templates-batch';
const views=['notifications'];
const roles=['SUPER_ADMIN'];
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
(async()=>{
 let ds,app,proxy,vite,browser;
 const manifest={source:'Vite dev server from current source, real Nest AppModule and disposable migrated PostgreSQL',baseCommit:process.env.CAPTURE_COMMIT || null,auth:'real local development login for seeded test roles',backend:'Real API, seeded synthetic local workforce and template history versions in disposable PostgreSQL; browser proxy permits only GET and local-login POST; no real providers or workers',screens:[],warnings:[]};
 try {
  fs.mkdirSync(output,{recursive:true});
  ds=await createIntegrationDataSourceFromScratch('m2design');
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app=mod.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false})); await app.init(); await app.getHttpAdapter().getInstance().ready();
  await seedLocalRoles(ds,mod.get('A2_WORKFORCE_CONFIG'),mod.get(AuditService));
  for (const channel of ['SMS','EMAIL']) await ds.query("INSERT INTO notification_templates (event_type,channel,locale,version,is_active,subject,body,created_by) VALUES ('transfer.completed',$1,'en-NG',2,false,$2,'Synthetic historical template for local review','fixture-maker')",[channel,channel==='EMAIL'?'Synthetic subject':null]);
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
     const section=page.getByTestId((mobile?'mobile-':'')+'section-platform');
     if(await section.getAttribute('aria-expanded')!=='true') await section.click();
     const nav=page.getByTestId((mobile?'mobile-':'')+'nav-'+key);
     if(!await nav.count()) {if(mobile) await page.keyboard.press('Escape');continue;}
     await nav.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(200);
     await page.getByRole('tab',{name:'3. SMS Templates'}).click();await page.getByTestId('template-workspace-sms').waitFor({timeout:20000});
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
     for(const channel of ['SMS','EMAIL']) {
       if(channel==='EMAIL') await page.getByRole('tab',{name:'4. Email Templates'}).click();
       const workspace=page.getByTestId('template-workspace-'+channel.toLowerCase());await workspace.waitFor();const select=workspace.getByLabel('Notification event');await select.selectOption('transfer.completed');await workspace.getByText('Showing 2 of 2 loaded versions. Filtering does not change a draft or propose a rollback.').waitFor({timeout:20000});
       const filter=workspace.getByLabel(channel+' version number filter');await filter.fill('2');assert.match(await workspace.innerText(),/Showing 1 of 2 loaded versions/);
       const compare=workspace.getByRole('button',{name:'Compare version 2 with active version'});await compare.click();const comparison=workspace.getByTestId('template-version-comparison');await comparison.waitFor();assert.equal(await comparison.evaluate(e=>document.activeElement===e),true);await comparison.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${channel.toLowerCase()}-comparison-${width}.png`});manifest.screens.push({key:channel+' comparison',role,width,file:`${channel.toLowerCase()}-comparison-${width}.png`,interaction:true});
       await workspace.getByRole('button',{name:'Close Comparison'}).click();assert.equal(await compare.evaluate(e=>document.activeElement===e),true);await filter.fill('999');await workspace.getByText('No loaded versions match this filter.').waitFor();await filter.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${channel.toLowerCase()}-filter-${width}.png`});manifest.screens.push({key:channel+' filter',role,width,file:`${channel.toLowerCase()}-filter-${width}.png`,interaction:true});
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
