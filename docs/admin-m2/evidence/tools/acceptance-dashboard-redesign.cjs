// Synthetic dashboard responses only; all non-GET requests are blocked.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
const axe = require('axe-core');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a=>a!=='--single-process'), headless: true });
  const page = await browser.newPage({ viewport: { width:320, height:900 } }); let restrictedCalls = 0, writes = 0;
  const widget = (widgetKey, displayName, kind, authorized) => ({ widgetKey, displayName, description:'Synthetic fixture', kind, authorized, fetchMode:'proxy', order:widgetKey === 'transaction-summary' ? 1 : 2 });
  await page.route('**/api/v1/**', route => {
    const req = route.request(), url = new URL(req.url()); let body;
    if (req.method() !== 'GET') { writes++; return route.fulfill({ status:403, body:'Blocked by synthetic harness' }); }
    if (url.pathname.endsWith('/my-dashboard')) body = { templateKey:'SYNTHETIC', displayName:'Synthetic Overview', description:'Synthetic populated dashboard', isFallback:false, widgets:[widget('transaction-summary','Transaction Summary','kpi-summary',true), widget('ledger-summary','Ledger Summary','status-breakdown',false)] };
    else if (url.pathname.endsWith('/widgets/transaction-summary')) body = {period:url.searchParams.get('period'),from:'2026-11-01',to:'2026-11-07',currency:'NGN',totalCompletedCount:42,totalCompletedValueMinor:'900719925474099301',totalFailedCount:2,totalPendingCount:1,successRatePercent:95.45,totalFeeRevenueMinor:'15000',feeRevenueNote:'Synthetic fee revenue',byType:[{type:'W2W',completedCount:42,completedValueMinor:'900719925474099301',failedCount:2,pendingCount:1,feeRevenueMinor:'15000'}],commission:null,commissionNote:'No verified cost data'};
    else if (url.pathname.endsWith('/widgets/ledger-summary')) { restrictedCalls++; return route.fulfill({ status:403, body:'Restricted fixture' }); }
    else return route.fulfill({ status:503, body:'Synthetic service unavailable' });
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/'); await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token','synthetic');localStorage.setItem('admin_workforce_session_id','synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['reporting.transaction_summary.view'],customerAccess:'NONE',assuranceLevel:'MFA'}));
  }); await page.reload({waitUntil:'networkidle'}); const report=[];
  for (const width of [320,360,390,768,769,1024,1280,1440]) {
    await page.setViewportSize({width,height:900}); if (width < 1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-dashboard').click();
    await page.getByText('₦9,007,199,254,740,993.01').first().waitFor(); await page.getByText(/Restricted/).waitFor();
    const period = page.getByLabel('Period', {exact:true}); await period.focus(); const response = page.waitForResponse(resp => resp.url().includes('/widgets/transaction-summary') && resp.url().includes('period=today')); await page.keyboard.press('ArrowUp'); if (await period.inputValue() !== 'today') throw Error('Period not keyboard operable');
    await response; if (restrictedCalls) throw Error('Restricted widget fetched');
    const scopes = page.getByText('Allowed scopes (1)'); await scopes.focus(); await page.keyboard.press('Enter'); if (!(await scopes.locator('..').evaluate(el=>el.open))) throw Error('Scope disclosure failed'); await page.addScriptTag({content:axe.source}); const scan=await page.evaluate(async()=>window.axe.run(document.querySelector('.mn-dashboard'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})); if(scan.violations.length)throw Error(JSON.stringify(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)})))); await assertVisibleLabels(page); const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth})); report.push({width,keyboard:true,restrictedWidgetNotFetched:true,exactAmount:true,visibleLabelMechanisms:true,scopesKeyboard:true,axeViolations:scan.violations.map(v=>v.id),...size});
    if ([320,1440].includes(width)) await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/dashboard-redesign-${width}.png`,fullPage:true});
    // Reset the workspace before the next viewport.
    await page.reload({waitUntil:'networkidle'});
  }
  if(writes)throw Error('Unexpected writes'); fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/acceptance-20261106/dashboard-redesign-smoke.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.length,writes,restrictedCalls,overflow:report.filter(x=>x.page>x.view)},null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
