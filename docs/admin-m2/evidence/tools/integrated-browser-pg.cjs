// Disposable real-PostgreSQL + real AppModule + real Admin Web browser integration.
// No external provider calls or deployed worker. The loopback server exists only during this test.
// Run from the repository root with a local PostgreSQL account able to create/drop disposable
// databases, the normal PG harness DB_* environment and a unique valid PG_TEST_RUN_ID.
// Example on Linux (adjust DB variables and Chromium libraries for your environment):
// NODE_ENV=test PG_TEST_RUN_ID=m2browser01 NOTIFICATION_WORKER_ENABLED=false \
// CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false NODE_OPTIONS="--require $PWD/test/support/mission-25c-network-guard.cjs" \
// node docs/admin-m2/evidence/tools/integrated-browser-pg.cjs
// Requires Chromium/Playwright and a built Admin Web dependency installation. Guard is not
// an OS firewall. No API response fixtures; test-issued sessions do not prove real IdP/MFA.
require('ts-node/register/transpile-only');
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { DataSource } = require('typeorm');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const { AppModule } = require('../../../../src/app.module');
const { A2WorkforceSessionService } = require('../../../../src/authorization/workforce-session.service');
const { A2FinanceRoleAssignment } = require('../../../../src/authorization/workforce-authentication.entity');
const { createIntegrationDataSource, destroyIntegrationDataSource } = require('../../../../test/support/pg-harness');
const repo = process.cwd();
const appDir = path.join(repo, 'apps/admin-web');
const report = {environment:'Disposable real PostgreSQL, in-process real AppModule HTTP and actual built Admin Web in headless browser', cases:[], limitations:'Selected workflows only. Local workforce sessions are test-issued, not real IdP/MFA. No real SMS, provider or deployed worker.'};
if (process.env.NODE_ENV !== 'test' || process.env.NOTIFICATION_WORKER_ENABLED !== 'false' || process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false' || !process.env.NODE_OPTIONS?.includes('mission-25c-network-guard.cjs')) throw Error('Requires test mode, disabled workers and outbound network guard');
(async () => {
 let ds, app, server, browser, out;
 try {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-admin-integration-'));
  const built = spawnSync('npm', ['run','build','--','--outDir',out,'--emptyOutDir'], {cwd:appDir,env:{...process.env,ADMIN_WEB_API_BASE_URL:'/api/v1',ADMIN_WEB_DEV_AUTH_MOCK:'false'},encoding:'utf8'});
  if (built.status !== 0) throw Error(`Admin build failed: ${built.stderr}`);
  ds = await createIntegrationDataSource('m2browser');
  const moduleRef = await Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(ds).compile();
  app = moduleRef.createNestApplication(new FastifyAdapter()); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:false}));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const customerId = randomUUID();
  await ds.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,[customerId,'m2-int-customer']);
  await ds.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,[customerId,'M2 Integration Customer']);
  async function session(role) {
   const now = new Date(), principalId = `m2browser:${role}:${randomUUID()}`;
   await ds.getRepository(A2FinanceRoleAssignment).save({id:randomUUID(),assignmentReference:`m2browser:${randomUUID()}`,assignmentVersion:1,principalId,roleKey:role,scopes:[],status:'ACTIVE',interim:true,effectiveFrom:new Date(now.getTime()-60000),effectiveTo:new Date(now.getTime()+86400000),assignedBy:'test-harness',assignedAt:now,revokedBy:null,revokedAt:null,bootstrapReference:null,approvalIds:[],auditReferences:[]});
   return app.get(A2WorkforceSessionService).establish({issuer:'https://local-dev-identity.monienaija.invalid',subject:principalId,principalId,audience:['workforce-admin'],issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),authenticatedAt:now.toISOString(),assuranceLevel:'MFA',amr:['pwd','otp'],acr:null,signingKeyId:'test-harness-key'});
  }
  const auditor = await session('FINANCE_AUDITOR');
  const treasury = await session('TREASURY');
  const operations = await session('OPERATIONS');
  const requests = [];
  server = http.createServer(async (req,res) => {
   const u = new URL(req.url,'http://127.0.0.1');
   if (u.pathname.startsWith('/api/v1/')) {
    // Read requests and only the selected disposable customer draft/profile operations reach the backend.
    if (req.method !== 'GET' && !(req.method === 'POST' && (u.pathname === '/api/v1/customers' || /^\/api\/v1\/customers\/[0-9a-f-]+\/registration-profile$/.test(u.pathname)))) {res.writeHead(403);return res.end('Blocked by integration harness');}
    let body=''; for await (const part of req) body += part;
    const response=await app.getHttpAdapter().getInstance().inject({method:req.method,url:req.url,headers:{authorization:req.headers.authorization || '',...(body ? {'content-type':'application/json'} : {})},...(body?{payload:body}:{})});
    requests.push({method:req.method,path:u.pathname,status:response.statusCode});
    res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type'] || 'application/json'}); return res.end(response.payload);
   }
   if (req.method !== 'GET') {res.writeHead(403);return res.end('Blocked');}
   const m=/^\/assets\/([a-zA-Z0-9._-]+)$/.exec(u.pathname);
   const file=m?path.join(out,'assets',m[1]):u.pathname==='/'?path.join(out,'index.html'):u.pathname==='/favicon.png'?path.join(out,'favicon.png'):null;
   if (!file || !fs.existsSync(file)) {res.writeHead(404);return res.end('Not found');}
   res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/png'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(x=>x!=='--single-process'),headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  async function signIn(realSession) {
   await page.goto(origin);
   await page.evaluate(s=>{localStorage.setItem('admin_workforce_token',s.accessToken);localStorage.setItem('admin_workforce_session_id',s.sessionId);localStorage.setItem('admin_workforce_principal',JSON.stringify(s.principal));},realSession);
   await page.reload({waitUntil:'networkidle'});
  }
  await signIn(auditor);
  await page.getByTestId('nav-customers').click();
  await page.getByText('M2 Integration Customer').first().waitFor({timeout:15000});
  assert.equal(await page.getByRole('button',{name:'New Customer'}).count(),0);
  await page.getByRole('button',{name:'Open Customer 360° for M2 Integration Customer'}).click();
  await page.getByRole('heading',{name:'Profile overview'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Suspend'}).count(),0);
  report.cases.push({role:'FINANCE_AUDITOR',case:'Real customer directory and 360, read-only controls',result:'passed'});
  const denied=await page.evaluate(async()=>{const r=await fetch('/api/v1/customers',{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('admin_workforce_token')}`,'Content-Type':'application/json'},body:JSON.stringify({reference:'m2-denied-customer',type:'INDIVIDUAL'})});return r.status;});
  assert.equal(denied,403); assert.equal(Number((await ds.query('SELECT count(*) AS n FROM customers'))[0].n),1);
  report.cases.push({role:'FINANCE_AUDITOR',case:'Real backend denies customer creation without database mutation',status:denied,result:'passed'});
  await signIn(treasury);
  assert.equal(await page.getByTestId('nav-customers').count(),0);
  const hidden=await page.evaluate(async()=>{const r=await fetch('/api/v1/internal/customers?page=1&limit=20',{headers:{Authorization:`Bearer ${localStorage.getItem('admin_workforce_token')}`}});return r.status;});
  assert.equal(hidden,403);
  report.cases.push({role:'TREASURY',case:'Customer navigation absent and real backend denies direct read',status:hidden,result:'passed'});
  await signIn(operations);
  await page.getByTestId('nav-customers').click();
  await page.getByRole('button',{name:'New Customer'}).click();
  const postCount=requests.filter(r=>r.method==='POST').length;
  await page.getByRole('button',{name:'Create DRAFT & continue'}).click();
  await page.getByText('First name is required.').waitFor();
  assert.equal(requests.filter(r=>r.method==='POST').length,postCount);
  await page.locator('#registration-first-name').fill('Synthetic');
  await page.locator('#registration-last-name').fill('Workflow');
  await page.getByRole('button',{name:'Create DRAFT & continue'}).click();
  await page.getByText('Customer profile saved. The record remains DRAFT.').waitFor({timeout:15000});
  const created=await ds.query(`SELECT c.id, c.status, p.display_name FROM customers c JOIN customer_profiles p ON p.customer_id=c.id WHERE p.display_name=$1`,['Synthetic Workflow']);
  assert.equal(created.length,1); assert.equal(created[0].status,'DRAFT');
  assert(requests.some(r=>r.method==='POST'&&r.path==='/api/v1/customers'&&r.status===201));
  assert(requests.some(r=>r.method==='POST'&&r.path===`/api/v1/customers/${created[0].id}/registration-profile`&&r.status===201));
  report.cases.push({role:'OPERATIONS',case:'Real UI required-field validation, then create DRAFT and profile in PostgreSQL',result:'passed'});
  assert(requests.some(r=>r.path==='/api/v1/internal/customers'&&r.method==='GET'&&r.status===200));
  report.requests=requests; report.result='passed';
  fs.mkdirSync('docs/admin-m2/evidence/integration-20261106',{recursive:true});
  fs.writeFileSync('docs/admin-m2/evidence/integration-20261106/browser-pg-real.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 } finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve=>server.close(resolve));
  if (app) await app.close();
  if (ds) await destroyIntegrationDataSource(ds);
  if (out) fs.rmSync(out,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
