'use strict';
/*
 * FFSA Fleet: standalone server.
 *
 * Runs the FFSA Fleet app (app/ffsa-fleet.html, unchanged from claude.ai) outside claude.ai by
 * giving it what claude.ai gave it: a database, file storage, a user, and Claude for "Ask".
 * The browser side of that is public/claude-shim.js, which implements window.claude.use(...)
 * on top of the HTTP API below.
 *
 *   GET    /                         the app, with the shim injected
 *   GET    /api/config               who is signed in, whether Ask is on
 *   GET    /api/db/:coll?q=<json>    query a collection  q = {where, orderBy, dir, limit}
 *   GET    /api/db/:coll/:id         read a document      -> {exists, data}
 *   PUT    /api/db/:coll/:id         replace a document (set)
 *   PATCH  /api/db/:coll/:id         deep-merge into an existing document (update)
 *   DELETE /api/db/:coll/:id         delete a document
 *   GET    /api/stream               Server-Sent Events: {coll, id, op} on every change
 *   POST   /api/assets               upload a photo or PDF (raw body, Content-Type header)
 *   GET    /api/assets               list uploaded files
 *   DELETE /api/assets/:id           delete an uploaded file
 *   GET    /_blob/:id                serve an uploaded file
 *   POST   /api/claude               Ask: one round to the Claude Messages API (streamed back)
 *
 * No dependencies: Node 18+ only. Settings come from environment variables or a .env file
 * (see .env.example).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./store');

const ROOT = path.join(__dirname, '..');
loadEnv(path.join(ROOT, '.env'));

const CFG = {
  port: Number(process.env.PORT || 8787),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  password: process.env.APP_PASSWORD || '',
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
  models: {
    default: process.env.ANTHROPIC_MODEL || '',
    quick: process.env.ANTHROPIC_MODEL_QUICK || process.env.ANTHROPIC_MODEL || '',
    complex: process.env.ANTHROPIC_MODEL_COMPLEX || process.env.ANTHROPIC_MODEL || '',
  },
  claudePerMin: Number(process.env.CLAUDE_MAX_PER_MIN || 20),
  maxUpload: 20 * 1024 * 1024,
};
const ASK_ON = !!(CFG.apiKey && CFG.models.default);

const store = new Store(CFG.dataDir);
const BLOB_DIR = path.join(CFG.dataDir, 'blobs');
fs.mkdirSync(BLOB_DIR, { recursive: true });
const BLOB_INDEX = path.join(BLOB_DIR, 'index.json');
let blobs = fs.existsSync(BLOB_INDEX) ? JSON.parse(fs.readFileSync(BLOB_INDEX, 'utf8')) : {};
const saveBlobs = () => { fs.writeFileSync(BLOB_INDEX + '.tmp', JSON.stringify(blobs, null, 1)); fs.renameSync(BLOB_INDEX + '.tmp', BLOB_INDEX); };
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'];

const APP_FILE = path.join(ROOT, 'app', 'ffsa-fleet.html');
const SHIM_FILE = path.join(ROOT, 'public', 'claude-shim.js');
function appHtml() {
  const html = fs.readFileSync(APP_FILE, 'utf8');
  return html.replace(/(<meta charset="utf-8">)/i, '$1\n<script src="/claude-shim.js"></script>');
}

/* ---------- helpers ---------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(data);
}
const fail = (res, status, code, message) => send(res, status, { error: { code, message } });
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Too large'), { status: 413, code: 'too_large' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 1024 * 1024) {
  const b = await readBody(req, limit);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error('Body is not valid JSON.'), { status: 400, code: 'invalid_argument' }); }
}

/* ---------- who is signed in ----------
 * With APP_PASSWORD set, the browser asks for a name and the password (HTTP Basic auth).
 * The name becomes the user id. In the Hub, use the Hub's own sign-in instead. */
function whoIs(req) {
  if (!CFG.password) return { id: 'u_local', name: process.env.APP_USER_NAME || 'Vehicle co-ordinator' };
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
  if (!m) return null;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  const pass = rest.join(':');
  const a = Buffer.from(pass), b = Buffer.from(CFG.password);
  if (!user || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: 'u_' + user.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: user };
}

/* ---------- live updates ---------- */
const streams = new Set();
store.on('change', ev => { const line = `data: ${JSON.stringify(ev)}\n\n`; for (const s of streams) s.write(line); });
setInterval(() => { for (const s of streams) s.write(': ping\n\n'); }, 25000).unref();

/* ---------- Ask rate limit (per user, per minute) ---------- */
const askHits = new Map();
function askAllowed(uid) {
  const now = Date.now(); const list = (askHits.get(uid) || []).filter(t => now - t < 60000);
  if (list.length >= CFG.claudePerMin) { askHits.set(uid, list); return false; }
  list.push(now); askHits.set(uid, list); return true;
}

const SYSTEM = 'You are Claude, answering inside the FFSA Fleet web app. The first user turn holds the app\'s standing instructions and its live data; follow them. You can only use the tools the app offers.';

