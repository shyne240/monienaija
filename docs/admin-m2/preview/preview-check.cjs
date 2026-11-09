// Safety/navigation smoke for the owner preview server, not product authorization or acceptance.
const assert = require('node:assert/strict');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('node:fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => a !== '--single-process'), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4178/') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto('http://127.0.0.1:4178/');
  await page.getByRole('button', { name: 'Open Admin Console preview' }).click();
  await page.getByTestId('nav-dashboard').waitFor();
  const keys = ['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'];
  const results = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const key of keys) {
      if (width < 1024) await page.getByTestId('mobile-menu-toggle').click();
      const link = page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + key);
      assert.equal(await link.count(), 1, `${key} missing at ${width}`);
      await link.click();
      await page.getByTestId('main-content').waitFor();
      results.push({ width, key });
    }
  }
  await page.getByTestId('nav-customers').click();
  await page.getByRole('button', { name: 'Open Customer 360° for Synthetic Customer' }).click();
  await page.getByRole('heading', { name: 'Profile overview' }).waitFor();
  await page.getByRole('tab', { name: 'Personal information & contact' }).click();
  await page.getByText('1 Synthetic Road').waitFor();
  await page.getByRole('tab', { name: 'Proof of Address & physical verification' }).click();
  await page.getByRole('heading', { name: 'Utility bill · revision 1' }).waitFor();
  await page.getByTestId('nav-agents').click();
  await page.getByText('AG-SYNTHETIC').first().waitFor();
  await page.getByRole('button', {name:'View', exact:true}).click();
  await page.getByRole('region', {name:'Unified Agent transaction stream'}).waitFor();
  await page.getByRole('region', {name:'Agent credential and session controls'}).waitFor();
  await page.getByRole('region', {name:'Agent funding workflow'}).waitFor();
  await page.getByTestId('nav-notifications').click();
  await page.getByTestId('notif-tab-smsTemplates').waitFor();
  await page.getByTestId('notif-tab-providerConfig').waitFor();
  await page.goto('http://127.0.0.1:4178/');
  await page.getByRole('button', {name:'Open funding checker preview'}).click();
  await page.getByTestId('nav-approvalsInbox').click();
  await page.getByRole('button', {name:'Review in Checker'}).waitFor();
  await page.getByText('synthetic-funding').first().waitFor();
  const safety = await page.evaluate(async () => {
    const methods = ['POST','PUT','PATCH','DELETE']; const statuses = [];
    for (const method of methods) statuses.push((await fetch('/api/v1/synthetic-safety-check', { method })).status);
    return { statuses, unavailable: (await fetch('/api/v1/not-a-fixture')).status };
  });
  assert.deepEqual(safety.statuses, [403,403,403,403]); assert.equal(safety.unavailable, 503);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { navigationCases: results.length, widths: [320,1440], keys, embedded: ['customer overview','personal information','proof of address','agent credentials','agent history','funding','notification template tab','notification provider tab','separate funding checker queue'], blockedMutationStatuses:safety.statuses, unknownFixtureStatus:safety.unavailable, externalRequests:external, pageErrors:errors, limitation:'Synthetic preview routing and UI only; not live authorization or full action coverage.' };
  fs.writeFileSync('docs/admin-m2/preview/preview-check.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
