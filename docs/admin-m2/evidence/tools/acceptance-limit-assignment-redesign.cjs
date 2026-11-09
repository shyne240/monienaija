// Synthetic fixtures and intercepted writes only; never reaches a backend.
const assert = require('assert');
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');
const chromium=require('@sparticuz/chromium').default;
const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
 const page=await browser.newPage({viewport:{width:320,height:900}});let patches=0;
 await page.route('**/api/v1/**',route=>{
  const r=route.request(),u=new URL(r.url());let body;
  if(r.method()==='PATCH'&&u.pathname.endsWith('/internal/limit-assignments/assignment-two')){patches++;body={id:'mismatched'};}
  else if(r.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks other mutations'});
  else if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/internal/limit-assignments'))body={data:[{id:u.searchParams.get('page')==='2'?'assignment-two':'assignment-one',subjectType:'AGENT_CLASS',subjectId:'synthetic-class',limitProfileCode:'SYNTHETIC_STANDARD',isActive:true,version:2,effectiveFrom:'2026-11-01T00:00:00Z'}],total:21,page:Number(u.searchParams.get('page')||1),limit:20,totalPages:2,hasNextPage:u.searchParams.get('page')!=='2'};
  else if(u.pathname.endsWith('/internal/limit-usages'))body={data:[{id:'11111111-1111-4111-8111-111111111111',principalType:'AGENT',principalId:'22222222-2222-4222-8222-222222222222',limitProfileCode:'SYNTHETIC_STANDARD',product:'CASH_IN',dimension:'DAILY_AMOUNT',windowType:'DAILY',windowKey:'2026-11-01',windowStart:'2026-11-01T00:00:00Z',windowEnd:'2026-11-02T00:00:00Z',currency:'NGN',usedAmountMinor:'15000',reservedAmountMinor:'1000',usedCount:1,reservedCount:1}],total:1,page:1,limit:20,totalPages:1};
  else if(u.pathname.endsWith('/internal/limit-reservations'))body={data:[{id:'33333333-3333-4333-8333-333333333333',status:'RESERVED',principalType:'AGENT',principalId:'22222222-2222-4222-8222-222222222222',limitProfileCode:'SYNTHETIC_STANDARD',product:'CASH_IN',dimension:'DAILY_AMOUNT',windowType:'DAILY',windowKey:'2026-11-01',windowStart:'2026-11-01T00:00:00Z',windowEnd:'2026-11-02T00:00:00Z',idempotencyKey:'synthetic-key',count:1,version:1,amountMinor:'1000',currency:'NGN',reservedAt:'2026-11-01T00:00:00Z',ageSeconds:600,stale:false}],total:1,page:1,limit:20,totalPages:1,staleThresholdMinutes:30};
  else return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic service unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.LIMIT_SMOKE_ORIGIN||'http://127.0.0.1:5173/');
 await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['limit.view','limit.modify','agent.assign_limit'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 const results=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.reload({waitUntil:'networkidle'});
  if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-limitAssignments').click();
  await page.getByText('AGENT_CLASS: synthetic-class').waitFor();
  const nav=page.getByRole('navigation',{name:'Limit workspace sections'});const usageLink=nav.getByRole('link',{name:'Usage diagnostics'});await usageLink.focus();await page.keyboard.press('Enter');
  const usage=page.getByRole('region',{name:'Limit usage diagnostics'});assert(await usage.evaluate(el=>document.activeElement===el));await usage.getByRole('button',{name:'Search usage'}).focus();await page.keyboard.press('Enter');await usage.getByText('15000').first().waitFor();
  const reservations=page.getByRole('region',{name:'Limit reservation diagnostics'});await reservations.getByRole('button',{name:'Search reservations'}).click();await reservations.getByText(/Stale threshold 30 min/).waitFor();
  await page.getByRole('button',{name:'Next assignments'}).click();await page.getByText('21 assignments · Page 2 of 2').waitFor();
  await page.getByRole('button',{name:'Deactivate SYNTHETIC_STANDARD for AGENT_CLASS synthetic-class'}).click();await page.getByText(/Assignment update not confirmed/).waitFor();assert.equal(await page.getByRole('button',{name:/Deactivate SYNTHETIC_STANDARD/}).count(),0);
  await page.getByRole('button',{name:'Filter assignments'}).click();await page.getByText('21 assignments · Page 1 of 2').waitFor();assert(await page.getByText(/Assignment review required/).isVisible());assert(await page.getByRole('button',{name:/Deactivate SYNTHETIC_STANDARD/}).isDisabled());
  await assertVisibleLabels(page);const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
  results.push({width,keyboardNavigationAndUsage:true,pagingAndUnconfirmedToggle:true,mutationsIntercepted:true,visibleLabelMechanisms:true,...size});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/limit-assignment-redesign-${width}.png`,fullPage:true});}
 }
 assert.equal(patches,8);fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/limit-assignment-redesign-smoke.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({total:results.length,overflow:results.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
