'use strict';
/*
 * Load FFSA's real data into the standalone server's store.
 *
 *   npm run seed            first time (refuses if data already exists)
 *   npm run seed -- --force wipe the local data and load the seed again
 *
 * Reads seed/db/<collection>.json ({docId: document}) and seed/files/ (photos and PDFs,
 * listed in seed/files/index.json). File ids are kept, so every "/_blob/<id>" the data
 * points at still works.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const force = process.argv.includes('--force');
const dbFile = path.join(dataDir, 'db.json');

if (fs.existsSync(dbFile) && !force) {
  console.error(`There is already data in ${dataDir}. Run "npm run seed -- --force" to replace it with the seed.`);
  process.exit(1);
}
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(dataDir, 'blobs'), { recursive: true });

const db = {};
const seedDb = path.join(ROOT, 'seed', 'db');
for (const f of fs.readdirSync(seedDb).filter(f => f.endsWith('.json'))) {
  const docs = JSON.parse(fs.readFileSync(path.join(seedDb, f), 'utf8'));
  if (Object.keys(docs).length) db[f.slice(0, -5)] = docs;
}
fs.writeFileSync(dbFile, JSON.stringify(db));

const filesDir = path.join(ROOT, 'seed', 'files');
const index = JSON.parse(fs.readFileSync(path.join(filesDir, 'index.json'), 'utf8'));
const blobs = {};
for (const f of index) {
  const buf = fs.readFileSync(path.join(filesDir, f.file));
  fs.writeFileSync(path.join(dataDir, 'blobs', f.id), buf);
  blobs[f.id] = { contentType: f.contentType, sizeBytes: buf.length, createdAt: '2026-11-16T00:00:00Z', by: 'seed' };
}
fs.writeFileSync(path.join(dataDir, 'blobs', 'index.json'), JSON.stringify(blobs, null, 1));

console.log('Seeded', Object.entries(db).map(([c, d]) => `${c}: ${Object.keys(d).length}`).join(', '), `| files: ${index.length}`);
