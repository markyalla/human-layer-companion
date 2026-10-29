'use strict';
// Security regression checks against an isolated server with synthetic data. TEST DATA ONLY.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const PORT = 7100 + Math.floor(Math.random() * 400), BASE = 'http://127.0.0.1:' + PORT, PASS = 'correct horse battery staple';
let fails = 0; const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); if (!c) fails++; };
let cookie = '';
const call = async (m, p, b, h) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(h || {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (p.endsWith('login') && r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; let j = {}; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t, headers: r.headers }; };
const raw = (reqPath, method = 'GET', body) => new Promise(res => { const rq = http.request({ host: '127.0.0.1', port: PORT, path: reqPath, method, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => res({ status: r.statusCode, text: t })); }); rq.on('error', e => res({ status: 0, text: String(e) })); if (body) rq.write(body); rq.end(); });
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-sec-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, ORGANISER_PASSWORD: PASS, DATA_DIR: dir }, stdio: 'pipe' });
  await new Promise(r => srv.stdout.on('data', d => String(d).includes('on :') && r()));
  const br = await chromium.launch();
  try {
    // ---- login: wrong passwords are throttled, the right one still works for a different client afterwards
    let last = 0; for (let i = 0; i < 30; i++) last = (await call('POST', '/api/host/login', { password: 'wrong' + i }, { 'X-Forwarded-For': '203.0.113.9' })).status;
    ok('Login: repeated wrong passwords are throttled (429)', last === 429, 'last status ' + last);
    const good = await call('POST', '/api/host/login', { password: PASS }, { 'X-Forwarded-For': '198.51.100.7' }); ok('Login: the correct password works from a different address', good.status === 200, good.status);
    // ---- unsigned requests to organiser endpoints
    const code = (await call('POST', '/api/host/sessions', { name: 'TEST sec', privacy: 'named' })).json.code;
    cookie = ''; const saved = (await call('POST', '/api/host/login', { password: PASS }, { 'X-Forwarded-For': '198.51.100.7' })).status; // re-sign-in
    const anon = async (m, p, b) => (await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).status;
    for (const [m, p, b] of [['GET', '/api/host/sessions'], ['POST', '/api/host/sessions', { name: 'x' }], ['GET', '/api/host/s/' + code + '/view'], ['POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'jobA' }], ['POST', '/api/host/s/' + code + '/activities', []], ['POST', '/api/host/s/' + code + '/delete', {}], ['GET', '/api/host/s/' + code + '/export?type=all'], ['GET', '/present/deck/notes.json']])
      { const s = await anon(m, p, b); ok('Organiser-only: ' + m + ' ' + p.replace(code, 'CODE') + ' refuses a visitor', s === 401, s); }
    // ---- session isolation
    const code2 = (await call('POST', '/api/host/sessions', { name: 'TEST sec2', privacy: 'named' })).json.code;
    const A = (await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'Alice' })).json.pid;
    await call('POST', '/api/host/s/' + code2 + '/action', { action: 'open', activityId: 'jobA' });
    const cross = await call('POST', '/api/s/' + code2 + '/respond', { pid: A, activityId: 'jobA', choice: 'efua', reason: 'gut' }); ok('Isolation: a participant id from one session is refused in another', cross.status === 401, cross.status);
    const fake = await call('POST', '/api/s/' + code + '/respond', { pid: 'ffffffffffffffff', activityId: 'jobA', choice: 'efua' }); ok('Isolation: an invented participant id is refused', fake.status === 401, fake.status);
    // ---- duplicate / concurrent submissions, closed and not-open activities
    await call('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'jobA' });
    await call('POST', '/api/s/' + code + '/view', { pid: A, activityId: 'jobA' });
    const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', '/api/s/' + code + '/respond', { pid: A, activityId: 'jobA', choice: i === 0 ? 'efua' : 'ama', reason: 'gut' })));
    ok('Duplicates: 25 simultaneous submissions from one person are all acknowledged but only one is stored (24 flagged duplicate)', burst.every(r => r.status === 200) && burst.filter(r => r.json.duplicate).length === 24, burst.map(r => r.status + (r.json.duplicate ? 'd' : '')).join(','));
    const hv = (await call('GET', '/api/host/s/' + code + '/view')).json; ok('Duplicates: the tally shows one vote, and it is the first answer, not a later one', hv.currentResults.submitted === 1 && hv.currentResults.options.find(o => o.id === 'efua').count === 1, JSON.stringify(hv.currentResults.options.map(o => o.id + ':' + o.count)));
    await call('POST', '/api/host/s/' + code + '/action', { action: 'close', activityId: 'jobA' });
    const B = (await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'Latecomer' })).json.pid;
    const late = await call('POST', '/api/s/' + code + '/respond', { pid: B, activityId: 'jobA', choice: 'ama', reason: 'gut' }); ok('Late: a vote after the host closes the activity is refused (409)', late.status === 409, late.status);
    const wrongAct = await call('POST', '/api/s/' + code + '/respond', { pid: B, activityId: 'rate', choice: '5', second: 'very' }); ok('An activity that is not the open one is refused', wrongAct.status === 409 || wrongAct.status === 400, wrongAct.status);
    const badChoice = await call('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'jobA' }); await call('POST', '/api/s/' + code + '/view', { pid: B, activityId: 'jobA' });
    const inv = await call('POST', '/api/s/' + code + '/respond', { pid: B, activityId: 'jobA', choice: '__not_an_option__', reason: 'gut' }); ok('Invalid: an answer that is not one of the options is refused', inv.status === 400, inv.status);
    const noConsent = await call('POST', '/api/s/' + code + '/join', { name: 'NoConsent' }); ok('Consent: joining without consent is refused', noConsent.status === 400, noConsent.status);
    const wrongCode = await call('GET', '/api/s/ZZZZZZ/info'); ok('Wrong session code gives a clear not-found', wrongCode.status === 404, wrongCode.status);
    // ---- recovery-code guessing is throttled
    let rl = 0; for (let i = 0; i < 80; i++) rl = (await call('POST', '/api/s/' + code + '/recover', { recovery: 'ZZ' + String(i).padStart(3, '0').replace(/[0-9]/g, 'A') }, { 'X-Forwarded-For': '203.0.113.50' })).status;
    ok('Recovery: repeated wrong codes from one address are throttled (429)', rl === 429, 'last status ' + rl);
    // ---- CSV (spreadsheet) injection
    const code3 = (await call('POST', '/api/host/sessions', { name: 'TEST csv', privacy: 'named' })).json.code;
    const evil = ['=HYPERLINK("http://evil.example","x")', '+1+1', '@SUM(1)', '-2+3', '\tTAB=1'];
    await call('POST', '/api/host/s/' + code3 + '/action', { action: 'open', activityId: 'interest' });
    for (const [i, n] of evil.entries()) { const pid = (await call('POST', '/api/s/' + code3 + '/join', { consent: true, name: n })).json.pid; await call('POST', '/api/s/' + code3 + '/respond', { pid, activityId: 'interest', choice: 'consult', email: 'x' + i + '@example.test', company: n, problem: n, uses: ['cust'] }); }
    const leads = (await call('GET', '/api/host/s/' + code3 + '/export?type=leads')).text, parts = (await call('GET', '/api/host/s/' + code3 + '/export?type=participants')).text;
    const cells = t => t.split(/\r?\n/).slice(1).join('\n');
    const danger = /(^|,)"?[=+@\-\t][^,\n]*/m;
    const bad = evil.filter(e => { const lines = (cells(leads) + '\n' + cells(parts)).split('\n'); return lines.some(l => l.split(',').some(c => { c = c.replace(/^"/, ''); return c.startsWith(e.slice(0, 3)) && /^[=+@\-\t]/.test(c); })); });
    ok('CSV injection: cells starting with = + - @ or tab are defused in the Leads and Participants exports', bad.length === 0, 'live formula cells for: ' + bad.join(' | '));
    ok('CSV: real emails are unchanged', /x0@example.test/.test(leads));
    // ---- hostile input stays text in every screen (names with markup)
    const code4 = (await call('POST', '/api/host/sessions', { name: 'TEST xss', privacy: 'named' })).json.code; const key4 = (await call('GET', '/api/host/s/' + code4 + '/view')).json.screenKey;
    const x = '<img src=x onerror="window.__xss=1">';
    const X = (await call('POST', '/api/s/' + code4 + '/join', { consent: true, name: x })).json.pid;
    const act = (a, id) => call('POST', '/api/host/s/' + code4 + '/action', { action: a, activityId: id });
    await act('open', 'jobA'); await call('POST', '/api/s/' + code4 + '/view', { pid: X, activityId: 'jobA' }); await call('POST', '/api/s/' + code4 + '/respond', { pid: X, activityId: 'jobA', choice: 'efua', reason: 'gut' }); await act('close', 'jobA'); await act('reveal', 'jobA');
    await act('open', 'interest'); await call('POST', '/api/s/' + code4 + '/respond', { pid: X, activityId: 'interest', choice: 'consult', email: 'a@example.test', company: x, problem: x });
    const hostCtx = await br.newContext({ viewport: { width: 1280, height: 900 } }); await hostCtx.addCookies([{ name: 'hl_host', value: cookie.split('=')[1], url: BASE }]);
    const tests = [['organiser dashboard', hostCtx, BASE + '/host'], ['tablet controller', hostCtx, BASE + '/present/' + code4 + '?len=full'], ['projector', await br.newContext({ viewport: { width: 1920, height: 1080 } }), BASE + '/show/' + code4 + '?k=' + key4 + '&len=full'], ['audience phone', await br.newContext({ viewport: { width: 390, height: 800 } }), BASE + '/j/' + code4]];
    for (const [name, ctx, url] of tests) { const pg = await ctx.newPage(); await pg.goto(url); await pg.waitForTimeout(1800); if (name === 'organiser dashboard') { try { await pg.click('text=' + code4, { timeout: 2000 }); await pg.waitForTimeout(1200); } catch (e) {} } if (name === 'tablet controller') { await pg.evaluate(() => { const i = window.__present.DEF.findIndex(d => d.id === 'pickr'); window.__present.show(i, 0); }); await pg.waitForTimeout(1200); } if (name === 'projector') { await call('POST', '/api/host/s/' + code4 + '/action', { action: 'slide', idx: 8, step: 0, total: 22 }); await pg.waitForTimeout(1500); } ok('Hostile name is shown as plain text on the ' + name + ' (no script ran)', !(await pg.evaluate(() => window.__xss)), 'script executed'); }
    // ---- unusual requests do not crash the server
    const odd = [await raw('/%E0%A4%A'), await raw('/' + 'a'.repeat(9000)), await raw('/api/host/login', 'POST', '{bad json'), await raw('/api/host/login', 'POST', 'x'.repeat(70000)), await raw('/api/s/' + code + '/join', 'PUT'), await raw('/present/deck/..%2f..%2fserver.js'), await raw('/present/slides/../../server.js'), await raw('/j/../../etc/passwd'), await raw('/api/s/' + code + '/join', 'POST', '{"consent":true,"name":"' + 'N'.repeat(5000) + '"}')];
    ok('Unusual requests do not return source code or stack traces', odd.every(r => !/require\(|at Object\.|node_modules|ORGANISER_PASSWORD/.test(r.text)), odd.map(r => r.status).join(','));
    const hl = await call('GET', '/health'); ok('The server is still healthy after those requests', hl.status === 200 && hl.json.ok === true, hl.status);
    // ---- headers
    const info = await call('GET', '/api/s/' + code + '/info'); const h = info.headers;
    ok('Headers: nosniff and a referrer policy are set (so the projector key is not leaked in Referer)', h.get('x-content-type-options') === 'nosniff' && /no-referrer|same-origin/.test(h.get('referrer-policy') || ''), 'nosniff=' + h.get('x-content-type-options') + ' referrer=' + h.get('referrer-policy'));
  } catch (e) { ok('exception', false, e.stack.split('\n').slice(0, 3).join(' | ')); }
  await br.close(); srv.kill(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
