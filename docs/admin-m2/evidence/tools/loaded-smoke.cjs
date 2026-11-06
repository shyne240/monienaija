const { chromium: playwright }=require('playwright-core'); const chromium=require('@sparticuz/chromium').default; const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true}); const page=await browser.newPage({viewport:{width:320,height:900}});
 await page.route('**/api/v1/**',route=>{
  const u=new URL(route.request().url());let body;
  if(route.request().method()!=='GET') return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'Synthetic harness blocks mutations'})});
  if(u.pathname.endsWith('/my-dashboard')) body={templateKey:'SYNTHETIC',displayName:'Operations overview',description:'Synthetic fixture',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/internal/support/tickets')) body={items:[{id:'ticket-synthetic-1',reference:'SUP-0001',status:'OPEN',category:'ACCOUNT',priority:'NORMAL',subject:'Synthetic support request',customerId:'customer-synthetic',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'}],pagination:{total:1}};
  else if(u.pathname.endsWith('/internal/support/tickets/ticket-synthetic-1')) body={id:'ticket-synthetic-1',reference:'SUP-0001',status:'OPEN',category:'ACCOUNT',priority:'NORMAL',subject:'Synthetic support request',customerId:'customer-synthetic',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'};
  else if(u.pathname.endsWith('/internal/support/tickets/ticket-synthetic-1/messages')) body=[{id:'m1',body:'Synthetic message for layout verification.',authorType:'CUSTOMER',isInternal:false,createdAt:'2026-11-01T10:00:00Z'}];
  else if(u.pathname.endsWith('/internal/fee-rules')) body=[{id:'synthetic-fee',code:'SYNTHETIC-FEE',productCode:'P2P',currency:'NGN',flatFeeMinor:'100',percentageBps:25,vatBps:750,status:'ACTIVE',version:1}];
  else if(u.pathname.endsWith('/ledger/accounts')) body=[{id:'synthetic-account',code:'1001',name:'Synthetic settlement account',accountType:'ASSET',currency:'NGN',accountingUnit:'CUSTOMER_FUNDS',normalBalance:'DEBIT',status:'ACTIVE',balanceMinor:'123456789'}];
  else return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic service unavailable'})});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5173/'); await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic:operator',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN','FINANCE_CONTROLLER'],scopes:['customer.manage_support_case','fee_rule.view','ledger.view'],customerAccess:'NONE',assuranceLevel:'MFA'}));}); await page.reload({waitUntil:'networkidle'});
 const report=[];for(const width of [320,360,390,768,769,1024,1280,1440]) {await page.setViewportSize({width,height:900});for(const key of ['support','feeRules','ledgerExplorer']){
   if(width<1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width<1024?'mobile-':'')+'nav-'+key).click();
   if(key==='support') {await page.getByText('SUP-0001').waitFor();await page.getByRole('button',{name:'View',exact:true}).click();await page.getByText('Synthetic message for layout verification.').waitFor();}
   if(key==='feeRules') await page.getByText('SYNTHETIC-FEE').first().waitFor();
   if(key==='ledgerExplorer') await page.getByText('Synthetic settlement account').waitFor();
   const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth})); report.push({width,key,...size});
   if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/loaded-${key}-${width}.png`,fullPage:true});
 }}
 console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
