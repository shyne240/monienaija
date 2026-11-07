// All API calls, including assignment writes, are intercepted synthetic fixtures.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const templates = ['ONE', 'TWO'].map(templateKey => ({ id: templateKey, templateKey, displayName: `Synthetic ${templateKey}`, description: 'Synthetic fixture', operationalArea: 'SYNTHETIC', isActive: true, layout: { widgets: [{ widgetKey:'synthetic-widget', order:0 }] } }));
  let mode = 'mismatch';
  await page.route('**/api/v1/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname; let body;
    if (req.method() === 'PUT' && path.endsWith('/assignments/SYNTHETIC_ROLE')) body = { id: mode === 'match' ? 'assignment' : 'unrelated', roleKey: 'SYNTHETIC_ROLE', templateKey:'TWO', assignedBy:'synthetic-operator', assignedAt:'2026-11-01T00:00:00Z' };
    else if (req.method() !== 'GET') return route.fulfill({ status:403, body:'Blocked by synthetic harness' });
    else if (path.endsWith('/my-dashboard')) body = { templateKey:'ONE', displayName:'Overview', description:'', isFallback:false, widgets:[] };
    else if (path.endsWith('/dashboard/templates')) body = templates;
    else if (path.endsWith('/dashboard/assignments')) body = [{ id:'assignment', roleKey:'SYNTHETIC_ROLE', templateKey:'ONE', assignedBy:'seed', assignedAt:'2026-11-01T00:00:00Z' }];
    else if (path.endsWith('/dashboard/widget-registry')) body = [{ widgetKey:'synthetic-widget', displayName:'Synthetic widget' }];
    else return route.fulfill({ status:503, body:'Synthetic service unavailable' });
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token','synthetic'); localStorage.setItem('admin_workforce_session_id','synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({ type:'PRIVILEGED', principalId:'synthetic-operator', sessionId:'synthetic', audience:'workforce-admin', roles:['SUPER_ADMIN'], scopes:['workforce.dashboard.view','workforce.dashboard.assign'], customerAccess:'NONE', assuranceLevel:'MFA' }));
  });
  await page.reload({ waitUntil:'networkidle' }); const report = [];
  const activate = async locator => { await locator.focus(); await page.keyboard.press('Enter'); };
  for (const width of [320,360,390,768,769,1024,1280,1440]) {
    mode = 'mismatch'; await page.setViewportSize({ width, height:900 });
    const navigate = async key => { if (width < 1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + key).click(); };
    await navigate('dashboard'); await navigate('dashboardSettings');
    const template = page.getByRole('button', { name:/ONE: Synthetic ONE/ }); await activate(template); await page.getByText('Synthetic widget (synthetic-widget)').waitFor();
    const select = page.getByLabel('Dashboard template for SYNTHETIC_ROLE'); await select.focus(); await page.keyboard.press('ArrowDown');
    if (await select.inputValue() !== 'TWO') throw Error('Template selection was not keyboard operable');
    const save = page.getByRole('button', { name:'Save dashboard assignment for SYNTHETIC_ROLE', exact:true }); await activate(save); await page.getByText(/assignment outcome could not be confirmed/).waitFor(); if (!(await save.isDisabled())) throw Error('Unconfirmed assignment allowed immediate retry');
    mode = 'match'; await activate(page.getByRole('button', { name:'Reload configuration' })); await page.getByLabel('Dashboard template for SYNTHETIC_ROLE').waitFor(); await activate(page.getByRole('button', { name:'Save dashboard assignment for SYNTHETIC_ROLE', exact:true })); await page.getByText('Dashboard for SYNTHETIC_ROLE is now TWO.').waitFor();
    await assertVisibleLabels(page); const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    report.push({ width, keyboard:true, mismatchedReceiptRejected:true, matchingReceiptConfirmed:true, visibleLabelMechanisms:true, ...size });
    if ([320,1440].includes(width)) await page.screenshot({ path:`${process.cwd()}/docs/admin-m2/evidence/dashboard-settings-actions-${width}.png`, fullPage:true });
  }
  fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/dashboard-settings-actions-smoke.json`, JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify({total:report.length,overflow:report.filter(x=>x.page>x.view)},null,2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
