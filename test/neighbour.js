'use strict';
// A neighbour answers on the helper's phone: separate identity, separate answers. TEST DATA.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=3900+Math.floor(Math.random()*90), BASE='http://127.0.0.1:'+PORT, PASS='pw-test';
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-n-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  const h=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
  await h.goto(BASE+'/host'); await h.fill('#pw',PASS); await h.click('button[type=submit]');
  await h.waitForSelector('#mk'); await h.fill('#nn','TEST DATA neighbour'); await h.click('#mk');
  await h.waitForSelector('img.qr'); const code=(await h.textContent('.card p.muted b'));
  const p=await (await br.newContext({viewport:{width:390,height:780},deviceScaleFactor:2,isMobile:true,hasTouch:true})).newPage();
  await p.goto(BASE+'/j/'+code); await p.waitForSelector('#jf'); await p.fill('#nm','Helper'); await p.check('#cs'); await p.click('#jb');
  await p.waitForSelector('text=You’re in.');
  await p.click('[data-help]'); await p.click('[data-nb=start]'); await p.fill('#nm','Neighbour'); await p.check('#cs'); await p.click('#jb');
  await p.waitForSelector('text=You are answering for a neighbour on this phone.');
  const neighbourCode=await p.textContent('.rec');
  await h.click('[data-open=meet]'); await p.waitForSelector('.opt');
  ok('Neighbour sees the five people', (await p.$$('label.opt')).length===5, String((await p.$$('label.opt')).length));
  await p.click('.opt >> text=Kofi'); await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.');
  await p.click('[data-nb=back]'); await p.waitForSelector('.opt');
  ok('Helper still has an unanswered vote after the neighbour answered', await p.isVisible('#sb'));
  const helperCode=await p.textContent('.rec');
  ok('Helper and neighbour have different recovery codes', helperCode!==neighbourCode, helperCode+' '+neighbourCode);
  await p.click('.opt >> text=Efua'); await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.');
  await h.click('[data-a=close]'); await h.click('[data-a=reveal]');
  const sc=await (await br.newContext({viewport:{width:1920,height:1080}})).newPage();
  const href=await h.getAttribute('a.btn.alt[target=_blank]','href'); await sc.goto(BASE+href.replace(BASE,''));
  await sc.waitForSelector('.rows');
  const rows=await sc.textContent('.rows');
  ok('Results show one vote for Kofi and one for Efua (two people, one phone)', /Kofi[\s\S]*?1\s*·\s*50%/.test(rows) && /Efua[\s\S]*?1\s*·\s*50%/.test(rows), rows.replace(/\s+/g,' '));
 }catch(e){console.log('FAIL exception ->',e.message); fails++}
 finally{await br.close(); srv.kill()}
 console.log(fails?('FAILED '+fails):'neighbour checks passed'); process.exit(fails?1:0);
})();
