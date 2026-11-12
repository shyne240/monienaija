// Browser navigation checks against the existing 11-role test matrix. All API calls are intercepted;
// this does not authenticate a live role or test the server authorization boundary.
const {chromium:playwright}=require('playwright-core');
const chromium=require('@sparticuz/chromium').default;
const ts=require('typescript'), vm=require('vm'), fs=require('fs'), assert=require('assert');
const source=fs.readFileSync('apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx','utf8');
const roles=source.slice(source.indexOf('const ROLE_PRINCIPALS ='),source.indexOf('type RoleKey ='));
const expected=source.slice(source.indexOf('const EXPECTED:'),source.indexOf('const SECTION_KEYS:'));
const compiled=ts.transpileModule(`${roles}\n${expected}\nexports.roles=ROLE_PRINCIPALS; exports.expected=EXPECTED;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const sandbox={exports:{}};vm.runInNewContext(compiled,sandbox);
const {roles: principals,expected: expectedRoutes}=sandbox.exports;
const views=['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'];
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>a!=='--single-process'),headless:true});const report=[];
 for(const [role,identity] of Object.entries(principals)) for(const width of [320,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});let writes=0;
  await page.route('**/api/v1/**',route=>{const request=route.request();if(request.method()!=='GET'){writes++;return route.fulfill({status:403,body:'blocked'});}if(request.url().includes('my-dashboard'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({templateKey:'SYNTHETIC',displayName:'Overview',widgets:[],isFallback:false})});return route.fulfill({status:503,body:'Synthetic unavailable'});});
  await page.goto('http://127.0.0.1:5173/');await page.evaluate(p=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({...p,principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',customerAccess:'NONE',assuranceLevel:'MFA'}));},identity);await page.reload({waitUntil:'networkidle'});
  if(width===320)await page.getByTestId('mobile-menu-toggle').click();const prefix=width===320?'mobile-nav-':'nav-';const expectedSet=new Set(expectedRoutes[role]);const mismatches=[];
  for(const view of views){const present=await page.getByTestId(prefix+view).count()>0;if(present!==expectedSet.has(view))mismatches.push({view,present,expected:expectedSet.has(view)});}
  if(width===320){await page.keyboard.press('Escape');assert.equal(await page.getByTestId('mobile-nav').count(),0);assert(await page.getByTestId('mobile-menu-toggle').evaluate(e=>e===document.activeElement));}
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({role,width,mismatches,writes,escapeAndFocusReturn:width===320?true:null,...size});await page.close();
 }
 fs.writeFileSync('docs/admin-m2/evidence/acceptance-20261106/role-navigation.json',JSON.stringify(report,null,2)+'\n');assert(report.every(x=>x.mismatches.length===0 && x.writes===0 && x.page<=x.view),'Role navigation, intercepted writes or overflow mismatch');console.log(JSON.stringify({total:report.length,mismatches:report.filter(x=>x.mismatches.length),writes:report.reduce((n,x)=>n+x.writes,0),overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
