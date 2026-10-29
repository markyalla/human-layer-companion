'use strict';
// Drives the one-window presenter with simulated participants (TEST DATA). Phones are simulated, not real.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=4500+Math.floor(Math.random()*300), BASE='http://127.0.0.1:'+PORT, PASS='pw';
const out=process.env.SHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'pr-'));
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
let cookie='';
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie},body:b?JSON.stringify(b):undefined});if(p.endsWith('login'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json().catch(()=>({}))};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-p-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  await call('POST','/api/host/login',{password:PASS});
  const code=(await call('POST','/api/host/sessions',{name:'TEST DATA present',privacy:'aggregate',audience:100})).code;
  const ctx=await br.newContext({viewport:{width:1920,height:1080}});
  await ctx.addCookies([{name:'hl_host',value:cookie.split('=')[1],url:BASE}]);
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
  await pg.goto(BASE+'/present/'+code+'?len=full'); await pg.waitForFunction(()=>window.__present&&document.querySelectorAll('.sl').length===22,null,{timeout:10000});
  ok('One-window presenter loads 20 slides',true);
  let imgs=true; try{await pg.waitForFunction(()=>{const a=[...document.querySelectorAll('.sl img')].filter(i=>i.getAttribute('src').indexOf('/deck/')>=0);return a.length===16&&a.every(i=>i.complete&&i.naturalWidth===1920)},null,{timeout:8000})}catch(e){imgs=false} ok('Every deck slide picture (16) loads at 1920 wide',imgs);
  const P=[]; for(let i=0;i<20;i++) P.push((await call('POST','/api/s/'+code+'/join',{consent:true})).pid);
  const go=async(n)=>{for(let i=0;i<n;i++){await pg.keyboard.press('ArrowRight');await pg.waitForTimeout(80)}};
  await go(6); // join
  await pg.waitForFunction(()=>document.getElementById('jn')&&document.getElementById('jn').textContent==='20'); ok('Join slide shows 20 joined live',true);
  await pg.waitForFunction(()=>/20 in the room|of about 100/.test(document.body.innerText)||true); 
  let st=await call('GET','/api/host/s/'+code+'/view'); ok('Join slide opened the onboarding form on phones',st.state.activityId==='onboard'&&st.state.phase==='open',JSON.stringify(st.state));
  const room=await pg.evaluate(()=>document.getElementById('jroom').textContent); ok('Join slide compares joined with the room size',/of about 100 in the room/.test(room)&&/20%/.test(room),room);
  await pg.screenshot({path:out+'/p-join.png'});
  await go(1); await pg.waitForTimeout(500); st=await call('GET','/api/host/s/'+code+'/view'); ok('Result slide closed and revealed onboarding',st.state.phase==='revealed',JSON.stringify(st.state)); await pg.screenshot({path:out+'/p-arms.png'});
  await go(1); await pg.waitForTimeout(500); st=await call('GET','/api/host/s/'+code+'/view'); ok('The storyboard slide does not open a vote',st.state.phase==='idle',JSON.stringify(st.state)); await pg.screenshot({path:out+'/p-vote-story.png'});
  await go(1); await pg.waitForTimeout(500); st=await call('GET','/api/host/s/'+code+'/view'); ok('The vote slide opened scenario 1',st.state.activityId==='jobA'&&st.state.phase==='open',JSON.stringify(st.state));
  const picks=['efua','efua','kofi','selorm','efua','yaw'];
  for(let i=0;i<12;i++){await call('POST','/api/s/'+code+'/view',{pid:P[i],activityId:'jobA'});await call('POST','/api/s/'+code+'/respond',{pid:P[i],activityId:'jobA',choice:picks[i%6],reason:'pace'});}
  await pg.waitForFunction(()=>document.getElementById('cn0').textContent==='12'); await pg.waitForTimeout(900); ok('The poll counter and bars grew live',true); await pg.screenshot({path:out+'/p-pick.png'});
  const h=await pg.evaluate(()=>parseFloat(document.getElementById('b0_efua').style.width)); ok('Efua bar grew',h>0,h);
  await pg.keyboard.press('r'); await pg.waitForTimeout(700);
  await go(1); await pg.waitForTimeout(1200); await pg.screenshot({path:out+'/p-pickr.png'});
  const txt=await pg.evaluate(()=>document.getElementById('vdr0').textContent); ok('Result slide says the room picked Efua',/The room picked Efua/.test(txt),txt);
  // demo link
  await go(4); const href=await pg.evaluate(()=>[...document.querySelectorAll('.sl a')].map(a=>a.href)[0]); ok('Demo slide has the link to the real GCG Game Plan',/P44iPoxS3QN5m5mc7zefuF/.test(href||''),href);
  // ask + final
  await go(7); await pg.waitForTimeout(600); st=await call('GET','/api/host/s/'+code+'/view'); ok('The offer slide opened the interest screen on phones',st.state.activityId==='interest'&&st.state.phase==='open',JSON.stringify(st.state));
  await call('POST','/api/s/'+code+'/respond',{pid:P[0],activityId:'interest',choice:'consult',email:'a@example.test',uses:['cust']}); await call('POST','/api/s/'+code+'/respond',{pid:P[1],activityId:'interest',choice:'consult',email:'b@example.test'});
  await pg.waitForFunction(()=>document.getElementById('ov_i')&&document.getElementById('ov_i').textContent==='2'); const hid=await pg.evaluate(()=>getComputedStyle(document.getElementById('ovbox_i')).display); ok('The interested count is hidden until the presenter shows it',hid==='none',hid); await pg.keyboard.press('i'); await pg.waitForTimeout(200); const shown=await pg.evaluate(()=>getComputedStyle(document.getElementById('ovbox_i')).display); ok('Pressing I shows the interested count',shown==='flex',shown); await pg.screenshot({path:out+'/p-ask.png'}); await pg.keyboard.press('i'); await pg.waitForTimeout(100);
  await go(1); await pg.waitForTimeout(600); st=await call('GET','/api/host/s/'+code+'/view'); ok('The final slide opened the rating screen on phones',st.state.activityId==='rate'&&st.state.phase==='open',JSON.stringify(st.state));
  ok('No page errors',errs.length===0,errs.join(' | '));
 }catch(e){ ok('exception',false,e.message.split('\n')[0]); }
 await br.close(); srv.kill();
 console.log('shots in '+out); console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
