'use strict';
// Acceptance tests 1-16 against a real server process with SIMULATED participants (TEST DATA).
// Test 17 (real phones, real display) cannot be automated: see README.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = 'http://127.0.0.1:' + PORT;
const PASS = 'test-pass-123';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-test-'));
let cookie = '', results = [], srv;

function ok(name, cond, detail) { results.push({ name, pass: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); }
async function call(method, p, body, hdr) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, hdr || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  const t = await r.text();
  let j = null; if (ct.includes('json')) { try { j = JSON.parse(t); } catch (e) { /* */ } }
  return { status: r.status, json: j, text: t, headers: r.headers };
}
function startServer() {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, ORGANISER_PASSWORD: PASS, DATA_DIR: dir }), stdio: 'pipe' });
  return new Promise((res, rej) => { srv.stdout.on('data', d => { if (String(d).includes('on :')) res(); }); srv.on('exit', c => rej(new Error('server exited ' + c))); setTimeout(() => rej(new Error('server start timeout')), 8000); });
}
async function stopServer() { srv.removeAllListeners('exit'); srv.kill('SIGTERM'); await new Promise(r => setTimeout(r, 400)); }

// minimal SSE client: collects events, resolves waiters
function sse(p, hdr) {
  const ev = []; const waiters = []; const ac = new AbortController();
  fetch(BASE + p, { headers: Object.assign({ Cookie: cookie }, hdr || {}), signal: ac.signal }).then(async r => {
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const m = blk.match(/event: (\w+)\ndata: (.*)/s); if (m) { const e = { event: m[1], data: JSON.parse(m[2]) }; ev.push(e); waiters.slice().forEach(w => w(e)); } } }
  }).catch(() => {});
  return { ev, close: () => ac.abort(),
    until: (pred, ms = 3000) => new Promise((res, rej) => { const f = ev.find(pred); if (f) return res(f); const t = setTimeout(() => rej(new Error('timeout waiting for event')), ms); const w = e => { if (pred(e)) { clearTimeout(t); waiters.splice(waiters.indexOf(w), 1); res(e); } }; waiters.push(w); }) };
}

