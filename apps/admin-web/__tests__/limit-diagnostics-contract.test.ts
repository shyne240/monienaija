import { parseDiagnostics } from '../src/screens/authenticated/limit-diagnostics-contract';
const common = {id:'32f243d5-b746-45aa-94fd-3ff7b06d211d', principalType:'CUSTOMER', principalId:'66c608d8-e71e-48a9-a217-83034c6b724d',limitProfileCode:'STANDARD',product:'TRANSFER',dimension:'DAILY_AMOUNT',currency:'NGN',windowType:'DAILY',windowKey:'2026-11-06',windowStart:'2026-11-06T00:00:00Z',windowEnd:'2026-11-07T00:00:00Z'};
const usage={...common,usedAmountMinor:'9223372036854775807',reservedAmountMinor:'2',usedCount:1,reservedCount:1};
const reservation={...common,idempotencyKey:'key',correlationId:'flow',amountMinor:'42',count:1,status:'RESERVED',reservedAt:'2026-11-06T12:00:00Z',version:1,ageSeconds:3600,stale:true};
const page=(data:unknown[], extra:object={})=>({page:1,limit:20,total:data.length,totalPages:1,data,...extra});

test('returns verified usage with exact minor units and projects only known fields',()=>{
 const result=parseDiagnostics(page([{...usage,requestHash:'PRIVATE_HASH',unexpected:{secret:'PRIVATE'}}]),'usage',1,{principalType:'customer',principalId:common.principalId,product:'transfer'});
 expect(result?.data[0].usedAmountMinor).toBe('9223372036854775807');expect(result?.data[0]).not.toHaveProperty('requestHash');expect(result?.data[0]).not.toHaveProperty('unexpected');
});

test('rejects contradictory pagination, duplicate rows, malformed numbers and mismatched filters',()=>{
 expect(parseDiagnostics(page([], {totalPages:0}),'usage',1,{})).toBeNull();
 expect(parseDiagnostics(page([usage,usage]),'usage',1,{})).toBeNull();
 expect(parseDiagnostics(page([{...usage,usedCount:-1}]),'usage',1,{})).toBeNull();
 expect(parseDiagnostics(page([{...usage,usedAmountMinor:123}]),'usage',1,{})).toBeNull();
 expect(parseDiagnostics(page([usage]),'usage',1,{principalId:'66c608d8-e71e-48a9-a217-83034c6b724e'})).toBeNull();
 expect(parseDiagnostics(page([usage]),'usage',1,{windowTo:'2026-11-06T00:00:00Z'})).toBeNull();
});

test('reservation status, staleness, and filter context must agree without inferring recovery',()=>{
 const good=page([reservation],{staleThresholdMinutes:30});
 expect(parseDiagnostics(good,'reservation',1,{status:'reserved',stale:'true',idempotencyKey:'key'})).not.toBeNull();
 expect(parseDiagnostics(good,'reservation',1,{idempotencyKey:'other'})).toBeNull();
 expect(parseDiagnostics(page([{...reservation,status:'COMMITTED'}],{staleThresholdMinutes:30}),'reservation',1,{})).toBeNull();
 expect(parseDiagnostics(page([{...reservation,stale:false}],{staleThresholdMinutes:30}),'reservation',1,{stale:'true'})).toBeNull();
 expect(parseDiagnostics(page([reservation],{staleThresholdMinutes:0}),'reservation',1,{})).toBeNull();
});
