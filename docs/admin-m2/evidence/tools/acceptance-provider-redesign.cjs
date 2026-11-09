const assertVisibleLabels = require('./assert-visible-labels.cjs');
const assert = require('assert');
// Synthetic provider metadata only: all mutations are blocked, including verification and test-send.
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
let writes = 0;
(async()=>{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});
 const gates={configured:false,verified:false,enabled:false,deliveryTested:false,productionReady:false};
 const snap=(channel)=>({channel,source:'DATABASE',provider:channel==='SMS'?'console':'none',enabled:false,lifecycleState:'NOT_CONFIGURED',gates,baseUrl:null,requestTimeoutMs:10000,senderId:null,fromEmail:null,fromName:null,replyToEmail:null,hasStoredCredential:false,keyFingerprint:null,misconfigurationCode:null,version:0,domainAuthentication:null,verification:{verifiedAt:null,verificationMethod:null,lastVerificationError:null},lastTest:{status:null,destinationMasked:null,providerRef:null,errorCode:null,testedAt:null}});
 const cfg={sms:snap('SMS'),email:snap('EMAIL'),encryption:{available:true,mode:'SYNTHETIC',activeKeyVersion:'test'},worker:{enabled:false},contracts:{robase:{verifiedEndpoint:'Synthetic contract',senderIdBehaviour:'Synthetic sender'},brevo:{domainAuthRequirements:['Synthetic SPF','Synthetic DKIM','Synthetic DMARC']}}};
 const proposal={id:'synthetic-proposal',channel:'SMS',expectedVersion:0,proposedProvider:'console',proposedEnabled:false,credentialAction:'CLEAR',reason:'Synthetic proposal',status:'REQUESTED',proposerPrincipalId:'synthetic-maker',approvalId:'synthetic-approval',createdAt:'2026-11-01',proposedDomainAuthentication:{spfConfigured:false,dkimConfigured:false,dmarcConfigured:false}};
 await page.route('**/api/v1/**', route=>{const req=route.request(), u=new URL(req.url());let body;
  if(req.method()!=='GET'){ writes++; return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'Synthetic harness blocks mutations'})}); }
  if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',description:'Synthetic',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/notifications/provider-config/proposals'))body={data:[proposal]};
  else if(u.pathname.endsWith('/notifications/provider-config'))body=cfg;
  else if(u.pathname.endsWith('/notifications/events'))body={items:[{eventType:'transfer.completed',deliveryClass:'TRANSACTIONAL',editable:true,eventEnabled:true,eventLocked:false,eventConfigurationVersion:1,variables:['reference'],channels:{SMS:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1},EMAIL:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1}}}]};
  else if(u.pathname.endsWith('/notifications/templates')){const eventType=u.searchParams.get('eventType'),channel=u.searchParams.get('channel');body={eventType,channel,locale:'en-NG',items:[{id:`synthetic-${channel}`,eventType,channel,locale:'en-NG',version:1,active:true,subject:channel==='EMAIL'?'Synthetic update':null,body:'Synthetic transfer {{reference}}',createdBy:'SYSTEM_SEED',createdAt:'2026-11-01'}],nextBeforeVersion:null};}
  else return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic service unavailable'})});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.NOTIFICATION_SMOKE_ORIGIN || 'http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic-admin',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN'],scopes:['notification.view_deliveries','notification.manage_templates','notification.provider.view','notification.provider.configure'],customerAccess:'NONE',assuranceLevel:'MFA'}));});await page.reload({waitUntil:'networkidle'});
 const report=[];for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.goto(process.env.NOTIFICATION_SMOKE_ORIGIN||'http://127.0.0.1:5173/',{waitUntil:'networkidle'});if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-notifications').click();await page.getByTestId('notif-tab-providerConfig').click();await page.getByTestId('provider-config-workspace').waitFor();await page.getByTestId('provider-proposal-row-synthetic-proposal').waitFor();
  const nav=page.getByRole('navigation',{name:'Provider configuration sections'});await nav.getByRole('link',{name:'Email configuration'}).focus();await page.keyboard.press('Enter');assert(await page.locator('#provider-email').evaluate(el=>document.activeElement===el));
  const email=page.getByTestId('email-provider-select');await email.selectOption('brevo');await page.getByTestId('email-api-key-input').fill('synthetic-secret');await email.selectOption('resend');assert.equal(await page.getByTestId('email-api-key-input').inputValue(),'');
  await nav.getByRole('link',{name:'Proposal queue'}).focus();await page.keyboard.press('Enter');assert(await page.locator('#provider-proposals').evaluate(el=>document.activeElement===el));await assertVisibleLabels(page);
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));report.push({width,keyboardNavigation:true,typedCredentialCleared:true,zeroWrites:writes===0,visibleLabelMechanisms:true,...size});assert(size.page<=size.view, `Document overflow at ${width}px: ${size.page}`);
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/provider-redesign-${width}.png`,fullPage:true});}
 }
 assert.equal(writes,0);fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/provider-redesign-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