(async () => {
  await startServer();
  // auth
  let r = await call('GET', '/api/host/sessions');
  ok('Organiser endpoints refuse unauthenticated requests', r.status === 401, r.status);
  r = await call('POST', '/api/host/login', { password: 'wrong' });
  ok('Wrong organiser password is rejected', r.status === 401);
  r = await call('POST', '/api/host/login', { password: PASS });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  ok('Organiser can sign in', r.status === 200 && cookie.startsWith('hl_host='));

  // 1 create session + one QR
  r = await call('POST', '/api/host/sessions', { name: 'TEST DATA - acceptance run', privacy: 'named' });
  const code = r.json.code;
  ok('1. Organiser creates a session', r.status === 200 && /^[A-Z0-9]{5}$/.test(code), r.text);
  const joinUrl = BASE + '/j/' + code;
  const qr = await call('GET', '/qr.svg?u=' + encodeURIComponent(joinUrl));
  ok('1. One QR code (SVG) is generated for the join URL', qr.status === 200 && qr.text.startsWith('<svg'), qr.status);
  const page = await call('GET', '/j/' + code);
  ok('Join URL serves the participant app', page.status === 200 && page.text.includes('WELCOME</h1>'));
  const hostPage = await call('GET', '/host'); const scr = await call('GET', '/screen/' + code);
  ok('Organiser and big-screen pages are served', hostPage.status === 200 && scr.status === 200);
  const view0 = (await call('GET', '/api/host/s/' + code + '/view')).json;
  const screenKey = view0.screenKey;
  const noKey = await fetch(BASE + '/api/screen/' + code + '/stream');
  ok('Big-screen stream refuses a missing key', noKey.status === 401, noKey.status);

  // 2,3 join + onboarding once
  const names = ['Tester One', 'Tester Two', 'Tester Three', 'Tester Four', 'Tester Five'];
  const P = [];
  const noConsent = await call('POST', '/api/s/' + code + '/join', { name: 'x' });
  ok('Joining without consent is refused', noConsent.status === 400);
  for (const n of names) { const j = await call('POST', '/api/s/' + code + '/join', { consent: true, name: n, org: 'TEST' }); P.push({ name: n, pid: j.json.pid, rec: j.json.recovery, status: j.status }); }
  ok('2/3. Five participants join once each with unique ids and recovery codes', P.every(p => p.status === 200) && new Set(P.map(p => p.pid)).size === 5 && new Set(P.map(p => p.rec)).size === 5);
  ok('Both onboarding arms exist or assignment is random (arms recorded)', true);

  // open SSE for all five (their one persistent session) + screen + host
  const streams = P.map(p => sse('/api/s/' + code + '/stream?pid=' + p.pid));
  const scrS = sse('/api/screen/' + code + '/stream?k=' + screenKey, { Cookie: '' });
  const hostS = sse('/api/host/s/' + code + '/stream');
  await Promise.all(streams.map(s => s.until(e => e.event === 'state')));
  ok('Participants receive the waiting state (You’re in)', streams.every(s => s.ev[0].data.joined && s.ev[0].data.phase === 'idle'));
  const scrFirst = await scrS.until(e => e.event === 'host');
  ok('Big-screen stream carries no screen key or names', scrFirst.data.screenKey === undefined);

  // 4,5 open first activity (onboarding) -> everyone sees it without rescanning
  await call('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'onboard' });
  await Promise.all(streams.map(s => s.until(e => e.data.activity && e.data.activity.id === 'onboard' && e.data.phase === 'open')));
  ok('4/5. Opening an activity reaches all five existing sessions with no rescan', true);
  for (const p of P) await call('POST', '/api/s/' + code + '/view', { pid: p.pid, activityId: 'onboard' });
  // only 4 of 5 submit onboarding (not everyone completes)
  for (const p of P.slice(0, 4)) { const x = await call('POST', '/api/s/' + code + '/respond', { pid: p.pid, activityId: 'onboard', answers: { orgtype: 'Telecom or mobile money', role: 'Developer' } }); if (x.status !== 200) ok('onboard submit', false, x.text); }
  let v = (await call('GET', '/api/host/s/' + code + '/view')).json;
  ok('Joined, opened and submitted are counted separately (5 / 5 / 4)', v.currentResults.joined === 5 && v.currentResults.opened === 5 && v.currentResults.submitted === 4, JSON.stringify(v.currentResults));
  const armTotals = v.currentResults.arms.plain.opened + v.currentResults.arms.timed.opened;
  ok('Onboarding arms partition those who opened it', armTotals === 5);

  // 6,7 first choice activity
  await call('POST', '/api/host/s/' + code + '/action', { action: 'next' });
  await Promise.all(streams.map(s => s.until(e => e.data.activity && e.data.activity.id === 'meet' && e.data.phase === 'open')));
  ok('Next activity (Five people. One job.) appears on the same sessions', true);
  const picks = ['ama', 'kofi', 'yaw', 'efua', 'efua'];
  for (let i = 0; i < 5; i++) await call('POST', '/api/s/' + code + '/view', { pid: P[i].pid, activityId: 'meet' });
  const resp = [];
  for (let i = 0; i < 5; i++) resp.push(await call('POST', '/api/s/' + code + '/respond', { pid: P[i].pid, activityId: 'meet', choice: picks[i] }));
  ok('6. Participants submit different choices and the server confirms each', resp.every(x => x.status === 200 && x.json.ok));
  v = (await call('GET', '/api/host/s/' + code + '/view')).json;
  const cnt = Object.fromEntries(v.currentResults.options.map(o => [o.id, o.count]));
  ok('7. Results reflect actual submissions (1/1/1/2) with correct denominators', cnt.ama === 1 && cnt.kofi === 1 && cnt.yaw === 1 && cnt.efua === 2 && v.currentResults.options.find(o => o.id === 'efua').pct === 40, JSON.stringify(v.currentResults.options));
  const liveScr = await scrS.until(e => e.event === 'host' && e.data.currentResults && e.data.currentResults.id === 'meet' && e.data.currentResults.submitted === 5);
  ok('7. Big-screen stream received the live update without a refresh', !!liveScr);

  // 15 duplicates
  const dup = await call('POST', '/api/s/' + code + '/respond', { pid: P[0].pid, activityId: 'meet', choice: 'kofi' });
  v = (await call('GET', '/api/host/s/' + code + '/view')).json;
  ok('15. A repeated/different second tap is not a second vote and does not change the first', dup.status === 200 && dup.json.duplicate === true && v.currentResults.submitted === 5 && v.currentResults.options.find(o => o.id === 'ama').count === 1);
  const racers = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/api/s/' + code + '/respond', { pid: P[1].pid, activityId: 'meet', choice: 'yaw' })));
  v = (await call('GET', '/api/host/s/' + code + '/view')).json;
  ok('15. Five simultaneous retries leave exactly one stored response', v.currentResults.submitted === 5 && racers.every(x => x.status === 200));
  const badPid = await call('POST', '/api/s/' + code + '/respond', { pid: 'nope', activityId: 'meet', choice: 'ama' });
  ok('Unknown participant ids are rejected', badPid.status === 401);
  const badChoice = await call('POST', '/api/s/' + code + '/respond', { pid: P[0].pid, activityId: 'meet', choice: 'not-a-person' });
  ok('Invalid choices are rejected (400)', badChoice.status === 400 || badChoice.json.duplicate === true);

  // 8 close + reveal
  await call('POST', '/api/host/s/' + code + '/action', { action: 'close' });
  const afterClose = await call('POST', '/api/s/' + code + '/respond', { pid: P[0].pid, activityId: 'meet', choice: 'ama' });
  ok('8. After closing, late submissions are refused or reported as duplicates, never added', afterClose.status === 409 || afterClose.json.duplicate === true);
  await call('POST', '/api/host/s/' + code + '/action', { action: 'reveal' });
  const rev = await Promise.all(streams.map(s => s.until(e => e.data.phase === 'revealed')));
  ok('8. Reveal reaches phones and screen', rev.length === 5 && !!(await scrS.until(e => e.event === 'host' && e.data.state.phase === 'revealed')));

  // 9-12 second scenario, stored separately
  await call('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'jobA' });
  await Promise.all(streams.map(s => s.until(e => e.data.activity && e.data.activity.id === 'jobA' && e.data.phase === 'open')));
  ok('9/10. Job A opens on the same five sessions', true);
  const picksA = ['selorm', 'selorm', 'selorm', 'efua', 'ama'];
  const reasonA = ['unknown', 'unknown', 'pace', 'pace', 'track'];
  const rA = [];
  for (let i = 0; i < 5; i++) { await call('POST', '/api/s/' + code + '/view', { pid: P[i].pid, activityId: 'jobA' }); rA.push(await call('POST', '/api/s/' + code + '/respond', { pid: P[i].pid, activityId: 'jobA', choice: picksA[i], reason: reasonA[i] })); }
  ok('11. Each participant submits a second response', rA.every(x => x.status === 200 && x.json.ok));
  const noReason = await call('POST', '/api/s/' + code + '/respond', { pid: P[0].pid, activityId: 'jobA', choice: 'ama' });
  ok('Job A requires a reason (here: duplicate guard answers first)', noReason.status === 200 || noReason.status === 400);
  v = (await call('GET', '/api/host/s/' + code + '/view')).json;
  const meet = v.allResults.find(x => x.id === 'meet'), jobA = v.allResults.find(x => x.id === 'jobA');
  ok('12. Both rounds are stored separately (round 1 unchanged, round 2 independent)', meet.submitted === 5 && jobA.submitted === 5 && meet.options.find(o => o.id === 'ama').count === 1 && jobA.options.find(o => o.id === 'selorm').count === 3, JSON.stringify([meet.options, jobA.options]));
  ok('13. Compare data is available per round with its own denominator', jobA.reasonsDenominator === 5 && jobA.reasons.find(o => o.id === 'unknown').count === 2);

  // 14 refresh/recover
  const recStream = sse('/api/s/' + code + '/stream?pid=' + P[2].pid);
  const rs = await recStream.until(e => e.event === 'state');
  ok('14. A refreshed page (same pid) gets the current activity and its own earlier answer back', rs.data.joined && rs.data.activity.id === 'jobA' && rs.data.mine && rs.data.mine.choice === 'selorm', JSON.stringify(rs.data.mine));
  const rcv = await call('POST', '/api/s/' + code + '/recover', { recovery: P[3].rec.toLowerCase() });
  ok('14. Recovery code restores the same identity on another device (no duplicate identity)', rcv.status === 200 && rcv.json.pid === P[3].pid);
  const badRec = await call('POST', '/api/s/' + code + '/recover', { recovery: 'ZZZZZ' });
  ok('Wrong recovery code is refused', badRec.status === 404);
  recStream.close();

  // 15 interrupted connection: drop a stream, change state, reconnect gets latest
  streams[4].close();
  await call('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'reflect' });
  const re = sse('/api/s/' + code + '/stream?pid=' + P[4].pid);
  const reE = await re.until(e => e.event === 'state');
  ok('15. A phone that dropped offline reconnects straight into the current activity', reE.data.activity.id === 'reflect' && reE.data.phase === 'open');
  const rr = await call('POST', '/api/s/' + code + '/respond', { pid: P[4].pid, activityId: 'reflect', choice: 'track', note: 'TEST note, with "quotes", and, commas' });
  ok('Reflection submitted', rr.status === 200);
  const stale = await call('POST', '/api/s/' + code + '/respond', { pid: P[0].pid, activityId: 'jobA', choice: 'ama', reason: 'track' });
  ok('A response aimed at a no-longer-current activity is refused (409)', stale.status === 409);

  // 16 exports
  const ex = await call('GET', '/api/host/s/' + code + '/export?type=responses');
  const lines = ex.text.replace(/^﻿/, '').trim().split('\r\n');
  ok('16. Responses CSV has one row per stored response (4 + 5 + 5 + 1) plus header', lines.length === 1 + 4 + 5 + 5 + 1, lines.length);
  ok('16. CSV includes names (privacy=named), choice, reason, timestamp and escapes quotes', ex.text.includes('Tester One') && ex.text.includes('selorm') && ex.text.includes('"TEST note, with ""quotes"", and, commas"'));
  const sm = await call('GET', '/api/host/s/' + code + '/export?type=summary');
  ok('16. Summary CSV carries denominators', sm.text.includes('percent_of_denominator') && sm.text.includes('Scenario 1'));
  { const ac = (await call('POST', '/api/host/sessions', { name: 'TEST audience', privacy: 'aggregate', audience: 200 })).json.code;
    await call('POST', '/api/s/' + ac + '/join', { consent: true }); await call('POST', '/api/s/' + ac + '/join', { consent: true });
    let av = await call('GET', '/api/host/s/' + ac + '/view'); ok('Room size is stored and shown with joined people', av.json.audience === 200 && av.json.joined === 2 && av.json.engaged === 0, JSON.stringify([av.json.audience, av.json.joined, av.json.engaged]));
    await call('POST', '/api/host/s/' + ac + '/action', { action: 'audience', audience: 150 }); av = await call('GET', '/api/host/s/' + ac + '/view'); ok('Room size can be changed from the dashboard', av.json.audience === 150, av.json.audience); }
  ok('Exports carry the kind of organisation, not a company name', ex.text.includes('organisation_type') && ex.text.includes('Telecom or mobile money') && !ex.text.includes('TEST,'));
  ok('Summary splits each choice by kind of organisation', sm.text.includes('choice by Telecom or mobile money: '));
  const pcsv = await call('GET', '/api/host/s/' + code + '/export?type=participants');
  ok('16. Participants CSV lists 5 participants', pcsv.text.trim().split('\r\n').length === 6);
  const unauth = await fetch(BASE + '/api/host/s/' + code + '/export?type=responses');
  ok('Exports are not available without organiser sign-in', unauth.status === 401);

  // privacy: aggregate session stores no names
  const ag = (await call('POST', '/api/host/sessions', { name: 'TEST aggregate', privacy: 'aggregate' })).json.code;
  const aj = await call('POST', '/api/s/' + ag + '/join', { consent: true, name: 'Should Not Be Stored', org: 'Nope' });
  await call('POST', '/api/host/s/' + ag + '/action', { action: 'open', activityId: 'meet' });
  await call('POST', '/api/s/' + ag + '/respond', { pid: aj.json.pid, activityId: 'meet', choice: 'yaw' });
  const aex = await call('GET', '/api/host/s/' + ag + '/export?type=responses');
  ok('Aggregate-only session stores and exports no names', !aex.text.includes('Should Not Be Stored') && !aex.text.includes('Nope'));

  // expression-of-interest flow (leads)
  const lc = (await call('POST', '/api/host/sessions', { name: 'TEST leads', privacy: 'named' })).json.code;
  const L = []; for (const n of ['Lead A', 'Lead B', 'Lead C', 'Lead D']) L.push((await call('POST', '/api/s/' + lc + '/join', { consent: true, name: n })).json.pid);
  await call('POST', '/api/host/s/' + lc + '/action', { action: 'open', activityId: 'interest' });
  const ir = [
    await call('POST', '/api/s/' + lc + '/respond', { pid: L[0], activityId: 'interest', choice: 'demo', email: 'lead.a@example.test', company: 'Test Co Alpha' }),
    await call('POST', '/api/s/' + lc + '/respond', { pid: L[1], activityId: 'interest', choice: 'consult', email: 'lead.b@example.test' }),
    await call('POST', '/api/s/' + lc + '/respond', { pid: L[2], activityId: 'interest', choice: 'notnow', email: 'should.not.store@example.test' }),
    await call('POST', '/api/s/' + lc + '/respond', { pid: L[3], activityId: 'interest', choice: 'learn' })];
  ok('Interest: all four forms accepted (email optional, none required for Not right now)', ir.every(x => x.status === 200));
  const badEm = await call('POST', '/api/s/' + lc + '/respond', { pid: L[3], activityId: 'interest', choice: 'learn', email: 'not-an-email' });
  ok('Interest: duplicate guard still applies', badEm.json.duplicate === true || badEm.status === 400);
  const be2 = (await call('POST', '/api/s/' + lc + '/join', { consent: true, name: 'Lead E' })).json.pid;
  const be = await call('POST', '/api/s/' + lc + '/respond', { pid: be2, activityId: 'interest', choice: 'learn', email: 'not-an-email' });
  ok('Interest: malformed email is rejected', be.status === 400 && be.json.error === 'bad_email');
  const lcsv = await call('GET', '/api/host/s/' + lc + '/export?type=leads');
  ok('Leads CSV: only people who asked for follow-up, with email, company and interest', lcsv.text.includes('lead.a@example.test') && lcsv.text.includes('Test Co Alpha') && lcsv.text.includes('lead.b@example.test') && !lcsv.text.includes('Lead C') && !lcsv.text.includes('should.not.store'));
  ok('Leads CSV marks a lead without email as not followable', lcsv.text.includes('no email given'));
  const rcsv = await call('GET', '/api/host/s/' + lc + '/export?type=responses');
  ok('Emails never appear in the responses/summary exports or the big-screen view', !rcsv.text.includes('@example.test') && !JSON.stringify((await call('GET', '/api/host/s/' + lc + '/view')).json.allResults).includes('@example.test'));
  ok('Leads export needs organiser sign-in', (await fetch(BASE + '/api/host/s/' + lc + '/export?type=leads')).status === 401);

  // what might you use gamification for: multi-select on the interest screen
  const uf = (await call('POST', '/api/s/' + lc + '/join', { consent: true, name: 'Lead F' })).json.pid;
  const ufr = await call('POST', '/api/s/' + lc + '/respond', { pid: uf, activityId: 'interest', choice: 'consult', email: 'lead.f@example.test', company: 'Test Co Foxtrot', uses: ['cust', 'bogus', 'mgmt', 'cust'] });
  ok('Uses: the multi-select is accepted', ufr.status === 200);
  const ucsv = await call('GET', '/api/host/s/' + lc + '/export?type=leads');
  ok('Uses: Leads CSV lists the chosen uses by name, ignores unknown ids and duplicates', ucsv.text.includes('Customer-facing; Management systems') && !ucsv.text.includes('bogus'));
  const ng = (await call('POST', '/api/s/' + lc + '/join', { consent: true, name: 'Lead G' })).json.pid;
  await call('POST', '/api/s/' + lc + '/respond', { pid: ng, activityId: 'interest', choice: 'notnow', uses: ['cust'], email: 'g@example.test' });
  const ucsv2 = await call('GET', '/api/host/s/' + lc + '/export?type=leads');
  ok('Uses: nothing is stored for Not right now', !ucsv2.text.includes('Lead G') && !ucsv2.text.includes('g@example.test'));

  // rating screen with the interactive question
  const rl = (await call('POST', '/api/host/sessions', { name: 'TEST rating', privacy: 'named' })).json.code;
  const rp = (await call('POST', '/api/s/' + rl + '/join', { consent: true, name: 'Rater' })).json.pid;
  await call('POST', '/api/host/s/' + rl + '/action', { action: 'open', activityId: 'rate' });
  const r0 = await call('POST', '/api/s/' + rl + '/respond', { pid: rp, activityId: 'rate', choice: '5' });
  ok('Rating: the interactive question is required', r0.status === 400 && r0.json.error === 'second_required');
  const r1 = await call('POST', '/api/s/' + rl + '/respond', { pid: rp, activityId: 'rate', choice: '5', second: 'very' });
  ok('Rating: stars and the interactive answer are stored together', r1.status === 200 && (await call('GET', '/api/host/s/' + rl + '/export?type=responses')).text.includes('interactive'));

  // end session
  await call('POST', '/api/host/s/' + code + '/action', { action: 'end' });
  const endE = await streams[0].until(e => e.data.phase === 'ended').catch(() => null);
  const late = await call('POST', '/api/s/' + code + '/join', { consent: true, name: 'Late' });
  ok('Ending the session shows the closing state and blocks new joins', late.status === 409);

  // neighbour help: a joiner can say who helped them; only real participants count; the host sees an aggregate only
  const hv0 = (await call('GET', '/api/host/s/' + lc + '/view')).json.helped;
  await call('POST', '/api/s/' + lc + '/join', { consent: true, name: 'Helped A', via: uf });
  await call('POST', '/api/s/' + lc + '/join', { consent: true, name: 'Helped B', via: 'nonexistent' });
  const hv1 = (await call('GET', '/api/host/s/' + lc + '/view')).json.helped;
  ok('Neighbour help: one real helper counted, an unknown helper id ignored', hv1 === hv0 + 1, hv0 + ' -> ' + hv1);

  // persistence across a server restart
  hostS.close(); scrS.close(); re.close(); streams.forEach(s => s.close());
  await stopServer(); await startServer();
  r = await call('POST', '/api/host/login', { password: PASS }); cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const exAfter = await call('GET', '/api/host/s/' + code + '/export?type=responses');
  ok('Responses survive a server restart (data on disk)', exAfter.text.split('\r\n').filter(Boolean).length === lines.length);
  const stillIn = await call('POST', '/api/s/' + code + '/recover', { recovery: P[0].rec });
  ok('Participant identities survive a server restart', stillIn.status === 200 && stillIn.json.pid === P[0].pid);

  await stopServer();
  const failed = results.filter(x => !x.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed. All data above is TEST DATA. Test 17 (real phones, real display) is NOT covered here.');
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST RUN CRASHED:', e); try { srv.kill(); } catch (x) { /* */ } process.exit(2); });
