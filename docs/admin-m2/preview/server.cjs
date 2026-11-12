// Read-only owner-review server. Serves a real Admin Web build, never a backend or notification worker.
// All non-GET requests are rejected, all API GETs are synthetic or explicitly unavailable.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'apps/admin-web');
const output = path.join(__dirname, '.output');
const build = spawnSync('npm', ['run', 'build', '--', '--outDir', output, '--emptyOutDir'], { cwd: app, stdio: 'inherit', env: { ...process.env, ADMIN_WEB_API_BASE_URL: '/api/v1', ADMIN_WEB_DEV_AUTH_MOCK: 'false' } });
if (build.status !== 0) throw new Error(`Preview build failed (${build.status})`);
const scopes = new Set();
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"]([a-z_]+(?:[.:][a-z_]+)+)['"]/g)) scopes.add(match[1]);
    }
  }
}
scan(path.join(app, 'src'));
const principal = { type: 'PRIVILEGED', principalId: 'preview-only', sessionId: 'preview-only', audience: 'workforce-admin', roles: ['SUPER_ADMIN','ADMINISTRATOR','FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER','OPERATIONS','SUPPORT','COMPLIANCE','RISK_FRAUD'], scopes: [...scopes], customerAccess: 'ANY', assuranceLevel: 'MFA' };
const customer = {id:'customer-synthetic',reference:'mn-synthetic-1234',type:'INDIVIDUAL',status:'ACTIVE',kycLevel:'LEVEL_1',kycStatus:'APPROVED',displayName:'Synthetic Customer',legalName:'Synthetic Customer',createdAt:'2026-11-01T10:00:00Z',primaryContact:{type:'PHONE',maskedValue:'+234*****1234',isVerified:true}};
const agent = {id:'agent-synthetic',reference:'AG-SYNTHETIC',status:'ACTIVE',agentClassId:null,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
const address = {id:'address-synthetic',type:'RESIDENTIAL',lineOne:'1 Synthetic Road',lineTwo:null,city:'Abuja',state:'FCT',country:'NG',postalCode:null,isPrimary:true};
const doc = {id:'doc-synthetic',submissionGroupId:'group-synthetic',revisionNumber:1,supersedesSubmissionId:null,customerId:customer.id,residentialAddressId:address.id,category:'UTILITY',documentType:'UTILITY_BILL',issuerName:'Synthetic Utility',documentDate:'2026-10-01',reviewStatus:'PENDING',documentStatus:'AVAILABLE',scannerResult:'CLEAN',originalFileName:'synthetic.png',detectedMimeType:'image/png',fileSizeBytes:'2048',uploadedAt:'2026-11-01T10:00:00Z',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'};
const ticket = {id:'synthetic-ticket',reference:'SUP-SYNTHETIC',status:'OPEN',subject:'Synthetic request',version:1,assignedTo:null,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
const gates = {configured:false,verified:false,enabled:false,deliveryTested:false,productionReady:false};
const snap = channel => ({channel,source:'DATABASE',provider:channel==='SMS'?'console':'none',enabled:false,lifecycleState:'NOT_CONFIGURED',gates,baseUrl:null,requestTimeoutMs:10000,senderId:null,fromEmail:null,fromName:null,replyToEmail:null,hasStoredCredential:false,keyFingerprint:null,misconfigurationCode:null,version:0,domainAuthentication:null,verification:{verifiedAt:null,verificationMethod:null,lastVerificationError:null},lastTest:{status:null,destinationMasked:null,providerRef:null,errorCode:null,testedAt:null}});
const cfg = {sms:snap('SMS'),email:snap('EMAIL'),encryption:{available:true,mode:'SYNTHETIC',activeKeyVersion:'test'},worker:{enabled:false},contracts:{robase:{verifiedEndpoint:'Synthetic contract',senderIdBehaviour:'Synthetic sender'},brevo:{domainAuthRequirements:['Synthetic SPF','Synthetic DKIM','Synthetic DMARC']}}};
const funding = {id:'synthetic-funding',approvalId:'synthetic-approval',agentId:'agent-synthetic',direction:'FUND',amountMinor:'100000',currency:'NGN',idempotencyKey:'synthetic-key',requestHash:'synthetic-hash',reference:'SYNTHETIC',status:'PENDING',approvalStatus:'REQUESTED',reason:'Synthetic funding request',requesterPrincipalId:'synthetic-maker',approvalApprovedBy:null,checkerPrincipalId:null,journalId:null,policy:{},approvalExpiresAt:'2027-12-01T00:00:00Z'};
function fixture(url) {
 const p = url.pathname;
 if (p.endsWith('/my-dashboard')) return {templateKey:'SYNTHETIC',displayName:'Owner review overview',description:'Synthetic data only',isFallback:false,widgets:[]};
 if (p.endsWith('/dashboard/templates')) return ['ONE','TWO'].map(templateKey=>({id:templateKey,templateKey,displayName:`Synthetic ${templateKey}`,description:'Synthetic fixture',operationalArea:'SYNTHETIC',isActive:true,layout:{widgets:[{widgetKey:'synthetic-widget',order:0}]}}));
 if (p.endsWith('/dashboard/assignments')) return [{id:'assignment',roleKey:'SYNTHETIC_ROLE',templateKey:'ONE',assignedBy:'seed',assignedAt:'2026-11-01T00:00:00Z'}];
 if (p.endsWith('/dashboard/widget-registry')) return [{widgetKey:'synthetic-widget',displayName:'Synthetic widget'}];
 if (p.endsWith('/internal/agents/funding-requests')) return {items:[funding],page:1,limit:20,total:1};
 if (p.endsWith('/agent-synthetic/funding-requests')) return [funding];
 if (p.endsWith('/ledger/accounts')) return [{id:'a',code:'1000',name:'Customer funds',currency:'NGN',balanceMinor:'123564',accountType:'ASSET',normalBalance:'DEBIT',accountingUnit:'CUSTOMER_FUNDS',status:'ACTIVE'}];
 if (p.endsWith('/ledger/journals/synthetic-journal')) return {id:'synthetic-journal',status:'POSTED',currency:'NGN',accountingUnit:'CUSTOMER_FUNDS',createdAt:'2026-11-01',reference:'SYNTHETIC',lines:[{id:'d',accountId:'synthetic-account-a',direction:'DEBIT',amountMinor:'123564'},{id:'c',accountId:'synthetic-account-b',direction:'CREDIT',amountMinor:'123564'}]};
 if (p.endsWith('/internal/customers')) return {data:[customer],total:1,page:1,limit:20,totalPages:1,hasNextPage:false,hasPreviousPage:false};
 if (p.endsWith('/phone-verification')) return {customerId:customer.id,customerStatus:'ACTIVE',phones:[{isPrimary:true,maskedValue:'+234*****1234',verifiedAt:'2026-10-01'}],activationGate:{verifiedPrimaryPhone:true}};
 if (p.endsWith('/onboarding-readiness')) return {status:'READY',onboardingStatus:'COMPLETED',missing:[]};
 if (p.endsWith('/eligibility')) return {status:'ELIGIBLE',statusChangedAt:'2026-10-01'};
 if (p.endsWith('/proof-of-address/capabilities')) return {enabled:true,maxUploadBytes:10485760,allowedMimeTypes:['application/pdf','image/png','image/jpeg'],previewAvailable:false,documentaryReviewEnabled:false,physicalVerificationEnabled:false,tier3OrWalletChangesEnabled:false};
 if (p.endsWith('/proof-of-address')) return {items:[doc],page:1,limit:20,total:1};
 if (p.endsWith('/profile')) return {displayName:customer.displayName,legalName:customer.legalName,firstName:'Synthetic',lastName:'Customer',dateOfBirth:'1990-01-01',nationality:'NG'};
 if (p.endsWith('/addresses')) return [address];
 if (p.endsWith('/contact-methods')) return [{id:'contact-synthetic',type:'PHONE',maskedValue:'+234*****1234',isPrimary:true,verifiedAt:'2026-10-01'}];
 if (p.endsWith('/identity-documents')) return [];
 if (p.endsWith('/wallets')) return {data:[{id:'11111111-1111-4111-8111-111111111111',customerId:customer.id,currency:'NGN',status:'ACTIVE'}],total:1};
 if (p.endsWith('/balance')) return {walletId:'11111111-1111-4111-8111-111111111111',customerId:customer.id,currency:'NGN',status:'ACTIVE',balanceMinor:'123456'};
 if (p.endsWith('/internal/agents/classes')) return [{id:'synthetic-class',reference:'CLASS-SYNTHETIC',code:'SYNTHETIC',name:'Synthetic class',description:null,isActive:true,requirements:null,requiredInformation:null,requiredDocumentCategories:null,applicableServices:null,applicableLimits:null,version:2,createdAt:'2026-11-01',updatedAt:'2026-11-01'}];
 if (p.endsWith('/internal/agents/applications')) return [{id:'app-synthetic',reference:'APP-SYNTHETIC',agentClassId:'synthetic-class',applicantReference:'AG-SYNTHETIC',status:'SUBMITTED',version:1,agentId:null,createdAt:'2026-11-01'}];
 if (p.endsWith('/internal/agents')) return {data:[agent],total:1};
 if (p.endsWith('/agent-synthetic/financial-position')) return {agentId:agent.id,currency:'NGN',balanceMinor:'123456',walletExists:true,walletId:'synthetic-wallet'};
 if (p.endsWith('/agent-synthetic/transactions')) return {items:[{id:'synthetic-tx-1',type:'CASH_TO_CASH',status:'COMPLETED',direction:'DEBIT',amountMinor:'123456',currency:'NGN',createdAt:'2026-11-01T00:00:00Z',completedAt:null,reference:'SYN-TX-1',narration:null,feeMinor:'100',counterparty:{type:'CUSTOMER',beneficiaryPhone:'08012345678'},commission:{commissionMinor:'2500',payable:true,treatment:'POSTED'},failureCode:null,failureMessage:null}],pagination:{page:1,limit:20,total:1,totalPages:1,hasNextPage:false}};
 if (p.endsWith('/transactions')) return {items:[{id:'tx-synthetic',type:'WALLET_TRANSFER',status:'COMPLETED',amountMinor:'123456',currency:'NGN',direction:'OUTGOING',createdAt:'2026-11-01'}]};
 if (p.endsWith('/internal/support/tickets')) return {items:[ticket],pagination:{total:1,page:1,limit:20,totalPages:1}};
 if (p.endsWith('/synthetic-ticket/messages')) return [{id:'m1',ticketId:ticket.id,authorId:'customer',authorType:'CUSTOMER',body:'Synthetic support message.',isInternal:false,createdAt:ticket.createdAt}];
 if (p.endsWith('/internal/support/tickets/synthetic-ticket')) return ticket;
 if (/\/(transfers|deposits|withdrawals)\/synthetic-trace$/.test(p)) return {id:'synthetic-trace',status:'PENDING',currency:'NGN',amountMinor:'100000',reference:'SYNTHETIC-REFERENCE',createdAt:'2026-11-01T10:00:00Z'};
 if (p.endsWith('/kyc')) return {id:'synthetic-assessment',customerId:'synthetic-customer',level:'LEVEL_2',status:'PENDING',assessedBy:'synthetic-reviewer',reason:'Synthetic verification'};
 if (p.endsWith('/compliance-cases')) return [{id:'synthetic-aml-1',customerId:'synthetic-customer',caseNumber:'Synthetic AML review',category:'AML',severity:'HIGH',status:'OPEN',openedAt:'2026-11-01'},{id:'synthetic-fraud-1',customerId:'synthetic-customer',caseNumber:'Synthetic fraud review',category:'FRAUD',severity:'HIGH',status:'OPEN',openedAt:'2026-11-01'}];
 if (p.endsWith('/internal/metrics')) return {generatedAt:'2026-11-01T00:00:00Z',metrics:{'synthetic.jobs_processed':'8','synthetic.health_checks':'4'}};
 if (p.endsWith('/internal/diagnostics')) return {status:'ok',version:'synthetic',database:{status:'ok'},migrations:{status:'ok',appliedCount:1},reconciliation:{status:'WARNING'},pendingOutbox:2,timestamp:'2026-11-01T00:00:00Z'};
 if (p.endsWith('/internal/outbox')) return [{id:'synthetic-outbox',eventType:'synthetic.event',aggregateType:'CUSTOMER',aggregateId:'synthetic-id',status:'PENDING',attempts:0,occurredAt:'2026-11-01T00:00:00Z'}];
 if (p.endsWith('/notifications/provider-config/proposals')) return {data:[]};
 if (p.endsWith('/notifications/provider-config')) return cfg;
 if (p.endsWith('/notifications/events')) return {items:[{eventType:'transfer.completed',deliveryClass:'TRANSACTIONAL',editable:true,eventEnabled:true,eventLocked:false,eventConfigurationVersion:1,variables:['reference'],channels:{SMS:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1},EMAIL:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1}}}]};
 if (p.endsWith('/notifications/templates')) { const channel=url.searchParams.get('channel'), eventType=url.searchParams.get('eventType'); return {eventType,channel,locale:'en-NG',items:[{id:`synthetic-${channel}`,eventType,channel,locale:'en-NG',version:1,active:true,subject:channel==='EMAIL'?'Synthetic update':null,body:'Synthetic transfer {{reference}}',createdBy:'SYSTEM_SEED',createdAt:'2026-11-01'}],nextBeforeVersion:null}; }
 if (p.endsWith('/notifications/deliveries') || p.endsWith('/notifications/outbox-receipts')) return {data:[],total:0,page:1,limit:20,totalPages:0,hasNextPage:false};
 const kind=p.split('/').pop();
 const catalog={ 'fee-rules':{id:'SYN-FEE-1',productCode:'TRANSFER',currency:'NGN',flatFeeMinor:'100',percentageBps:15,vatBps:0,isActive:true,effectiveFrom:'2026-11-01T00:00:00Z',version:1},'commission-rules':{id:'SYN-COMMISSION-1',productCode:'CASH_IN',recipientType:'AGENT',currency:'NGN',calculationModel:'FIXED',calculationBasis:'PRINCIPAL',isActive:true,version:1},'reward-rules':{id:'SYN-REWARD-1',productCode:'TRANSFER',beneficiaryType:'CUSTOMER',rewardType:'CASHBACK',currency:'NGN',calculationModel:'FIXED',isActive:true,version:1},products:{code:'SYN-PRODUCT-1',name:'Synthetic transfer',domain:'WALLET',currency:'NGN',status:'ACTIVE',enabled:true,configurationStatus:'READY',version:1},'limit-profiles':{code:'SYN_PROFILE_1',name:'Synthetic standard',kind:'AGENT',status:'ACTIVE',enabled:true,configurationStatus:'CONFIGURED',version:1},'limit-rules':{id:'00000000-0000-4000-8000-000000000001',limitProfileCode:'SYN_PROFILE_1',product:'CASH_IN',direction:null,channel:null,currency:'NGN',dimension:'DAILY_AMOUNT',limitValueMinor:'10000000',limitValueCount:null,isActive:true,priority:0,version:1,effectiveFrom:'2026-11-01T00:00:00Z',effectiveTo:null}};
 if (catalog[kind]) return {data:[catalog[kind]],total:1,page:1,limit:20,totalPages:1,hasNextPage:false};
 if (p.endsWith('/internal/limit-assignments')) return {data:[{id:'assignment-synthetic',subjectType:'AGENT_CLASS',subjectId:'synthetic-class',limitProfileCode:'SYN_PROFILE_1',isActive:true,version:1,effectiveFrom:'2026-11-01T00:00:00Z'}],total:1,page:1,limit:20,totalPages:1,hasNextPage:false};
 return undefined;
}
const launcher = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Console review preview</title><style>body{margin:0;background:#f2f6f3;color:#17342c;font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:auto;padding:clamp(24px,5vw,64px) 20px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1}h2{font-size:20px;margin-top:32px}.label{color:#466b58;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.card{background:white;border:1px solid #cfdfd5;border-radius:16px;padding:24px}.warning{background:#fff7e6;border-left:4px solid #a86b09;padding:16px}.button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;background:#096149;color:white;padding:0 22px;border:0;border-radius:8px;font-weight:700;font-size:16px;cursor:pointer}a{color:#075d45}button:focus-visible,a:focus-visible{outline:3px solid #a86b09;outline-offset:3px}li{margin:8px 0}</style></head><body><main><p class="label">MonieNaija · owner review</p><h1>Explore the redesigned Admin Console</h1><p>This opens the actual Admin Web interface with a <strong>synthetic preview session</strong> and example data. It is not a production sign-in or a real account.</p><div class="card"><p class="warning"><strong>Safe preview:</strong> every write is blocked by the preview server. No real data, money, messages, provider calls, SMS tests or notification workers are used. Some screens deliberately show “service unavailable” where no preview fixture exists.</p><button id="open" class="button">Open Admin Console preview</button> <button id="checker" class="button">Open funding checker preview</button><h2>How to explore</h2><ul><li>Use the sidebar; on a narrow screen use the menu button. The preview combines roles only to expose navigation: it does not demonstrate real authorization.</li><li>Open <strong>Customer &amp; KYC Servicing</strong> and select the synthetic customer for Customer 360, personal details, proof and registration.</li><li>Open <strong>Agent Network Management</strong> for applications, the synthetic Agent, funding, credentials and history; use Agent Classes separately. Writes remain blocked.</li><li>For the funding approval queue, return to this guide and choose <strong>Open funding checker preview</strong>. The general composite session includes SUPER_ADMIN, so the real UI correctly restricts its checker queue.</li><li>Use synthetic lookup IDs <code>synthetic-trace</code> for transfers, deposits or withdrawals, <code>synthetic-journal</code> for the ledger, and <code>synthetic-customer</code> for KYC / cases.</li><li>Review the remaining transaction, finance, commercial, compliance, workforce, notification, health and audit views from the sidebar. Some panels have no fixture and will show an unavailable state.</li><li>Return here using the <strong>Preview guide</strong> link at the bottom right. Browser zoom and screen reader tests need your own desktop tools.</li></ul></div><p>The preview is for visual exploration, not live workflow or security sign-off. See the owner checklist and screenshot package in the acceptance documents.</p></main><script>function enter(checker){const principal=${JSON.stringify(principal)};if(checker)principal.roles=['FINANCE_CONTROLLER'];localStorage.setItem('admin_workforce_token','preview-only');localStorage.setItem('admin_workforce_session_id','preview-only');localStorage.setItem('admin_workforce_principal',JSON.stringify(principal));location.href='/console';}document.getElementById('open').addEventListener('click',()=>enter(false));document.getElementById('checker').addEventListener('click',()=>enter(true));</script></body></html>`;
(async () => {
 const server = http.createServer(async (req,res) => {
   res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; form-action 'self'; base-uri 'self'");
   res.setHeader('Cache-Control','no-store');
   const url = new URL(req.url,'http://preview.invalid');
   if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(403,{'Content-Type':'application/json'});return res.end(JSON.stringify({message:'Preview only: all writes and test sends are blocked.'}));}
   if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
     const body=fixture(url); res.writeHead(body===undefined?503:200,{'Content-Type':'application/json'});
     return res.end(JSON.stringify(body===undefined?{message:'Preview fixture unavailable. No live service was contacted.'}:body));
   }
   if (url.pathname === '/' || url.pathname === '/__review') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(launcher);}
   if (url.pathname === '/console') {
     let html=fs.readFileSync(path.join(output,'index.html'),'utf8');
     html=html.replace('</body>', '<a href="/__review" style="position:fixed;right:8px;bottom:8px;z-index:9999;background:#173f32;color:white;padding:7px 10px;border-radius:6px;font:700 12px system-ui;text-decoration:none;box-shadow:0 2px 8px #0004">Synthetic preview · guide</a></body>');
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);
   }
   // Serve only the generated public assets; source files, environment and Git data are not exposed.
   const asset = /^\/assets\/([a-zA-Z0-9._-]+)$/.exec(url.pathname);
   const file = asset ? path.join(output, 'assets', asset[1]) : url.pathname === '/favicon.png' ? path.join(output, 'favicon.png') : null;
   if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
   const types = {'.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2'};
   res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
   return fs.createReadStream(file).pipe(res);
 });
 server.listen(Number(process.env.PORT || 4178),'0.0.0.0',()=>console.log(`Owner review preview listening on port ${process.env.PORT || 4178}`));
})().catch(error=>{console.error(error);process.exit(1)});
