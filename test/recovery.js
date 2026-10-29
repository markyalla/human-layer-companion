'use strict';
// Failure and recovery checks: refreshes, a phone going offline, server restarts, a disk that will not save. TEST DATA ONLY.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { chromium, devices } = require('playwright');
const PORT = 7900 + Math.floor(Math.random() * 300), BASE = 'http://127.0.0.1:' + PORT, PASS = 'recovery pass';
let fails = 0; const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = ''; const call = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (p.endsWith('login')) cookie = r.headers.get('set-cookie').split(';')[0]; let j = {}; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-rec-'));
let srv; const start = async () => { srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, ORGANISER_PASSWORD: PASS, DATA_DIR: dir }, stdio: 'pipe' }); await new Promise(r => srv.stdout.on('data', d => String(d).includes('on :') && r())); };
const stop = async sig => { srv.kill(sig); await new Promise(r => srv.on('exit', r)); };
(async () => {
  await start(); const br = await chromium.launch();
  try {
    await call('POST', '/api/host/login', { password: PASS });
    const code = (await call('POST', '/api/host/sessions', { name: 'TEST recovery', privacy: 'named' })).json.code; const key = (await call('GET', '/api/host/s/' + code + '/view')).json.screenKey;
    const act = (a, id) => call('POST', '/api/host/s/' + code + '/action', { action: a, activityId: id });
    // tablet + projector
    const tab = await br.newContext({ viewport: { width: 1180, height: 820 } }); await tab.addCookies([{ name: 'hl_host', value: cookie.split('=')[1], url: BASE }]);
    const ctl = await tab.newPage(); const proj = await (await br.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await ctl.goto(BASE + '/present/' + code); await ctl.waitForFunction(() => window.__present && document.querySelectorAll('.sl').length === 14);
    await proj.goto(BASE + '/show/' + code + '?k=' + key); await proj.waitForFunction(() => window.__present && document.querySelectorAll('.sl').length === 14);
    for (let i = 0; i < 7; i++) { await ctl.keyboard.press('ArrowRight'); await ctl.waitForTimeout(90); }
    await proj.waitForFunction(() => window.__present.state().idx >= 6, null, { timeout: 5000 }); const before = await ctl.evaluate(() => window.__present.state().idx);
    // 1. the presenter refreshes the tablet mid-talk
    await ctl.reload(); await ctl.waitForFunction(() => window.__present && document.querySelectorAll('.sl').length === 14); await ctl.waitForTimeout(1200);
    const afterCtl = await ctl.evaluate(() => window.__present.state().idx), afterProj = await proj.evaluate(() => window.__present.state().idx);
    ok('Presenter refresh: the tablet comes back on the same slide (was ' + (before + 1) + ', now ' + (afterCtl + 1) + ')', afterCtl === before, 'slide ' + (afterCtl + 1));
    ok('Presenter refresh: the projector stays on the same slide', afterProj === before, 'projector on slide ' + (afterProj + 1));
    // 2. the projector refreshes
    await proj.reload(); await proj.waitForFunction(() => window.__present && document.querySelectorAll('.sl').length === 14); await proj.waitForTimeout(1200);
    ok('Projector refresh: it returns to the current slide without help', (await proj.evaluate(() => window.__present.state().idx)) === before);
    // 3. a phone: join, refresh, cannot vote twice; goes offline and comes back
    const ph = await (await br.newContext({ ...devices['iPhone 13'] })).newPage(); await ph.goto(BASE + '/j/' + code); await ph.fill('#nm', 'Phone One'); await ph.check('#cs'); await ph.click('#jb'); await ph.waitForFunction(() => /Keep this page open/.test(document.body.innerText));
    await act('open', 'jobA'); await ph.waitForSelector('text=Who do you pull?'); await ph.click('input[value=efua]', { force: true }); await ph.click('text=Fits the pace'); await ph.click('button:has-text("Submit")'); await ph.waitForSelector('text=recorded');
    await ph.reload(); await ph.waitForTimeout(1500); const txt = await ph.evaluate(() => document.body.innerText);
    ok('Phone refresh: stays joined and shows the vote was already recorded (no second vote offered)', /recorded/.test(txt) && !/Submit/.test(txt), txt.slice(0, 80).replace(/\n/g, ' | '));
    await act('close', 'jobA'); await act('open', 'interest'); await ph.waitForTimeout(800);
    await stop('SIGTERM'); await ph.waitForTimeout(3000); /* a browser's offline switch does not cut an open stream, so the connection is really cut by stopping the server */ const off = await ph.evaluate(() => document.body.innerText);
    ok('Phone offline: the person is told the connection is lost (and that nothing is recorded meanwhile)', /Connection lost/.test(off), off.slice(0, 120).replace(/\n/g, ' | '));
    await start(); await call('POST', '/api/host/login', { password: PASS }); await ph.waitForTimeout(7000); const on = await ph.evaluate(() => document.body.innerText);
    ok('Phone back online: the warning clears by itself and the current screen is shown', !/Connection lost/.test(on) && /Which of your systems/.test(on), on.slice(0, 120).replace(/\n/g, ' | '));
    // 4. server restart (clean stop, then abrupt kill) mid-session
    await act('close', 'interest'); await act('open', 'jobA');
    const pidBefore = (await call('GET', '/api/host/s/' + code + '/view')).json;
    await stop('SIGTERM'); await start();
    const v1 = (await call('POST', '/api/host/login', { password: PASS }), (await call('GET', '/api/host/s/' + code + '/view')).json);
    ok('Restart (clean): the session, joined people, votes and the open activity are all still there', v1.joined === pidBefore.joined && v1.state.activityId === 'jobA' && v1.state.phase === 'open' && v1.allResults.find(x => x.id === 'jobA').submitted === 1, JSON.stringify([v1.joined, v1.state]));
    ok('Restart (clean): the slide position is remembered', v1.slide && v1.slide.idx === before, JSON.stringify(v1.slide));
    await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'Two' }); await sleep(400);
    await stop('SIGKILL'); await start(); await call('POST', '/api/host/login', { password: PASS });
    const v2 = (await call('GET', '/api/host/s/' + code + '/view')).json;
    ok('Restart (abrupt kill, after a 0.4 s pause): everyone who joined is still there', v2.joined === 2, 'joined ' + v2.joined);
    await sleep(2500); const ph2 = await ph.evaluate(() => document.body.innerText);
    ok('Restart: an open phone reconnects by itself and the person is still recognised', !/Cannot reach/.test(ph2) && !/Welcome/i.test(ph2.slice(0, 60)), ph2.slice(0, 100).replace(/\n/g, ' | '));
    await proj.waitForTimeout(3000); ok('Restart: the projector reconnects by itself and shows the same slide', (await proj.evaluate(() => window.__present.state().idx)) === before);
    // 5. a disk that will not save must not crash the server
    fs.mkdirSync(path.join(dir, 'db.json.tmp'), { recursive: true });
    await call('POST', '/api/host/login', { password: PASS }); await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'During save failure' }); await sleep(700);
    const hl = await call('GET', '/health'); ok('Save failure: the server keeps running and keeps answering', hl.status === 200, hl.status);
    ok('Save failure: the problem is reported so the presenter can see it (health shows saveError)', hl.json && hl.json.saveError, JSON.stringify(hl.json));
    fs.rmdirSync(path.join(dir, 'db.json.tmp')); await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'After recovery' }); await sleep(4000);
    const hl2 = await call('GET', '/health'); ok('Save failure: saving resumes by itself once the disk works and the warning clears', hl2.status === 200 && !hl2.json.saveError, JSON.stringify(hl2.json));
  } catch (e) { ok('exception', false, e.stack.split('\n').slice(0, 3).join(' | ')); }
  await br.close(); try { srv.kill(); } catch (e) {} console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
