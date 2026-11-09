// Synthetic fixtures only: all API traffic is intercepted; no live writes.
const assert = require('assert');
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');
const chromium=require('@sparticuz/chromium').default;
const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
 const page=await browser.newPage({viewport:{width:320,height:900}});page.on('dialog',dialog=>dialog.accept());
 let disableWrites=0;
 await page.route('**/api/v1/**',route=>{
  const req=route.request(),u=new URL(req.url());let body;
  if(req.method()==='POST'&&u.pathname.endsWith('/support/workforce-users'))body={username:'synthetic',supportUserId:'synthetic-id',temporaryPassword:'synthetic-one-time',passwordExpiresAt:'2027-01-01T00:00:00Z'};
  else if(req.method()==='POST'&&u.pathname.endsWith('/support/workforce-users/synthetic-id/disable')){disableWrites++;body={id:'synthetic-id',status:'DISABLED'};}
  else if(req.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});
  else if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/workforce-overview'))body={activeWorkforceHeadcount:7,activeSessionCount:4,roleDistribution:[{roleKey:'OPERATIONS',count:3},{roleKey:'COMPLIANCE',count:4}]};
  else return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic service unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.WORKFORCE_SMOKE_ORIGIN || 'http://127.0.0.1:5173/');
 await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic-admin',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN','ADMINISTRATOR'],scopes:['workforce.dashboard.view','workforce.user.create','workforce.user.suspend'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 const results=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.reload({waitUntil:'networkidle'});
  if(width<1024)await page.getByTestId('mobile-menu-toggle').click();
  await page.getByTestId((width<1024?'mobile-':'')+'nav-workforceAccess').click();
  await page.getByText('OPERATIONS',{exact:true}).waitFor();
  await page.getByLabel('Support username or email').fill('synthetic');await page.getByRole('button',{name:'Create SUPPORT User'}).click();await page.getByText(/synthetic-one-time/).waitFor();
  await page.getByRole('button',{name:'Dismiss credential'}).click();
  await page.getByLabel('Reason (optional)').fill('Synthetic review');
  const trigger=page.getByRole('button',{name:'Disable SUPPORT User'});await trigger.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Disable SUPPORT user?'});await dialog.waitFor();
  assert(await dialog.innerText().then(t=>t.includes('synthetic-id')&&t.includes('Synthetic review')));
  assert(await page.getByRole('button',{name:'Cancel'}).evaluate(el=>document.activeElement===el));
  await page.keyboard.press('Shift+Tab');assert(await page.getByRole('button',{name:'Confirm disable'}).evaluate(el=>document.activeElement===el));
  if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/workforce-review-${width}.png`,fullPage:true});
  const dialogSize=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
  await page.keyboard.press('Escape');assert(await trigger.evaluate(el=>document.activeElement===el));assert.equal(disableWrites,results.length);
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Confirm disable'}).click();await page.getByText('Support user synthetic-id disabled.').waitFor();assert.equal(disableWrites,results.length+1);
  await assertVisibleLabels(page);
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
  results.push({width,visibleLabelMechanisms:true,reviewKeyboard:true,disableIntercepted:true,...size,dialogPage:dialogSize.page,dialogView:dialogSize.view});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/workforce-redesign-${width}.png`,fullPage:true});}
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/workforce-redesign-smoke.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({total:results.length,overflow:results.filter(x=>x.page>x.view||x.dialogPage>x.dialogView)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
