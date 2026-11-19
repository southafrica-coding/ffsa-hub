/*
 * claude-shim.js: runs the FFSA Fleet app outside claude.ai.
 *
 * On claude.ai the app gets its database, file storage, user, downloads, Claude ("Ask") and
 * dictation from `window.claude.use(name)`. This file provides the same calls on top of the
 * standalone server (server/server.js), so the app file itself stays unchanged.
 *
 *   db         Firestore-like: collection/doc/where/orderBy/limit/get/onSnapshot/set/update/delete
 *              Live updates come from the server over Server-Sent Events (/api/stream).
 *   assets     upload/list/delete photos and PDFs; served at /_blob/<id>
 *   user       id/name/can/profiles (from /api/config)
 *   downloads  save({filename, data}) -> browser download
 *   sample     Claude with page tools (the tool-use loop runs here, in the page; each round
 *              goes through POST /api/claude, which holds the API key)
 *   dictation  speech to text with the browser's Web Speech API, where the browser has it
 *
 * When the module moves into the Hub, replace these with the Hub's own services (see CLAUDE.md).
 */
(function () {
  'use strict';
  if (window.claude && window.claude.use) return;

  const json = r => r.json().catch(() => ({}));
  const cfgP = fetch('/api/config', { credentials: 'same-origin' }).then(json).catch(() => ({ user: { id: 'u_local', name: '' }, ask: false }));
  const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});
  async function api(method, url, body, headers) {
    let r;
    try {
      r = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined ? headers : Object.assign({ 'Content-Type': 'application/json' }, headers), body: body === undefined ? undefined : (body instanceof Blob ? body : JSON.stringify(body)) });
    } catch (e) { throw err('unavailable', 'The server can\'t be reached.'); }
    const out = await json(r);
    if (!r.ok) {
      const e = out.error || {};
      throw err(e.code || (r.status === 401 || r.status === 403 ? 'permission_denied' : r.status === 413 ? 'too_large' : r.status === 429 ? 'rate_limited' : 'unavailable'), e.message || ('HTTP ' + r.status));
    }
    return out;
  }
  const enc = encodeURIComponent;
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  let seq = 0;
  const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 10);

  /* ---------------- db ---------------- */
  const listeners = new Set();
  let es = null, esOpened = false;
  function ensureStream() {
    if (es) return;
    es = new EventSource('/api/stream');
    es.onmessage = e => { let ev; try { ev = JSON.parse(e.data); } catch (x) { return; } refreshColl(ev.coll); };
    es.onopen = () => { if (esOpened) listeners.forEach(l => l.schedule()); esOpened = true; }; // after a reconnect, catch up
  }
  const refreshColl = coll => listeners.forEach(l => { if (l.coll === coll) l.schedule(); });

  function splitPath(p, even) {
    const segs = String(p).split('/').filter(Boolean);
    if (even ? segs.length !== 2 : segs.length !== 1) throw new TypeError('This standalone database supports top-level collections only: ' + p);
    return segs;
  }
  function docSnap(coll, id, data) {
    return { id, exists: data != null, data: () => (data == null ? undefined : JSON.parse(JSON.stringify(data))), get: f => (data == null ? undefined : data[f]), ref: docRef(coll, id), metadata: META };
  }
  function querySnap(coll, docs, prev) {
    const snaps = docs.map(d => docSnap(coll, d.id, d.data));
    const changes = () => {
      const before = new Map((prev || []).map((d, i) => [d.id, { d, i }]));
      const out = [];
      docs.forEach((d, i) => { const b = before.get(d.id); if (!b) out.push({ type: 'added', doc: snaps[i], oldIndex: -1, newIndex: i }); else if (JSON.stringify(b.d.data) !== JSON.stringify(d.data)) out.push({ type: 'modified', doc: snaps[i], oldIndex: b.i, newIndex: i }); });
      const now = new Set(docs.map(d => d.id));
      (prev || []).forEach((d, i) => { if (!now.has(d.id)) out.push({ type: 'removed', doc: docSnap(coll, d.id, d.data), oldIndex: i, newIndex: -1 }); });
      return out;
    };
    return { docs: snaps, size: snaps.length, empty: !snaps.length, metadata: META, forEach: f => snaps.forEach(f), docChanges: changes };
  }
  function subscribe(coll, fetchFn, makeSnap, next, error) {
    let last = null, dead = false, timer = null, running = false, again = false;
    const run = async () => {
      if (dead) return;
      if (running) { again = true; return; }
      running = true;
      try {
        const res = await fetchFn();
        const key = JSON.stringify(res);
        if (!dead && key !== last) { const prev = last ? JSON.parse(last) : null; last = key; try { next(makeSnap(res, prev)); } catch (e) { console.error(e); } }
      } catch (e) { if (!dead && error) try { error(e); } catch (x) { console.error(x); } }
      running = false;
      if (again) { again = false; run(); }
    };
    const l = { coll, schedule: () => { clearTimeout(timer); timer = setTimeout(run, 30); } };
    listeners.add(l); ensureStream(); setTimeout(run, 0);
    return () => { dead = true; clearTimeout(timer); listeners.delete(l); };
  }
  function query(coll, q) {
    const fetchDocs = () => api('GET', '/api/db/' + enc(coll) + (q.where.length || q.orderBy || q.limit ? '?q=' + enc(JSON.stringify(q)) : '')).then(r => r.docs);
    return {
      where: (f, op, v) => query(coll, Object.assign({}, q, { where: q.where.concat([[f, op, v]]) })),
      orderBy: (f, dir) => query(coll, Object.assign({}, q, { orderBy: f, dir: dir || 'asc' })),
      limit: n => query(coll, Object.assign({}, q, { limit: n })),
      get: async () => querySnap(coll, await fetchDocs(), null),
      onSnapshot: (next, error) => subscribe(coll, fetchDocs, (docs, prev) => querySnap(coll, docs, prev), next, error),
    };
  }
  function collRef(path) {
    const [coll] = splitPath(path, false);
    return Object.assign(query(coll, { where: [] }), {
      path: coll,
      doc: id => docRef(coll, id || newId()),
      add: async data => { const r = docRef(coll, newId()); await r.set(data); return r; },
    });
  }
  function docRef(coll, id) {
    const url = '/api/db/' + enc(coll) + '/' + enc(id);
    const fetchDoc = () => api('GET', url).then(r => (r.exists ? r.data : null));
    const write = async (method, body) => { await api(method, url, body); refreshColl(coll); };
    return {
      id, path: coll + '/' + id,
      get: async () => docSnap(coll, id, await fetchDoc()),
      set: data => write('PUT', data),
      update: data => write('PATCH', data),
      delete: () => write('DELETE'),
      onSnapshot: (next, error) => subscribe(coll, fetchDoc, d => docSnap(coll, id, d), next, error),
      collection: () => { throw new TypeError('Subcollections are not supported by the standalone database.'); },
    };
  }
  const db = { collection: collRef, doc: path => { const [c, id] = splitPath(path, true); return docRef(c, id); } };

  /* ---------------- assets ---------------- */
  const assets = {
    async upload(blob, options) {
      const type = (options && options.type) || blob.type;
      try { return await api('POST', '/api/assets', blob, { 'Content-Type': type || 'application/octet-stream' }); }
      catch (e) { throw err(['too_large', 'unsupported_type', 'rate_limited'].includes(e.code) ? e.code : 'upstream_error', e.message); }
    },
    list: () => api('GET', '/api/assets'),
    delete: ref => api('DELETE', '/api/assets/' + enc(String(ref).replace(/^.*\/_blob\//, ''))),
  };

  /* ---------------- user ---------------- */
  const user = {
    id: async () => (await cfgP).user.id,
    name: async () => (await cfgP).user.name || '',
    email: async () => null,
    avatarUrl: async () => null,
    isOwner: async () => true,
    canEdit: async () => true,
    can: async () => true,
    me: async () => { const u = (await cfgP).user; return { id: u.id, name: u.name || '', email: null, avatarUrl: null, isOwner: true, canEdit: true }; },
    profiles: async ids => { const u = (await cfgP).user; const out = {}; (ids || []).forEach(id => { out[id] = { id, name: id === u.id ? u.name : '', avatarUrl: null, isGuest: false }; }); return out; },
    search: async () => [],
  };

  /* ---------------- downloads ---------------- */
  const downloads = {
    async save({ filename, data }) {
      const b = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      return { status: 'saved' };
    },
  };

  /* ---------------- sample (Claude) ---------------- */
  const MAX_ROUNDS = 6;
  function toMessages(input) {
    const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : Array.from(input || []);
    const out = [];
    for (const t of turns) {
      const role = t.role === 'assistant' ? 'assistant' : 'user', text = String(t.content || '');
      if (!text.trim()) continue;
      const last = out[out.length - 1];
      if (last && last.role === role) last.content += '\n\n' + text; else out.push({ role, content: text });
    }
    return out;
  }
  async function round(body, signal, onDelta) {
    let r;
    try { r = await fetch('/api/claude', { method: 'POST', signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw err(signal && signal.aborted ? 'cancelled' : 'upstream_error', String(e && e.message || e)); }
    if (!r.ok) { const o = await json(r); throw err((o.error && o.error.code) || 'upstream_error', (o.error && o.error.message) || 'HTTP ' + r.status); }
    const blocks = []; let stop = null, buf = '';
    const reader = r.body.getReader(), dec = new TextDecoder();
    const onEvent = ev => {
      if (ev.type === 'content_block_start') blocks[ev.index] = Object.assign({}, ev.content_block, ev.content_block.type === 'tool_use' ? { _json: '' } : {});
      else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index]; if (!b) return;
        if (ev.delta.type === 'text_delta') { b.text = (b.text || '') + ev.delta.text; onDelta(ev.delta.text); }
        else if (ev.delta.type === 'input_json_delta') b._json += ev.delta.partial_json;
      } else if (ev.type === 'message_delta') stop = ev.delta && ev.delta.stop_reason;
      else if (ev.type === 'error') throw err(ev.error && /overloaded|rate/.test(ev.error.type) ? 'rate_limited' : 'upstream_error', ev.error && ev.error.message);
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
          if (data) onEvent(JSON.parse(data));
        }
      }
    } catch (e) { throw e.code ? e : err(signal && signal.aborted ? 'cancelled' : 'upstream_error', String(e && e.message || e)); }
    const content = blocks.filter(Boolean).map(b => {
      if (b.type === 'tool_use') { let input = {}; try { input = b._json ? JSON.parse(b._json) : (b.input || {}); } catch (e) {} return { type: 'tool_use', id: b.id, name: b.name, input }; }
      if (b.type === 'text') return { type: 'text', text: b.text || '' };
      return null;
    }).filter(b => b && !(b.type === 'text' && !b.text));
    return { content, stop };
  }
  async function sample(input, options) {
    options = options || {};
    const cfg = await cfgP;
    if (!cfg.ask) throw err('capability_disabled', 'Ask is off on this server.');
    const signal = options.signal;
    if (signal && signal.aborted) throw err('cancelled', 'Cancelled');
    const messages = toMessages(input);
    if (!messages.length || messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') throw err('invalid_request', 'Input must start and end with a user turn.');
    if (new Blob([messages.map(m => m.content).join('')]).size > 262144) throw err('prompt_too_large', 'Input is over 256 KiB.');
    const tools = (options.tools || []).slice(0, 20);
    const toolDefs = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    let full = '', emitted = 0, roundHasText = false, truncated = false;
    const onDelta = d => {
      if (!roundHasText && full) full += '\n\n';
      roundHasText = true; full += d;
      if (full.trim() && options.onText && !(signal && signal.aborted)) { const delta = full.slice(emitted); emitted = full.length; try { options.onText({ text: full, delta }); } catch (e) { console.error(e); } }
    };
    try {
      for (let n = 0; n < MAX_ROUNDS; n++) {
        roundHasText = false;
        const last = n === MAX_ROUNDS - 1;
        const body = { messages, tier: options.modelTier === 'quick' || options.modelTier === 'complex' ? options.modelTier : 'default' };
        if (toolDefs.length) { body.tools = toolDefs; if (last) body.tool_choice = { type: 'none' }; }
        const res = await round(body, signal, onDelta);
        if (res.stop === 'max_tokens') truncated = true;
        if (res.stop === 'refusal') throw err('refused', 'Claude declined to answer.');
        const calls = res.content.filter(b => b.type === 'tool_use');
        if (res.stop !== 'tool_use' || !calls.length) break;
        messages.push({ role: 'assistant', content: res.content });
        const results = await Promise.all(calls.map(async c => {
          const tool = tools.find(t => t.name === c.name);
          const ctl = new AbortController(); const kill = () => ctl.abort();
          if (signal) signal.addEventListener('abort', kill, { once: true });
          const timer = setTimeout(kill, 150000);
          try {
            if (!tool) throw new Error('No tool called ' + c.name);
            let out = await tool.execute(c.input || {}, { signal: ctl.signal });
            out = typeof out === 'string' ? out : JSON.stringify(out === undefined ? null : out);
            return { type: 'tool_result', tool_use_id: c.id, content: out.slice(0, 32768) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: c.id, content: 'Error: ' + (e && e.message || e), is_error: true };
          } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', kill); }
        }));
        if (signal && signal.aborted) throw err('cancelled', 'Cancelled');
        messages.push({ role: 'user', content: results });
      }
    } catch (e) {
      const code = signal && signal.aborted ? 'cancelled' : e.code || 'upstream_error';
      throw err(code, e.message, { text: full });
    }
    if (!full.trim()) throw err('empty_completion', 'No answer came back.');
    return { text: full, truncated, modelTierApplied: options.modelTier === 'quick' || options.modelTier === 'complex' ? options.modelTier : 'default' };
  }
  sample.json = async (input, options) => {
    const { text } = await sample(input, options);
    const tries = [text, (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], (() => { const a = text.search(/[[{]/), b = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')); return a >= 0 && b > a ? text.slice(a, b + 1) : null; })()];
    for (const t of tries) { if (t == null) continue; try { return JSON.parse(t); } catch (e) {} }
    throw err('invalid_json', 'The answer was not JSON.', { text });
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 }, modelTiers: ['default', 'quick', 'complex'] });

  /* ---------------- dictation (Web Speech API) ---------------- */
  function makeDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const subs = { partial: new Set(), final: new Set(), state: new Set() };
    const on = set => h => { set.add(h); return () => set.delete(h); };
    const fire = (set, e) => set.forEach(h => { try { h(e); } catch (x) { console.error(x); } });
    let rec = null, state = 'idle', spoken = false, stopWaiters = [];
    const setState = (s, reason) => { state = s; fire(subs.state, s === 'idle' && reason ? { state: s, reason } : { state: s }); };
    const map = e => (e === 'not-allowed' || e === 'service-not-allowed' ? 'not_granted' : e === 'language-not-supported' ? 'unavailable' : e === 'aborted' || e === 'no-speech' ? 'stopped' : 'upstream_error');
    return {
      start(opts) {
        if (state === 'listening') return Promise.resolve();
        return new Promise((resolve, reject) => {
          const r = rec = new SR();
          r.lang = (opts && opts.language) || document.documentElement.lang || navigator.language || 'en-ZA';
          r.continuous = true; r.interimResults = true;
          let started = false, reason = 'stopped';
          r.onstart = () => { started = true; setState('listening'); resolve(); };
          r.onresult = e => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const res = e.results[i], t = res[0].transcript.trim();
              if (res.isFinal) { if (t) { fire(subs.final, { text: (spoken ? ' ' : '') + t }); spoken = true; } } else interim += res[0].transcript;
            }
            fire(subs.partial, { text: interim.trim() });
          };
          r.onerror = e => { reason = map(e.error); };
          r.onend = () => {
            fire(subs.partial, { text: '' }); rec = null; setState('idle', reason);
            if (!started) reject({ code: reason, message: 'Dictation did not start.' });
            stopWaiters.splice(0).forEach(f => f());
          };
          setState('starting');
          try { r.start(); } catch (e) { rec = null; setState('idle', 'upstream_error'); reject({ code: 'upstream_error', message: String(e) }); }
        });
      },
      stop() {
        if (!rec) return Promise.resolve();
        setState('finishing');
        return new Promise(res => { stopWaiters.push(res); try { rec.stop(); } catch (e) { res(); } });
      },
      active: () => state !== 'idle',
      onPartial: on(subs.partial),
      onFinal: on(subs.final),
      onState: h => { const u = on(subs.state)(h); if (state !== 'idle') setTimeout(() => h({ state }), 0); return u; },
    };
  }
  let dict;

  /* ---------------- window.claude ---------------- */
  window.claude = {
    standalone: true,
    use: async name => {
      switch (name) {
        case 'db': return db;
        case 'assets': return assets;
        case 'user': return user;
        case 'downloads': return downloads;
        case 'sample': return (await cfgP).ask ? sample : null;
        case 'dictation': if (dict === undefined) dict = makeDictation(); return dict;
        default: throw err('not_declared', 'The standalone server does not provide "' + name + '".');
      }
    },
  };
})();
