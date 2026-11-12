// Synthetic role changes are intercepted; no live backend writes.
const assert=require('assert');
const assertVisibleLabels=require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});let writes=[];
 await page.route('**/api/v1/**',route=>{const r=route.request(),u=new URL(r.url());let body;
  if(r.method()==='POST'&&u.pathname.endsWith('/a2/workforce/roles')){const request=r.postDataJSON();writes.push({method:'POST',request});body={status:'ACTIVE',principalId:request.targetPrincipalId,roleKey:request.roleKey};}
  else if(r.method()==='DELETE'&&u.pathname.includes('/a2/workforce/roles/')){const parts=u.pathname.split('/');const request=r.postDataJSON();writes.push({method:'DELETE',request});body={status:'REVOKED',principalId:decodeURIComponent(parts[parts.length-2]),roleKey:parts[parts.length-1]};}
  else if(r.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});
  else if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
  else return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic service unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.ROLE_SMOKE_ORIGIN||'http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic-admin',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN'],scopes:['workforce.role.assign','workforce.role.revoke','workforce.role.assign_operational','workforce.role.revoke_operational'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 const results=[];for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.reload({waitUntil:'networkidle'});if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-roleGovernance').click();
  await page.getByLabel('Target Principal ID (e.g. issuer:subject)').fill('synthetic-target');await page.getByLabel('Effective From').fill('2026-11-01T09:00');await page.getByLabel('Effective To').fill('2027-11-01T09:00');await page.getByLabel('Related Maker-Checker Approval IDs (comma separated, when required)').fill('approval-a, approval-b');
  const trigger=page.getByRole('button',{name:'Commit Role Assignment'});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Confirm role assignment'});await dialog.waitFor();const review=await dialog.innerText();assert(review.includes('synthetic-target')&&review.includes('FINANCE_PREPARER')&&review.includes('approval-a, approval-b')&&review.includes('UTC'));
  assert(await page.getByRole('button',{name:'Cancel'}).evaluate(el=>document.activeElement===el));await page.keyboard.press('Shift+Tab');assert(await page.getByRole('button',{name:'Confirm role change'}).evaluate(el=>document.activeElement===el));
  if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/role-review-${width}.png`,fullPage:true});
  const dialogSize=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));await page.keyboard.press('Escape');assert(await trigger.evaluate(el=>document.activeElement===el));assert.equal(writes.length,results.length*2);
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Confirm role change'}).click();await page.getByText('Finance role assigned successfully.').waitFor();assert.deepEqual(writes.at(-1).request.approvalIds,['approval-a','approval-b']);
  await page.getByRole('button',{name:'Operational Roles'}).click();await page.getByRole('button',{name:'Revoke Operational Role'}).click();assert.equal(await page.getByLabel('Related Maker-Checker Approval IDs (comma separated, when required)').count(),0);
  await page.getByLabel('Target Principal ID (e.g. issuer:subject)').fill('synthetic-target');await page.getByLabel('Effective From').fill('2026-11-01T09:00');await page.getByLabel('Effective To').fill('2027-11-01T09:00');await page.getByRole('button',{name:'Execute Revocation'}).click();await page.getByRole('button',{name:'Confirm role change'}).click();await page.getByText('Operational role revoked successfully.').waitFor();assert.deepEqual(writes.at(-1).request.approvalIds,[]);
  await assertVisibleLabels(page);const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));results.push({width,reviewKeyboard:true,financeAndOperationalIntercepted:true,visibleLabelMechanisms:true,...size,dialogPage:dialogSize.page,dialogView:dialogSize.view});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/role-governance-redesign-${width}.png`,fullPage:true});}
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/role-governance-redesign-smoke.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({total:results.length,overflow:results.filter(x=>x.page>x.view||x.dialogPage>x.dialogView)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
