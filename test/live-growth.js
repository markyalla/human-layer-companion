'use strict';
// Checks the big-screen page grows live while votes arrive (simulated participants, TEST DATA).
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=4100+Math.floor(Math.random()*300), BASE='http://127.0.0.1:'+PORT, PASS='pw';
const out=process.env.SHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'g-'));
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
let cookie='';
const call=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie},body:b?JSON.stringify(b):undefined});if(p.endsWith('login'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json().catch(()=>({}))};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-g-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  await call('POST','/api/host/login',{password:PASS});
  const code=(await call('POST','/api/host/sessions',{name:'TEST DATA growth',privacy:'aggregate'})).code;
  const view=await call('GET','/api/host/s/'+code+'/view');
  const P=[]; for(let i=0;i<24;i++) P.push((await call('POST','/api/s/'+code+'/join',{consent:true})).pid);
  const pg=await (await br.newContext({viewport:{width:1920,height:1080}})).newPage();
  await pg.goto(BASE+'/screen/'+code+'?k='+view.screenKey); await pg.waitForSelector('.qrbox');
  await pg.waitForFunction(()=>document.querySelector('.count').textContent==='24'); ok('Join screen counts 24 joined live',true);
  await call('POST','/api/host/s/'+code+'/action',{action:'open',activityId:'meet'});
  await pg.waitForSelector('.rows'); await pg.screenshot({path:out+'/grow-0.png'});
  const width=async(i)=>pg.evaluate(i=>parseFloat(document.querySelectorAll('.r .t div')[i].style.width)||0,i);
  const picks=['ama','kofi','yaw','efua'];
  const seen=[];
  for(let i=0;i<24;i++){
    const pick=i<10?'efua':picks[i%4];
    await call('POST','/api/s/'+code+'/view',{pid:P[i],activityId:'meet'});
    await call('POST','/api/s/'+code+'/respond',{pid:P[i],activityId:'meet',choice:pick});
    if(i===5||i===13){ await pg.waitForFunction(n=>document.getElementById('cn').textContent==String(n),i+1); await pg.waitForTimeout(800); await pg.screenshot({path:out+'/grow-'+(i+1)+'.png'}); seen.push(await width(3)); }
  }
  await pg.waitForFunction(()=>document.getElementById('cn').textContent==='24');
  await pg.waitForTimeout(900); await pg.screenshot({path:out+'/grow-24.png'});
  ok('Counter reached 24 without a refresh',true);
  ok('Efua bar grew between updates',seen[1]>seen[0]&&seen[0]>0,JSON.stringify(seen));
  const txt=await pg.textContent('.rows'); ok('Counts match what was sent (Efua 14 of 24)',/Efua[^0-9]*14/.test(txt),txt);
  await call('POST','/api/host/s/'+code+'/action',{action:'close'}); await call('POST','/api/host/s/'+code+'/action',{action:'reveal'});
  await pg.waitForSelector('.tag.done'); await pg.screenshot({path:out+'/grow-final.png'}); ok('Reveal shows Final',true);
 }catch(e){console.log('FAIL crashed ->',e.message);fails++}
 await br.close();srv.kill();console.log(fails?fails+' FAILED':'growth checks passed','; shots in',out);process.exit(fails?1:0);
})();
