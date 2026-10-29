'use strict';
// Two golden apples: fastest to finish onboarding (countdown group) and first to pull the right person in the bank vote. TEST DATA.
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=5700+Math.floor(Math.random()*200), BASE='http://127.0.0.1:'+PORT, PASS='pw';
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
let cookie='';
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie},body:b?JSON.stringify(b):undefined});if(p.endsWith('login'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json().catch(()=>({}))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-p-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 try{
  await call('POST','/api/host/login',{password:PASS});
  const code=(await call('POST','/api/host/sessions',{name:'TEST DATA prizes',privacy:'named'})).code;
  const key=(await call('GET','/api/host/s/'+code+'/view')).screenKey;
  const P=[]; for(let i=0;i<8;i++) P.push(await call('POST','/api/s/'+code+'/join',{name:'Person'+i,consent:true}));
  const act=async(a,id)=>call('POST','/api/host/s/'+code+'/action',{action:a,activityId:id});
  const phone=async(pid)=>{const r=await fetch(BASE+'/api/s/'+code+'/stream?pid='+pid);const rd=r.body.getReader();let t='';while(!t.includes('\n\n')){const {value}=await rd.read();t+=new TextDecoder().decode(value)}rd.cancel();return JSON.parse(t.split('data: ')[1].split('\n')[0])};
  const screen=async()=>{const r=await fetch(BASE+'/api/screen/'+code+'/stream?k='+key);const rd=r.body.getReader();let t='';while(!t.includes('\n\n')){const {value}=await rd.read();t+=new TextDecoder().decode(value)}rd.cancel();return JSON.parse(t.split('data: ')[1].split('\n')[0])};
  // onboarding: first finisher in the countdown group
  await act('open','onboard');
  const timed=P;
  for(const p of P) await call('POST','/api/s/'+code+'/view',{pid:p.pid,activityId:'onboard'});
  const order=timed.slice(); for(const p of order){ await sleep(30); await call('POST','/api/s/'+code+'/respond',{pid:p.pid,activityId:'onboard',answers:{orgtype:'Bank or fintech',role:'Leader'}}); }
  await act('close','onboard');
  let v=await call('GET','/api/host/s/'+code+'/view'); const r1=v.allResults.find(x=>x.id==='onboard');
  ok('Host sees the onboarding apple winner',r1.firstTimedFinisher&&r1.firstTimedFinisher.label.startsWith('Person'),JSON.stringify(r1.firstTimedFinisher));
  let sc=await screen(); const s1=sc.allResults.find(x=>x.id==='onboard');
  ok('Big screen hides the name before the reveal',!(s1.firstTimedFinisher&&s1.firstTimedFinisher.label),JSON.stringify(s1.firstTimedFinisher));
  await act('open','onboard'); await act('reveal');
  sc=await screen(); const s2=sc.allResults.find(x=>x.id==='onboard');
  ok('After reveal the big screen shows the onboarding winner',s2.firstTimedFinisher&&!!s2.firstTimedFinisher.label&&!s2.firstTimedFinisher.pid,JSON.stringify(s2.firstTimedFinisher));
  // the bank vote
  await act('open','jobA');
  for(const p of P) await call('POST','/api/s/'+code+'/view',{pid:p.pid,activityId:'jobA'});
  const picks=['kofi','efua','yaw','efua','ama','selorm','efua','kofi'];
  for(let i=0;i<8;i++){ await sleep(30); await call('POST','/api/s/'+code+'/respond',{pid:P[i].pid,activityId:'jobA',choice:picks[i],reason:'pace'}); }
  v=await call('GET','/api/host/s/'+code+'/view'); const r2=v.allResults.find(x=>x.id==='jobA');
  ok('First correct answer is the earliest person who picked Efua (Person1)',r2.firstCorrect&&r2.firstCorrect.label==='Person1'&&r2.correct===3,JSON.stringify(r2.firstCorrect)+' '+r2.correct);
  ok('The organiser sees everyone who got it right, in order',JSON.stringify(r2.correctList)===JSON.stringify(['Person1','Person3','Person6']),JSON.stringify(r2.correctList));
  sc=await screen(); const s3=sc.allResults.find(x=>x.id==='jobA');
  ok('Big screen hides the bank winner before the reveal',!(s3.firstCorrect&&s3.firstCorrect.label),JSON.stringify(s3.firstCorrect));
  ok('The big screen never gets the list of names',!JSON.stringify(sc).includes('correctList'));
  ok('The answer is not sent to phones',!JSON.stringify(sc.current||{}).includes('"answer"')&&!JSON.stringify(v.current||{}).includes('"answer"'));
  await act('close','jobA'); await act('reveal');
  sc=await screen(); const s4=sc.allResults.find(x=>x.id==='jobA');
  ok('After reveal the big screen shows the bank winner without ids',s4.firstCorrect&&s4.firstCorrect.label==='Person1'&&!s4.firstCorrect.pid,JSON.stringify(s4.firstCorrect));
  await call('POST','/api/host/s/'+code+'/action',{action:'slide',idx:5,step:0,total:21});
  const pr=await phone(P[0].pid); ok('Phones get a talk progress figure (5 of 21 slides = 25%)',pr.progress===25,pr.progress);
  const ev=await (await fetch(BASE+'/api/host/s/'+code+'/export?type=all',{headers:{Cookie:cookie}})).json(); ok('Everything export holds participants, responses and winners',Object.keys(ev.participants).length===8&&Object.keys(ev.responses).length>=16&&Object.keys(ev.winners).length===2,JSON.stringify(Object.keys(ev.winners)));
  const noauth=await fetch(BASE+'/api/host/s/'+code+'/export?type=all'); ok('Export needs the host sign-in',noauth.status===401,noauth.status);
  const w=await phone(P[1].pid), l=await phone(P[3].pid);
  ok('The winner sees the prize on their phone, others do not',w.won===true&&!l.won,JSON.stringify([w.won,l.won]));
  ok('Phones never receive the answer',!JSON.stringify(w).includes('"answer"'));
 }catch(e){ ok('exception',false,e.message); }
 srv.kill(); console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
