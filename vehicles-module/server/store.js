'use strict';
/*
 * A tiny document store with the same behaviour as the claude.ai artifact database
 * the FFSA Fleet app was written for (Firestore-like):
 *   - collections of JSON documents, addressed as "collection/docId"
 *   - set = full replace (creates if missing)
 *   - update = deep merge into an EXISTING document (nested plain objects merge,
 *     arrays and everything else replace; {"__delete__": true} removes a field)
 *   - queries: where (==, !=, <, <=, >, >=, in, not-in, array-contains), one orderBy, limit
 *
 * Everything lives in memory and is saved to DATA_DIR/db.json (atomic write, debounced).
 * This is for running and testing the app next to the Hub. In the Hub, replace it with
 * the Hub's own database (see CLAUDE.md).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isPlain(v) && v.__delete__ === true) { delete target[k]; continue; }
    if (isPlain(v) && isPlain(target[k])) { deepMerge(target[k], v); continue; }
    target[k] = isPlain(v) ? stripDeletes(clone(v)) : clone(v);
  }
  return target;
}
function stripDeletes(o) {
  for (const [k, v] of Object.entries(o)) {
    if (isPlain(v) && v.__delete__ === true) delete o[k];
    else if (isPlain(v)) stripDeletes(v);
  }
  return o;
}

// Firestore-ish ordering across types: null < boolean < number < string < other
function typeRank(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 2;
  if (typeof v === 'string') return 3;
  return 4;
}
function cmp(a, b) {
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 4) return JSON.stringify(a).localeCompare(JSON.stringify(b));
  return a < b ? -1 : a > b ? 1 : 0;
}
const OPS = {
  '==': (a, b) => a !== undefined && JSON.stringify(a) === JSON.stringify(b),
  '!=': (a, b) => a !== undefined && JSON.stringify(a) !== JSON.stringify(b),
  '<': (a, b) => a !== undefined && typeRank(a) === typeRank(b) && cmp(a, b) < 0,
  '<=': (a, b) => a !== undefined && typeRank(a) === typeRank(b) && cmp(a, b) <= 0,
  '>': (a, b) => a !== undefined && typeRank(a) === typeRank(b) && cmp(a, b) > 0,
  '>=': (a, b) => a !== undefined && typeRank(a) === typeRank(b) && cmp(a, b) >= 0,
  'in': (a, b) => Array.isArray(b) && b.some(x => JSON.stringify(x) === JSON.stringify(a)),
  'not-in': (a, b) => a !== undefined && Array.isArray(b) && !b.some(x => JSON.stringify(x) === JSON.stringify(a)),
  'array-contains': (a, b) => Array.isArray(a) && a.some(x => JSON.stringify(x) === JSON.stringify(b)),
};

const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function checkName(s, what) {
  if (typeof s !== 'string' || !SEG.test(s) || s === '.' || s === '..') {
    const e = new Error(`Invalid ${what}: ${s}`); e.code = 'invalid_argument'; e.status = 400; throw e;
  }
}

class Store extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.data = {};
    this._timer = null;
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  _save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 50);
  }
  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  _changed(coll, id, op) { this._save(); this.emit('change', { coll, id, op }); }

  get(coll, id) {
    checkName(coll, 'collection'); checkName(id, 'document id');
    const d = (this.data[coll] || {})[id];
    return d ? clone(d) : null;
  }
  set(coll, id, doc) {
    checkName(coll, 'collection'); checkName(id, 'document id');
    if (!isPlain(doc)) { const e = new Error('A document must be a JSON object.'); e.code = 'invalid_argument'; e.status = 400; throw e; }
    (this.data[coll] = this.data[coll] || {})[id] = stripDeletes(clone(doc));
    this._changed(coll, id, 'set');
  }
  update(coll, id, patch) {
    checkName(coll, 'collection'); checkName(id, 'document id');
    const cur = (this.data[coll] || {})[id];
    if (!cur) { const e = new Error(`No document ${coll}/${id} to update.`); e.code = 'invalid_argument'; e.status = 400; throw e; }
    if (!isPlain(patch)) { const e = new Error('An update must be a JSON object.'); e.code = 'invalid_argument'; e.status = 400; throw e; }
    deepMerge(cur, patch);
    this._changed(coll, id, 'update');
  }
  delete(coll, id) {
    checkName(coll, 'collection'); checkName(id, 'document id');
    if (this.data[coll] && this.data[coll][id]) { delete this.data[coll][id]; this._changed(coll, id, 'delete'); }
  }
  /** q = {where: [[field, op, value], ...], orderBy: field, dir: 'asc'|'desc', limit: n} */
  query(coll, q = {}) {
    checkName(coll, 'collection');
    let rows = Object.entries(this.data[coll] || {});
    for (const [f, op, v] of q.where || []) {
      const fn = OPS[op];
      if (!fn) { const e = new Error(`Unknown operator ${op}`); e.code = 'invalid_argument'; e.status = 400; throw e; }
      rows = rows.filter(([, d]) => fn(d[f], v));
    }
    if (q.orderBy) {
      const f = q.orderBy, s = q.dir === 'desc' ? -1 : 1;
      rows.sort(([ia, a], [ib, b]) => {
        const ma = a[f] === undefined, mb = b[f] === undefined;
        if (ma !== mb) return ma ? 1 : -1; // missing field sorts last
        return s * cmp(a[f], b[f]) || (ia < ib ? -1 : 1);
      });
    } else rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (q.limit) rows = rows.slice(0, Math.max(1, Math.min(1000, q.limit | 0)));
    return rows.map(([id, d]) => ({ id, data: clone(d) }));
  }
  collections() { return Object.keys(this.data); }
  dump() { return clone(this.data); }
}

module.exports = { Store, deepMerge };
