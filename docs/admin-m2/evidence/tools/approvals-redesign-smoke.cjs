// All checker outcomes are synthetic and intercepted; no backend decisions are made.
const assert=require('assert');const assertVisibleLabels=require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});let calls=0;
 await page.route('**/api/v1/**',route=>{const r=route.request(),u=new URL(r.url());let body;
  if(r.method()==='POST'&&u.pathname.endsWith('/approvals/synthetic-id/approve')){calls++;body={approved:false,reason:'SELF_APPROVAL_FORBIDDEN',approval:{id:'synthetic-id',status:'REQUESTED'}};}
  else if(r.method()==='POST'&&u.pathname.endsWith('/approvals/synthetic-id/reject')){calls++;body={approved:false,reason:'REJECTED',approval:{id:'synthetic-id',status:'REJECTED'}};}
  else if(r.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});
  else if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
  else return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic service unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.APPROVAL_SMOKE_ORIGIN||'http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic-checker',sessionId:'synthetic',audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['privileged:approve'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 const report=[];for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.reload({waitUntil:'networkidle'});if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-approvalsInbox').click();
  await page.getByLabel('Pending Approval ID (UUID)').fill('synthetic-id');await page.getByLabel('Audit Comment / Verification Notes (Optional)').fill('Synthetic review');
  const trigger=page.getByRole('button',{name:'Sign & Approve Action'});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Confirm approval'});await dialog.waitFor();assert((await dialog.innerText()).includes('synthetic-id'));assert((await dialog.innerText()).includes('Synthetic review'));
  assert(await page.getByRole('button',{name:'Cancel'}).evaluate(el=>document.activeElement===el));await page.keyboard.press('Shift+Tab');assert(await page.getByRole('button',{name:'Confirm decision'}).evaluate(el=>document.activeElement===el));
  if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/approvals-review-${width}.png`,fullPage:true});
  const dialogSize=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));await page.keyboard.press('Escape');assert(await trigger.evaluate(el=>document.activeElement===el));assert.equal(calls,report.length*2);
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Confirm decision'}).click();await page.getByText(/Decision not confirmed: SELF_APPROVAL_FORBIDDEN/).waitFor();
  await page.getByRole('button',{name:'Reject Action'}).click();await page.getByRole('dialog',{name:'Confirm rejection'}).waitFor();await page.getByRole('button',{name:'Confirm decision'}).click();await page.getByText('Approval decision recorded as rejected successfully.').waitFor();assert(await page.getByRole('status').evaluate(el=>document.activeElement===el));assert((await page.getByRole('status').innerText()).includes('synthetic-id'));
  await assertVisibleLabels(page);const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({width,keyboardReview:true,deniedAndRejectedIntercepted:true,visibleLabelMechanisms:true,...size,dialogPage:dialogSize.page,dialogView:dialogSize.view});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/approvals-redesign-${width}.png`,fullPage:true});}
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/approvals-redesign-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view||x.dialogPage>x.dialogView)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
