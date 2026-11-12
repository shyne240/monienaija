// Synthetic read fixtures only. All mutations are blocked; no SMS tests, workers or providers are run.
const assert=require('assert');const assertVisibleLabels=require('./assert-visible-labels.cjs');const {chromium:playwright}=require('playwright-core');const chromium=require('@sparticuz/chromium').default;const fs=require('fs');
(async()=>{const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});const page=await browser.newPage({viewport:{width:320,height:900}});let writes=0;
 const gates={configured:false,verified:false,enabled:false,deliveryTested:false,productionReady:false};
 const snap=channel=>({channel,source:'DATABASE',provider:channel==='SMS'?'console':'none',enabled:false,lifecycleState:'NOT_CONFIGURED',gates,baseUrl:null,requestTimeoutMs:10000,senderId:null,fromEmail:null,fromName:null,replyToEmail:null,hasStoredCredential:false,keyFingerprint:null,misconfigurationCode:null,version:0,domainAuthentication:null,verification:{verifiedAt:null,verificationMethod:null,lastVerificationError:null},lastTest:{status:null,destinationMasked:null,providerRef:null,errorCode:null,testedAt:null}});
 const cfg={sms:snap('SMS'),email:snap('EMAIL'),encryption:{available:true,mode:'SYNTHETIC',activeKeyVersion:'test'},worker:{enabled:false},contracts:{robase:{verifiedEndpoint:'Synthetic contract',senderIdBehaviour:'Synthetic sender'},brevo:{domainAuthRequirements:['Synthetic SPF','Synthetic DKIM','Synthetic DMARC']}}};
 await page.route('**/api/v1/**',route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'){writes++;return route.fulfill({status:403,body:'Synthetic harness blocks mutations'});}let body;
  if(u.pathname.endsWith('/my-dashboard'))body={templateKey:'SYNTHETIC',displayName:'Overview',isFallback:false,widgets:[]};
  else if(u.pathname.endsWith('/notifications/events'))body={items:[{eventType:'transfer.completed',deliveryClass:'TRANSACTIONAL',editable:true,eventEnabled:true,eventLocked:false,eventConfigurationVersion:1,variables:['reference'],channels:{SMS:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1},EMAIL:{enabled:true,locked:false,configurationVersion:1,activeTemplateVersion:1}}}]};
  else if(u.pathname.endsWith('/notifications/provider-config/proposals'))body={data:[]};
  else if(u.pathname.endsWith('/notifications/provider-config'))body=cfg;
  else if(u.pathname.endsWith('/notifications/deliveries'))body={data:[],total:0,page:1,limit:20,totalPages:0,hasNextPage:false};
  else if(u.pathname.endsWith('/notifications/outbox-receipts'))body={data:[],total:0,page:1,limit:20,totalPages:0,hasNextPage:false};
  else return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic service unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.NOTIFICATION_SMOKE_ORIGIN||'http://127.0.0.1:5173/');await page.evaluate(()=>{localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'synthetic-admin',sessionId:'synthetic',audience:'workforce-admin',roles:['SUPER_ADMIN'],scopes:['notification.view_deliveries','notification.provider.view','notification.provider.configure'],customerAccess:'NONE',assuranceLevel:'MFA'}));});
 const results=[];for(const width of [320,360,390,768,769,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.reload({waitUntil:'networkidle'});if(width<1024)await page.getByTestId('mobile-menu-toggle').click();await page.getByTestId((width<1024?'mobile-':'')+'nav-notifications').click();
  await page.getByTestId('notif-tab-events').click();await page.getByText('transfer.completed',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Refresh Console'}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-testid="refresh-notifications-console-btn"]').disabled);
  const search=page.getByLabel('Search event or description');await search.fill('no-synthetic-match');await page.getByText('No catalogue events match these filters.').waitFor();assert((await page.getByRole('status').allTextContents()).some(s=>s.includes('Showing 0 of 1 catalogue events.')));
  await page.getByRole('button',{name:'Reset filters'}).focus();await page.keyboard.press('Enter');assert.equal(await search.inputValue(),'');
  const trigger=page.getByRole('button',{name:'Configure Triggers for transfer.completed'});await trigger.focus();await page.keyboard.press('Enter');const drawer=page.getByTestId('event-trigger-config-panel');await drawer.waitFor();assert(await drawer.evaluate(el=>document.activeElement===el));
  if([320,1440].includes(width))await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/notification-event-drawer-${width}.png`,fullPage:true});
  await drawer.getByRole('button',{name:'Close'}).click();assert(await trigger.evaluate(el=>document.activeElement===el));await assertVisibleLabels(page);
  const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));results.push({width,filterReset:true,keyboardDrawerFocus:true,mutationsBlocked:writes===0,visibleLabelMechanisms:true,...size});
  if([320,1440].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/notification-events-redesign-${width}.png`,fullPage:true});}
 }
 assert.equal(writes,0);fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/notification-events-redesign-smoke.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({total:results.length,overflow:results.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
