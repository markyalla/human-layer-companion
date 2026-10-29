'use strict';
// Drives the REAL pages in headless Chromium at phone size (emulation, not a real phone). TEST DATA.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const PORT=3700+Math.floor(Math.random()*200), BASE='http://127.0.0.1:'+PORT, PASS='pw-test';
const out=process.env.SHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'shots-'));
let fails=0; const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+d)); if(!c)fails++};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-b-'));
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT,ORGANISER_PASSWORD:PASS,DATA_DIR:dir},stdio:'pipe'});
 await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
 const br=await chromium.launch();
 try{
  const hctx=await br.newContext({viewport:{width:1280,height:900}}); const h=await hctx.newPage();
  await h.goto(BASE+'/host'); await h.fill('#pw',PASS); await h.click('button[type=submit]');
  await h.waitForSelector('#mk'); await h.fill('#nn','TEST DATA browser run'); await h.click('#mk');
  await h.waitForSelector('img.qr'); const code=(await h.textContent('.card p.muted b'));
  ok('Organiser UI: session created, QR shown',/^[A-Z0-9]{5}$/.test(code),code);
  const screenHref=await h.getAttribute('a.btn.alt[target=_blank]','href');
  const sctx=await br.newContext({viewport:{width:1920,height:1080}}); const sc=await sctx.newPage(); await sc.goto(BASE+screenHref.replace(BASE,''));
  await sc.waitForSelector('.qrbox img'); await sc.screenshot({path:out+'/screen-wait.png'});
  // phone
  const phone=await br.newContext({viewport:{width:390,height:780},deviceScaleFactor:2,isMobile:true,hasTouch:true}); const p=await phone.newPage();
  await p.goto(BASE+'/j/'+code); await p.waitForSelector('#jf'); await p.screenshot({path:out+'/phone-welcome.png'});
  await p.click('#jb'); ok('Join blocked without name/consent', await p.isVisible('#jf') && !(await p.isVisible('text=You’re in.')));
  await p.fill('#nm','Test Phone'); await p.check('#cs'); await p.click('#jb');
  await p.waitForSelector('text=You’re in.'); ok('Phone: joined, shows "You’re in."',true);
  const rec=await p.textContent('.rec'); ok('Recovery code is shown',/^[A-Z0-9]{5}$/.test(rec),rec);
  await p.screenshot({path:out+'/phone-waiting.png'});
  await p.click('[data-help]'); await p.waitForSelector('[data-nb=start]');
  ok('Help panel has no QR code and no WhatsApp link', (await p.$$('img[alt*="QR"]')).length===0 && (await p.$$('a[href^="https://wa.me"]')).length===0, 'found qr or wa link');
  await p.screenshot({path:out+'/phone-help.png',fullPage:true});
  await p.click('[data-nb=start]'); await p.waitForSelector('#jf'); await p.screenshot({path:out+'/phone-neighbour-join.png',fullPage:true});
  ok('Neighbour join form opens on the same phone', await p.isVisible('text=YOUR NEIGHBOUR JOINS HERE'));
  await p.fill('#nm','Neighbour'); await p.check('#cs'); await p.click('#jb');
  await p.waitForSelector('text=You are answering for a neighbour on this phone.'); ok('Phone switches to the neighbour on the same device',true);
  await p.screenshot({path:out+'/phone-neighbour-in.png',fullPage:true});
  await p.click('[data-nb=back]'); await p.waitForSelector('[data-help]');
  await p.waitForFunction(()=>/You have helped 1 person/.test(document.body.innerText)); ok('Helper sees "You have helped 1 person join" after the neighbour joins on the same phone',true);
  await sc.waitForFunction(()=>document.querySelector('.count')&&document.querySelector('.count').textContent==='2'); ok('Big screen shows 2 joined live (phone and neighbour)',true);
  // open onboarding
  await h.click('[data-open=onboard]'); await p.waitForSelector('#af');
  await p.screenshot({path:out+'/phone-onboard.png'});
  await p.click('#sb'); ok('Empty onboarding is blocked', await p.isVisible('.err'));
  await p.click('label.chip >> text=Developer'); await p.click('label.chip >> text=Telecom or mobile money');
  await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.'); ok('Onboarding confirmed only after server accepted',true);
  // meet five
  await h.click('[data-open=meet]'); await p.waitForSelector('.opt');
  await p.screenshot({path:out+'/phone-meet.png',fullPage:true});
  await p.click('.opt >> text=Efua'); await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.');
  await sc.waitForFunction(()=>/1/.test((document.getElementById('cn')||{textContent:''}).textContent)); await sc.screenshot({path:out+'/screen-open.png'});
  // refresh phone: state restored
  await p.reload(); await p.waitForSelector('text=Your choice has been recorded.'); ok('Refresh keeps session and shows own submission',true);
  // close + reveal
  await h.click('[data-a=close]'); await h.click('[data-a=reveal]');
  await p.waitForSelector('text=Your vote is in.'); ok('Phone shows reveal message',true);
  await sc.waitForSelector('.rows'); await sc.screenshot({path:out+'/screen-reveal.png'});
  ok('Big screen shows Efua with 100% of 1',/Efua[\s\S]*100%/.test(await sc.textContent('.rows')));
  // job A on same page
  await h.click('[data-open=jobA]'); await p.waitForSelector('.job');
  await p.click('.opt >> text=Selorm'); await p.click('#sb'); ok('Missing reason is blocked', await p.isVisible('.err'));
  await p.click('label.chip >> text=Handles the unknown'); await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.');
  await p.screenshot({path:out+'/phone-jobA-done.png'});
  // offline then retry
  await h.click('[data-open=reflect]'); await p.waitForSelector('#af');
  await p.click('.opt >> text=Track record'); await phone.setOffline(true); await p.click('#sb');
  await p.waitForSelector('.err'); ok('Offline submit: clear error, not shown as recorded', !(await p.isVisible('text=Your choice has been recorded.')));
  await phone.setOffline(false); await p.click('#sb'); await p.waitForSelector('text=Your choice has been recorded.',{timeout:8000}); ok('Retry after reconnect succeeds',true);
  await h.click('[data-open=interest]'); await p.waitForSelector('text=Which of your systems could benefit from game thinking?');
  await p.screenshot({path:out+'/phone-interest1.png'});
  await p.click('.opt >> text=Customer-facing'); await p.click('.opt >> text=Management systems'); await p.screenshot({path:out+'/phone-interest2.png',fullPage:true});
  await p.fill('#em','bad'); await p.click('#sb'); ok('Interest: bad email blocked on the phone', await p.isVisible('.err'));
  await p.fill('#em','visitor@example.test'); await p.fill('#co','Test Co'); await p.fill('#pr','People skip the second step.'); await p.click('#sb'); await p.waitForSelector('text=Thanks for your interest.'); ok('Interest: email + company, confirms only after server',true);
  await p.screenshot({path:out+'/phone-interest-done.png'});
  // host compare + screenshot
  await h.waitForSelector('[data-cmp=A]'); await h.screenshot({path:out+'/host.png',fullPage:true});
  const ed=await h.inputValue('#ed'); ok('Activity editor loaded with JSON',ed.includes('"jobA"'));
  await h.click('#end'); await h.click('#end'); await p.waitForSelector('text=Thank you.'); ok('End session: phone shows closing message',true);
 }catch(e){ console.log('FAIL crashed ->',e.message); fails++; }
 await br.close(); srv.kill(); console.log(fails?fails+' FAILED':'browser checks passed','; screenshots in',out); process.exit(fails?1:0);
})();
