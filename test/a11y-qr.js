'use strict';
// QR decode + basic accessibility probes on the phone page. TEST DATA ONLY. Needs jsqr/pngjs (from scratchpad/qa) - audit helper, not part of the app.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const Q='/tmp/claude-0/-home-user/f25b67ea-52b2-5113-ab5d-5e6b036e058f/scratchpad/qa/node_modules/';
const jsQR=require(Q+'jsqr'), {PNG}=require(Q+'pngjs');
const PORT=4100+Math.floor(Math.random()*200), BASE='http://127.0.0.1:'+PORT, PASS='pw-test';
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-a-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch(); let h=null;
 try{
  const call=async(m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:{'content-type':'application/json',...(h?{cookie:h}:{})},body:b?JSON.stringify(b):undefined});const c=r.headers.get('set-cookie');if(c)h=c.split(';')[0];return {status:r.status,json:await r.json().catch(()=>null)}};
  await call('POST','/api/host/login',{password:PASS}); const s=await call('POST','/api/host/sessions',{name:'a11y'}); const code=s.json.code||s.json.session&&s.json.session.code;
  // QR: render the join URL as the projector would, then decode the picture
  const url=BASE+'/j/'+code; const pg=await (await br.newContext({viewport:{width:1280,height:720}})).newPage();
  await pg.goto(BASE+'/qr.svg?u='+encodeURIComponent(url)); await pg.waitForTimeout(300);
  for (const px of [180,260,420]) { await pg.setViewportSize({width:px+80,height:px+80}); const buf=await pg.screenshot(); const png=PNG.sync.read(buf); const r=jsQR(new Uint8ClampedArray(png.data),png.width,png.height); ok('QR decodes back to the join link at about '+px+' px',r&&r.data===url,r&&r.data); }
  // phone page probes
  const ph=await (await br.newContext({...devices['iPhone 13']})).newPage(); await ph.goto(url);
  const small=await ph.evaluate(()=>[...document.querySelectorAll('button,select,a,label.row')].filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect();return {t:(e.tagName+' '+(e.id||e.textContent||'')).trim().slice(0,30),w:Math.round(r.width),h:Math.round(r.height)}}).filter(x=>x.h<40));
  ok('Join page: visible buttons/links are at least 40 px tall',small.length===0,JSON.stringify(small));
  const unl=await ph.evaluate(()=>[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>e.offsetParent&&!(e.labels&&e.labels.length)&&!e.getAttribute('aria-label')).map(e=>e.id||e.name||e.type));
  ok('Join page: every field has a label',unl.length===0,JSON.stringify(unl));
  ok('Join page: page language and zoom are not blocked',await ph.evaluate(()=>!!document.documentElement.lang&&!/user-scalable=no|maximum-scale=1\b/.test((document.querySelector('meta[name=viewport]')||{}).content||'')),'lang/viewport');
  const fs16=await ph.evaluate(()=>[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>e.id));
  ok('Join page: fields are 16 px or larger (iPhone does not zoom in on focus)',fs16.length===0,JSON.stringify(fs16));
 }catch(e){ok('exception',false,e.message)}
 await br.close(); srv.kill(); console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
