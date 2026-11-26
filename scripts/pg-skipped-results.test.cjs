const {test} = require('node:test');
const assert = require('node:assert/strict');
const {skippedSuites} = require('./pg-skipped-results.cjs');
const suite = {name:'/repo/test/volume.ts',status:'skipped',assertionResults:[{status:'pending'}]};
const parse = (s) => skippedSuites({testResults:s},[suite.name],'/repo',[]);
test('explicit fully skipped suite is recorded, not passed',()=>assert.deepEqual(parse([suite]),[{status:'SKIP',file:'test/volume.ts',durationSeconds:null}]));
test('missing, empty, failed, incomplete or unexpected results remain missing',()=>{
 for(const results of [[],[{...suite,assertionResults:[]}],[{...suite,status:'failed'}],[{...suite,assertionResults:[{status:'passed'}]}],[{...suite,name:'/repo/other.ts'}]]) assert.deepEqual(parse(results),[]);
});
