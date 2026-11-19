'use strict';
/* Server and reminder tests. Run: npm test (no network, no API key: Claude is mocked). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMock } = require('./mock-claude');
const { buildReminder } = require('../server/reminder');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ffsa-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
let proc, mock;

before(async () => {
  mock = createMock();
  await new Promise(r => mock.server.listen(0, r));
  const env = Object.assign({}, process.env, { DATA_DIR: DATA, PORT: String(PORT), ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'mock-model', ANTHROPIC_BASE_URL: `http://localhost:${mock.server.address().port}`, APP_PASSWORD: '' });
  const s = spawnSync(process.execPath, [path.join(ROOT, 'server/seed.js'), '--force'], { env, encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr);
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(async () => {
  if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); proc.kill(); });
  mock && mock.server.close();
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const j = (p, o) => fetch(BASE + p, o).then(async r => ({ status: r.status, body: await r.json() }));
const send = (method, p, body) => j(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('serves the app with the shim injected', async () => {
  const html = await fetch(BASE + '/').then(r => r.text());
  assert.match(html, /<script src="\/claude-shim.js"><\/script>/);
  assert.match(html, /<title>FFSA Fleet<\/title>/);
});

test('reads the seeded data, with where / orderBy / limit', async () => {
  const all = await j('/api/db/fleet');
  assert.equal(all.body.docs.length, 6);
  const q = encodeURIComponent(JSON.stringify({ where: [['status', '==', 'booked']] }));
  const booked = await j('/api/db/records?q=' + q);
  assert.deepEqual(booked.body.docs.map(d => d.id).sort(), ['r-bk-crv', 'r-bk-kombi', 'r-bk-kph', 'r-bk-kvs']);
  const q2 = encodeURIComponent(JSON.stringify({ where: [['vehicleId', '==', 'h1-1']], orderBy: 'date', dir: 'desc', limit: 2 }));
  const h1 = await j('/api/db/records?q=' + q2);
  assert.deepEqual(h1.body.docs.map(d => d.data.date), ['2026-11-23', '2026-10-16']);
  const cfg = await j('/api/db/config/schedule');
  assert.deepEqual(cfg.body.data.weeklyOnly, ['2026-11-16', '2026-11-23']);
});

test('update deep-merges into an existing document and refuses a missing one', async () => {
  await send('PUT', '/api/db/fleet/zz-test', { name: 'Test', cardPrinted: { date: '2026-01-01', sig: 'abc', stale: false }, tags: [1, 2] });
  await send('PATCH', '/api/db/fleet/zz-test', { cardPrinted: { stale: true }, tags: [3], gone: { __delete__: true } });
  const d = (await j('/api/db/fleet/zz-test')).body.data;
  assert.deepEqual(d.cardPrinted, { date: '2026-01-01', sig: 'abc', stale: true });
  assert.deepEqual(d.tags, [3]);
  const miss = await send('PATCH', '/api/db/fleet/does-not-exist', { a: 1 });
  assert.equal(miss.status, 400);
  assert.equal(miss.body.error.code, 'invalid_argument');
  await send('DELETE', '/api/db/fleet/zz-test');
  assert.equal((await j('/api/db/fleet/zz-test')).body.exists, false);
});

test('streams live changes', async () => {
  const ac = new AbortController();
  const res = await fetch(BASE + '/api/stream', { signal: ac.signal });
  const reader = res.body.getReader();
  const got = (async () => { let s = ''; for (;;) { const { value } = await reader.read(); s += new TextDecoder().decode(value); if (s.includes('"coll":"trips"')) return s; } })();
  await new Promise(r => setTimeout(r, 100));
  await send('PUT', '/api/db/trips/t-live', { vehicleId: 'h1-2', from: '2026-12-01', to: '2026-12-02', label: 'Test' });
  const s = await got; ac.abort();
  assert.match(s, /"id":"t-live"/);
  await send('DELETE', '/api/db/trips/t-live');
});

test('stores, serves and deletes photos; refuses other types', async () => {
  const jpg = fs.readFileSync(path.join(ROOT, 'seed/files/fb85e952431347f5055c26827cacfda2.jpg'));
  const up = await j('/api/assets', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpg });
  assert.equal(up.status, 200);
  assert.match(up.body.id, /^[0-9a-f]{32}$/);
  const got = await fetch(BASE + up.body.url);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.equal((await got.arrayBuffer()).byteLength, jpg.length);
  assert.equal((await send('DELETE', '/api/assets/' + up.body.id)).body.deleted, true);
  assert.equal((await fetch(BASE + up.body.url)).status, 404);
  const bad = await j('/api/assets', { method: 'POST', headers: { 'content-type': 'text/html' }, body: '<p>x</p>' });
  assert.equal(bad.body.error.code, 'unsupported_type');
  const seeded = await fetch(BASE + '/_blob/56d4100116c53353b3c6ece384418ba2');
  assert.equal(seeded.headers.get('content-type'), 'application/pdf');
});

test('Ask: proxies one round to Claude and streams it back', async () => {
  const r = await fetch(BASE + '/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'How many vehicles?' }] }) });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /content_block_delta/);
  const sent = mock.calls[mock.calls.length - 1];
  assert.equal(sent.model, 'mock-model');
  assert.equal(sent.stream, true);
});

test('reminder for Tue 17 Nov 2026 matches the scheduled task', () => {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  const r = buildReminder(data, '2026-11-17', { appUrl: 'X' });
  assert.equal(r.subject, 'FFSA inspections – Tuesday, 17 Nov: 2 due today');
  assert.deepEqual(r.sections.today, ['Hyundai H1 #1 (KVS 119 NW) – weekly check', 'Hyundai H1 #2 (JYD 637 NW) – weekly check']);
  assert.deepEqual(r.sections.tomorrow, ['Hyundai H1 #3 (KPH 387 NW) – weekly check', 'VW Kombi (KLK 556 NW) – weekly check']);
  assert.equal(r.sections.in2.length, 0);
  assert.equal(r.sections.postponed.length, 2);
  assert.match(r.sections.workshop[0], /Honda CR-V .*Motech, tomorrow/);
  assert.equal(r.sections.cards.length, 0, 'in-car guides only on Mondays');
});

test('reminder: monthly checks come back in the week of 30 Nov', () => {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  const r = buildReminder(data, '2026-12-01');
  assert.ok(r.sections.today.every(l => l.endsWith('monthly check')), r.sections.today.join('\n'));
});

test('reminder: km rules (inspection every 5000, service every 10000, combined visit, booked as inspection only)', () => {
  const base = { config: { schedule: { assign: {} } }, trips: {}, records: {} };
  const v = (extra) => Object.assign({ name: 'Van', reg: 'X', status: 'In service' }, extra);
  // inspection due on its own: last service 100 000, B2B at 105 000 -> service at 110 000, B2B at 110 000 -> combined
  let r = buildReminder(Object.assign({}, base, { fleet: { a: v({ odometer: 109600, lastService: { km: 100000 }, lastB2B: { km: 105000 } }) } }), '2026-11-17');
  assert.deepEqual(r.sections.km, ['Van (X): Service and bumper-to-bumper inspection due in 400 km (at 110 000 km), book it at the workshop']);
  // only the inspection: last service 100 000, odometer 104 700 -> B2B at 105 000
  r = buildReminder(Object.assign({}, base, { fleet: { a: v({ odometer: 104700, lastService: { km: 100000 } }) } }), '2026-11-17');
  assert.deepEqual(r.sections.km, ['Van (X): Bumper-to-bumper inspection due in 300 km (at 105 000 km), book it at the workshop']);
  // overdue
  r = buildReminder(Object.assign({}, base, { fleet: { a: v({ odometer: 105200, lastService: { km: 100000 } }) } }), '2026-11-17');
  assert.match(r.sections.km[0], /overdue by 200 km/);
  // combined visit booked as an inspection only
  r = buildReminder(Object.assign({}, base, { fleet: { a: v({ odometer: 109800, lastService: { km: 100000 }, lastB2B: { km: 105000 }, followUp: { date: '2026-11-20', kind: 'Workshop inspection (bumper to bumper)' } }) } }), '2026-11-17');
  assert.match(r.sections.km[0], /booked 20 Nov as an inspection only: ask for a service too/);
  // booked as a service: nothing to say
  r = buildReminder(Object.assign({}, base, { fleet: { a: v({ odometer: 109800, lastService: { km: 100000 }, lastB2B: { km: 105000 }, followUp: { date: '2026-11-20', kind: 'Service' } }) } }), '2026-11-17');
  assert.equal(r.sections.km.length, 0);
});

test('reminder: clashes and double bookings', () => {
  const data = {
    config: { schedule: { assign: {} } },
    fleet: { a: { name: 'Van', reg: 'X', status: 'In service' } },
    records: { r1: { vehicleId: 'a', status: 'booked', kind: 'Service', date: '2026-11-20', until: '2026-11-21' } },
    trips: { t1: { vehicleId: 'a', from: '2026-11-21', to: '2026-11-25', label: 'HULC' }, t2: { vehicleId: 'a', from: '2026-11-24', to: '2026-11-26', label: 'Rental' } },
  };
  const r = buildReminder(data, '2026-11-17');
  assert.equal(r.sections.clashes.length, 2);
  assert.match(r.sections.clashes[0], /Service \(20 Nov – 21 Nov\) clashes with HULC/);
  assert.match(r.sections.clashes[1], /double booked, HULC .* and Rental/);
});
