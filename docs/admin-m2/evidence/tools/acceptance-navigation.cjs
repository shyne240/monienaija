const { chromium: playwright }=require('playwright-core'); const chromium=require('@sparticuz/chromium').default; const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true}); const page=await browser.newPage({viewport:{width:320,height:900}});
 const files=['navigation-access.ts','Layout.tsx','AgentNetworkScreen.tsx','NotificationManagementScreen.tsx']; let text=files.map(x=>fs.readFileSync(process.cwd()+'/apps/admin-web/src/screens/authenticated/'+x,'utf8')).join('\n');
 const scopes=[...new Set([...text.matchAll(/['"]([a-z_]+(?:[.:][a-z_]+)+)['"]/g)].map(x=>x[1]))];
 await page.route('**/api/v1/**',route=>{const u=route.request().url(); if(u.includes('my-dashboard')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({templateKey:'SYNTHETIC',displayName:'Operations overview',description:'Synthetic fixture',isFallback:false,widgets:[]})}); return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic service unavailable'})});});
 await page.goto('http://127.0.0.1:5173/'); await page.evaluate(s=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic:operator',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN','ADMINISTRATOR','FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER'],scopes:s,customerAccess:'NONE',assuranceLevel:'MFA'}));},scopes); await page.reload({waitUntil:'networkidle'});
 const keys=['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'];
 const report=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]) { await page.setViewportSize({width,height:900}); for(const key of keys) { try {
   if(width<1024) await page.getByTestId('mobile-menu-toggle').click();
   const selector=(width<1024?'mobile-':'')+'nav-'+key; const button=page.getByTestId(selector); if(!(await button.count())) {report.push({width,key,missing:true});if(width<1024) await page.keyboard.press('Escape');continue;}
   await button.click({timeout:4000}); await page.waitForTimeout(120); const sizes=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth,content:document.querySelector('[data-testid="main-content"]').scrollWidth,contentWidth:document.querySelector('[data-testid="main-content"]').clientWidth}));
   report.push({width,key,...sizes});
   if([320,1440].includes(width) && ['support','agents','notifications','transfers'].includes(key)) await page.screenshot({path:`/tmp/m2-accept-${key}-${width}.png`,fullPage:true});
 } catch(e){report.push({width,key,error:String(e).slice(0,250)});if(width<1024 && await page.getByTestId('mobile-menu-close').isVisible().catch(()=>false)) await page.keyboard.press('Escape');} } }
 console.log(JSON.stringify(report,null,2)); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
