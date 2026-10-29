'use strict';
// The 10-minute default run, the demo video slide, and range requests for the video. TEST DATA.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=6100+Math.floor(Math.random()*200), BASE='http://127.0.0.1:'+PORT, PASS='pw';
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
let cookie='';
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie},body:b?JSON.stringify(b):undefined});if(p.endsWith('login'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json().catch(()=>({}))};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-t-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  await call('POST','/api/host/login',{password:PASS});
  const code=(await call('POST','/api/host/sessions',{name:'TEST DATA ten',privacy:'named'})).code;
  const key=(await call('GET','/api/host/s/'+code+'/view')).screenKey;
  const rr=await fetch(BASE+'/present/deck/reaction.mp4',{headers:{Range:'bytes=0-99'}}); ok('The reel is served in ranges',rr.status===206,rr.status);
  const rg=await fetch(BASE+'/present/deck/demo.mp4',{headers:{Range:'bytes=0-99'}});
  ok('Video is served in ranges (seekable)',rg.status===206&&(await rg.arrayBuffer()).byteLength===100,rg.status);
  const tab=await br.newContext({viewport:{width:1180,height:820}}); await tab.addCookies([{name:'hl_host',value:cookie.split('=')[1],url:BASE}]);
  const ctl=await tab.newPage(); const e=[]; ctl.on('pageerror',x=>e.push(String(x)));
  const proj=await (await br.newContext({viewport:{width:1920,height:1080}})).newPage(); proj.on('pageerror',x=>e.push(String(x)));
  await ctl.goto(BASE+'/present/'+code); await ctl.waitForFunction(()=>window.__present&&document.querySelectorAll('.sl').length===14,null,{timeout:10000});
  ok('Default run is the 10-minute order (14 slides)',true);
  await proj.goto(BASE+'/show/'+code+'?k='+key); await proj.waitForFunction(()=>window.__present&&document.querySelectorAll('.sl').length===14,null,{timeout:10000});
  const ids=await ctl.evaluate(()=>window.__present.ids?window.__present.ids():null);
  for(let i=0;i<11;i++){await ctl.keyboard.press('ArrowRight');await ctl.waitForTimeout(80)}
  await proj.waitForFunction(()=>window.__present.state().idx===10,null,{timeout:5000}); ok('Projector follows to the demo video slide',true);
  const vs=await proj.evaluate(()=>{const v=document.querySelector('.sl.on video');return v?v.getAttribute('src'):null}); ok('Projector shows the video element for demo.mp4 (the test browser cannot decode H.264, so playback itself is checked on real devices)',/demo\.mp4$/.test(vs||''),vs);
  const tx=await ctl.evaluate(()=>document.querySelector('.sl.on').innerText); ok('Tablet shows a card, not the video',/Playing on the projector/.test(tx)&&!(await ctl.$('.sl.on video')),tx);
  await ctl.keyboard.press('ArrowRight'); await proj.waitForFunction(()=>window.__present.state().idx===11); 
  const paused=await proj.evaluate(()=>{const v=document.querySelector('video');return v.paused}); ok('Video pauses when you move on',paused===true);
  for(let i=0;i<11;i++){await ctl.keyboard.press('ArrowLeft');await ctl.waitForTimeout(60)} await proj.waitForFunction(()=>window.__present.state().idx===0,null,{timeout:5000});
  const ab=await proj.evaluate(()=>document.querySelector('.sl.on').innerText); ok('The what-we-do slide is short: culture, education and systems, made fun',/Culture, education\s+and systems,\s+made fun/.test(ab)&&ab.length<160,ab);
  ok('The reel frame sits on the same slide',!!(await proj.$('.sl.on #reelbox')));
  await ctl.keyboard.press('ArrowRight'); await proj.waitForFunction(()=>window.__present.state().step===1&&window.__present.state().idx===0,null,{timeout:5000}); ok('One arrow press starts the reel on the same slide (projector follows the step)',true);
  const rv=await proj.evaluate(()=>{const v=document.querySelector('.sl.on #reelbox video');return v?v.getAttribute('src'):null}); ok('The reel is in the frame on the opening slide (reaction.mp4)',/reaction\.mp4/.test(rv||''),rv); ok('The frame shows no "not added" note',!/Video not added yet/.test(await proj.evaluate(()=>document.querySelector('.sl.on #reelbox').innerText)));
  await ctl.keyboard.press('ArrowRight'); await proj.waitForFunction(()=>window.__present.state().idx===1,null,{timeout:5000}); ok('The next arrow press moves on to the cover',true);
  ok('The 12-month slide comes before the 8% slide',await ctl.evaluate(()=>{var d=window.__present.DEF.map(function(x){return x.id});return d.indexOf('turnover')>-1&&d.indexOf('turnover')<d.indexOf('number')&&d.indexOf('number')-d.indexOf('turnover')===1}));
  await ctl.evaluate(()=>window.__present.show(12,0)); await ctl.waitForTimeout(400);
  const c0=await proj.evaluate(()=>getComputedStyle(document.getElementById('ovbox_i')).display); ok('The interest count is hidden on the projector by default',c0==='none',c0);
  await ctl.keyboard.press('i'); await proj.waitForFunction(()=>getComputedStyle(document.getElementById('ovbox_i')).display!=='none',null,{timeout:5000}); ok('Pressing I on the tablet shows the interest count on the projector (projector follows the count)',true);
  ok('No page errors',e.length===0,e.join(' | '));
 }catch(x){ ok('exception',false,x.message.split('\n')[0]); }
 await br.close(); srv.kill(); console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
