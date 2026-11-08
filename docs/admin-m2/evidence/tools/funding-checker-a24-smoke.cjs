const assertVisibleLabels = require('./assert-visible-labels.cjs');
// All responses, including mutation receipts, are synthetic and intercepted in the browser.
const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
 const page=await browser.newPage({viewport:{width:320,height:900}});let stage='REQUESTED';
 const item=()=>({id:'synthetic-funding',approvalId:'synthetic-approval',agentId:'synthetic-agent',direction:'FUND',amountMinor:'100000',currency:'NGN',idempotencyKey:'synthetic-key',requestHash:'synthetic-hash',reference:'SYNTHETIC',status:stage==='CONSUMED'?'EXECUTED':'PENDING',approvalStatus:stage,reason:'Synthetic funding request',requesterPrincipalId:'synthetic-maker',approvalApprovedBy:stage==='REQUESTED'?null:'synthetic-checker',checkerPrincipalId:stage==='CONSUMED'?'synthetic-checker':null,journalId:stage==='CONSUMED'?'synthetic-journal':null,policy:{},approvalExpiresAt:'2027-12-01T00:00:00Z'});
 await page.route('**/api/v1/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(req.method()==='POST' && path.endsWith('/approvals/synthetic-approval/approve')){stage='APPROVED';body={approved:true,reason:'APPROVED',approval:{id:'synthetic-approval',status:'APPROVED'}};}
   else if(req.method()==='POST' && path.endsWith('/funding-requests/synthetic-funding/execute')){stage='CONSUMED';body={status:'COMPLETED',journalId:'synthetic-journal',agentId:'synthetic-agent',amountMinor:'100000',currency:'NGN',idempotencyKey:'synthetic-key',requestHash:'synthetic-hash'};}
   else if(req.method()!=='GET') return route.fulfill({status:403,body:'Blocked by synthetic harness'});
   else if(path.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
   else if(path.endsWith('/internal/agents/funding-requests'))body={items:[item()],page:1,limit:20,total:1};
   else if(path.endsWith('/internal/agents/synthetic-agent/funding-requests'))body=[item()];
   else return route.fulfill({status:503,body:'Synthetic service unavailable'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.APPROVAL_SMOKE_ORIGIN || 'http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic-checker',sessionId:'synthetic',audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['agent.fund','agent.defund','privileged:approve'],customerAccess:'NONE',assuranceLevel:'MFA'}));});await page.reload({waitUntil:'networkidle'});
 const report=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
   stage='REQUESTED';await page.setViewportSize({width,height:900});if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-dashboard').click();if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-approvalsInbox').click();
   const review=page.getByRole('button',{name:'Review in Checker'});await review.focus();await page.keyboard.press('Enter');const acknowledgment=page.getByLabel('I reviewed this Agent, amount, direction and business reason');await acknowledgment.waitFor();await acknowledgment.focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');
   const approve=page.getByRole('button',{name:'Approve funding instruction'});if(!await approve.evaluate(el=>document.activeElement===el))throw Error('Approval button not reachable after keyboard review');await page.keyboard.press('Enter');
   const execute=page.getByRole('button',{name:'Execute approved instruction'});await execute.waitFor();await acknowledgment.focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');if(!await execute.evaluate(el=>document.activeElement===el))throw Error('Execution button not reachable after keyboard review');await page.keyboard.press('Enter');await page.getByText(/Posting confirmed/).waitFor();
   await assertVisibleLabels(page);const sizes=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({width,workspace:'synthetic checker approval and posting receipt',keyboard:true,visibleLabelMechanisms:true,...sizes});if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/funding-checker-a24-${width}.png`,fullPage:true});
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/funding-checker-a24-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
