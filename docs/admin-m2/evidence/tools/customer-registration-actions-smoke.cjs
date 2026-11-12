// Synthetic registration writes are intercepted. No real customers, OTPs, messaging or backend mutations.
const assertVisibleLabels=require('./assert-visible-labels.cjs');
const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});
 let profileMode='valid', unexpectedPatch=0;
 const customer={id:'customer-synthetic',reference:'SYNTHETIC',type:'INDIVIDUAL',status:'DRAFT',kycLevel:'NONE',kycStatus:'NOT_STARTED',version:1,createdAt:'2026-11-01',updatedAt:'2026-11-01',deletedAt:null};
 await page.route('**/api/v1/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;let body;
  if(req.method()==='PATCH'){unexpectedPatch++;return route.fulfill({status:403,body:'Synthetic harness blocks PATCH'});}
  if(req.method()==='POST' && path.endsWith('/customers'))body=customer;
  else if(req.method()==='POST' && path.endsWith('/customer-synthetic/registration-profile')){if(profileMode==='conflict')return route.fulfill({status:409,contentType:'application/json',body:'{"message":"Synthetic conflict"}'});body={id:'profile-synthetic',customerId:customer.id,displayName:'Synthetic Customer'};}
  else if(req.method()==='POST' && path.endsWith('/customer-synthetic/contact-method'))body={id:'phone-synthetic',customerId:customer.id,type:'PHONE',maskedValue:'+234*****0001',isPrimary:true,verifiedAt:null};
  else if(req.method()==='POST' && path.endsWith('/customer-synthetic/identity-document'))body={id:'identity-synthetic',customerId:customer.id,type:'NIN',maskedDocumentNumber:'••••••0001',issuingCountry:'NG',issuedAt:null,expiresAt:null};
  else if(req.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutation'});
  else if(path.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',widgets:[]};
  else if(path.endsWith('/internal/customers'))body={data:[],total:0,page:1,limit:20,totalPages:0,hasNextPage:false,hasPreviousPage:false};
  else return route.fulfill({status:503,body:'Synthetic service unavailable'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['customer.view','customer.create','customer.view_contact_methods','customer.view_identity_documents','customer.view_address','kyc.review'],customerAccess:'NONE',assuranceLevel:'MFA'}));});await page.reload({waitUntil:'networkidle'});
 const report=[];for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});async function nav(key){if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-'+key).click();}
  async function openWizard(){await nav('dashboard');await nav('customers');await page.getByRole('button',{name:'New Customer'}).click();await page.getByLabel('First name').fill('Synthetic');await page.getByLabel('Last name').fill('Customer');}
  profileMode='valid';await openWizard();const create=page.getByRole('button',{name:'Create DRAFT & continue'});await create.focus();await page.keyboard.press('Enter');await page.getByLabel('Primary phone number').waitFor();
  await page.getByLabel('Primary phone number').fill('+2348012340001');await page.getByRole('button',{name:'Save contact details'}).click();await page.getByText(/Contact details saved/).waitFor();await page.getByRole('button',{name:'Continue to address'}).click();await page.getByRole('button',{name:'Skip address'}).click();
  await page.getByLabel('Document number').fill('00000000001');await page.getByRole('button',{name:'Save this document'}).click();await page.getByText('••••••0001 · Saved').waitFor();
  await assertVisibleLabels(page);const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/customer-registration-actions-${width}.png`,fullPage:true});}
  profileMode='conflict';await openWizard();await page.getByRole('button',{name:'Create DRAFT & continue'}).click();await page.getByText(/conflicting record already exists/i).waitFor();if(unexpectedPatch)throw Error('Registration profile conflict triggered a PATCH');
  report.push({width,workspace:'synthetic registration receipts',confirmed:true,profileConflictNotOverwritten:true,...size});
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/customer-registration-actions-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(row=>row.page>row.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