async function claudeRound(req, res, me) {
  if (!ASK_ON) return fail(res, 503, 'not_declared', 'Ask is off: set ANTHROPIC_API_KEY and ANTHROPIC_MODEL.');
  if (!askAllowed(me.id)) return fail(res, 429, 'rate_limited', 'Too many questions in a minute.');
  const body = await readJson(req, 2 * 1024 * 1024);
  const tier = ['quick', 'complex'].includes(body.tier) ? body.tier : 'default';
  const payload = {
    model: CFG.models[tier],
    max_tokens: Math.min(Number(body.max_tokens) || 4096, 8192),
    system: SYSTEM,
    messages: body.messages,
    stream: true,
  };
  if (!Array.isArray(body.messages) || !body.messages.length) return fail(res, 400, 'invalid_request', 'messages is required.');
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  if (payload.tools && body.tool_choice) payload.tool_choice = body.tool_choice;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let up;
  try {
    up = await fetch(CFG.baseUrl + '/v1/messages', {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': CFG.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if (ac.signal.aborted) return;
    return fail(res, 502, 'upstream_error', 'Could not reach Claude: ' + e.message);
  }
  if (!up.ok) {
    const text = await up.text().catch(() => '');
    const code = up.status === 429 || up.status === 529 ? 'rate_limited' : up.status === 413 || /prompt is too long/i.test(text) ? 'prompt_too_large' : up.status === 401 || up.status === 403 ? 'sampling_disabled' : 'upstream_error';
    console.error('[ask] Claude API error', up.status, text.slice(0, 500));
    return fail(res, up.status === 429 ? 429 : 502, code, `Claude API ${up.status}`);
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  try {
    for await (const chunk of up.body) res.write(chunk);
  } catch (e) { /* client went away or upstream dropped */ }
  res.end();
}

/* ---------- router ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const me = whoIs(req);
  if (!me) return send(res, 401, 'Sign in required.', { 'WWW-Authenticate': 'Basic realm="FFSA Fleet", charset="UTF-8"' });

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, appHtml(), { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.method === 'GET' && p === '/claude-shim.js') return send(res, 200, fs.readFileSync(SHIM_FILE, 'utf8'), { 'Content-Type': 'text/javascript; charset=utf-8' });
  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && p === '/api/config') return send(res, 200, { user: me, ask: ASK_ON, tiers: ['default', 'quick', 'complex'] });

  let m;
  if ((m = p.match(/^\/api\/db\/([^/]+)$/)) && req.method === 'GET') {
    let q = {};
    try { q = JSON.parse(url.searchParams.get('q') || '{}'); } catch (e) { return fail(res, 400, 'invalid_argument', 'q is not valid JSON.'); }
    return send(res, 200, { docs: store.query(decodeURIComponent(m[1]), q) });
  }
  if ((m = p.match(/^\/api\/db\/([^/]+)\/([^/]+)$/))) {
    const coll = decodeURIComponent(m[1]), id = decodeURIComponent(m[2]);
    if (req.method === 'GET') { const d = store.get(coll, id); return send(res, 200, { exists: !!d, data: d }); }
    if (req.method === 'PUT') { store.set(coll, id, await readJson(req)); return send(res, 200, { ok: true }); }
    if (req.method === 'PATCH') { store.update(coll, id, await readJson(req)); return send(res, 200, { ok: true }); }
    if (req.method === 'DELETE') { store.delete(coll, id); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    streams.add(res); req.on('close', () => streams.delete(res));
    return;
  }
  if (p === '/api/assets' && req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!UPLOAD_TYPES.includes(type)) return fail(res, 415, 'unsupported_type', `Can't store ${type || 'that file type'}.`);
    const buf = await readBody(req, CFG.maxUpload);
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(BLOB_DIR, id), buf);
    blobs[id] = { contentType: type, sizeBytes: buf.length, createdAt: new Date().toISOString(), by: me.id };
    saveBlobs();
    return send(res, 200, { id, url: '/_blob/' + id, sizeBytes: buf.length, contentType: type });
  }
  if (p === '/api/assets' && req.method === 'GET') {
    const assets = Object.entries(blobs).map(([id, b]) => ({ id, url: '/_blob/' + id, contentType: b.contentType, sizeBytes: b.sizeBytes, createdAt: b.createdAt }));
    return send(res, 200, { assets, usage: { files: assets.length, bytes: assets.reduce((n, a) => n + a.sizeBytes, 0), maxFiles: 5000, maxBytes: 1024 ** 3 } });
  }
  if ((m = p.match(/^\/api\/assets\/([0-9a-f]{32})$/)) && req.method === 'DELETE') {
    const had = !!blobs[m[1]];
    if (had) { delete blobs[m[1]]; saveBlobs(); fs.rmSync(path.join(BLOB_DIR, m[1]), { force: true }); }
    return send(res, 200, { deleted: had });
  }
  if ((m = p.match(/^\/_blob\/([0-9a-f]{32})$/)) && req.method === 'GET') {
    const b = blobs[m[1]];
    if (!b) return send(res, 404, 'Not found');
    return send(res, 200, fs.readFileSync(path.join(BLOB_DIR, m[1])), { 'Content-Type': b.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' });
  }
  if (p === '/api/claude' && req.method === 'POST') return claudeRound(req, res, me);

  return send(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (!err.status) console.error(err);
    if (!res.headersSent) fail(res, err.status || 500, err.code || 'internal', err.message);
    else res.end();
  });
});

if (require.main === module) {
  server.listen(CFG.port, () => {
    console.log(`FFSA Fleet running on http://localhost:${CFG.port}`);
    console.log(`  data: ${CFG.dataDir}  (${store.collections().length ? store.collections().join(', ') : 'empty: run npm run seed'})`);
    console.log(`  Ask: ${ASK_ON ? 'on (' + CFG.models.default + ')' : 'off (set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in .env)'}`);
    console.log(`  sign-in: ${CFG.password ? 'password required' : 'none (set APP_PASSWORD to require one)'}`);
  });
  const stop = () => { store.flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { server, store };
