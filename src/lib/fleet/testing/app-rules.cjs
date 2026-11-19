// Test helper: loads the rule functions out of the reference app (vehicles-module/app/ffsa-fleet.html)
// into a sandbox, so parity.test.ts can compare them with the TypeScript port. Tests only.
/* eslint-disable */
const fs = require('fs'), vm = require('vm');
module.exports = function load(htmlPath) {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const cut = (a, b) => { const i = h.indexOf(a); const j = h.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error('marker ' + a + ' / ' + b); return h.slice(i, j); };
  const parts = [
    cut('const TYPES = [', '/* Why and how for each checklist point.'),
    cut('const PROFILES =', '/* In-car guide for drivers'),
    cut('const WATCH_KIND =', 'function attnListHTML'),
    cut('/* ---------- Where things are ---------- */', 'const _staleMarked'),
    cut('const pad2 =', 'const blob ='),
    cut('const clone =', '/* ---------- State ---------- */'),
    cut('/* ---------- Derived data ---------- */', 'function statusPill'),
    cut('/* Where a vehicle\'s weekly check stands in the week starting ws (a Monday). */\nfunction weekly', 'function clashHTML'),
    cut('function lastProvider', 'function bookGapBtn'),
    cut('/* ---------- Km readings ---------- */', 'const kmLastLine'),
    cut('const budgetMins', 'function timePanel'),
    cut('function todayTasks', 'function taskHTML'),
  ];
  const weeklyOnlyLine = h.match(/const weeklyOnly = ws => .*\n/)[0];
  const src = `var TODAY='2026-11-17';
    const S = {vehicles:[], vmap:{}, providers:[], checklist:null, sched:null, notify:null, trips:[], bookings:[], timelog:[], vdata:{id:null, loaded:{}}, canWrite:true};
    const esc = s => String(s), startBtn = (v, type) => 'start:' + type, bookGapBtn = (v, kind, g) => 'book:' + kind + ':' + (g ? g.from + '>' + g.to : '');
    ${parts.join('\n')}
    ${weeklyOnlyLine}
    todayISO = () => TODAY;`;
  // todayISO is a const in the app; make it reassignable.
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.replace('const todayISO = () =>', 'var todayISO = () =>') + `
    ;globalThis.__api = { S, setToday: t => { TODAY = t; }, vehicleAlerts, todayTasks, clashList, weekly, kmAlerts, cardStatus, attentionFor, suggestGap, alternatives };`, ctx);
  return ctx.__api;
};
