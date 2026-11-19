'use strict';
/*
 * The daily 7am inspection reminder, in code.
 *
 * Today this reminder is sent by a Claude scheduled task that reads the Fleet app's database
 * every morning at 06:58 (Africa/Johannesburg) and follows the rules in
 * docs/REMINDER_PROMPT.md. This file is the same rules as plain code, so the Hub can run it
 * from its own scheduler and send it through the Hub's own Slack app / email.
 *
 *   node server/reminder.js                   today's reminder (South African date), printed
 *   node server/reminder.js --date 2026-11-17 the reminder for another day
 *   node server/reminder.js --post            also post it to SLACK_WEBHOOK_URL
 *   node server/reminder.js --json            the sections as JSON
 *
 * buildReminder(data, today) is pure: data = {fleet, trips, records, config} as
 * {docId: document} maps, today = 'YYYY-MM-DD'. It returns {subject, text, sections, empty}.
 */
const path = require('path');
const fs = require('fs');

const KM = { inspect: 5000, service: 10000, warn: 500 };
const B2B = 'Workshop inspection (bumper to bumper)';
const SERVICE = 'Service';
const SKIP = ['For sale', 'Off the road'];
const AWAY = ['On a trip', 'In workshop'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- dates (ISO strings, no time zones) ---------- */
const D = iso => new Date(iso + 'T00:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekday = s => D(s).getUTCDay() || 7; // Mon=1 .. Sun=7
const weekStart = s => addDays(s, 1 - weekday(s));
const monthStart = s => s.slice(0, 8) + '01';
const short = s => `${D(s).getUTCDate()} ${MON[D(s).getUTCMonth()]}`;
const dayName = s => DAY[D(s).getUTCDay()];
const range = (a, b) => (!b || a === b ? short(a) : `${short(a)} – ${short(b)}`);
const overlaps = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
const fmtKm = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function todayInSA(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function buildReminder(data, today, opts = {}) {
  const appUrl = opts.appUrl || process.env.APP_URL || 'http://localhost:8787';
  const config = data.config || {};
  const sched = config.schedule || {};
  const assign = sched.assign || {};
  const weeklyOnly = sched.weeklyOnly || [];
  const checklist = config.checklist;
  const monthlyInUse = !!(checklist && (checklist.sections || []).some(s => (s.items || []).some(i => (i.in || []).includes('monthly'))));

  const fleet = Object.entries(data.fleet || {}).map(([id, v]) => Object.assign({ id }, v));
  const trips = Object.entries(data.trips || {}).map(([id, t]) => Object.assign({ id }, t));
  const records = Object.entries(data.records || {}).map(([id, r]) => Object.assign({ id }, r));
  const label = v => `${v.name}${v.reg ? ` (${v.reg})` : ''}`;
  const tripsOf = vid => trips.filter(t => t.vehicleId === vid && t.from && t.to);
  const tripOn = (vid, d) => tripsOf(vid).find(t => t.from <= d && d <= t.to);
  const active = fleet.filter(v => !SKIP.includes(v.status));
  const planned = (v, d) => addDays(weekStart(d), Number(assign[v.id]) - 1);
  const doneInWeek = (v, ws) => !!(v.lastCheck && v.lastCheck.date && v.lastCheck.date >= ws && v.lastCheck.date <= addDays(ws, 6));
  const kindFor = (v, p) => (monthlyInUse && !weeklyOnly.includes(weekStart(p)) && !(v.lastMonthly && v.lastMonthly.date && v.lastMonthly.date >= monthStart(p)) ? 'monthly check' : 'weekly check');

  const S = { today: [], tomorrow: [], in2: [], still: [], clashes: [], trips: [], postponed: [], workshop: [], km: [], cards: [] };
  const scheduled = active.filter(v => assign[v.id]);

  // Today, tomorrow and the day after
  [['today', 0], ['tomorrow', 1], ['in2', 2]].forEach(([key, n]) => {
    const day = addDays(today, n);
    for (const v of scheduled) {
      if (Number(assign[v.id]) !== weekday(day) || doneInWeek(v, weekStart(day))) continue;
      const t = tripOn(v.id, day);
      if (t) S.postponed.push(`${label(v)}: away until ${short(t.to)} (${t.label || 'trip'}), check when it's back`);
      else if (AWAY.includes(v.status)) S.postponed.push(`${label(v)}: ${v.status === 'On a trip' ? 'on a trip' : 'at the workshop'}, check when it's back`);
      else S[key].push(`${label(v)} – ${kindFor(v, day)}`);
    }
  });

  // Still to do this week
  const ws = weekStart(today);
  for (const v of scheduled) {
    const p = planned(v, today);
    if (p >= today || doneInWeek(v, ws)) continue;
    if (tripOn(v.id, today) || AWAY.includes(v.status)) continue;
    const endedTrip = tripsOf(v.id).filter(t => t.from <= p && p <= t.to && t.to < today).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    const back = v.statusSince && v.statusSince >= p ? v.statusSince : endedTrip ? endedTrip.to : null;
    S.still.push(`${label(v)} – ${kindFor(v, p)}, ${back ? `back since ${short(back)}, check now` : `overdue since ${dayName(p)} ${short(p)}`}`);
  }

  // Workshop visits = booked records + each vehicle's followUp (not counted twice)
  const bookedIds = new Set(records.filter(r => r.status === 'booked').map(r => r.id));
  const visits = records.filter(r => r.status === 'booked' && r.date).map(r => ({ vehicleId: r.vehicleId, from: r.date, to: r.until || r.date, kind: r.kind || 'Workshop visit', provider: r.provider || '' }));
  for (const v of fleet) {
    const f = v.followUp;
    if (f && f.date && !(f.recId && bookedIds.has(f.recId))) visits.push({ vehicleId: v.id, from: f.date, to: f.until || f.date, kind: f.kind || 'Workshop visit', provider: f.provider || '' });
  }
  const vmap = Object.fromEntries(fleet.map(v => [v.id, v]));

  // Clashes
  for (const w of visits) {
    if (w.to < today || !vmap[w.vehicleId]) continue;
    for (const t of tripsOf(w.vehicleId)) {
      if (t.to >= today && overlaps(w.from, w.to, t.from, t.to)) S.clashes.push(`${vmap[w.vehicleId].name}: ${w.kind} (${range(w.from, w.to)}) clashes with ${t.label || 'a trip'} (${range(t.from, t.to)}), sort it out on the Calendar page`);
    }
  }
  for (const v of fleet) {
    const ts = tripsOf(v.id).filter(t => t.to >= today);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      if (overlaps(ts[i].from, ts[i].to, ts[j].from, ts[j].to)) S.clashes.push(`${v.name}: double booked, ${ts[i].label || 'trip'} (${range(ts[i].from, ts[i].to)}) and ${ts[j].label || 'trip'} (${range(ts[j].from, ts[j].to)})`);
    }
  }

  // Trips leaving and coming back
  const tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  for (const t of trips) {
    const v = vmap[t.vehicleId]; if (!v) continue;
    if (t.from === today || t.from === tomorrow) S.trips.push(`${label(v)} leaves ${t.from === today ? 'today' : 'tomorrow'} (${t.label || 'trip'}, back ${short(t.to)}): do a pre-trip check`);
    if ((t.to === yesterday || t.to === today) && !(v.lastPost && v.lastPost.date && v.lastPost.date >= t.to)) S.trips.push(`${label(v)} is back from ${t.label || 'a trip'} (${short(t.to)}): do a post-trip check`);
  }

  // Workshop visits today or tomorrow
  for (const v of fleet) {
    const f = v.followUp;
    if (f && (f.date === today || f.date === tomorrow)) S.workshop.push(`${label(v)}: ${f.kind || 'workshop visit'}${f.provider ? ` at ${f.provider}` : ''}, ${f.date === today ? 'today' : 'tomorrow'}`);
  }

  // Services and inspections by km
  for (const v of active) {
    if (!(v.odometer > 0)) continue;
    const ls = v.lastService && v.lastService.km > 0 ? v.lastService.km : null;
    const lb = v.lastB2B && v.lastB2B.km > 0 ? v.lastB2B.km : null;
    if (ls == null && lb == null) continue;
    const every = v.serviceKm > 0 ? v.serviceKm : KM.service;
    const svcKm = ls != null ? ls + every : null;
    const insKm = Math.max(ls || 0, lb || 0) + KM.inspect;
    const left = km => km - v.odometer;
    const booked = kinds => visits.some(w => w.vehicleId === v.id && w.to >= today && kinds.includes(w.kind));
    const bookedAs = kind => visits.find(w => w.vehicleId === v.id && w.to >= today && w.kind === kind);
    const due = (name, km) => (left(km) < 0 ? `${label(v)}: ${name} overdue by ${fmtKm(-left(km))} km (was due at ${fmtKm(km)} km)` : `${label(v)}: ${name} due in ${fmtKm(left(km))} km (at ${fmtKm(km)} km), book it at the workshop`);
    const combined = svcKm != null && (svcKm <= insKm + KM.warn || (left(svcKm) <= KM.warn && left(insKm) <= KM.warn));
    if (combined) {
      if (left(svcKm) > KM.warn || booked([SERVICE])) continue;
      const b = bookedAs(B2B);
      S.km.push(b ? `${label(v)}: service and bumper-to-bumper inspection due, booked ${short(b.from)} as an inspection only: ask for a service too` : due('Service and bumper-to-bumper inspection', svcKm));
    } else {
      if (svcKm != null && left(svcKm) <= KM.warn && !booked([SERVICE])) S.km.push(due('Service', svcKm));
      if (left(insKm) <= KM.warn && !booked([B2B, SERVICE])) S.km.push(due('Bumper-to-bumper inspection', insKm));
    }
  }

  // In-car guides (Mondays only)
  if (weekday(today) === 1) {
    for (const v of active) {
      const c = v.cardPrinted;
      if (!c || !c.date) S.cards.push(`${label(v)}: print and laminate the in-car guide (Manual tab)`);
      else if (c.stale) S.cards.push(`${label(v)}: in-car guide out of date, print a new one`);
      else if (addDays(c.date, 182) <= today) S.cards.push(`${label(v)}: in-car guide is 6 months old, print a new one`);
    }
  }

  const TITLES = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['in2', 'In 2 days'], ['still', 'Still to do this week'], ['clashes', 'Clashes'], ['trips', 'Trips'], ['postponed', 'Postponed'], ['workshop', 'Workshop visits'], ['km', 'Services and inspections'], ['cards', 'In-car guides']];
  const empty = TITLES.every(([k]) => !S[k].length);
  const count = S.today.length ? `${S.today.length} due today` : S.tomorrow.length ? `nothing due today, ${S.tomorrow.length} due tomorrow` : S.in2.length ? `nothing due today, ${S.in2.length} due in 2 days` : 'nothing due today';
  const subject = `FFSA inspections – ${dayName(today)}, ${short(today)}: ${count}`;
  const body = TITLES.filter(([k]) => S[k].length).map(([k, t]) => `${t}\n${S[k].map(l => '• ' + l).join('\n')}`).join('\n\n');
  const text = `${body}\n\nOpen the inspection app: ${appUrl}`;
  return { subject, text, sections: S, empty };
}

/* ---------- command line ---------- */
async function main() {
  const args = process.argv.slice(2);
  const arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const ROOT = path.join(__dirname, '..');
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); }
  const dbFile = path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data'), 'db.json');
  if (!fs.existsSync(dbFile)) { console.error('No data yet: run "npm run seed" first.'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const today = arg('--date') || todayInSA();
  const r = buildReminder(data, today);
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  if (r.empty) { console.log(`Nothing to send for ${today}.`); return; }
  console.log(`Subject: ${r.subject}\n\n${r.text}`);
  if (args.includes('--post')) {
    const hook = process.env.SLACK_WEBHOOK_URL;
    if (!hook) { console.error('\nSet SLACK_WEBHOOK_URL to post it.'); process.exit(1); }
    const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${r.subject}*\n\n${r.text}` }) });
    console.log(`\nSlack: ${res.status} ${await res.text()}`);
    if (!res.ok) process.exit(1);
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { buildReminder, todayInSA, KM };
