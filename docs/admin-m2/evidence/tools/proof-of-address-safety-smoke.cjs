// Synthetic upload/lifecycle responses only; no real file, customer, backend or worker.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
const axe = require('axe-core');
(async () => {
 const browser = await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
 const page = await browser.newPage({viewport:{width:320,height:900}});
 const c={id:'customer-synthetic',reference:'SYNTHETIC',type:'INDIVIDUAL',status:'ACTIVE',kycLevel:'LEVEL_1',kycStatus:'APPROVED',displayName:'Synthetic Customer',legalName:'Synthetic Customer',createdAt:'2026-11-01'};
 const address={id:'address-synthetic',type:'RESIDENTIAL',lineOne:'1 Synthetic Road',lineTwo:null,city:'Abuja',state:'FCT',country:'NG',postalCode:null,isPrimary:true};
 const makeDoc=()=>({id:'doc-synthetic',submissionGroupId:'group-synthetic',revisionNumber:1,supersedesSubmissionId:null,customerId:c.id,residentialAddressId:address.id,category:'UTILITY',documentType:'UTILITY_BILL',issuerName:null,documentDate:null,reviewStatus:'PENDING',documentStatus:'AVAILABLE',scannerResult:'CLEAN',originalFileName:'synthetic.pdf',detectedMimeType:'application/pdf',fileSizeBytes:String(Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF').length),uploadedAt:'2026-11-01T10:00:00Z',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'});
 let doc, mode;
 await page.route('**/api/v1/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;let body;
  if(req.method()==='POST' && path.endsWith('/customer-synthetic/proof-of-address')) body=mode==='bad-upload'?{...doc,customerId:'other-customer'}:doc;
  else if(req.method()==='POST' && path.endsWith('/doc-synthetic/withdraw')) {if(mode==='bad-withdraw')body={...doc,id:'other-document',documentStatus:'WITHDRAWN'};else {doc={...doc,documentStatus:'WITHDRAWN'};body=doc;}}
  else if(req.method()!=='GET')return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});
  else if(path.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',widgets:[]};
  else if(path.endsWith('/internal/customers'))body={data:[c],total:1,page:1,limit:20,totalPages:1,hasNextPage:false,hasPreviousPage:false};
  else if(path.endsWith('/proof-of-address/capabilities'))body={enabled:true,maxUploadBytes:10485760,allowedMimeTypes:['application/pdf'],previewAvailable:true,documentaryReviewEnabled:false,physicalVerificationEnabled:false,tier3OrWalletChangesEnabled:false};
  else if(path.endsWith('/history'))body={items:[{id:'history-synthetic',submissionId:doc.id,action:'UPLOADED',actorRoleKey:'OPERATIONS',previousDocumentStatus:null,newDocumentStatus:'AVAILABLE',reason:null,createdAt:'2026-11-01T10:00:00Z'}],page:1,limit:20,total:1};
  else if(path.endsWith('/proof-of-address'))body={items:[doc],page:1,limit:20,total:1};
  else if(path.endsWith('/addresses'))body=[address];
  else if(path.endsWith('/phone-verification'))body={customerId:c.id,customerStatus:'ACTIVE',phones:[],activationGate:{verifiedPrimaryPhone:false}};
  else if(path.endsWith('/onboarding-readiness'))body={status:'READY',onboardingStatus:'COMPLETED',missing:[]};
  else if(path.endsWith('/eligibility'))body={status:'ELIGIBLE'};
  else if(path.endsWith('/transactions'))body={items:[]};
  else if(path.endsWith('/wallets'))body={data:[]};
  else return route.fulfill({status:503,body:'Synthetic service unavailable'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5176/');
 await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['customer.view','customer.view_address','customer.view_proof_of_address_metadata','customer.upload_proof_of_address','customer.withdraw_proof_of_address'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 await page.reload({waitUntil:'networkidle'});const report=[];
 for(const width of [320,360,390,768,769,1024,1280,1440]){
  doc=makeDoc(); mode='bad-upload'; await page.setViewportSize({width,height:900});
  async function nav(key){if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-'+key).click();}
  await nav('dashboard');await nav('customers');await page.getByRole('button',{name:'Open Customer 360° for Synthetic Customer'}).click();await page.getByRole('tab',{name:'Proof of Address & physical verification'}).click();await page.getByRole('heading',{name:'Utility bill · revision 1'}).waitFor();
  await page.getByLabel('Document file (PDF, JPG, JPEG, PNG)').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF')});
  await page.getByRole('button',{name:'Discard upload draft'}).click();await page.getByRole('dialog',{name:'Discard upload draft?'}).getByRole('button',{name:'Keep draft'}).click();await page.getByRole('tab',{name:'Overview'}).click();await page.getByRole('dialog',{name:'Leave Proof of Address?'}).getByRole('button',{name:'Keep working'}).click();await nav('dashboard');await page.getByRole('dialog',{name:'Leave customer information?'}).getByRole('button',{name:'Keep working'}).click();
  const upload=page.getByRole('button',{name:'Upload Proof of Address'});await upload.focus();await page.keyboard.press('Enter');await page.getByText(/Upload outcome could not be confirmed/).waitFor();
  if(await page.getByRole('button',{name:'Retry same upload'}).isEnabled())throw Error('Retry enabled without review');await page.getByRole('tab',{name:'Overview'}).click();await page.getByRole('dialog',{name:'Leave Proof of Address?'}).getByRole('button',{name:'Keep working'}).click();const pendingSize=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));if(pendingSize.page>pendingSize.view)throw Error('pending upload overflow');if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/proof-pending-${width}.png`,fullPage:true});} await page.getByRole('button',{name:'Refresh records for upload review'}).click();await page.getByRole('button',{name:'I reviewed the records and history'}).waitFor({state:'visible'});await page.getByRole('button',{name:'I reviewed the records and history'}).click(); mode='valid-upload';await page.getByRole('button',{name:'Retry same upload'}).click();await page.getByText(/submission is available with a clean malware scan/).waitFor();
  mode='bad-withdraw';const withdraw=page.getByRole('button',{name:'Withdraw',exact:true});await withdraw.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.getByLabel('Reason (required)').fill('Synthetic reason');const confirm=dialog.getByRole('button',{name:'Confirm withdrawal'});await confirm.focus();await page.keyboard.press('Enter');await dialog.getByText(/Withdrawal outcome could not be confirmed/).waitFor();
  if(await confirm.isEnabled())throw Error('Conflicting action enabled without review');await dialog.getByRole('button',{name:'Cancel'}).click();await page.getByRole('button',{name:'Refresh Proof of Address records'}).click();await page.getByRole('button',{name:'View history'}).click();await page.getByText('UPLOADED',{exact:true}).waitFor();const reviewSize=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));if(reviewSize.page>reviewSize.view)throw Error('lifecycle review overflow');await page.getByRole('button',{name:'I reviewed this document and history'}).click();mode='valid-withdraw';await page.getByRole('button',{name:'Withdraw',exact:true}).click();const nextDialog=page.getByRole('dialog');await nextDialog.getByLabel('Reason (required)').fill('Synthetic reason');await nextDialog.getByRole('button',{name:'Confirm withdrawal'}).click();await page.getByText(/document was withdrawn. Content access is disabled/i).waitFor();await assertVisibleLabels(page);await page.addScriptTag({content:axe.source});const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>v.id));if(violations.length)throw Error('axe violations: '+violations.join(','));
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({width,workspace:'proof of address actions',synthetic:true,keyboard:true,uploadMismatchRejected:true,withdrawMismatchRejected:true,draftTabShellGuard:true,pendingTabGuard:true,confirmed:true,pendingSize,reviewSize, targetedAxeViolations:[],...size});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/proof-safety-${width}.png`,fullPage:true});}
 }
 fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/proof-of-address-safety-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
