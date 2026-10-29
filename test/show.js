'use strict';
// Two screens: the controller (tablet, signed in) and the projector (no password, screen key). Phones are simulated. TEST DATA.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=5400+Math.floor(Math.random()*300), BASE='http://127.0.0.1:'+PORT, PASS='pw';
const out=process.env.SHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'sh-'));
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
let cookie='';
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie},body:b?JSON.stringify(b):undefined});if(p.endsWith('login'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json().catch(()=>({}))};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-s-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  await call('POST','/api/host/login',{password:PASS});
  const made=await call('POST','/api/host/sessions',{name:'TEST DATA show',privacy:'aggregate'}); const code=made.code;
  const view=await call('GET','/api/host/s/'+code+'/view'); const key=view.screenKey;
  const tab=await br.newContext({viewport:{width:1180,height:820},hasTouch:true}); await tab.addCookies([{name:'hl_host',value:cookie.split('=')[1],url:BASE}]);
  const ctl=await tab.newPage(); const e1=[]; ctl.on('pageerror',e=>e1.push(String(e)));
  const proj=await (await br.newContext({viewport:{width:1920,height:1080}})).newPage(); const e2=[]; proj.on('pageerror',e=>e2.push(String(e)));
  await ctl.goto(BASE+'/present/'+code+'?len=full'); await ctl.waitForFunction(()=>window.__present&&document.querySelectorAll('.sl').length===22,null,{timeout:10000});
  await proj.goto(BASE+'/show/'+code+'?k='+key+'&len=full'); await proj.waitForFunction(()=>window.__present&&document.querySelectorAll('.sl').length===22,null,{timeout:10000});
  const barHidden=await proj.evaluate(()=>getComputedStyle(document.getElementById('bar')).display); ok('Projector view has no control bar',barHidden==='none',barHidden);
  const noLogin=await proj.evaluate(()=>getComputedStyle(document.getElementById('login')).display); ok('Projector view asks for no password',noLogin==='none',noLogin);
  const idxOf=async(pg)=>pg.evaluate(()=>window.__present.state().idx);
  const wait=async(pg,n)=>pg.waitForFunction((n)=>window.__present.state().idx===n,n,{timeout:5000});
  const go=async(n)=>{for(let i=0;i<n;i++){await ctl.keyboard.press('ArrowRight');await ctl.waitForTimeout(80)}};
  await go(6); await wait(proj,5); ok('Projector follows the controller to the join slide',true);
  const P=[]; for(let i=0;i<14;i++) P.push((await call('POST','/api/s/'+code+'/join',{consent:true})).pid);
  await proj.waitForFunction(()=>document.getElementById('jn').textContent==='14',null,{timeout:5000}); ok('Projector shows live joins',true);
  await go(3); await wait(proj,8); await ctl.waitForTimeout(300);
  for(let i=0;i<10;i++){await call('POST','/api/s/'+code+'/view',{pid:P[i],activityId:'jobA'});await call('POST','/api/s/'+code+'/respond',{pid:P[i],activityId:'jobA',choice:['efua','efua','kofi'][i%3],reason:'pace'});}
  await proj.waitForFunction(()=>document.getElementById('cn0')&&document.getElementById('cn0').textContent==='10',null,{timeout:5000}); ok('Projector shows the live poll on the same slide',true); await proj.screenshot({path:out+'/proj-pick.png'});
  await ctl.keyboard.press('ArrowLeft'); await wait(proj,7); ok('Going back on the controller goes back on the projector',true);
  await proj.keyboard.press('ArrowRight'); await proj.waitForTimeout(300); ok('Keys on the projector do nothing',(await idxOf(proj))===7);
  await ctl.screenshot({path:out+'/ctl.png'});
  const bad=await fetch(BASE+'/api/screen/'+code+'/stream?k=wrong'); ok('A wrong screen key is refused',bad.status===401,bad.status);
  const nn=await fetch(BASE+'/present/deck/notes.json'); ok('Speaker notes are refused without host sign-in',nn.status===401,nn.status);
  const nh=await fetch(BASE+'/present/deck/notes.json',{headers:{Cookie:cookie}}); ok('Speaker notes load for the signed-in host',nh.status===200,nh.status);
  ok('No page errors',e1.length===0&&e2.length===0,e1.concat(e2).join(' | '));
 }catch(e){ ok('exception',false,e.message.split('\n')[0]); }
 await br.close(); srv.kill();
 console.log('shots in '+out); console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
