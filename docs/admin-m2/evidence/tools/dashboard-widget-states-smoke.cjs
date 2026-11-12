// All API calls are intercepted; non-GET requests are blocked.
const assertVisibleLabels=require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});let malformed=false;
 const widget=(widgetKey,displayName,order)=>({widgetKey,displayName,description:'Synthetic data',order,authorized:true,fetchMode:'proxy',kind:'status-breakdown'});
 await page.route('**/api/v1/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;let body;
  if(req.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});
  if(path.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Synthetic Overview',description:'Synthetic dashboard',isFallback:false,widgets:[widget('reconciliation-status','Reconciliation Status',1),widget('agent-lifecycle-summary','Agent Network Summary',2)]};
  else if(path.endsWith('/widgets/reconciliation-status'))body={report:{status:'WARNING',generatedAt:'2026-11-01T10:00:00Z',checks:[{name:'test',status:'WARNING',message:'Synthetic review needed'}]},trialBalance:{generatedAt:'2026-11-01T10:01:00Z',balanced:true,dimensions:[{currency:'NGN',accountingUnit:'DEFAULT',totalDebitsMinor:'100',totalCreditsMinor:malformed?'99':'100',balanced:true}],rows:[]}};
  else if(path.endsWith('/widgets/agent-lifecycle-summary'))body=malformed?{byStatus:[{status:'ACTIVE'}],pendingApplicationCount:0}:{byStatus:[{status:'ACTIVE',count:12}],pendingApplicationCount:3};
  else return route.fulfill({status:503,body:'Synthetic service unavailable'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['reconciliation.view','agent.view'],customerAccess:'NONE',assuranceLevel:'MFA'}));});await page.reload({waitUntil:'networkidle'});const report=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});malformed=true;await page.reload({waitUntil:'networkidle'});
  await page.getByText('Invalid reconciliation widget response.').waitFor();await page.getByText('Invalid status summary response.').waitFor();if(await page.getByText('Balanced',{exact:true}).count())throw Error('Contradictory response displayed balanced');
  malformed=false;await page.reload({waitUntil:'networkidle'});await page.getByText('Balanced',{exact:true}).waitFor();await page.getByText('Synthetic review needed').waitFor();await page.getByText('Pending Applications').waitFor();
  const open=page.getByRole('button',{name:'Open Agent Network →'});await open.focus();if(!await open.evaluate(el=>document.activeElement===el))throw Error('Navigation is not keyboard focusable');
  await assertVisibleLabels(page);const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({width,invalidResponsesRejected:true,reportedStatesShown:true,keyboardFocus:true,visibleLabelMechanisms:true,...size});if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/dashboard-widget-states-${width}.png`,fullPage:true});
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/dashboard-widget-states-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
