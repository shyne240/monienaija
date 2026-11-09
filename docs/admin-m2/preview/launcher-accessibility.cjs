// Focused checks of the preview launcher, not WCAG or screen-reader certification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const axe = require('axe-core');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage();
  const results = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({width,height:900}); await page.goto('http://127.0.0.1:4178/');
    await page.addScriptTag({content:axe.source});
    const result = await page.evaluate(async () => {
      const scan = await window.axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
      return {violations:scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.html)})),page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth};
    });
    assert.equal(result.page, result.view); assert.deepEqual(result.violations, []);
    await page.keyboard.press('Tab');
    assert(await page.getByRole('button',{name:'Open Admin Console preview'}).evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Enter');
    await page.getByTestId(width < 1024 ? 'mobile-menu-toggle':'nav-dashboard').waitFor();
    results.push({width,launchByKeyboard:true,...result});
  }
  fs.writeFileSync('docs/admin-m2/preview/launcher-accessibility.json', JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
