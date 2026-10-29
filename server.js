'use strict';
// The Human Layer: live audience companion. One QR code per session.
// Zero framework: Node http + Server-Sent Events + a JSON file. Only dependency: qrcode.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { console.warn('qrcode package missing: QR images disabled'); }

const PORT = process.env.PORT || 3000;
const PASS = process.env.ORGANISER_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!PASS) { console.error('Set ORGANISER_PASSWORD before starting.'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- storage ----------
let db = { sessions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { /* new store */ }
let saveTimer = null;
let saveError = '';
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
    saveError = '';
  } catch (e) { // keep serving from memory, say so, and try again shortly (a full or unwritable disk must not end the show)
    saveError = String(e && e.code || e).slice(0, 60); console.error('SAVE FAILED:', e && e.message);
    if (!saveTimer) saveTimer = setTimeout(saveNow, 3000);
  }
}
function save() { if (!saveTimer) saveTimer = setTimeout(saveNow, 150); }
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });

// ---------- helpers ----------
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(n) { let s = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length]; return s; }
function hex(n) { return crypto.randomBytes(n).toString('hex'); }
const hostToken = crypto.createHash('sha256').update('hl-host:' + PASS).digest('hex');
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function isHost(req) { return safeEq(cookies(req).hl_host || '', hostToken); }
function send(res, status, body, type) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(data);
}
const tries = new Map(); // failed attempts per client address: { n, t }
function clientIp(req) { const f = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean); return f.length ? f[f.length - 1] : (req.socket.remoteAddress || 'unknown'); } // the last entry is the one our own proxy added
function tooMany(kind, req, max, windowMs) { const k = kind + '|' + clientIp(req), e = tries.get(k); return !!(e && Date.now() - e.t < windowMs && e.n >= max); }
function noteFail(kind, req, windowMs) { const k = kind + '|' + clientIp(req), now = Date.now(), e = tries.get(k); if (e && now - e.t < windowMs) e.n++; else tries.set(k, { n: 1, t: now }); if (tries.size > 5000) for (const [key, v] of tries) if (now - v.t > windowMs) tries.delete(key); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 60000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// ---------- default content (editable per session in the dashboard) ----------
function defaultActivities() {
  const P = {
    ama: { id: 'ama', nums: [3, 9, 8, 5], name: 'Ama', role: 'The Master', stats: 'Speed 3 · Accuracy 9 · On time 8 · Free time 5 (each out of 10)', plus: ['Deepest technical skill in the building', 'Spots mistakes others miss', 'Others ask her to check their work'], minus: ['Does her best work alone, on long projects', 'Half her usual time free this month'] },
    kofi: { id: 'kofi', nums: [6, 3, 6, 10], name: 'Kofi', role: 'The Storyteller', stats: 'Speed 6 · Accuracy 3 · On time 6 · Free time 10 (each out of 10)', plus: ['Explains anything simply', 'People trust him quickly', 'Brings sceptics along'], minus: ['Energised by working with a team', 'Prefers variety over fine detail'] },
    yaw: { id: 'yaw', nums: [5, 9, 10, 10], name: 'Yaw', role: 'The Metronome', stats: 'Speed 5 · Accuracy 9 · On time 10 · Free time 10 (each out of 10)', plus: ['Has never missed a deadline', 'Same quality, week after week', 'Careful with detail'], minus: ['Likes a clear plan and a long, steady run', 'Calm alone or in a small team'] },
    efua: { id: 'efua', nums: [10, 4, 7, 8], name: 'Efua', role: 'The Sprinter', stats: 'Speed 10 · Accuracy 4 · On time 7 · Free time 8 (each out of 10)', plus: ['Fastest at completing work', 'Thrives on short, urgent assignments', 'Lifts the whole team'], minus: ['Short, intense bursts; months-long work drains her', 'Often works best alone, fast'] },
    selorm: { id: 'selorm', nums: [6, 4, 7, 9], name: 'Selorm', role: 'The Pathfinder', stats: 'Speed 6 · Accuracy 4 · On time 7 · Free time 9 (each out of 10)', plus: ['Thrives when nothing is clear', 'Finds a route through the unknown', 'Asks for help early'], minus: ['Explores best in a small team', 'Restless in repetitive work'] }
  };
  const five = [P.ama, P.kofi, P.yaw, P.efua, P.selorm];
  const reasons = [
    { id: 'track', label: 'Track record' }, { id: 'pace', label: 'Fits the pace' }, { id: 'people', label: 'Good with people' },
    { id: 'unknown', label: 'Handles the unknown' }, { id: 'time', label: 'Has the time' }, { id: 'gut', label: 'Gut feeling' }
  ];
  return [
    { id: 'onboard', kind: 'onboard', title: 'Welcome aboard', prompt: 'Two quick taps.', timedSeconds: 60, timedNote: 'The fastest finisher wins a golden apple.',
      fields: [
        { id: 'orgtype', label: 'Kind of organisation', type: 'select', options: ['Telecom or mobile money', 'Bank or fintech', 'Insurance', 'Software or IT services', 'Consulting', 'Government or public sector', 'NGO or non-profit', 'Education or research', 'Health', 'Retail or consumer goods', 'Energy, mining or industry', 'Media or creative', 'Something else'] },
        { id: 'role', label: 'Your role', type: 'select', options: ['Developer', 'Product or design', 'People or HR', 'Leader', 'Something else'] }
      ] },
    { id: 'meet', kind: 'choice', title: 'Five people. One job.', prompt: 'Who would you hire?', options: five, askReason: false, allowChange: false },
    { id: 'jobA', kind: 'choice', title: 'Scenario 1', role: 'the team leader', short: 'Payroll is failing. 40,000 salaries. You can release one person.', job: 'It is month-end, 11:30 PM, and you run technology at a bank in Accra. Each of your five people is holding something critical: core banking, cards and ATMs, the mobile app, fraud monitoring, regulatory reporting. Partner companies\u2019 payroll files are bouncing at your payments API. The CFO calls: 40,000 salaries must be resubmitted before the morning cut-off. The vendor on call says the fault is in your setup, and only your team can change production. The incident manager can release one person. Everyone else stays on watch.',
      prompt: 'Who do you pull?', options: five, reasons, askReason: true, allowChange: false, answer: 'efua' },
    { id: 'jobB', kind: 'choice', title: 'Scenario 2', role: 'HR', short: 'Launch day for 300 agents. A team of six who have never met.', job: 'A new bill-pay feature goes live in three weeks. 300 mobile money agents need training, the support desk needs a script, and the day-one plan must be tested. Six people from product, support and marketing have been lent to you and have never worked together. Half detail and logistics, half keeping people calm.',
      prompt: 'Who leads launch day?', options: five, reasons, askReason: true, allowChange: false },
    { id: 'jobC', kind: 'choice', title: 'Scenario 3', role: 'the team leader', short: 'New wallet customers never come back. Four months, a team of five.', job: 'A mobile payments company registers many new wallet customers, but too many never make a second transaction. The MD says fix it by March. Sales wants activations, compliance wants ID checks, agents say customers do not trust it yet. Several languages, app, USSD and agents. Four months, a team of five, weekly calls, monthly numbers to the board.',
      prompt: 'The hardest one. Who is the best fit to lead it?', options: five, reasons, askReason: true, allowChange: false },
    { id: 'interest', kind: 'interest', title: '10 free consultations', prompt: 'Which of your systems could benefit from game thinking?',
      options: [
        { id: 'learn', name: 'Yes, I\u2019d like to learn more' }, { id: 'consult', name: 'I\u2019m interested in a consultation' },
        { id: 'demo', name: 'I\u2019d like to see a live demo if it\u2019s a good fit' }, { id: 'notnow', name: 'Not right now' }],
      usesLabel: 'Tap any that apply',
      uses: [
        { id: 'cust', name: 'Customer-facing', hint: 'Onboarding, education, loyalty, launches' },
        { id: 'emp', name: 'Employee-facing', hint: 'Onboarding, training, recognition' },
        { id: 'mgmt', name: 'Management systems', hint: 'Matching people to work, adoption, planning' },
        { id: 'other', name: 'Something else', hint: '' }],
      problemLabel: 'Anything specific? One line, optional', problemHint: 'e.g. people stop using it',
      emailNote: 'Only the organiser sees your email and what you write. We use them only to reply about these consultations. Please leave out confidential details. We choose the ten problems we most want to solve.' },
    { id: 'rate', kind: 'choice', title: 'Rate the talk', prompt: 'How was this talk?',
      second: { id: 'interactive', label: 'Did you find the experience interactive?', options: [{ id: 'very', name: 'Very interactive' }, { id: 'some', name: 'Somewhat interactive' }, { id: 'not', name: 'Not very interactive' }] },
      options: [{ id: '5', name: '5 \u00b7 Loved it' }, { id: '4', name: '4 \u00b7 Good' }, { id: '3', name: '3 \u00b7 OK' }, { id: '2', name: '2 \u00b7 Not really' }, { id: '1', name: '1 \u00b7 Missed the mark' }],
      askReason: false, allowChange: false, note: true },
    { id: 'reflect', kind: 'choice', title: 'Looking back', prompt: 'What mattered most in your decisions?', options: reasons.map(r => ({ id: r.id, name: r.label })), askReason: false, allowChange: false, note: true }
  ];
}

function newSession(name, privacy, audience) {
  let c; do { c = code(5); } while (db.sessions[c]);
  const s = { code: c, name: clean(name, 80) || 'The Human Layer', privacy: privacy === 'aggregate' ? 'aggregate' : 'named', createdAt: Date.now(),
    screenKey: hex(8), status: 'waiting', state: { activityId: null, phase: 'idle', at: Date.now() }, activities: defaultActivities(),
    participants: {}, views: {}, responses: {}, lastResponseAt: null, audience: Math.max(0, Math.min(5000, parseInt(audience, 10) || 0)) };
  db.sessions[c] = s; save(); return s;
}

// ---------- realtime (SSE) ----------
const streams = {}; // code -> Set<{res,kind,pid}>
function addStream(req, res, s, kind, pid, first, screen) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const c = { res, kind, pid, screen: !!screen };
  (streams[s.code] = streams[s.code] || new Set()).add(c);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) { /* closed */ } }, 20000);
  req.on('close', () => { clearInterval(hb); streams[s.code] && streams[s.code].delete(c); });
  first(c);
}
function emit(c, event, data) { try { c.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* closed */ } }
function pushParticipants(s) { (streams[s.code] || []).forEach(c => { if (c.kind === 'p') emit(c, 'state', participantState(s, c.pid)); }); }
let hostTimers = {};
function pushHosts(s) {
  if (hostTimers[s.code]) return;
  hostTimers[s.code] = setTimeout(() => {
    delete hostTimers[s.code];
    const v = hostView(s), vs = redact(v);
    (streams[s.code] || []).forEach(c => { if (c.kind === 'h') emit(c, 'host', c.screen ? vs : v); });
  }, 200);
}

