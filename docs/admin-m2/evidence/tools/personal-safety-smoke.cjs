const assertVisibleLabels = require('./assert-visible-labels.cjs');
// Synthetic data only: intercepted mismatched profile receipt; all other writes blocked.
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
const axe = require('axe-core');
const assert=require('assert');
(async () => {
 const browser = await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>a!=='--single-process'),headless:true});
 const page = await browser.newPage({viewport:{width:320,height:900}});let writes=0;
 const c={id:'customer-synthetic',reference:'mn-synthetic-1234',type:'INDIVIDUAL',status:'ACTIVE',kycLevel:'LEVEL_1',kycStatus:'APPROVED',displayName:'Synthetic Customer',legalName:'Synthetic Customer',createdAt:'2026-11-01T10:00:00Z',primaryContact:{type:'PHONE',maskedValue:'+234*****1234',isVerified:true}};
 const addr={id:'address-synthetic',type:'RESIDENTIAL',lineOne:'1 Synthetic Road',lineTwo:null,city:'Abuja',state:'FCT',country:'NG',postalCode:null,isPrimary:true};
 const doc={id:'doc-synthetic',submissionGroupId:'group-synthetic',revisionNumber:1,supersedesSubmissionId:null,customerId:c.id,residentialAddressId:addr.id,category:'UTILITY',documentType:'UTILITY_BILL',issuerName:'Synthetic Utility',documentDate:'2026-10-01',reviewStatus:'PENDING',documentStatus:'AVAILABLE',scannerResult:'CLEAN',originalFileName:'synthetic.png',detectedMimeType:'image/png',fileSizeBytes:'2048',uploadedAt:'2026-11-01T10:00:00Z',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'};
 await page.route('**/api/v1/**', route => {const req=route.request(),u=new URL(req.url());let body;
  if(req.method()!=='GET'){writes++;if(req.method()==='PATCH' && u.pathname.endsWith('/profile')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'profile-synthetic',customerId:'other-customer',displayName:'Mismatch',legalName:null})});return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'Synthetic harness blocks mutations'})});}
  if(u.pathname.endsWith('/proof-of-address/doc-synthetic/content'))return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGf8AAAAASUVORK5CYII=','base64')});
  if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',description:'Synthetic',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/internal/customers'))body={data:[c],total:1,page:1,limit:20,totalPages:1,hasNextPage:false,hasPreviousPage:false};
  else if(u.pathname.endsWith('/phone-verification'))body={customerId:c.id,customerStatus:'ACTIVE',phones:[{isPrimary:true,maskedValue:'+234*****1234',verifiedAt:'2026-10-01'}],activationGate:{verifiedPrimaryPhone:true}};
  else if(u.pathname.endsWith('/onboarding-readiness'))body={status:'READY',onboardingStatus:'COMPLETED',missing:[]};
  else if(u.pathname.endsWith('/eligibility'))body={status:'ELIGIBLE',statusChangedAt:'2026-10-01'};
  else if(u.pathname.endsWith('/transactions'))body={items:[{id:'tx-synthetic',type:'WALLET_TRANSFER',status:'COMPLETED',amountMinor:'123456',currency:'NGN',direction:'OUTGOING',createdAt:'2026-11-01'}]};
  else if(u.pathname.endsWith('/wallets'))body={data:[{id:'wallet-synthetic',currency:'NGN',status:'ACTIVE'}]};
  else if(u.pathname.endsWith('/balance'))body={currency:'NGN',balanceMinor:'123456'};
  else if(u.pathname.endsWith('/profile'))body={id:'profile-synthetic',customerId:c.id,displayName:c.displayName,legalName:c.legalName,firstName:'Synthetic',middleName:null,lastName:'Customer',dateOfBirth:'1990-01-01',nationality:'NG'};
  else if(u.pathname.endsWith('/addresses'))body=[addr];
  else if(u.pathname.endsWith('/contact-methods'))body=[{id:'contact-synthetic',type:'PHONE',maskedValue:'+234*****1234',isPrimary:true,verifiedAt:'2026-10-01'}];
  else if(u.pathname.endsWith('/identity-documents'))body=[];
  else if(u.pathname.endsWith('/proof-of-address/capabilities'))body={enabled:true,maxUploadBytes:10485760,allowedMimeTypes:['application/pdf','image/png','image/jpeg'],previewAvailable:true,documentaryReviewEnabled:false,physicalVerificationEnabled:false,tier3OrWalletChangesEnabled:false};
  else if(u.pathname.endsWith('/proof-of-address'))body={items:[doc],page:1,limit:20,total:1};
  else return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic service unavailable'})});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5176/'); await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['customer.view','customer.create','customer.view_address','customer.view_contact_methods','customer.view_identity_documents','customer.view_transactions','customer.view_wallets','customer.suspend','customer.view_proof_of_address_metadata','customer.upload_proof_of_address','customer.download_proof_of_address','customer.withdraw_proof_of_address','customer.archive_proof_of_address','kyc.review'],readOnlyPrincipal:false,customerAccess:'NONE',assuranceLevel:'MFA'}));});await page.reload({waitUntil:'networkidle'});

 const report=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
  const before=writes;await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:5176/',{waitUntil:'networkidle'});
  async function nav(key){if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-'+key).click();}
  await nav('customers');await page.getByRole('button',{name:'Open Customer 360° for Synthetic Customer'}).click();await page.getByRole('tab',{name:'Personal information & contact'}).click();await page.getByRole('button',{name:'Edit profile'}).click();await page.getByLabel('Display name Required').fill('Pending synthetic name');
  assert.equal(await page.getByRole('button',{name:'Add address'}).isEnabled(),false);
  await page.getByRole('tab',{name:'Overview'}).click();let dialog=page.getByRole('dialog',{name:'Leave personal information?'});await dialog.waitFor();await dialog.getByRole('button',{name:'Keep working'}).click();assert.equal(await page.getByLabel('Display name Required').inputValue(),'Pending synthetic name');
  await nav('dashboard');dialog=page.getByRole('dialog',{name:'Leave customer information?'});await dialog.waitFor();await dialog.getByRole('button',{name:'Keep working'}).click();assert.equal(await page.getByLabel('Display name Required').inputValue(),'Pending synthetic name');
  await page.getByRole('button',{name:'Save profile'}).click();await page.getByRole('heading',{name:'Review an unconfirmed or conflicting action'}).waitFor();assert.equal(await page.getByRole('button',{name:'Save profile'}).isEnabled(),false);assert.equal(writes-before,1);
  await page.getByRole('button',{name:'Refresh personal records for review'}).click();await page.getByRole('button',{name:'I reviewed the records; discard draft and unlock'}).waitFor();assert.equal(await page.getByLabel('Display name Required').inputValue(),'Pending synthetic name');
  await page.addScriptTag({content:axe.source});const scan=await page.evaluate(async()=>window.axe.run(document.querySelector('main.customer-management'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));const violations=scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)}));assert(size.page<=size.view);assert.equal(violations.length,0,JSON.stringify(violations));await assertVisibleLabels(page);if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/personal-safety-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'I reviewed the records; discard draft and unlock'}).click();assert.equal(await page.getByRole('button',{name:'Edit profile'}).isEnabled(),true);assert.equal(writes-before,1);report.push({width,interceptedProfileWrites:1,tabAndShellGuard:true,uncertainReview:true,axeViolations:violations,...size});
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/personal-safety-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,writes,overflow:report.filter(x=>x.page>x.view),axeViolations:report.flatMap(x=>x.axeViolations)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
