const fs=require('fs');
const B='http://127.0.0.1:3000/api/v1';
const m=JSON.parse(fs.readFileSync('/home/user/monienaija-local-dev-11-roles-credentials.json','utf8'));
(async()=>{
  const lr=await fetch(B+'/internal/a2/workforce/local-admin-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:m.SUPER_ADMIN.email,password:m.SUPER_ADMIN.password})});
  const sa=(await lr.json()).accessToken;
  const ev=await (await fetch(B+'/internal/notifications/events',{headers:{Authorization:'Bearer '+sa}})).json();
  const it=ev.items.find(i=>i.eventType==='customer.funding.requested');
  console.log('current EMAIL:',JSON.stringify(it.channels.EMAIL));
  const r=await fetch(B+'/internal/notifications/changes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sa},body:JSON.stringify({type:'CONFIGURATION',eventType:'customer.funding.requested',channel:'EMAIL',enabled:true,expectedVersion:it.channels.EMAIL.configurationVersion,reason:'M25E browser verification: enable EMAIL on an informational event'})});
  const b=await r.json();
  console.log('CREATE',r.status,JSON.stringify(b));
  fs.writeFileSync('/tmp/m25e-approval-id.txt',b.approvalId||'');
})().catch(e=>{console.error(e);process.exit(1)});
