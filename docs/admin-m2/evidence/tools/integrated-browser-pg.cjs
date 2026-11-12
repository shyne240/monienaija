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
const axe = require('axe-core');
const { AppModule } = require('../../../../src/app.module');
const { A2WorkforceSessionService } = require('../../../../src/authorization/workforce-session.service');
const { A2FinanceRoleAssignment } = require('../../../../src/authorization/workforce-authentication.entity');
const { Agent } = require('../../../../src/agent/agent.entity');
const { AgentClassService } = require('../../../../src/agent/agent-class.service');
const { WalletService } = require('../../../../src/wallet/wallet.service');
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
  const maker = await session('AGENT_NETWORK_MANAGER');
  const support = await session('CUSTOMER_SERVICE');
  const compliance = await session('COMPLIANCE');
  const superAdmin = await session('SUPER_ADMIN');
  const controller = await session('FINANCE_CONTROLLER');
  const requests = [];
  const ticketId = randomUUID();
  await ds.query(`INSERT INTO support_tickets (id,reference,customer_id,created_by_type,created_by_id,subject,category,description,status,priority) VALUES ($1,$2,$3,'CUSTOMER','m2-test-customer','Synthetic support issue','OTHER','Disposable support fixture','OPEN','MEDIUM')`,[ticketId,'M2-SUPPORT-FIXTURE',customerId]);
  const agentClass = await app.get(AgentClassService).create({reference:`m2-cls-${randomUUID()}`,code:`M2-${randomUUID().slice(0,8)}`,name:'Synthetic funding class',actor:'test',applicableServices:['CASH_IN','AGENT_FUNDING','AGENT_DEFUNDING']});
  const agent = await ds.getRepository(Agent).save({id:randomUUID(),reference:`m2-agent-${randomUUID()}`,status:'ACTIVE',agentClassId:agentClass.id});
  const wallet = await app.get(WalletService).createWallet({customerId:agent.id,currency:'NGN',idempotencyKey:`m2-wallet-${randomUUID()}`});
  let safeApprovalId = null, safeFundingId = null;
  server = http.createServer(async (req,res) => {
   const u = new URL(req.url,'http://127.0.0.1');
   if (u.pathname.startsWith('/api/v1/')) {
    // Read requests and only the explicitly selected disposable operations reach the backend.
    if (req.method !== 'GET' && !(req.method === 'PUT' && u.pathname === '/api/v1/internal/a2/workforce/dashboard/assignments/TREASURY') && !(req.method === 'POST' && (u.pathname === '/api/v1/customers' || /^\/api\/v1\/customers\/[0-9a-f-]+\/registration-profile$/.test(u.pathname) || u.pathname === `/api/v1/internal/agents/${agent.id}/fund-request` || u.pathname === `/api/v1/internal/agents/${agent.id}/defund-request` || (safeApprovalId && u.pathname === `/api/v1/internal/a2/workforce/approvals/${safeApprovalId}/approve`) || (safeFundingId && u.pathname === `/api/v1/internal/agents/funding-requests/${safeFundingId}/execute`) || u.pathname === `/api/v1/internal/support/tickets/${ticketId}/status` || u.pathname === `/api/v1/internal/support/tickets/${ticketId}/messages` || u.pathname === `/api/v1/customers/${customerId}/kyc-assessment`))) {res.writeHead(403);return res.end('Blocked by integration harness');}
    let body=''; for await (const part of req) body += part;
    const response=await app.getHttpAdapter().getInstance().inject({method:req.method,url:req.url,headers:{authorization:req.headers.authorization || '',...(body ? {'content-type':'application/json'} : {}),...(req.headers['idempotency-key'] ? {'idempotency-key':req.headers['idempotency-key']} : {})},...(body?{payload:body}:{})});
    if (response.statusCode >= 400 && u.pathname.includes('/support/tickets/') && req.method === 'POST') console.error('SUPPORT RESPONSE',response.statusCode,response.payload);
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
  page.on('dialog',dialog=>dialog.accept());
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
  // Real maker -> independent checker -> posting against an isolated, synthetic Agent.
  await signIn(maker);
  await page.getByTestId('nav-agents').click();
  await page.getByLabel('Funding Agent ID').fill(agent.id);
  await page.getByLabel('Funding amount in kobo').fill('1000');
  await page.getByLabel('Funding reason').fill('Disposable integration funding');
  await page.getByRole('button',{name:'Request independent approval'}).click();
  await page.getByText(/Await an independent checker/).waitFor({timeout:15000});
  const fundingRows=await ds.query(`SELECT id, approval_id, status, journal_id FROM agent_funding_requests WHERE agent_id=$1`,[agent.id]);
  assert.equal(fundingRows.length,1); assert.equal(fundingRows[0].status,'PENDING'); assert.equal(fundingRows[0].journal_id,null);
  safeFundingId=fundingRows[0].id; safeApprovalId=fundingRows[0].approval_id;
  const selfDecision=await page.evaluate(async id=>{const r=await fetch(`/api/v1/internal/a2/workforce/approvals/${id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('admin_workforce_token')}`,'Content-Type':'application/json'},body:JSON.stringify({comment:'Self approval probe'})});return r.status;},safeApprovalId);
  assert.equal(selfDecision,403);
  assert.equal((await ds.query('SELECT status FROM privileged_action_approvals WHERE id=$1',[safeApprovalId]))[0].status,'REQUESTED');
  await signIn(controller);
  await page.getByTestId('nav-approvalsInbox').click();
  await page.getByText(safeFundingId,{exact:false}).first().waitFor({timeout:15000});
  await page.getByRole('button',{name:'Review in Checker'}).click();
  const acknowledgement=page.getByLabel('I reviewed this Agent, amount, direction and business reason');
  await acknowledgement.check();
  await page.getByRole('button',{name:'Approve funding instruction'}).click();
  const execute=page.getByRole('button',{name:'Execute approved instruction'});
  await execute.waitFor({timeout:15000});
  await acknowledgement.check();
  await execute.click();
  await page.getByText(/Posting confirmed/).waitFor({timeout:15000});
  const posted=(await ds.query('SELECT status,journal_id,checker_principal_id FROM agent_funding_requests WHERE id=$1',[safeFundingId]))[0];
  assert.equal(posted.status,'EXECUTED'); assert(posted.journal_id); assert.equal(posted.checker_principal_id,controller.principal.principalId);
  const lines=await ds.query(`SELECT direction,amount_minor::text AS amount FROM ledger_lines WHERE journal_id=$1`,[posted.journal_id]);
  assert.equal(lines.length,2); assert.equal(lines.filter(l=>l.direction==='DEBIT'&&l.amount==='1000').length,1); assert.equal(lines.filter(l=>l.direction==='CREDIT'&&l.amount==='1000').length,1);
  assert.equal(Number((await ds.query('SELECT count(*) AS n FROM ledger_journals WHERE id=$1',[posted.journal_id]))[0].n),1);
  report.cases.push({role:'AGENT_NETWORK_MANAGER + FINANCE_CONTROLLER',case:'Real maker request, self-approval denied, independent checker approves and executes; balanced disposable journal',result:'passed'});
  // Revisit the retained maker key, recover the terminal FUND instruction and then DEFUND.
  // Replaying the same posting is expected to return the same journal, not post twice.
  await signIn(maker);
  await page.getByTestId('nav-agents').click();
  await page.getByLabel('Funding Agent ID').fill(agent.id);
  await page.getByRole('button',{name:'Recover retained instruction'}).click();
  await page.getByRole('button',{name:'Start another instruction'}).click();
  await page.getByLabel('Direction').selectOption('DEFUND');
  await page.getByLabel('Funding amount in kobo').fill('300');
  await page.getByLabel('Funding reason').fill('Disposable integration defunding');
  await page.getByRole('button',{name:'Request independent approval'}).click();
  await page.getByText(/Await an independent checker/).waitFor({timeout:15000});
  const defundRows=await ds.query(`SELECT id, approval_id, status, journal_id FROM agent_funding_requests WHERE agent_id=$1 AND direction='DEFUND'`,[agent.id]);
  assert.equal(defundRows.length,1); assert.equal(defundRows[0].status,'PENDING'); assert.equal(defundRows[0].journal_id,null);
  safeFundingId=defundRows[0].id; safeApprovalId=defundRows[0].approval_id;
  await signIn(controller);
  await page.getByTestId('nav-approvalsInbox').click();
  await page.getByText(safeFundingId,{exact:false}).first().waitFor({timeout:15000});
  await page.getByRole('button',{name:'Review in Checker'}).click();
  const defundAck=page.getByLabel('I reviewed this Agent, amount, direction and business reason');
  await defundAck.check(); await page.getByRole('button',{name:'Approve funding instruction'}).click();
  const defundExecute=page.getByRole('button',{name:'Execute approved instruction'});
  await defundExecute.waitFor({timeout:15000}); await defundAck.check(); await defundExecute.click();
  await page.getByText(/Posting confirmed/).waitFor({timeout:15000});
  const defundPosted=(await ds.query('SELECT status,journal_id FROM agent_funding_requests WHERE id=$1',[safeFundingId]))[0];
  assert.equal(defundPosted.status,'EXECUTED'); assert(defundPosted.journal_id);
  const defundLines=await ds.query(`SELECT direction,amount_minor::text AS amount FROM ledger_lines WHERE journal_id=$1`,[defundPosted.journal_id]);
  assert.equal(defundLines.length,2); assert.equal(defundLines.filter(l=>l.direction==='DEBIT'&&l.amount==='300').length,1); assert.equal(defundLines.filter(l=>l.direction==='CREDIT'&&l.amount==='300').length,1);
  const replay=page.getByRole('button',{name:'Recover posted result'});
  await replay.waitFor(); await defundAck.check(); await replay.click();
  await page.getByText(/REPLAYED.*Posting confirmed/).waitFor({timeout:15000});
  const reloaded=(await ds.query('SELECT journal_id FROM agent_funding_requests WHERE id=$1',[safeFundingId]))[0];
  assert.equal(reloaded.journal_id,defundPosted.journal_id);
  assert.equal(Number((await ds.query('SELECT count(*) AS n FROM ledger_lines WHERE journal_id=$1',[defundPosted.journal_id]))[0].n),2);
  const walletBalance=await ds.query(`SELECT COALESCE(SUM(CASE WHEN l.direction=a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM wallet_accounts w JOIN ledger_accounts a ON a.id=w.ledger_account_id LEFT JOIN ledger_lines l ON l.ledger_account_id=a.id WHERE w.id=$1`,[wallet.id]);
  assert.equal(walletBalance[0].balance,'700');
  report.cases.push({role:'AGENT_NETWORK_MANAGER + FINANCE_CONTROLLER',case:'Recover maker key; real DEFUND approve, post and replay; same journal and 700-kobo test balance',result:'passed'});
  // Real support queue, keyboard entry, optimistic status mutation and internal-only note.
  await signIn(support);
  await page.getByTestId('nav-support').click();
  await page.getByText('M2-SUPPORT-FIXTURE').waitFor({timeout:15000});
  const viewTicket=page.getByRole('row').filter({hasText:'M2-SUPPORT-FIXTURE'}).getByRole('button',{name:'View'});
  await viewTicket.focus(); await page.keyboard.press('Enter');
  const ticketHeading=page.getByRole('heading',{name:'Ticket M2-SUPPORT-FIXTURE'});
  await ticketHeading.waitFor(); assert(await ticketHeading.evaluate(e=>document.activeElement===e));
  await page.getByRole('button',{name:'Mark In Progress'}).click();
  await page.getByText('Status → IN_PROGRESS').waitFor({timeout:15000});
  const updatedTicket=(await ds.query('SELECT status,version FROM support_tickets WHERE id=$1',[ticketId]))[0];
  assert.equal(updatedTicket.status,'IN_PROGRESS'); assert.equal(updatedTicket.version,2);
  await page.getByLabel('Message',{exact:true}).fill('Disposable internal support note');
  await page.getByLabel('Internal operator note').check();
  await page.getByRole('form',{name:'Add internal note'}).getByRole('button',{name:'Send'}).click();
  await page.getByText('Internal note added.').waitFor({timeout:15000});
  const notes=await ds.query('SELECT id,body,is_internal,author_id,author_type FROM support_ticket_messages WHERE ticket_id=$1',[ticketId]);
  assert.equal(notes.length,1); assert.equal(notes[0].body,'Disposable internal support note'); assert.equal(notes[0].is_internal,true); assert.equal(notes[0].author_id,support.principal.principalId); assert.equal(notes[0].author_type,support.principal.type);
  const idem=await ds.query(`SELECT idempotency_key FROM idempotency_records WHERE resource_id=$1 AND resource_type='SUPPORT_TICKET_MESSAGE'`,[notes[0].id]);
  assert.equal(idem.length,1);
  const messageReplay=await page.evaluate(async ({id,key})=>{
   const send=async body=>{const r=await fetch(`/api/v1/internal/support/tickets/${id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('admin_workforce_token')}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({body,isInternal:true})});return {status:r.status,body:await r.json()};};
   return {replay:await send('Disposable internal support note'),conflict:await send('Changed internal note')};
  },{id:ticketId,key:idem[0].idempotency_key});
  assert.equal(messageReplay.replay.status,201); assert.equal(messageReplay.replay.body.id,notes[0].id); assert.equal(messageReplay.conflict.status,409);
  assert.equal(Number((await ds.query('SELECT count(*) AS n FROM support_ticket_messages WHERE ticket_id=$1',[ticketId]))[0].n),1);
  assert(requests.some(r=>r.path===`/api/v1/internal/support/tickets/${ticketId}/messages`&&r.method==='POST'&&r.status===201));
  report.cases.push({role:'CUSTOMER_SERVICE',case:'Keyboard ticket detail, real status/version and internal-only note; idempotent replay and conflict',result:'passed'});
  // Existing LEVEL_1 KYC review only; no Tier 3 policy or feature is introduced.
  await signIn(compliance);
  await page.getByTestId('nav-kycQueue').click();
  await page.getByLabel('Customer UUID').fill(customerId);
  await page.locator('.compliance-workspace__decision select').nth(1).selectOption('PENDING');
  await page.getByLabel('Assessment reason (optional)').fill('Disposable Level 1 review');
  const kycPostCount=requests.filter(r=>r.path===`/api/v1/customers/${customerId}/kyc-assessment`&&r.method==='POST').length;
  await page.getByRole('button',{name:'Submit Assessment'}).click();
  const kycDialog=page.getByRole('dialog',{name:'Confirm KYC decision?'});
  await kycDialog.waitFor();
  const keepKyc=kycDialog.getByRole('button',{name:'Keep editing'}), confirmKyc=kycDialog.getByRole('button',{name:'Confirm KYC decision'});
  assert(await keepKyc.evaluate(e=>document.activeElement===e));
  await page.keyboard.press('Shift+Tab'); assert(await confirmKyc.evaluate(e=>document.activeElement===e));
  await page.keyboard.press('Tab'); assert(await keepKyc.evaluate(e=>document.activeElement===e));
  await page.keyboard.press('Escape'); assert.equal(await kycDialog.count(),0);
  assert(await page.getByRole('button',{name:'Submit Assessment'}).evaluate(e=>document.activeElement===e));
  assert.equal(requests.filter(r=>r.path===`/api/v1/customers/${customerId}/kyc-assessment`&&r.method==='POST').length,kycPostCount);
  await page.getByRole('button',{name:'Submit Assessment'}).click();
  await kycDialog.getByRole('button',{name:'Confirm KYC decision'}).click();
  await page.getByText('KYC assessment submitted.').waitFor({timeout:15000});
  const assessment=(await ds.query('SELECT kyc_level,kyc_status,assessed_by,is_current FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=true',[customerId]))[0];
  assert.equal(assessment.kyc_level,'LEVEL_1'); assert.equal(assessment.kyc_status,'PENDING'); assert.equal(assessment.assessed_by,compliance.principal.principalId);
  await page.getByRole('button',{name:'I reviewed the submitted assessment'}).click();
  report.cases.push({role:'COMPLIANCE',case:'Keyboard trap, Escape/no write and confirmed Level 1 KYC review; persistence and actor attribution',result:'passed'});
  // Isolated dashboard assignment through real UI; a read-only auditor must be denied.
  await signIn(superAdmin);
  await page.getByTestId('nav-dashboardSettings').click();
  const dashboardSelect=page.getByLabel('Dashboard template for TREASURY');
  await dashboardSelect.waitFor({timeout:15000});
  const previousTemplate=await dashboardSelect.inputValue();
  const replacement=await dashboardSelect.locator('option:not(:disabled)').evaluateAll((items,prior)=>items.map(x=>x.value).find(x=>x!==prior),previousTemplate);
  assert(replacement);
  await dashboardSelect.selectOption(replacement);
  await page.getByLabel('Reason for TREASURY dashboard change').fill('Disposable assignment test');
  const beforeAssignment=requests.filter(r=>r.method==='PUT').length;
  await page.getByRole('button',{name:'Save dashboard assignment for TREASURY'}).click();
  const confirmAssignment=page.getByRole('group',{name:'Confirm assignment for TREASURY'});
  assert(await confirmAssignment.getByRole('button',{name:'Keep editing'}).evaluate(e=>document.activeElement===e));
  assert.equal(requests.filter(r=>r.method==='PUT').length,beforeAssignment);
  await confirmAssignment.getByRole('button',{name:'Confirm assignment'}).click();
  await page.getByText(`Dashboard for TREASURY is now ${replacement}.`).waitFor({timeout:15000});
  assert.equal((await ds.query('SELECT template_key FROM role_dashboard_assignments WHERE role_key=$1',['TREASURY']))[0].template_key,replacement);
  await signIn(auditor);
  const assignmentDenied=await page.evaluate(async value=>{const r=await fetch('/api/v1/internal/a2/workforce/dashboard/assignments/TREASURY',{method:'PUT',headers:{Authorization:`Bearer ${localStorage.getItem('admin_workforce_token')}`,'Content-Type':'application/json'},body:JSON.stringify({templateKey:value,reason:'Denied test'})});return r.status;},previousTemplate);
  assert.equal(assignmentDenied,403);
  assert.equal((await ds.query('SELECT template_key FROM role_dashboard_assignments WHERE role_key=$1',['TREASURY']))[0].template_key,replacement);
  report.cases.push({role:'SUPER_ADMIN + FINANCE_AUDITOR',case:'Confirmed dashboard assignment persists; read-only role denied change',result:'passed'});
  // Inspect the actual posted journal and support audit through authorized UI reads.
  await page.getByTestId('nav-ledgerExplorer').click();
  await page.getByLabel('Audit Journal ID (UUID)').fill(posted.journal_id);
  await page.getByRole('button',{name:'Audit Journal'}).focus(); await page.keyboard.press('Enter');
  await page.getByText('Journal Entry Details').waitFor({timeout:15000});
  assert.equal(await page.getByRole('region',{name:'Journal posting lines'}).locator('tbody tr').count(),2);
  assert(await page.getByText(posted.journal_id,{exact:false}).count());
  await page.getByTestId('nav-auditEvents').click();
  await page.getByLabel('Entity ID (optional)').fill(ticketId);
  await page.getByRole('button',{name:'Search',exact:true}).focus(); await page.keyboard.press('Enter');
  await page.getByRole('region',{name:'Audit events'}).locator('tbody tr').first().waitFor({timeout:15000});
  assert((await page.getByRole('region',{name:'Audit events'}).locator('tbody tr').count())>=1);
  assert(requests.some(r=>r.path===`/api/v1/ledger/journals/${posted.journal_id}`&&r.status===200));
  report.cases.push({role:'FINANCE_AUDITOR',case:'Keyboard inspection of real balanced funding journal and support audit events',result:'passed'});
  // Read real seeded notification templates and exercise local draft protection only.
  // No notification mutation, test-send, provider request or worker is permitted here.
  await signIn(superAdmin);
  await page.getByTestId('nav-notifications').click();
  const notificationWritesBefore=requests.filter(r=>r.method!=='GET'&&r.path.includes('/notifications/')).length;
  for (const [tab,channel] of [['smsTemplates','SMS'],['emailTemplates','EMAIL']]) {
   await page.getByTestId('notif-tab-'+tab).click();
   const workspace=page.getByTestId('template-workspace-'+channel.toLowerCase());
   const select=workspace.getByTestId('template-event-select');
   await select.waitFor({timeout:15000});
   await workspace.getByTestId('template-version-history-table').waitFor({timeout:15000});
   const initialEvent=await select.inputValue();
   const nextEvent=await select.locator('option:not(:disabled)').evaluateAll((items,current)=>items.map(x=>x.value).find(x=>x&&x!==current),initialEvent);
   assert(nextEvent,`Need two seeded events to test ${channel} draft protection`);
   const draft=workspace.getByTestId('template-body-textarea');
   await draft.fill('Disposable local draft {{reference}}');
   await select.selectOption(nextEvent);
   const prompt=workspace.getByTestId('template-event-switch-prompt'); await prompt.waitFor();
   assert(await prompt.evaluate(e=>document.activeElement===e));
   await prompt.getByRole('button',{name:'Keep draft'}).click();
   assert.equal(await select.inputValue(),initialEvent); assert.equal(await draft.inputValue(),'Disposable local draft {{reference}}');
   await select.selectOption(nextEvent); await prompt.getByRole('button',{name:'Discard and switch'}).click();
   assert.equal(await select.inputValue(),nextEvent);
  }
  assert.equal(requests.filter(r=>r.method!=='GET'&&r.path.includes('/notifications/')).length,notificationWritesBefore);
  assert(requests.some(r=>r.method==='GET'&&r.path==='/api/v1/internal/notifications/templates'&&r.status===200));
  report.cases.push({role:'SUPER_ADMIN',case:'Read real SMS and email template histories; local event-switch draft keep/discard without notification writes',result:'passed'});
  // Traverse the views actually visible to two separate real catalogue roles. This checks
  // real read integration and accessibility of the seeded/empty states, not every action.
  const views=['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'];
  report.navigation=[];
  for (const width of [1440,320]) for (const [role, identity] of [['SUPER_ADMIN',superAdmin],['FINANCE_CONTROLLER',controller]]) {
   await page.setViewportSize({width,height:900});
   await signIn(identity);
   await page.addScriptTag({content:axe.source});
   const mobile=width<1024;
   if (mobile) {
    const toggle=page.getByTestId('mobile-menu-toggle');
    await toggle.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByTestId('mobile-nav').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('mobile-nav').count(),0);
    assert(await toggle.evaluate(e=>document.activeElement===e));
   }
   for (const key of views) {
    if (mobile) await page.getByTestId('mobile-menu-toggle').click();
    const nav=page.getByTestId((mobile?'mobile-':'')+'nav-'+key);
    if (!await nav.count()) {if (mobile) await page.keyboard.press('Escape'); continue;}
    const before=requests.length;
    await nav.click();
    await page.waitForTimeout(100); await page.waitForLoadState('networkidle');
    let expandedTemplates=0;
    if (width===320 && role==='SUPER_ADMIN' && key==='dashboardSettings') {
     const headers=page.locator('.mn-dashboard-settings__template-header');
     expandedTemplates=await headers.count(); assert.equal(expandedTemplates,12);
     for (let i=0;i<expandedTemplates;i++) {
      const header=headers.nth(i); await header.focus(); await page.keyboard.press('Enter');
      assert.equal(await header.getAttribute('aria-expanded'),'true');
      const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert(geometry.scroll<=geometry.width,`Expanded template ${i} overflow: ${JSON.stringify(geometry)}`);
      await page.keyboard.press('Enter'); assert.equal(await header.getAttribute('aria-expanded'),'false');
     }
    }
    const headings=await page.locator('[data-testid="main-content"] h1, [data-testid="main-content"] h2').allTextContents();
    const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
    if (sizes.scrollWidth>sizes.width) console.error('OVERFLOW',key,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).map(e=>({tag:e.tagName,cls:e.className,txt:(e.textContent||'').trim().slice(0,60),left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right),scroll:e.scrollWidth,client:e.clientWidth,overflow:getComputedStyle(e).overflowX})).filter(e=>e.right>document.documentElement.clientWidth+1).slice(0,40))));
    const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));});
    report.navigation.push({role,view:key,expandedTemplates,headings:headings.slice(0,4),requests:requests.slice(before),...sizes,violations});
    console.log('NAV',role,key,JSON.stringify(report.navigation.at(-1)));
   }
  }
  assert.equal(report.navigation.length,72, 'Unexpected real-role navigation coverage');
  const failures=report.navigation.filter(x=>x.violations.length || x.scrollWidth>x.width || x.requests.some(r=>r.status>=500));
  assert.deepEqual(failures,[], 'Accessibility, overflow or backend server error in selected navigation states');
  for (const endpoint of ['/api/v1/internal/customers','/api/v1/internal/agents','/api/v1/internal/support/tickets','/api/v1/internal/agents/funding-requests','/api/v1/ledger/accounts','/api/v1/internal/fee-rules','/api/v1/internal/limit-profiles','/api/v1/internal/notifications/events']) {
   assert(requests.some(r=>r.path===endpoint&&r.method==='GET'&&r.status===200),`Missing successful real read: ${endpoint}`);
  }
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
