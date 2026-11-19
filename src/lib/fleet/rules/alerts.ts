// Needs attention (SPEC 6.3). Reference: vehicleAlerts, worst in
// vehicles-module/app/ffsa-fleet.html. Ported line by line.

import { clashList, tripName, tripsOf } from "./bookings";
import { cardStatus } from "./card";
import { condCounts } from "./checklist";
import { addDays, daysUntil, fmtDate, fmtDay, fmtKm, has, plural } from "./format";
import { kmAlerts, nextService } from "./km";
import { weekly } from "./schedule";
import type { Alert, FleetData, FleetVehicle, Sev } from "./types";

export function vehicleAlerts(F: FleetData, v: FleetVehicle): Alert[] {
  const out: Alert[] = [];
  const today = F.today;
  if (v.licenceExpiry) {
    const d = daysUntil(v.licenceExpiry, today);
    if (d < 0) out.push({ sev: "crit", text: `Licence disc expired ${fmtDate(v.licenceExpiry)}` });
    else if (d <= 30) out.push({ sev: "warn", text: `Licence disc expires in ${plural(d, "day")} (${fmtDate(v.licenceExpiry)})` });
  } else out.push({ sev: "info", text: "Licence disc expiry date not captured" });
  const ns = nextService(v, today);
  const kmA = kmAlerts(F, v);
  out.push(...kmA);
  if (ns && !kmA.some((a) => a.svc)) {
    if (has(ns.daysLeft) && (ns.daysLeft as number) < 0) out.push({ sev: "crit", text: `Service overdue since ${fmtDate(ns.date)}` });
    else if (has(ns.daysLeft) && (ns.daysLeft as number) <= 30) out.push({ sev: "warn", text: `Service due ${fmtDate(ns.date)}` });
  }
  if (!(v.lastService && has(v.lastService.km)))
    out.push({ sev: "info", text: "Odometer reading at the last service not captured: the next service can’t be worked out" });
  if (!(v.lastService && has(v.lastService.km)) && !(v.lastB2B && has(v.lastB2B.km)))
    out.push({ sev: "info", text: "Odometer reading at the last bumper-to-bumper inspection not captured" });
  const fu = v.followUp;
  if (fu && (fu.date || has(fu.km))) {
    let sev: Sev | null = null,
      txt = "";
    const what = fu.kind ? ` (${fu.kind}${fu.provider ? ", " + fu.provider : ""})` : "";
    if (fu.date) {
      const d = daysUntil(fu.date, today);
      if (d < 0) {
        sev = "crit";
        txt = `Workshop visit overdue since ${fmtDate(fu.date)}`;
      } else if (d <= 14) {
        sev = "warn";
        txt = d === 0 ? "Workshop visit today" : `Workshop visit ${fmtDay(fu.date)}`;
      }
    }
    if (!sev && has(fu.km) && has(v.odometer)) {
      const left = (fu.km as number) - (v.odometer as number);
      if (left < 0) {
        sev = "crit";
        txt = `Workshop visit overdue by ${fmtKm(-left)}`;
      } else if (left <= 1000) {
        sev = "warn";
        txt = `Workshop visit due in ${fmtKm(left)}`;
      }
    }
    if (sev) out.push({ sev, text: txt + what });
  }
  for (const cx of clashList(F)) if (cx.vehicleId === v.id) out.push({ sev: cx.sev, text: cx.text });
  const c = condCounts(F.checklist, v);
  if (c.fix) out.push({ sev: "crit", text: `${plural(c.fix, "item")} marked Fix now`, tab: "condition" });
  if (c.mon) out.push({ sev: "warn", text: `${plural(c.mon, "item")} to monitor`, tab: "condition" });
  const w = weekly(F, v);
  if (w.st === "today") out.push({ sev: "warn", text: `${w.name} due today` });
  else if (w.st === "due") out.push({ sev: "warn", text: `${w.name} due now (back since ${fmtDay(w.back)})` });
  else if (w.st === "overdue") out.push({ sev: "warn", text: `${w.name} overdue (planned for ${fmtDay(w.date)})` });
  else if (w.st === "none") out.push({ sev: "info", text: "No weekly inspection day set" });
  const tomorrow = addDays(today, 1),
    weekAgo = addDays(today, -7);
  for (const t of tripsOf(F, v.id)) {
    if (t.from === today || t.from === tomorrow)
      out.push({ sev: "warn", text: `Leaves ${t.from === today ? "today" : "tomorrow"} (${tripName(t)}, back ${fmtDay(t.to)}): do a pre-trip check` });
    if (t.to <= today && t.to >= weekAgo && !(v.lastPost && (v.lastPost.date || "") >= t.to))
      out.push({ sev: "warn", text: `Back from ${tripName(t)} on ${fmtDay(t.to)}: do a post-trip check` });
  }
  if (!["For sale", "Off the road"].includes(v.status || "")) {
    const cs = cardStatus(v, F.notify, today);
    if (cs.st === "none") out.push({ sev: "info", text: "In-car guide not printed yet", tab: "manual" });
    else if (cs.st === "stale") out.push({ sev: "warn", text: "In-car guide is out of date: print a new one", tab: "manual" });
    else if (cs.st === "old") out.push({ sev: "warn", text: "In-car guide is 6 months old: print a new one", tab: "manual" });
  }
  return out;
}

export function worst(alerts: Alert[]): "crit" | "warn" | "ok" {
  if (alerts.some((a) => a.sev === "crit")) return "crit";
  if (alerts.some((a) => a.sev === "warn")) return "warn";
  return "ok";
}
