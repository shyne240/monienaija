// Synthetic profile reads and intercepted writes only. No live backend, OTP or messaging.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
(async () => {
 const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
 const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
 const customer = { id: 'customer-synthetic', reference: 'SYNTHETIC', type: 'INDIVIDUAL', status: 'ACTIVE', displayName: 'Synthetic Customer', legalName: 'Synthetic Customer', createdAt: '2026-11-01' };
 let profile, mode;
 const initialProfile = () => ({ id:'profile-synthetic', customerId:customer.id, displayName:'Synthetic Customer', legalName:'Synthetic Customer', firstName:'Synthetic', middleName:null, lastName:'Customer', dateOfBirth:'1990-01-01', nationality:'NG' });
 await page.route('**/api/v1/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  let body;
  if (request.method() === 'PATCH' && path.endsWith('/customer-synthetic/profile')) {
   const proposed = { ...profile, ...request.postDataJSON() };
   if (mode === 'mismatch') body = { ...proposed, customerId:'other-customer' };
   else { profile = proposed; body = profile; }
  } else if (request.method() !== 'GET') return route.fulfill({ status:403, body:'Synthetic harness blocks mutations' });
  else if (path.endsWith('/my-dashboard')) body={templateKey:'SYNTHETIC',displayName:'Overview',widgets:[]};
  else if (path.endsWith('/internal/customers')) body={data:[customer],total:1,page:1,limit:20,totalPages:1};
  else if (path.endsWith('/profile')) body=profile;
  else if (path.endsWith('/addresses') || path.endsWith('/contact-methods') || path.endsWith('/identity-documents')) body=[];
  else if (path.endsWith('/transactions')) body={items:[]};
  else if (path.endsWith('/wallets')) body={data:[]};
  else if (path.endsWith('/phone-verification')) body={customerId:customer.id,customerStatus:'ACTIVE',phones:[],activationGate:{verifiedPrimaryPhone:false}};
  else if (path.endsWith('/onboarding-readiness')) body={status:'READY',onboardingStatus:'COMPLETED',missing:[]};
  else if (path.endsWith('/eligibility')) body={status:'ELIGIBLE'};
  else return route.fulfill({status:503,body:'Synthetic service unavailable'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5173/');
 await page.evaluate(() => { localStorage.setItem('admin_workforce_token','synthetic'); localStorage.setItem('admin_workforce_session_id','synthetic'); localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['customer.view','customer.create','customer.view_address','customer.view_contact_methods','customer.view_identity_documents'],customerAccess:'NONE',assuranceLevel:'MFA'})); });
 await page.reload({waitUntil:'networkidle'});
 const results=[];
 for (const width of [320,360,390,768,769,1024,1280,1440]) {
  profile=initialProfile(); mode='mismatch'; await page.setViewportSize({width,height:900});
  async function navigate(key) {if(width<1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width<1024?'mobile-':'')+'nav-'+key).click();}
  await navigate('dashboard'); await navigate('customers');
  await page.getByRole('button',{name:'Open Customer 360° for Synthetic Customer'}).click();
  await page.getByRole('tab',{name:'Personal information & contact'}).click();
  await page.getByRole('button',{name:'Edit profile'}).click();
  const displayName=page.getByLabel('Display name',{exact:false}); await displayName.fill('Synthetic Revised Customer');
  const save=page.getByRole('button',{name:'Save profile'}); await save.focus(); await page.keyboard.press('Enter');
  await page.getByText(/request outcome could not be confirmed/i).waitFor();
  if(await page.getByText(/Personal information saved/).count()) throw Error('Mismatched receipt was reported as saved');
  mode='valid'; await save.focus(); await page.keyboard.press('Enter');
  await page.getByText('Synthetic Revised Customer',{exact:true}).first().waitFor();
  await assertVisibleLabels(page);
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
  results.push({width,workspace:'profile receipt',synthetic:true,keyboard:true,mismatchRejected:true,validReceiptConfirmed:true,...size});
  if([320,1440].includes(width)) {await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/customer-profile-receipt-${width}.png`,fullPage:true});}
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/customer-profile-receipt-smoke.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({total:results.length,overflow:results.filter(row=>row.page>row.view)},null,2)); await browser.close();
})().catch(error => {console.error(error);process.exit(1)});