// ---------- views ----------
function currentActivity(s) { return s.activities.find(a => a.id === s.state.activityId) || null; }
function publicActivity(a) {
  if (!a) return null;
  const o = Object.assign({}, a); delete o.answer; return o; // the answer to a prize question stays on the server
}
function participantState(s, pid) {
  const p = s.participants[pid];
  const a = currentActivity(s);
  const st = { now: Date.now(), session: { code: s.code, name: s.name, status: s.status, privacy: s.privacy }, joined: !!p, phase: s.state.phase };
  if (s.slide && s.slide.total > 1) st.progress = Math.round(Math.min(s.slide.idx, s.slide.total - 1) / (s.slide.total - 1) * 100);
  if (p) {
    st.me = { pid: p.pid, name: p.name, recovery: p.recovery, arm: p.arm, helped: Object.values(s.participants).filter(x => x.helpedBy === p.pid).length };
    if (a && ['open', 'paused', 'closed', 'revealed'].includes(s.state.phase)) {
      st.activity = publicActivity(a);
      const key = a.id + '|' + pid;
      st.viewedAt = s.views[key] ? s.views[key].at : null;
      if (s.state.phase === 'revealed') { const r = activityResults(s, a); if ((r.firstTimedFinisher && r.firstTimedFinisher.pid === pid) || (r.firstCorrect && r.firstCorrect.pid === pid)) st.won = true; }
      st.mine = s.responses[key] ? { choice: s.responses[key].choice, reason: s.responses[key].reason, note: s.responses[key].note, at: s.responses[key].at } : null;
    }
  }
  return st;
}
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2 * 10) / 10; }
function activityResults(s, a) {
  const joined = Object.keys(s.participants).length;
  const resp = Object.values(s.responses).filter(r => r.activityId === a.id);
  const views = Object.values(s.views).filter(v => v.activityId === a.id);
  const out = { id: a.id, title: a.title, kind: a.kind, joined, opened: views.length, submitted: resp.length };
  if (a.kind === 'onboard') {
    out.arms = {};
    ['plain', 'timed'].forEach(arm => {
      const o = views.filter(v => (s.participants[v.pid] || {}).arm === arm);
      const f = resp.filter(r => (s.participants[r.pid] || {}).arm === arm);
      const secs = f.map(r => { const v = s.views[a.id + '|' + r.pid]; return v ? (r.at - v.at) / 1000 : null; }).filter(x => x != null);
      const assigned = Object.values(s.participants).filter(x => x.arm === arm).length;
      out.arms[arm] = { assigned, droppedOut: Math.max(0, assigned - f.length), pctOfAssigned: assigned ? Math.round(f.length / assigned * 1000) / 10 : null, opened: o.length, finished: f.length, pctOfOpened: o.length ? Math.round(f.length / o.length * 1000) / 10 : null, medianSeconds: median(secs),
        meanSeconds: secs.length ? Math.round(secs.reduce((x, y) => x + y, 0) / secs.length * 10) / 10 : null,
        fastestSeconds: secs.length ? Math.round(Math.min.apply(null, secs) * 10) / 10 : null };
    });
    const timed = resp.map(r => ({ pid: r.pid, at: r.at, v: s.views[a.id + '|' + r.pid] })).filter(x => x.v).sort((x, y) => (x.at - x.v.at) - (y.at - y.v.at))[0];
    if (timed) { const p = s.participants[timed.pid]; out.firstTimedFinisher = { pid: timed.pid, cohort: p.arm === 'timed' ? 2 : 1, label: (p.name || 'Participant ' + p.recovery), seconds: Math.round((timed.at - timed.v.at) / 100) / 10 }; }
    return out;
  }
  if (a.kind === 'interest') out.withEmail = resp.filter(r => r.email).length;
  if (a.kind === 'choice') {
    const tt = resp.map(r => { const v = s.views[a.id + '|' + r.pid]; return v ? { sec: (r.at - v.at) / 1000, choice: r.choice } : null; }).filter(x => x && x.sec >= 0);
    if (tt.length) { const secs = tt.map(x => x.sec), f = tt.slice().sort((x, y) => x.sec - y.sec)[0], r1 = x => Math.round(x * 10) / 10;
      out.timing = { n: tt.length, avgSeconds: r1(secs.reduce((x, y) => x + y, 0) / secs.length), medianSeconds: median(secs), fastestSeconds: r1(f.sec), fastestChoice: f.choice }; }
  }
  if (a.answer) {
    const ao = (a.options || []).find(o => o.id === a.answer); out.answerName = ao ? (ao.name || ao.label) : a.answer;
    const ok = resp.filter(r => r.choice === a.answer).sort((x, y) => x.at - y.at); out.correct = ok.length;
    out.correctList = ok.map(r => { const p = s.participants[r.pid] || {}; return p.name || 'Participant ' + p.recovery; });
    if (ok.length) { const p = s.participants[ok[0].pid] || {}, v = s.views[a.id + '|' + ok[0].pid]; out.firstCorrect = { pid: ok[0].pid, label: p.name || 'Participant ' + p.recovery, seconds: v ? Math.round((ok[0].at - v.at) / 100) / 10 : null }; }
  }
  if (a.second) { // which joining people say they prefer, overall and by the group they were in
    const ans = resp.map(r => ({ v: r.answers && r.answers[a.second.id], arm: (s.participants[r.pid] || {}).arm })).filter(x => x.v);
    const cnt = (list, id) => list.filter(x => x.v === id).length;
    out.second = { id: a.second.id, label: a.second.label, answered: ans.length,
      options: (a.second.options || []).map(o => ({ id: o.id, name: o.name, count: cnt(ans, o.id) })),
      byArm: { plain: { n: ans.filter(x => x.arm === 'plain').length, game: cnt(ans.filter(x => x.arm === 'plain'), 'game') }, timed: { n: ans.filter(x => x.arm === 'timed').length, game: cnt(ans.filter(x => x.arm === 'timed'), 'game') } } };
  }
  out.options = (a.options || []).map(o => { const n = resp.filter(r => r.choice === o.id).length; return { id: o.id, name: o.name || o.label, count: n, pct: resp.length ? Math.round(n / resp.length * 1000) / 10 : 0 }; });
  if (a.askReason) {
    const withReason = resp.filter(r => r.reason);
    out.reasonsDenominator = withReason.length;
    out.reasons = (a.reasons || []).map(o => { const n = withReason.filter(r => r.reason === o.id).length; return { id: o.id, name: o.label, count: n, pct: withReason.length ? Math.round(n / withReason.length * 1000) / 10 : 0 }; });
  }
  return out;
}
function redact(v) {
  // the big screen never receives names or the screen key of other sessions
  const o = JSON.parse(JSON.stringify(v)); delete o.screenKey;
  [o.currentResults].concat(o.allResults || []).forEach(r => { if (r) delete r.correctList; }); // names of everyone who got it right go to the organiser only
  const shown = o.state && o.state.phase === 'revealed' ? o.state.activityId : null; // names appear on the big screen only when the host reveals
  [o.currentResults].concat(o.allResults || []).forEach(r => { if (!r) return; ['firstTimedFinisher', 'firstCorrect'].forEach(k => { if (r[k]) { delete r[k].pid; if (r.id !== shown) delete r[k].label; } }); });
  return o;
}
function hostView(s) {
  const a = currentActivity(s);
  return { now: Date.now(), code: s.code, name: s.name, privacy: s.privacy, status: s.status, state: s.state, screenKey: s.screenKey,
    slide: s.slide || { idx: 0, step: 0 }, orgMix: orgMix(s), audience: s.audience || 0, engaged: new Set(Object.values(s.responses).map(r => r.pid)).size, joined: Object.keys(s.participants).length, helped: Object.values(s.participants).filter(x => x.helpedBy).length, lastResponseAt: s.lastResponseAt, connected: ((streams[s.code]) ? [...streams[s.code]].filter(c => c.kind === 'p').length : 0),
    activities: s.activities.map(x => ({ id: x.id, title: x.title, kind: x.kind })),
    current: a ? publicActivity(a) : null, currentResults: a ? activityResults(s, a) : null,
    allResults: s.activities.map(x => activityResults(s, x)) };
}

