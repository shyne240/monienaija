// Read-only consistency checks for the architecture artifacts; no application boot or network.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..'), layout=fs.readFileSync(path.join(root,'apps/admin-web/src/screens/authenticated/Layout.tsx'),'utf8');
const {rows,deep}=require('./blueprint-data.cjs'), index=require('./source-inventory.json');
const nav=layout.slice(layout.indexOf('const sections = ['),layout.indexOf('const toggleSection ='));
const actual=[...nav.matchAll(/key:\s*'([^']+)'\s+as View/g)].map(x=>x[1]);
assert.equal(actual.length,28);assert.equal(new Set(actual).size,28);assert.deepEqual(rows.map(r=>r.id).sort(),actual.sort());
for(const r of rows){assert(fs.existsSync(path.join(root,r.evidence)),r.evidence);for(const k of ['group','label','target','gate','purpose','tasks','gaps','backend','batch','status'])assert(r[k],r.id+': '+k)}
for(const file of [...index.frontend,...index.controllers,...index.entities,...index.dtos])assert(fs.existsSync(path.join(root,file.file)),file.file);
assert.equal(new Set(index.roleCatalogue.assignments.map(a=>a.role)).size,11);assert(index.roleCatalogue.functions.length>0);assert(deep.length>=20);
const html=fs.readFileSync(path.join(__dirname,'review.html'),'utf8'),script=html.match(/<script>([\s\S]*)<\/script>/)?.[1];assert(script);const parsed=ts.createSourceFile('review.js',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(parsed.parseDiagnostics.length,0,'embedded script must parse');assert(!/<script\s+src=/i.test(html),'artifact must not depend on external scripts');
console.log(`PASS: ${rows.length} canonical views, ${deep.length} inner-component records, ${index.roleCatalogue.assignments.length} seed grants; source files and embedded script checked.`);
