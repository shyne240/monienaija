# Admin headless browser probe — source and raw output

**Evidence, not application code.** This script ran locally at `cf60b9d8001c605f4d986a222c07ed10e7adee30` using a synthetic browser-only principal. It intercepted every `/api/` request with synthetic JSON and aborted non-local network requests. The token/principal strings are invented, and the unusually broad scopes only expose controls for inspection; they do not verify real entitlements. The script selects screens and measures DOM/accessibility state; it does not submit a financial operation. No backend, production service or external provider was contacted.

Chromium `141.0.7390.0`, `puppeteer-core` `24.25.0`, `@sparticuz/chromium` `141.0.0`; 18 API requests were mocked, no external request was observed. The local Vite process used `ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:9` as a second safeguard and was stopped after the probe. This is a synthetic desktop-browser engine at narrow and wide viewports: **not a mobile device, emulator or actual screen reader**. The Accessibility-domain nodes are not a screen-reader interaction or a full audit. See [interpretation and unknowns](../01-verification.md#admin-drawer-keyboard-and-accessibility-tree).

The following reproduces the original sandbox paths when the separately installed browser tools and their local Chromium runtime libraries are present. They are an external cache, not repo/application dependencies, and may not persist in another environment. Start the Admin Vite server in a separate terminal (stop it after the probe); all API requests must remain intercepted, and no real backend or credentials should be used:

```sh
cd /home/user/monienaija/apps/admin-web
ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:9 npm run dev -- --host 0.0.0.0
# In a separate terminal:
mkdir -p /home/user/.cache/m0-probes
awk '/^```js admin-probe$/{p=1;next} /^```$/{if(p) exit} p' \
  /home/user/monienaija/docs/design-discovery-20261029/m0/evidence/admin-browser-probe.md \
  > /home/user/.cache/m0-probes/admin-browser.cjs
LD_LIBRARY_PATH=/home/user/.cache/ui-discovery-tools/chromium-libs/lib \
  node /home/user/.cache/m0-probes/admin-browser.cjs
```

For another machine, adapt the absolute repo/cache paths and provision a compatible headless Chromium/Puppeteer **outside** the app. Do not proxy to a real backend. Request counts can vary with timing; the evidence concerns the recorded run, not a requirement that the count always equal 18.

## Recorded raw output

```json
{
  "sizes": [
    {
      "viewport": 320,
      "mainClientWidth": 320,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 472,
        "right": 543,
        "withinVisibleMain": false
      },
      "simulator": {
        "left": 609,
        "right": 769,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 718,
      "scrollLeftToTrack": 452,
      "trackAfterHorizontalScroll": {
        "left": 20,
        "right": 91,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 360,
      "mainClientWidth": 360,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 472,
        "right": 543,
        "withinVisibleMain": false
      },
      "simulator": {
        "left": 609,
        "right": 769,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 678,
      "scrollLeftToTrack": 452,
      "trackAfterHorizontalScroll": {
        "left": 20,
        "right": 91,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 390,
      "mainClientWidth": 390,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 472,
        "right": 543,
        "withinVisibleMain": false
      },
      "simulator": {
        "left": 609,
        "right": 769,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 648,
      "scrollLeftToTrack": 452,
      "trackAfterHorizontalScroll": {
        "left": 20,
        "right": 91,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 768,
      "mainClientWidth": 768,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 472,
        "right": 543,
        "withinVisibleMain": true
      },
      "simulator": {
        "left": 609,
        "right": 769,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 270,
      "scrollLeftToTrack": 270,
      "trackAfterHorizontalScroll": {
        "left": 202,
        "right": 273,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 769,
      "mainClientWidth": 441,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 800,
        "right": 871,
        "withinVisibleMain": false
      },
      "simulator": {
        "left": 937,
        "right": 1097,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 597,
      "scrollLeftToTrack": 452,
      "trackAfterHorizontalScroll": {
        "left": 348,
        "right": 419,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 1024,
      "mainClientWidth": 696,
      "mainScrollWidth": 1038,
      "overflowX": "auto",
      "track": {
        "left": 800,
        "right": 871,
        "withinVisibleMain": true
      },
      "simulator": {
        "left": 937,
        "right": 1097,
        "withinVisibleMain": false
      },
      "maxScrollLeft": 342,
      "scrollLeftToTrack": 342,
      "trackAfterHorizontalScroll": {
        "left": 458,
        "right": 529,
        "withinVisibleMain": true
      }
    },
    {
      "viewport": 1440,
      "mainClientWidth": 1112,
      "mainScrollWidth": 1112,
      "overflowX": "auto",
      "track": {
        "left": 800,
        "right": 871,
        "withinVisibleMain": true
      },
      "simulator": {
        "left": 937,
        "right": 1097,
        "withinVisibleMain": true
      },
      "maxScrollLeft": 0,
      "scrollLeftToTrack": 0,
      "trackAfterHorizontalScroll": {
        "left": 800,
        "right": 871,
        "withinVisibleMain": true
      }
    }
  ],
  "navigation": {
    "closedToggleAX": [
      {
        "role": "button",
        "name": "Open navigation menu",
        "ignored": false,
        "properties": {
          "invalid": "false",
          "focusable": true,
          "focused": true
        }
      }
    ],
    "openToggleAX": [
      {
        "role": "button",
        "name": "Open navigation menu",
        "ignored": false,
        "properties": {
          "invalid": "false",
          "focusable": true,
          "focused": true
        }
      }
    ],
    "drawerAX": [
      {
        "role": "navigation",
        "name": "Mobile navigation",
        "ignored": false,
        "properties": {}
      }
    ],
    "opened": {
      "drawerPresent": true,
      "toggleExpanded": null,
      "toggleName": "Open navigation menu",
      "mainInert": false
    },
    "afterSelection": {
      "drawerPresent": false,
      "activeTag": "BODY",
      "activeTestId": null,
      "focusInMain": false
    },
    "tabCount": 37,
    "firstMain": {
      "tag": "BUTTON",
      "inMain": true
    },
    "drawerAfterEscape": true
  },
  "requests": {
    "mockedApi": 18,
    "abortedExternal": 0
  }
}```

## Harness used

```js admin-probe
const fs = require('fs');
const puppeteer = require('/home/user/.cache/ui-discovery-tools/node_modules/puppeteer-core');
const chromium = require('/home/user/.cache/ui-discovery-tools/node_modules/@sparticuz/chromium');
(async () => {
  const nav = fs.readFileSync('/home/user/monienaija/apps/admin-web/src/screens/authenticated/navigation-access.ts','utf8');
  const scopes = [...new Set(Array.from(nav.matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z_]+|:[a-z_]+)+)'/g),m=>m[1]))];
  scopes.push('customer.create');
  const browser = await puppeteer.launch({args:chromium.args, executablePath:await chromium.executablePath(), headless:true});
  const counts = {mockedApi:0, abortedExternal:0};
  async function page(width){
    const p = await browser.newPage(); await p.setViewport({width,height:width>=1024?900:844,deviceScaleFactor:1});
    await p.setRequestInterception(true); p.on('request',r=>{
      const u=new URL(r.url());
      if(u.pathname.startsWith('/api/')) {counts.mockedApi++;const data=u.pathname.includes('my-dashboard')?{displayName:'Synthetic',widgets:[]}:{data:[],items:[],total:0,page:1,limit:20,totalPages:0,hasNextPage:false,hasPreviousPage:false};r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});}
      else if(u.hostname==='127.0.0.1'&&u.port==='5173') r.continue().catch(()=>{});
      else {counts.abortedExternal++;r.abort().catch(()=>{});}
    });
    await p.evaluateOnNewDocument(sc=>{localStorage.setItem('admin_workforce_token','synthetic-only');localStorage.setItem('admin_workforce_session_id','synthetic-only');localStorage.setItem('admin_workforce_principal',JSON.stringify({type:'PRIVILEGED',principalId:'review:synthetic',sessionId:'synthetic-only',audience:'workforce-admin',roles:['SUPER_ADMIN','FINANCE_CONTROLLER'],scopes:sc,customerAccess:'NONE',assuranceLevel:'MFA'}));},scopes);
    await p.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle0'});return p;
  }
  const sizes=[];
  for(const width of [320,360,390,768,769,1024,1440]){
    const p=await page(width);
    if(width<=768){await p.click('[data-testid=mobile-menu-toggle]');await p.click('[data-testid=mobile-nav-transfers]');}
    else await p.click('[data-testid=nav-transfers]');
    await new Promise(r=>setTimeout(r,150));
    const info=await p.evaluate(()=>{
      const main=document.querySelector('[data-testid=main-content]');
      const buttons=Array.from(main.querySelectorAll('button'));
      const pos=e=>{if(!e)return null; const r=e.getBoundingClientRect(), m=main.getBoundingClientRect();return {left:Math.round(r.left),right:Math.round(r.right),withinVisibleMain:r.left>=Math.max(0,m.left)&&r.right<=Math.min(innerWidth,m.right)};};
      const track=buttons.find(x=>x.textContent.trim()==='Track');
      const run=buttons.find(x=>x.textContent.trim()==='Run Simulation');
      const result={viewport:innerWidth,mainClientWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,overflowX:getComputedStyle(main).overflowX,track:pos(track),simulator:pos(run)};
      main.scrollLeft=99999;result.maxScrollLeft=main.scrollLeft; if(track){const target=track.getBoundingClientRect().left-main.getBoundingClientRect().left+main.scrollLeft-20;main.scrollLeft=target;} result.scrollLeftToTrack=main.scrollLeft;result.trackAfterHorizontalScroll=pos(track);return result;
    }); sizes.push(info);await p.close();
  }
  const p=await page(390);
  const client=await p.createCDPSession();await client.send('DOM.enable');await client.send('Accessibility.enable');
  async function ax(selector){const {root}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector}); const {nodes}=await client.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});return nodes.map(n=>({role:n.role?.value,name:n.name?.value,ignored:n.ignored,properties:Object.fromEntries((n.properties||[]).map(q=>[q.name,q.value?.value]))}));}
  await p.focus('[data-testid=mobile-menu-toggle]');const closedToggleAX=await ax('[data-testid=mobile-menu-toggle]');
  await p.keyboard.press('Enter');const openToggleAX=await ax('[data-testid=mobile-menu-toggle]');const drawerAX=await ax('[data-testid=mobile-nav] nav');
  const opened=await p.evaluate(()=>({drawerPresent:!!document.querySelector('[data-testid=mobile-nav]'),toggleExpanded:document.querySelector('[data-testid=mobile-menu-toggle]').getAttribute('aria-expanded'),toggleName:document.querySelector('[data-testid=mobile-menu-toggle]').getAttribute('aria-label'),mainInert:document.querySelector('[data-testid=main-content]').hasAttribute('inert')}));
  await p.focus('[data-testid=mobile-nav-customers]');await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,150));
  const afterSelection=await p.evaluate(()=>({drawerPresent:!!document.querySelector('[data-testid=mobile-nav]'),activeTag:document.activeElement?.tagName,activeTestId:document.activeElement?.getAttribute('data-testid'),focusInMain:!!document.activeElement?.closest('[data-testid=main-content]')}));
  await p.click('[data-testid=mobile-menu-toggle]');let tabCount=0, firstMain=null;
  for(let i=0;i<60;i++){await p.keyboard.press('Tab');tabCount++;let v=await p.evaluate(()=>({tag:document.activeElement?.tagName,inMain:!!document.activeElement?.closest('[data-testid=main-content]')}));if(v.inMain){firstMain=v;break;}}
  await p.keyboard.press('Escape');const drawerAfterEscape=!!(await p.$('[data-testid=mobile-nav]'));
  const out={sizes,navigation:{closedToggleAX,openToggleAX,drawerAX,opened,afterSelection,tabCount,firstMain,drawerAfterEscape},requests:counts};
  fs.writeFileSync('/home/user/.cache/m0-probes/admin-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));await p.close();await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
```