// ---------- csv ----------
// a spreadsheet must not run text typed by a participant: a leading = + - @ or tab is defused with an apostrophe
function csvCell(v) { v = v == null ? '' : (typeof v === 'number' ? String(v) : String(v)); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+([.,]\d+)?$/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function csv(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function exportResponses(s) {
  const rows = [['session', 'participant_id', 'display_name', 'organisation_type', 'arm', 'activity_id', 'activity_title', 'kind', 'choice', 'reason', 'note', 'answers', 'submitted_at', 'seconds_from_open', 'status']];
  Object.values(s.responses).sort((a, b) => a.at - b.at).forEach(r => {
    const p = s.participants[r.pid] || {}; const a = s.activities.find(x => x.id === r.activityId) || {}; const v = s.views[r.activityId + '|' + r.pid];
    rows.push([s.code, r.pid, s.privacy === 'named' ? p.name : '', orgTypeOf(s, r.pid), p.arm, r.activityId, a.title, a.kind, r.choice, r.reason, r.note, r.answers ? JSON.stringify(r.answers) : '', new Date(r.at).toISOString(), v ? (r.at - v.at) / 1000 : '', 'confirmed']);
  });
  return csv(rows);
}
function orgTypeOf(s, pid) { const r = s.responses['onboard|' + pid]; return (r && r.answers && r.answers.orgtype) || ''; }
function orgMix(s) { const m = {}; Object.values(s.responses).filter(r => r.activityId === 'onboard' && r.answers && r.answers.orgtype).forEach(r => { m[r.answers.orgtype] = (m[r.answers.orgtype] || 0) + 1; }); return Object.keys(m).map(k => ({ name: k, count: m[k] })).sort((x, y) => y.count - x.count); }
function exportParticipants(s) {
  const rows = [['session', 'participant_id', 'display_name', 'organisation_type', 'arm', 'joined_at', 'activities_opened', 'activities_submitted']];
  Object.values(s.participants).forEach(p => {
    rows.push([s.code, p.pid, s.privacy === 'named' ? p.name : '', orgTypeOf(s, p.pid), p.arm, new Date(p.joinedAt).toISOString(),
      Object.values(s.views).filter(v => v.pid === p.pid).length, Object.values(s.responses).filter(r => r.pid === p.pid).length]);
  });
  return csv(rows);
}
function exportLeads(s) {
  const rows = [['session', 'display_name', 'organisation_type', 'email', 'company', 'interest', 'uses', 'problem', 'submitted_at', 'note']];
  Object.values(s.responses).filter(r => { const a = s.activities.find(x => x.id === r.activityId); return a && a.kind === 'interest' && r.choice !== 'notnow'; }).sort((a, b) => a.at - b.at).forEach(r => {
    const p = s.participants[r.pid] || {}; const a = s.activities.find(x => x.id === r.activityId); const o = (a.options || []).find(x => x.id === r.choice) || {};
    rows.push([s.code, s.privacy === 'named' ? p.name : '', orgTypeOf(s, r.pid), r.email || '', r.company || '', o.name || r.choice, (r.uses || []).map(id => { const u = (a.uses || []).find(x => x.id === id); return u ? u.name : id; }).join('; '), r.problem || '', new Date(r.at).toISOString(), r.email ? 'expression of interest, not a booking' : 'no email given: cannot follow up']);
  });
  return csv(rows);
}
function exportSummary(s) {
  const rows = [['activity_id', 'title', 'kind', 'joined', 'opened', 'submitted', 'item', 'count', 'percent_of_denominator', 'denominator']];
  s.activities.forEach(a => {
    const r = activityResults(s, a);
    if (r.arms) Object.keys(r.arms).forEach(k => { rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, k + ' finished', r.arms[k].finished, r.arms[k].pctOfOpened, r.arms[k].opened]); rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, k + ' finished, of everyone assigned', r.arms[k].finished, r.arms[k].pctOfAssigned, r.arms[k].assigned]); rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, k + ' dropped out or never started', r.arms[k].droppedOut, r.arms[k].assigned ? Math.round(r.arms[k].droppedOut / r.arms[k].assigned * 1000) / 10 : null, r.arms[k].assigned]); });
    (r.options || []).forEach(o => rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, 'choice: ' + o.name, o.count, o.pct, r.submitted]));
    if (a.kind === 'choice') {
      const resp = Object.values(s.responses).filter(x => x.activityId === a.id);
      const orgs = {}; resp.forEach(x => { const o = orgTypeOf(s, x.pid) || 'not given'; (orgs[o] = orgs[o] || []).push(x); });
      Object.keys(orgs).sort().forEach(o => (a.options || []).forEach(op => { const n = orgs[o].filter(x => x.choice === op.id).length; rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, 'choice by ' + o + ': ' + (op.name || op.label), n, orgs[o].length ? Math.round(n / orgs[o].length * 1000) / 10 : 0, orgs[o].length]); }));
    }
    (r.reasons || []).forEach(o => rows.push([a.id, a.title, a.kind, r.joined, r.opened, r.submitted, 'reason: ' + o.name, o.count, o.pct, r.reasonsDenominator]));
  });
  return csv(rows);
}

