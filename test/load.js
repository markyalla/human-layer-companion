'use strict';
// Load / capacity measurement on one machine with synthetic phones. Not a real-network test. TEST DATA ONLY.
const { spawn, execSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const N = parseInt(process.argv[2] || '300', 10), SSE = Math.min(N, parseInt(process.argv[3] || String(N), 10));
const PORT = 7600 + Math.floor(Math.random() * 300), PASS = 'loadtest-pass';
const agent = new http.Agent({ keepAlive: true, maxSockets: 400 });
const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : 0; };
const rq = (m, p, b, ck) => new Promise(res => { const t0 = process.hrtime.bigint(); const d = b ? JSON.stringify(b) : null; const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, agent, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}), ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}) } }, rs => { let t = ''; rs.on('data', c => t += c); rs.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} res({ status: rs.statusCode, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6, headers: rs.headers }); }); }); rq_err(r, res); if (d) r.write(d); r.end(); });
function rq_err(r, res) { r.on('error', e => res({ status: 0, json: {}, ms: 0 })); }
const pool = async (items, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const rss = pid => { try { return Math.round(parseInt(fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024); } catch (e) { return -1; } };
const cpu = pid => { try { const f = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(' '); return (parseInt(f[13]) + parseInt(f[14])) / 100; } catch (e) { return 0; } };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-load-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, ORGANISER_PASSWORD: PASS, DATA_DIR: dir }, stdio: 'pipe' });
  await new Promise(r => srv.stdout.on('data', d => String(d).includes('on :') && r()));
  const out = { N, SSE, rssStart: rss(srv.pid) };
  const lg = await rq('POST', '/api/host/login', { password: PASS }); const ck = lg.headers['set-cookie'][0].split(';')[0];
  const code = (await rq('POST', '/api/host/sessions', { name: 'TEST load', privacy: 'named' }, ck)).json.code;
  const key = (await rq('GET', '/api/host/s/' + code + '/view', null, ck)).json.screenKey;
  // projector + organiser streams
  let submitted = 0, tDone = null, tVote0 = null; const sc = http.get({ host: '127.0.0.1', port: PORT, path: '/api/screen/' + code + '/stream?k=' + key }, rs => { let buf = ''; rs.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/data: (.*)/); if (m) try { const v = JSON.parse(m[1]); const r = v.currentResults; if (r && r.id === 'jobA' && r.submitted >= N && !tDone) tDone = Date.now(); } catch (e) {} } }); });
  const hs = http.get({ host: '127.0.0.1', port: PORT, path: '/api/host/s/' + code + '/stream', headers: { Cookie: ck } }, rs => rs.on('data', () => {}));
  // joins
  const t0 = Date.now(); const joins = await pool(Array.from({ length: N }), 60, (_, i) => rq('POST', '/api/s/' + code + '/join', { consent: true, name: 'P' + i }));
  out.joinOk = joins.filter(j => j.status === 200).length; out.joinSeconds = (Date.now() - t0) / 1000; out.joinP50 = Math.round(pct(joins.map(j => j.ms), 0.5)); out.joinP95 = Math.round(pct(joins.map(j => j.ms), 0.95));
  const P = joins.filter(j => j.status === 200).map(j => j.json.pid);
  // phones' live streams
  let evCount = 0; const streams = P.slice(0, SSE).map(pid => http.get({ host: '127.0.0.1', port: PORT, path: '/api/s/' + code + '/stream?pid=' + pid }, rs => rs.on('data', () => { evCount++; })));
  await new Promise(r => setTimeout(r, 1500)); out.rssAfterJoin = rss(srv.pid);
  // open the vote, everyone views and answers at once (burst)
  await rq('POST', '/api/host/s/' + code + '/action', { action: 'open', activityId: 'jobA' }, ck);
  await pool(P, 100, pid => rq('POST', '/api/s/' + code + '/view', { pid, activityId: 'jobA' }));
  const cpu0 = cpu(srv.pid); const w0 = Date.now(); tVote0 = Date.now();
  const ch = ['ama', 'kofi', 'yaw', 'efua', 'selorm'];
  const votes = await Promise.all(P.map((pid, i) => rq('POST', '/api/s/' + code + '/respond', { pid, activityId: 'jobA', choice: ch[i % 5], reason: 'gut' })));
  const burstSec = (Date.now() - w0) / 1000;
  out.voteOk = votes.filter(v => v.status === 200).length; out.voteErr = votes.length - out.voteOk; out.voteP50 = Math.round(pct(votes.map(v => v.ms), 0.5)); out.voteP95 = Math.round(pct(votes.map(v => v.ms), 0.95)); out.voteMax = Math.round(Math.max(...votes.map(v => v.ms))); out.burstSeconds = +burstSec.toFixed(2);
  for (let i = 0; i < 100 && !tDone; i++) await new Promise(r => setTimeout(r, 100));
  out.projectorCaughtUpMsAfterLastVote = tDone ? tDone - (w0 + burstSec * 1000) : null; out.projectorSawAllVotes = !!tDone;
  const hv = (await rq('GET', '/api/host/s/' + code + '/view', null, ck)).json; out.serverCounted = hv.currentResults.submitted;
  out.cpuSecondsDuringBurst = +(cpu(srv.pid) - cpu0).toFixed(2); out.rssAfterBurst = rss(srv.pid); out.eventsPushedToPhones = evCount;
  const t1 = Date.now(); const ex = await rq('POST', '/api/host/s/' + code + '/action', { action: 'close', activityId: 'jobA' }, ck); out.closeMs = Date.now() - t1;
  const t2 = Date.now(); const csvr = await new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: '/api/host/s/' + code + '/export?type=responses', headers: { Cookie: ck }, agent }, rs => { let n = 0; rs.on('data', c => n += c.length); rs.on('end', () => res(n)); })); out.exportMs = Date.now() - t2; out.exportBytes = csvr;
  const dbf = path.join(dir, 'db.json'); out.dbBytes = fs.existsSync(dbf) ? fs.statSync(dbf).size : 0;
  console.log(JSON.stringify(out)); streams.forEach(s => s.destroy()); sc.destroy(); hs.destroy(); srv.kill(); process.exit(0);
})();
