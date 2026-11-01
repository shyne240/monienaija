/**
 * Mission 25H — support-message recipient binding regression (real HTTP, two real customers).
 * Confirms customer A cannot read or post messages into customer B's ticket.
 */
const fs=require('node:fs');
const BASE='http://127.0.0.1:3000/api/v1';
let pass=0,fail=0;const results=[];
function rec(n,ok,d){results.push({n,ok,d});ok?(pass++,console.log('PASS '+n)):(fail++,console.log('FAIL '+n+' — '+JSON.stringify(d)));}
async function req(m,p,{token,body,headers={}}={}){const h={...headers};if(token)h.authorization=`Bearer ${token}`;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+p,{method:m,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j=null;try{j=t?JSON.parse(t):null}catch{}
 return{status:r.status,text:t,json:j};}
(async()=>{
const fx=JSON.parse(fs.readFileSync('fixtures.json','utf8'));
const login=async c=>(await req('POST',`/customers/${c.customerId}/authenticate`,{body:{password:c.password}})).json.session.accessToken;
const t1=await login(fx.customer1), t2=await login(fx.customer2);
const created=await req('POST','/customers/me/support/tickets',{token:t1,headers:{'idempotency-key':'m25h-ticket-'+Date.now()},
  body:{subject:'M25H binding probe',category:'OTHER',description:'Recipient binding regression probe',priority:'LOW'}});
rec('customer A can open its own support ticket',created.status===201||created.status===200,{status:created.status,body:created.text.slice(0,150)});
const ticketId=created.json?.id;
if(ticketId){
  const readOther=await req('GET',`/customers/me/support/tickets/${ticketId}`,{token:t2});
  rec('customer B cannot READ customer A ticket',readOther.status===404||readOther.status===403,{status:readOther.status});
  const msgOther=await req('POST',`/customers/me/support/tickets/${ticketId}/messages`,{token:t2,
    headers:{'idempotency-key':'m25h-msg-'+Date.now()},body:{body:'cross-customer injection attempt'}});
  rec('customer B cannot POST a message into customer A ticket',msgOther.status===404||msgOther.status===403,{status:msgOther.status,body:msgOther.text.slice(0,120)});
  const readOwn=await req('GET',`/customers/me/support/tickets/${ticketId}`,{token:t1});
  rec('customer A can read its own ticket',readOwn.status===200,{status:readOwn.status});
  const listOwn=await req('GET','/customers/me/support/tickets',{token:t1});
  const listOther=await req('GET','/customers/me/support/tickets',{token:t2});
  const ownIds=(listOwn.json?.items??listOwn.json??[]).map?.(x=>x.id)??[];
  const otherIds=(listOther.json?.items??listOther.json??[]).map?.(x=>x.id)??[];
  rec('ticket lists are scoped per customer (A ticket not in B list)',ownIds.includes(ticketId)&&!otherIds.includes(ticketId),{ownIds:ownIds.length,otherIds:otherIds.length});
}
fs.writeFileSync('support-results.json',JSON.stringify({pass,fail,total:results.length,results},null,2));
console.log(`=== SUPPORT TOTALS: ${pass} passed / ${fail} failed / ${results.length} ===`);
process.exit(fail===0?0:1);})().catch(e=>{console.error('ERR',e.message);process.exit(2);});