// ---------- validation of activities edited in the dashboard ----------
function validActivities(list) {
  if (!Array.isArray(list) || !list.length || list.length > 30) return 'activities must be a list of 1 to 30 items';
  const ids = new Set();
  for (const a of list) {
    if (!a || typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(a.id)) return 'each activity needs an id of letters, digits, _ or -';
    if (ids.has(a.id)) return 'duplicate id: ' + a.id; ids.add(a.id);
    if (!['onboard', 'choice', 'interest'].includes(a.kind)) return a.id + ': kind must be onboard, choice or interest';
    if (a.kind !== 'onboard' && (!Array.isArray(a.options) || a.options.length < 2)) return a.id + ': a choice needs at least 2 options';
  }
  return null;
}

// ---------- http ----------
const PUB = path.join(__dirname, 'public');
const pages = { '/host': 'host.html', '/host/': 'host.html' };
function serveFile(res, f, type) { try { send(res, 200, fs.readFileSync(path.join(PUB, f)), type || 'text/html; charset=utf-8'); } catch (e) { send(res, 404, 'Not found'); } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // pages
    if (req.method === 'GET') {
      if (pages[p]) return serveFile(res, pages[p]);
      if (/^\/j\/[A-Za-z0-9]{3,10}\/?$/.test(p)) return serveFile(res, 'participant.html');
      if (/^\/screen\/[A-Za-z0-9]{3,10}\/?$/.test(p)) return serveFile(res, 'screen.html');
      if (/^\/(present|show)\/[A-Za-z0-9]{3,10}\/?$/.test(p)) return serveFile(res, 'present/present.html');
      if (p === '/present/deck/notes.json' && !isHost(req)) return send(res, 401, { error: 'unauthorised' });
      if (/^\/present\/deck\/[a-z0-9-]+\.mp4$/.test(p)) {
        let f; try { f = path.join(PUB, 'present/' + p.slice(9)); const st = fs.statSync(f); const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
          if (m) { const a = m[1] ? parseInt(m[1], 10) : 0, b = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
            res.writeHead(206, { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Content-Length': b - a + 1 }); return fs.createReadStream(f, { start: a, end: b }).pipe(res); }
          res.writeHead(200, { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': st.size }); return fs.createReadStream(f).pipe(res);
        } catch (e) { return send(res, 404, 'Not found'); }
      }
      if (/^\/present\/(slides\/[a-z-]+\.html|logo\.png|deck\/[a-z0-9-]+\.(?:jpg|json))$/.test(p)) return serveFile(res, 'present/' + p.slice(9), p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
      if (p === '/') return send(res, 200, '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:20px system-ui;padding:2rem;background:#0B0B0B;color:#FBF8F0"><h1>The Human Layer</h1><p>Scan the QR code on the screen to join.</p>', 'text/html; charset=utf-8');
      if (p === '/qr.svg') {
        if (!QRCode) return send(res, 503, 'QR unavailable');
        const target = clean(url.searchParams.get('u'), 500);
        if (!/^https?:\/\//.test(target)) return send(res, 400, 'bad url');
        const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B0B0B', light: '#FFFFFF' } });
        return send(res, 200, svg, 'image/svg+xml');
      }
      if (p === '/health') return send(res, 200, { ok: true, sessions: Object.keys(db.sessions).length, ...(saveError ? { saveError } : {}) });
    }

    // participant API
    let m = p.match(/^\/api\/s\/([A-Za-z0-9]+)\/(info|join|recover|stream|view|respond)$/);
    if (m) {
      const s = db.sessions[m[1].toUpperCase()];
      if (!s) return send(res, 404, { error: 'session_not_found' });
      const act = m[2];
      if (act === 'info' && req.method === 'GET') return send(res, 200, { name: s.name, status: s.status, privacy: s.privacy });
      if (act === 'stream' && req.method === 'GET') {
        const pid = clean(url.searchParams.get('pid'), 40);
        return addStream(req, res, s, 'p', pid, c => emit(c, 'state', participantState(s, pid)));
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      const body = await readJson(req);
      if (act === 'join') {
        if (s.status === 'ended') return send(res, 409, { error: 'ended' });
        if (body.consent !== true) return send(res, 400, { error: 'consent_required' });
        if (Object.keys(s.participants).length >= 2000) return send(res, 429, { error: 'full' });
        const pid = hex(8); let rec; do { rec = code(5); } while (Object.values(s.participants).some(x => x.recovery === rec));
        s.participants[pid] = { pid, recovery: rec, name: s.privacy === 'named' ? clean(body.name, 40) : '', org: s.privacy === 'named' ? clean(body.org, 60) : '',
          arm: (() => { const ps = Object.values(s.participants); const np = ps.filter(x => x.arm === 'plain').length, nt = ps.filter(x => x.arm === 'timed').length; return np === nt ? (Math.random() < 0.5 ? 'plain' : 'timed') : (np < nt ? 'plain' : 'timed'); })(), joinedAt: Date.now(), helpedBy: (typeof body.via === 'string' && s.participants[clean(body.via, 40)]) ? clean(body.via, 40) : '' };
        save(); pushHosts(s);
        const hb = s.participants[pid].helpedBy; if (hb) (streams[s.code] || []).forEach(c => { if (c.kind === 'p' && c.pid === hb) emit(c, 'state', participantState(s, hb)); });
        return send(res, 200, { pid, recovery: rec });
      }
      if (act === 'recover') {
        if (tooMany('recover', req, 20, 600000)) return send(res, 429, { error: 'too_many_attempts' });
        const rec = clean(body.recovery, 10).toUpperCase();
        const q = Object.values(s.participants).find(x => x.recovery === rec);
        if (!q) noteFail('recover', req, 600000);
        return q ? send(res, 200, { pid: q.pid, recovery: q.recovery }) : send(res, 404, { error: 'code_not_found' });
      }
      const pid = clean(body.pid, 40);
      if (!s.participants[pid]) return send(res, 401, { error: 'not_joined' });
      const a = currentActivity(s);
      if (act === 'view') {
        if (!a || a.id !== body.activityId) return send(res, 409, { error: 'not_current' });
        const key = a.id + '|' + pid;
        if (!s.views[key]) { s.views[key] = { pid, activityId: a.id, at: Date.now() }; save(); pushHosts(s); }
        return send(res, 200, { ok: true, at: s.views[key].at });
      }
      if (act === 'respond') {
        if (!a || a.id !== body.activityId) return send(res, 409, { error: 'not_current' });
        if (s.state.phase !== 'open') return send(res, 409, { error: s.state.phase === 'paused' ? 'paused' : 'closed' });
        const key = a.id + '|' + pid;
        if (s.responses[key] && !a.allowChange) return send(res, 200, { ok: true, duplicate: true, at: s.responses[key].at });
        const r = { pid, activityId: a.id, at: Date.now() };
        if (a.kind === 'onboard') {
          const ans = {}; (a.fields || []).forEach(f => { ans[f.id] = clean((body.answers || {})[f.id], 80); });
          if ((a.fields || []).some(f => !ans[f.id])) return send(res, 400, { error: 'answer_all' });
          r.answers = ans;
        } else if (a.kind === 'interest') {
          const opt = (a.options || []).find(o => o.id === body.choice);
          if (!opt) return send(res, 400, { error: 'bad_choice' });
          r.choice = opt.id;
          const email = clean(body.email, 120);
          if (opt.id !== 'notnow' && email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return send(res, 400, { error: 'bad_email' }); r.email = email; }
          const co = clean(body.company, 80); if (opt.id !== 'notnow' && co) r.company = co;
          const pb = clean(body.problem, 400); if (opt.id !== 'notnow' && pb) r.problem = pb;
          const uses = (Array.isArray(body.uses) ? body.uses : []).filter(id => (a.uses || []).some(u => u.id === id)).slice(0, 10);
          if (opt.id !== 'notnow' && uses.length) r.uses = Array.from(new Set(uses));
        } else {
          const opt = (a.options || []).find(o => o.id === body.choice);
          if (!opt) return send(res, 400, { error: 'bad_choice' });
          r.choice = opt.id;
          if (a.askReason) { const rs = (a.reasons || []).find(o => o.id === body.reason); if (!rs) return send(res, 400, { error: 'reason_required' }); r.reason = rs.id; }
          r.note = clean(body.note, 140);
          if (a.second) { const so = (a.second.options || []).find(o => o.id === body.second); if (!so) return send(res, 400, { error: 'second_required' }); r.answers = { [a.second.id]: so.id }; }
        }
        if (!s.views[key]) s.views[key] = { pid, activityId: a.id, at: r.at };
        s.responses[key] = r; s.lastResponseAt = r.at; save(); pushHosts(s);
        return send(res, 200, { ok: true, at: r.at });
      }
    }

    // host + screen API
    m = p.match(/^\/api\/host\/(login|sessions)$/);
    if (m && req.method === 'POST' && m[1] === 'login') {
      const body = await readJson(req);
      if (tooMany('login', req, 10, 600000)) return send(res, 429, { error: 'too_many_attempts' });
      if (!safeEq(body.password || '', PASS)) { noteFail('login', req, 600000); return send(res, 401, { error: 'wrong_password' }); }
      tries.delete('login|' + clientIp(req));
      const secure = (req.headers['x-forwarded-proto'] || '') === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', 'hl_host=' + hostToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400' + secure);
      return send(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/screen\/([A-Za-z0-9]+)\/stream$/);
    if (m && req.method === 'GET') {
      const s = db.sessions[m[1].toUpperCase()];
      if (!s || !(isHost(req) || safeEq(url.searchParams.get('k') || '', s.screenKey))) return send(res, 401, { error: 'unauthorised' });
      return addStream(req, res, s, 'h', null, c => emit(c, 'host', redact(hostView(s))), true);
    }
    if (p.startsWith('/api/host/')) {
      if (!isHost(req)) return send(res, 401, { error: 'unauthorised' });
      if (p === '/api/host/sessions' && req.method === 'GET') return send(res, 200, Object.values(db.sessions).sort((a, b) => b.createdAt - a.createdAt).map(s => ({ code: s.code, name: s.name, status: s.status, privacy: s.privacy, createdAt: s.createdAt, joined: Object.keys(s.participants).length, responses: Object.keys(s.responses).length })));
      if (p === '/api/host/sessions' && req.method === 'POST') { const b = await readJson(req); const s = newSession(b.name, b.privacy, b.audience); return send(res, 200, { code: s.code }); }
      m = p.match(/^\/api\/host\/s\/([A-Za-z0-9]+)\/(view|stream|action|activities|export|delete)$/);
      if (!m) return send(res, 404, { error: 'not_found' });
      const s = db.sessions[m[1].toUpperCase()];
      if (!s) return send(res, 404, { error: 'session_not_found' });
      if (m[2] === 'view' && req.method === 'GET') return send(res, 200, hostView(s));
      if (m[2] === 'stream' && req.method === 'GET') return addStream(req, res, s, 'h', null, c => emit(c, 'host', hostView(s)));
      if (m[2] === 'export' && req.method === 'GET') {
        const t = url.searchParams.get('type') || 'responses';
        if (t === 'activities') return send(res, 200, s.activities);
        if (t === 'all') { // everything the server holds for this session, in one file
          const winners = {}; s.activities.forEach(a => { const r = activityResults(s, a); if (r.firstTimedFinisher) winners[a.id + ' (fastest to finish)'] = { name: r.firstTimedFinisher.label, cohort: r.firstTimedFinisher.cohort, seconds: r.firstTimedFinisher.seconds }; if (r.firstCorrect) winners[a.id + ' (first correct)'] = { name: r.firstCorrect.label, seconds: r.firstCorrect.seconds, everyone_correct_in_order: r.correctList }; });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + s.code + '-everything.json"', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ exportedAt: new Date().toISOString(), session: { code: s.code, name: s.name, privacy: s.privacy, createdAt: s.createdAt, audience: s.audience || 0 }, winners, participants: s.participants, views: s.views, responses: s.responses, activities: s.activities, results: s.activities.map(a => activityResults(s, a)) }, null, 1));
        }
        const body = t === 'leads' ? exportLeads(s) : t === 'participants' ? exportParticipants(s) : t === 'summary' ? exportSummary(s) : exportResponses(s);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + s.code + '-' + t + '.csv"', 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      const b = await readJson(req);
      if (m[2] === 'delete') { delete db.sessions[s.code]; save(); return send(res, 200, { ok: true }); }
      if (m[2] === 'activities') {
        const err = validActivities(b.activities); if (err) return send(res, 400, { error: err });
        s.activities = b.activities; if (!s.activities.find(a => a.id === s.state.activityId)) s.state = { activityId: null, phase: 'idle', at: Date.now() };
        save(); pushParticipants(s); pushHosts(s); return send(res, 200, { ok: true });
      }
      if (m[2] === 'action') {
        const ids = s.activities.map(a => a.id); const i = ids.indexOf(s.state.activityId);
        const setPhase = (ph, id) => { s.state = { activityId: id === undefined ? s.state.activityId : id, phase: ph, at: Date.now() }; };
        switch (b.action) {
          case 'open': if (!ids.includes(b.activityId)) return send(res, 400, { error: 'bad_activity' }); setPhase('open', b.activityId); s.status = 'live'; break;
          case 'next': if (i + 1 >= ids.length) return send(res, 400, { error: 'no_next' }); setPhase('open', ids[i + 1]); s.status = 'live'; break;
          case 'prev': if (i <= 0) return send(res, 400, { error: 'no_prev' }); setPhase('open', ids[i - 1]); break;
          case 'pause': if (s.state.phase === 'open') setPhase('paused'); break;
          case 'resume': if (s.state.phase === 'paused' || s.state.phase === 'closed') setPhase('open'); break;
          case 'close': if (['open', 'paused'].includes(s.state.phase)) setPhase('closed'); break;
          case 'reveal': if (s.state.activityId) setPhase('revealed'); break;
          case 'idle': setPhase('idle', null); break;
          case 'audience': s.audience = Math.max(0, Math.min(5000, parseInt(b.audience, 10) || 0)); break;
          case 'end': s.status = 'ended'; setPhase('ended', null); break;
          case 'slide': s.slide = { idx: Math.max(0, Math.min(60, parseInt(b.idx, 10) || 0)), step: Math.max(0, Math.min(10, parseInt(b.step, 10) || 0)), total: Math.max(0, Math.min(80, parseInt(b.total, 10) || 0)), ov: b.ov ? 1 : 0 }; break;
          default: return send(res, 400, { error: 'bad_action' });
        }
        save(); pushParticipants(s); pushHosts(s); return send(res, 200, { ok: true, state: s.state });
      }
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (!res.headersSent) send(res, e.message === 'bad json' || e.message === 'too large' ? 400 : 500, { error: e.message === 'bad json' || e.message === 'too large' ? e.message : 'server_error' });
    if (e.message !== 'bad json' && e.message !== 'too large') console.error(e);
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log('Human Layer companion on :' + PORT));
